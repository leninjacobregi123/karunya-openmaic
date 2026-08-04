#!/usr/bin/env bash
# Bootstraps the fully-containerized remote stack (docker-compose.remote.yml)
# on a machine you don't control beyond Docker itself - clones/updates the
# repo, generates a real .env (random secrets, no leftover placeholders),
# and brings the whole stack up with the containerized vLLM profile so
# nothing needs installing on the host outside Docker.
#
# Usage:
#   ./bootstrap-remote.sh                # first run: clone + configure + start
#   ./bootstrap-remote.sh                # re-run: pulls latest + restarts
#   ./bootstrap-remote.sh --external-vllm http://192.168.6.249:8001/v1 openai/gpt-oss-120b
#                                         # use an already-running vLLM elsewhere
#                                         # instead of the containerized one
set -euo pipefail

REPO_URL="https://github.com/leninjacobregi123/karunya-openmaic.git"
REPO_DIR="karunya-openmaic"
COMPOSE_FILE="docker-compose.remote.yml"

# --- parse args --------------------------------------------------------------
VLLM_MODE="local"        # local | external
EXTERNAL_VLLM_URL=""
EXTERNAL_VLLM_MODEL=""
if [ "${1:-}" = "--external-vllm" ]; then
  VLLM_MODE="external"
  EXTERNAL_VLLM_URL="${2:?Usage: --external-vllm <base-url> <model-name>}"
  EXTERNAL_VLLM_MODEL="${3:?Usage: --external-vllm <base-url> <model-name>}"
fi

# --- 1. get the repo -----------------------------------------------------------
# If this script is already running from inside a checkout (the common re-run
# pattern: `cd karunya-openmaic && git pull && ./bootstrap-remote.sh`), operate
# in place instead of cloning a second, nested copy. A nested clone shares
# this directory's basename ("karunya-openmaic"), so Docker Compose's default
# project-name-from-directory-basename would point it at the SAME persisted
# volumes (Postgres, etc.) as this checkout, while generating a brand-new
# random .env - a guaranteed secret mismatch against data that volume already
# has baked in.
if [ -f "$COMPOSE_FILE" ] && [ -d .git ]; then
  echo "==> already inside a checkout ($(pwd)), pulling latest in place"
  git pull
elif [ -d "$REPO_DIR/.git" ]; then
  echo "==> $REPO_DIR already exists, pulling latest"
  git -C "$REPO_DIR" pull
  cd "$REPO_DIR"
else
  echo "==> cloning $REPO_URL"
  git clone "$REPO_URL" "$REPO_DIR"
  cd "$REPO_DIR"
fi

# --- 2. sanity-check prerequisites --------------------------------------------
command -v docker >/dev/null 2>&1 || { echo "docker not found - install Docker first" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "docker compose plugin not found" >&2; exit 1; }

echo "==> checking GPU passthrough into containers"
if ! docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu24.04 nvidia-smi >/dev/null 2>&1; then
  echo "WARNING: 'docker run --gpus all ... nvidia-smi' failed - GPU passthrough may not be configured." >&2
  echo "         Continuing anyway; tts/image/vllm containers will fail to start without it." >&2
fi

# --- 3. build .env -------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.remote.example .env
  echo "==> created .env from template"
fi

set_env() {
  local key="$1" value="$2"
  # matches both "KEY=..." and a commented-out placeholder "#KEY=..."
  if grep -q "^#\?${key}=" .env; then
    sed -i "s|^#\?${key}=.*|${key}=${value}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
}

# Only replace secrets that are still at their template placeholder value, so
# re-running this script never rotates secrets on an already-configured .env.
grep -q '^POSTGRES_PASSWORD=change-me-postgres$' .env && set_env POSTGRES_PASSWORD "$(openssl rand -hex 16)"
grep -q '^MINIO_ROOT_PASSWORD=change-me-minio$' .env && set_env MINIO_ROOT_PASSWORD "$(openssl rand -hex 16)"
grep -q '^SESSION_SECRET=change-me-to-a-long-random-string$' .env && set_env SESSION_SECRET "$(openssl rand -hex 32)"

if [ "$VLLM_MODE" = "external" ]; then
  set_env MAIC_VLLM_MODEL "${EXTERNAL_VLLM_MODEL}"
  set_env MAIC_VLLM_BASE_URL "$EXTERNAL_VLLM_URL"
  PROFILE_ARGS=()
  echo "==> configured for external vLLM at ${EXTERNAL_VLLM_URL} (model: ${EXTERNAL_VLLM_MODEL})"
else
  set_env MAIC_VLLM_MODEL "Qwen/Qwen3-32B-AWQ"
  set_env MAIC_VLLM_BASE_URL "http://vllm:8000/v1"
  PROFILE_ARGS=(--profile local-vllm)
  echo "==> configured for containerized vLLM (Qwen/Qwen3-32B-AWQ)"
fi

# --- 4. build images -----------------------------------------------------------
echo "==> building images"
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" build

# --- 5. prime model caches -------------------------------------------------------
# Model weights are pre-downloaded and pushed as GitHub Releases (this host's
# network may not reach HF's storage CDN cleanly) - see prime-model-cache.sh.
# Idempotent: a no-op if a cache is already populated, so re-running this
# script (e.g. after a git pull) never re-downloads anything unnecessarily.
echo "==> priming model caches (skips any model already cached)"
./prime-model-cache.sh sdxl
./prime-model-cache.sh voxcpm2
if [ "$VLLM_MODE" = "local" ]; then
  ./prime-model-cache.sh qwen3-32b
fi

# --- 6. bring the stack up -----------------------------------------------------
echo "==> starting stack"
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" up -d

echo
echo "==> stack starting. Follow progress with:"
if [ "$VLLM_MODE" = "local" ]; then
  echo "      docker compose -f $COMPOSE_FILE logs -f vllm    # first boot downloads ~18GB"
  echo
  echo "==> image/tts are NOT started by default - vllm is sized assuming it has the"
  echo "    GPU to itself. Switch to media mode when you need image/TTS generation:"
  echo "      docker compose -f $COMPOSE_FILE stop vllm"
  echo "      docker compose -f $COMPOSE_FILE --profile media up -d image tts"
  echo "    and back when you need the LLM's full context again:"
  echo "      docker compose -f $COMPOSE_FILE stop image tts"
  echo "      docker compose -f $COMPOSE_FILE --profile local-vllm up -d vllm"
fi
echo "      docker compose -f $COMPOSE_FILE logs -f app"
echo
echo "==> once healthy, open http://<this-machine>:$(grep '^MAIC_APP_PORT=' .env | cut -d= -f2 || echo 3000)"
echo "    login: admin@karunya.edu / teacher123"
