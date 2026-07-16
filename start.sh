#!/usr/bin/env bash
# start.sh — Bring up the full Karunya/OpenMAIC dev stack on ANY machine.
#
# Portable by design: it does not assume the default ports are free, does not
# assume a particular GPU (or any GPU), and runs the Next.js app as a plain
# host process (not Docker) so it never depends on the app container's build
# step (which needs apt-get network access + an arch/glibc match with the
# host — fragile across machines; see Dockerfile.dev).
#
# Usage:
#   ./start.sh                 App + Postgres/Redis/MinIO, LLM via host Ollama.
#   ./start.sh --with-models   Also start local TTS (VoxCPM2) + image gen
#                              (SDXL) if an NVIDIA GPU is present. Builds
#                              their Python venvs on first run — large
#                              downloads (~2-3GB total).
#   ./start.sh stop            Stop everything a previous run of this script started.
#
# Env overrides (all optional — auto-picked if unset/taken):
#   MAIC_APP_PORT, MAIC_PG_PORT, MAIC_REDIS_PORT, MAIC_MINIO_API_PORT,
#   MAIC_MINIO_CONSOLE_PORT, MAIC_TTS_PORT, MAIC_IMAGE_PORT
#   MAIC_DEFAULT_MODEL (provider:model), MAIC_OLLAMA_URL, MAIC_OLLAMA_MODELS
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT/OpenMAIC"
RUN_DIR="$ROOT/.run"
COMPOSE_FILE="$ROOT/docker-compose.dev.yml"
mkdir -p "$RUN_DIR"

WITH_MODELS=0
DO_STOP=0
for arg in "$@"; do
  case "$arg" in
    --with-models) WITH_MODELS=1 ;;
    stop|--stop) DO_STOP=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown argument: $arg (see --help)"; exit 1 ;;
  esac
done

log()  { printf '\n==> %s\n' "$1"; }
warn() { printf 'WARNING: %s\n' "$1" >&2; }

# -----------------------------------------------------------------------------
# stop mode
# -----------------------------------------------------------------------------
if [[ "$DO_STOP" -eq 1 ]]; then
  log "Stopping app"
  if [[ -f "$RUN_DIR/app.pid" ]]; then
    kill "$(cat "$RUN_DIR/app.pid")" 2>/dev/null || true
    rm -f "$RUN_DIR/app.pid"
  fi
  if [[ -f "$RUN_DIR/tts.port" ]]; then
    log "Stopping TTS server"
    (cd "$ROOT/deploy/tts-voxcpm" && PORT="$(cat "$RUN_DIR/tts.port")" ./stop.sh || true)
    rm -f "$RUN_DIR/tts.port"
  fi
  if [[ -f "$RUN_DIR/image.port" ]]; then
    log "Stopping image server"
    (cd "$ROOT/deploy/image-sdxl" && PORT="$(cat "$RUN_DIR/image.port")" ./stop.sh || true)
    rm -f "$RUN_DIR/image.port"
  fi
  log "Stopping Postgres/Redis/MinIO"
  docker compose -f "$COMPOSE_FILE" down
  echo "Stopped."
  exit 0
fi

# -----------------------------------------------------------------------------
# prerequisites
# -----------------------------------------------------------------------------
log "Checking prerequisites"
for cmd in docker node pnpm curl ss; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Missing required command: $cmd"; exit 1; }
done
docker compose version >/dev/null 2>&1 || { echo "docker compose plugin not found"; exit 1; }

# -----------------------------------------------------------------------------
# port allocation — never assume a default port is free on this machine
# -----------------------------------------------------------------------------
declare -a _USED_PORTS=()
port_taken() {
  ss -tln 2>/dev/null | awk '{print $4}' | grep -qE "[.:]$1\$"
}
find_free_port() {
  local p=$1
  while port_taken "$p" || [[ " ${_USED_PORTS[*]:-} " == *" $p "* ]]; do p=$((p + 1)); done
  _USED_PORTS+=("$p")
  echo "$p"
}

