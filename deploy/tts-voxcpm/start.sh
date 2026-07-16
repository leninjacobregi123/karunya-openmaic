#!/bin/bash
# Start the local VoxCPM2 TTS server (dev) on the GB10 host.
# OpenMAIC (dev container, host networking) reaches it at http://localhost:8000/v1
# and is configured via TTS_VOXCPM_BASE_URL in docker-compose.dev.yml.
#
#   ./start.sh          # launch detached, logs -> server.log
#   tail -f server.log  # watch
#   ./stop.sh           # stop
set -e
cd "$(dirname "$0")"

PORT="${PORT:-8000}"

# Free the port if a previous server is listening (targets the listener, NOT this shell).
fuser -k "${PORT}/tcp" 2>/dev/null || true
sleep 1

# PYTORCH_JIT=0: GB10 is Blackwell sm_121; the cu128 nvrtc rejects that arch when the
# JIT fuser tries to compile fused kernels (e.g. the VoxCPM "snake" activation). Run eager.
PYTORCH_JIT=0 PORT="$PORT" setsid ./.venv/bin/python ./server.py > server.log 2>&1 < /dev/null &
disown 2>/dev/null || true

echo "VoxCPM server starting on :$PORT (pid $!). Waiting for readiness..."
for i in $(seq 1 40); do
  if curl -s --max-time 3 "http://localhost:${PORT}/health" 2>/dev/null | grep -q '"ok":true'; then
    echo "READY: $(curl -s http://localhost:${PORT}/health)"
    exit 0
  fi
  sleep 8
done
echo "Did not become ready in time; check server.log"
exit 1
