#!/usr/bin/env bash
# Seeds a service's model cache volume from a pre-downloaded model pushed as a
# GitHub Release, for hosts that can't reach the HF storage CDN directly.
# Everything (API lookup, download, reassembly, extraction) runs INSIDE a
# throwaway container built from the service's own image - nothing touches
# the host filesystem outside Docker.
#
# Idempotent: if the target cache already looks populated, this is a fast
# no-op (safe to call unconditionally from a deploy script).
#
# Usage (run from the repo root, next to docker-compose.remote.yml):
#   ./prime-model-cache.sh sdxl        # stabilityai/stable-diffusion-xl-base-1.0 -> image_cache
#   ./prime-model-cache.sh voxcpm2     # openbmb/VoxCPM2 -> tts_cache
#   ./prime-model-cache.sh gptoss      # openai/gpt-oss-20b -> vllm_cache (plain dir, not HF cache layout)
set -euo pipefail

REPO="leninjacobregi123/karunya-openmaic"
COMPOSE_FILE="docker-compose.remote.yml"

MODEL="${1:-}"
case "$MODEL" in
  sdxl)
    TAG="sdxl-model"
    ARCHIVE="sdxl.tar.gz"
    SERVICE="image"
    LAYOUT="hf-cache-tar"
    MARKER="/root/.cache/huggingface/hub/models--stabilityai--stable-diffusion-xl-base-1.0/snapshots"
    ;;
  voxcpm2)
    TAG="voxcpm2-model"
    ARCHIVE="voxcpm2.tar.gz"
    SERVICE="tts"
    LAYOUT="hf-cache-tar"
    MARKER="/root/.cache/huggingface/hub/models--openbmb--VoxCPM2/snapshots"
    ;;
  gptoss)
    TAG="gptoss20b-model"
    SERVICE="vllm"
    LAYOUT="flat-dir"
    TARGET_DIR="/root/.cache/huggingface/local-models/gpt-oss-20b"
    MARKER="$TARGET_DIR/model.safetensors.index.json"
    ;;
  *)
    echo "Usage: $0 <sdxl|voxcpm2|gptoss>" >&2
    exit 1
    ;;
esac

[ -f "$COMPOSE_FILE" ] || { echo "$COMPOSE_FILE not found - run this from the repo root" >&2; exit 1; }

echo "==> priming '$SERVICE' cache from release '$TAG', entirely inside a container"

if [ "$LAYOUT" = "hf-cache-tar" ]; then
  docker compose -f "$COMPOSE_FILE" run --rm -T --no-deps \
    -e MODEL_REPO="$REPO" -e MODEL_TAG="$TAG" -e MODEL_ARCHIVE="$ARCHIVE" -e CACHE_MARKER="$MARKER" \
    --entrypoint sh "$SERVICE" -s <<'INNER'
set -e
if ls ${CACHE_MARKER}/* >/dev/null 2>&1; then
  echo "==> already primed (found $CACHE_MARKER), skipping download"
  exit 0
fi

cd /tmp
API_URL="https://api.github.com/repos/${MODEL_REPO}/releases/tags/${MODEL_TAG}"
echo "==> fetching release manifest: $API_URL"
curl -fsSL "$API_URL" | grep -oP '"browser_download_url":\s*"\K[^"]+' > asset_urls.txt
[ -s asset_urls.txt ] || { echo "no assets found for this release" >&2; exit 1; }

while read -r url; do
  fname=$(basename "$url")
  echo "    downloading $fname"
  curl -fSL "$url" -o "$fname"
done < asset_urls.txt

echo "==> verifying all parts landed"
ls -la "${MODEL_ARCHIVE}".part-*

echo "==> reassembling ${MODEL_ARCHIVE}"
cat "${MODEL_ARCHIVE}".part-* > "${MODEL_ARCHIVE}"
rm -f "${MODEL_ARCHIVE}".part-* asset_urls.txt

mkdir -p /root/.cache/huggingface
echo "==> extracting into /root/.cache/huggingface"
tar xzf "${MODEL_ARCHIVE}" -C /root/.cache/huggingface
rm -f "${MODEL_ARCHIVE}"

echo "==> done. Cache contents:"
du -sh /root/.cache/huggingface/hub/* 2>/dev/null
INNER

else
  # flat-dir layout (gptoss): release assets are individual model files, with
  # large ones split as "<filename>.part-XX" - no tar involved. Each original
  # filename is reassembled (if split) and placed directly into a plain
  # directory. vLLM's --model flag then points straight at that directory
  # (a filesystem path is a pure local load, same trick as the SDXL fix in
  # deploy/image-sdxl/server.py - it completely bypasses Hub API/network/
  # completeness-check logic, which is what actually breaks on this network).
  docker compose -f "$COMPOSE_FILE" run --rm -T --no-deps \
    -e MODEL_REPO="$REPO" -e MODEL_TAG="$TAG" -e TARGET_DIR="$TARGET_DIR" -e CACHE_MARKER="$MARKER" \
    --entrypoint sh "$SERVICE" -s <<'INNER'
set -e
if [ -f "$CACHE_MARKER" ]; then
  echo "==> already primed (found $CACHE_MARKER), skipping download"
  exit 0
fi

mkdir -p /tmp/gptoss-dl "$TARGET_DIR"
cd /tmp/gptoss-dl
API_URL="https://api.github.com/repos/${MODEL_REPO}/releases/tags/${MODEL_TAG}"
echo "==> fetching release manifest: $API_URL"
curl -fsSL "$API_URL" | grep -oP '"browser_download_url":\s*"\K[^"]+' > asset_urls.txt
[ -s asset_urls.txt ] || { echo "no assets found for this release" >&2; exit 1; }

while read -r url; do
  fname=$(basename "$url")
  echo "    downloading $fname"
  curl -fSL "$url" -o "$fname"
done < asset_urls.txt
rm -f asset_urls.txt

echo "==> reassembling split files and moving everything into $TARGET_DIR"
# Files with ".part-XX" get concatenated back to their original name, in
# sorted (alphabetical) part order; anything else moves over as-is.
for f in *; do
  case "$f" in
    *.part-*)
      base="${f%.part-*}"
      if [ ! -f "$TARGET_DIR/$base" ]; then
        echo "    reassembling $base"
        cat "$base".part-* > "$TARGET_DIR/$base"
        rm -f "$base".part-*
      fi
      ;;
    *)
      mv "$f" "$TARGET_DIR/$f"
      ;;
  esac
done
cd /
rm -rf /tmp/gptoss-dl

echo "==> done. Cache contents:"
ls -la "$TARGET_DIR"
du -sh "$TARGET_DIR"
INNER
fi

echo "==> cache primed (fully inside Docker). Start/restart the service normally:"
echo "      docker compose -f $COMPOSE_FILE up -d $SERVICE"