log "Resolving free ports"
export MAIC_APP_PORT="${MAIC_APP_PORT:-$(find_free_port 3000)}"
export MAIC_PG_PORT="${MAIC_PG_PORT:-$(find_free_port 5433)}"
export MAIC_REDIS_PORT="${MAIC_REDIS_PORT:-$(find_free_port 6379)}"
export MAIC_MINIO_API_PORT="${MAIC_MINIO_API_PORT:-$(find_free_port 9000)}"
export MAIC_MINIO_CONSOLE_PORT="${MAIC_MINIO_CONSOLE_PORT:-$(find_free_port 9001)}"
echo "  app=$MAIC_APP_PORT  postgres=$MAIC_PG_PORT  redis=$MAIC_REDIS_PORT  minio=$MAIC_MINIO_API_PORT/$MAIC_MINIO_CONSOLE_PORT"

# -----------------------------------------------------------------------------
# data infra (Postgres/Redis/MinIO) — plain prebuilt images, no build step
# -----------------------------------------------------------------------------
log "Starting Postgres/Redis/MinIO"
docker compose -f "$COMPOSE_FILE" up -d postgres redis minio

log "Waiting for Postgres to be ready"
for _ in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U maic -d maic >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# -----------------------------------------------------------------------------
# app deps (host-side; the app runs as a host process, not in Docker)
# -----------------------------------------------------------------------------
if [[ ! -d "$APP_DIR/node_modules" ]]; then
  log "node_modules missing — running pnpm install (this also builds workspace packages)"
  (cd "$APP_DIR" && pnpm install)
fi

log "Running DB migrations"
(cd "$APP_DIR" && DATABASE_URL="postgresql://maic:maic_dev_pw@localhost:${MAIC_PG_PORT}/maic" pnpm exec drizzle-kit migrate)

log "Seeding dev users (idempotent)"
(cd "$APP_DIR" && DATABASE_URL="postgresql://maic:maic_dev_pw@localhost:${MAIC_PG_PORT}/maic" pnpm tsx lib/db/seed.ts)

