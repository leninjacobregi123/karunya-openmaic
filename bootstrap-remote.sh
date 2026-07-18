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
if [ -d "$REPO_DIR/.git" ]; then
  echo "==> $REPO_DIR already exists, pulling latest"
  git -C "$REPO_DIR" pull
else
  echo "==> cloning $REPO_URL"
  git clone "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"

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
  set_env MAIC_VLLM_MODEL "openai/gpt-oss-20b"
  set_env MAIC_VLLM_BASE_URL "http://vllm:8000/v1"
  PROFILE_ARGS=(--profile local-vllm)
  echo "==> configured for containerized vLLM (openai/gpt-oss-20b)"
fi

# --- 4. bring the stack up -----------------------------------------------------
echo "==> starting stack (this can take a while on first run: image builds + model downloads)"
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" up -d --build

echo
echo "==> stack starting. Follow progress with:"
if [ "$VLLM_MODE" = "local" ]; then
  echo "      docker compose -f $COMPOSE_FILE logs -f vllm    # first boot downloads ~13GB"
fi
echo "      docker compose -f $COMPOSE_FILE logs -f app"
echo
echo "==> once healthy, open http://<this-machine>:$(grep '^MAIC_APP_PORT=' .env | cut -d= -f2 || echo 3000)"
echo "    login: admin@karunya.edu / teacher123"