# -----------------------------------------------------------------------------
# optional: local TTS (VoxCPM2) + image gen (SDXL), GPU-gated
# -----------------------------------------------------------------------------
if [[ "$WITH_MODELS" -eq 1 ]]; then
  if ! command -v nvidia-smi >/dev/null 2>&1 || ! nvidia-smi >/dev/null 2>&1; then
    warn "--with-models requested but no NVIDIA GPU detected — skipping TTS/image."
  else
    export MAIC_TTS_PORT="${MAIC_TTS_PORT:-$(find_free_port 8000)}"
    export MAIC_IMAGE_PORT="${MAIC_IMAGE_PORT:-$(find_free_port 8001)}"

    if [[ ! -x "$ROOT/deploy/tts-voxcpm/.venv/bin/python" ]]; then
      log "Building TTS venv (first run only — large download)"
      (cd "$ROOT/deploy/tts-voxcpm" && uv venv --python 3.12 .venv \
        && UV_HTTP_TIMEOUT=300 UV_CONCURRENT_DOWNLOADS=1 uv pip install --python .venv/bin/python torch --index-url https://download.pytorch.org/whl/cu128 \
        && UV_HTTP_TIMEOUT=300 UV_CONCURRENT_DOWNLOADS=1 uv pip install --python .venv/bin/python numpy soundfile fastapi uvicorn voxcpm \
        && UV_HTTP_TIMEOUT=300 UV_CONCURRENT_DOWNLOADS=1 uv pip install --python .venv/bin/python --reinstall-package torchaudio torchaudio --index-url https://download.pytorch.org/whl/cu128)
    fi
    log "Starting TTS server on :$MAIC_TTS_PORT"
    (cd "$ROOT/deploy/tts-voxcpm" && PORT="$MAIC_TTS_PORT" ./start.sh) && echo "$MAIC_TTS_PORT" > "$RUN_DIR/tts.port"

    if [[ ! -x "$ROOT/deploy/image-sdxl/.venv/bin/python" ]]; then
      log "Building image-gen venv (first run only — large download)"
      (cd "$ROOT/deploy/image-sdxl" && uv venv --python 3.12 .venv \
        && UV_HTTP_TIMEOUT=300 UV_CONCURRENT_DOWNLOADS=1 uv pip install --python .venv/bin/python torch --index-url https://download.pytorch.org/whl/cu128 \
        && UV_HTTP_TIMEOUT=300 UV_CONCURRENT_DOWNLOADS=1 uv pip install --python .venv/bin/python diffusers transformers accelerate safetensors pillow sentencepiece fastapi uvicorn)
    fi
    log "Starting image-gen server on :$MAIC_IMAGE_PORT"
    (cd "$ROOT/deploy/image-sdxl" && PORT="$MAIC_IMAGE_PORT" ./start.sh) && echo "$MAIC_IMAGE_PORT" > "$RUN_DIR/image.port"
  fi
fi

# -----------------------------------------------------------------------------
# the app itself — host process (see header comment for why not Docker)
# -----------------------------------------------------------------------------
log "Starting the app on :$MAIC_APP_PORT"
(
  cd "$APP_DIR"
  export NODE_ENV=development
  export NEXT_TELEMETRY_DISABLED=1
  export ALLOW_LOCAL_NETWORKS=true
  export NEXT_PUBLIC_MAIC_EDITOR_ENABLED=true
  export PARALLEL_SCENE_CONCURRENCY=4
  export DEFAULT_MODEL="${MAIC_DEFAULT_MODEL:-ollama:qwen3.6:35b}"
  export OLLAMA_BASE_URL="${MAIC_OLLAMA_URL:-http://localhost:11434/v1}"
  export OLLAMA_MODELS="${MAIC_OLLAMA_MODELS:-qwen3.6:35b,qwen3.6:27b,gemma4:31b,gpt-oss:120b,gpt-oss:20b,qwen3.5:9b,deepseek-r1:70b}"
  export DATABASE_URL="postgresql://maic:maic_dev_pw@localhost:${MAIC_PG_PORT}/maic"
  export REDIS_URL="redis://localhost:${MAIC_REDIS_PORT}"
  export SESSION_SECRET="dev-session-secret-change-me"
  export AUTH_MODE=dev
  export S3_ENDPOINT="http://localhost:${MAIC_MINIO_API_PORT}"
  export S3_ACCESS_KEY=maic
  export S3_SECRET_KEY=maic_dev_pw
  export S3_BUCKET=maic-media
  [[ -f "$RUN_DIR/tts.port" ]] && export TTS_VOXCPM_BASE_URL="http://localhost:$(cat "$RUN_DIR/tts.port")/v1"
  [[ -f "$RUN_DIR/image.port" ]] && export IMAGE_LEMONADE_BASE_URL="http://localhost:$(cat "$RUN_DIR/image.port")/v1"
  nohup pnpm dev -p "$MAIC_APP_PORT" > "$RUN_DIR/app.log" 2>&1 &
  echo $! > "$RUN_DIR/app.pid"
)

log "Waiting for the app to respond"
ready=0
for _ in $(seq 1 40); do
  if curl -s -o /dev/null "http://localhost:${MAIC_APP_PORT}/api/health"; then ready=1; break; fi
  sleep 1
done

echo
echo "============================================================"
if [[ "$ready" -eq 1 ]]; then
  echo "READY: http://localhost:${MAIC_APP_PORT}"
else
  echo "App did not respond within 40s — check $RUN_DIR/app.log"
fi
echo "Login: admin@karunya.edu / teacher123 (teacher)"
echo "       student1@karunya.edu / student123 (student)"
echo "MinIO console: http://localhost:${MAIC_MINIO_CONSOLE_PORT} (maic / maic_dev_pw)"
[[ -f "$RUN_DIR/tts.port" ]] && echo "TTS server: http://localhost:$(cat "$RUN_DIR/tts.port")"
[[ -f "$RUN_DIR/image.port" ]] && echo "Image-gen server: http://localhost:$(cat "$RUN_DIR/image.port")"
echo "Stop everything: ./start.sh stop"
echo "============================================================"
