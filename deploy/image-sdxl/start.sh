#!/bin/bash
# Start the local SDXL image server (dev) on the GB10 host.
# OpenMAIC (dev container, host networking) reaches it at http://localhost:8001/v1
# via IMAGE_LEMONADE_BASE_URL in docker-compose.dev.yml (keyless server-managed provider).
#
#   ./start.sh / ./stop.sh ; tail -f server.log
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8001}"

fuser -k "${PORT}/tcp" 2>/dev/null || true   # frees the listener, NOT this shell
sleep 1

PYTORCH_JIT=0 PORT="$PORT" setsid ./.venv/bin/python ./server.py > server.log 2>&1 < /dev/null &
disown 2>/dev/null || true

echo "SDXL server starting on :$PORT (pid $!). Waiting for readiness..."
for i in $(seq 1 60); do
  if curl -s --max-time 3 "http://localhost:${PORT}/health" 2>/dev/null | grep -q '"ok":true'; then
    echo "READY: $(curl -s http://localhost:${PORT}/health)"; exit 0
  fi
  sleep 12
done
echo "Did not become ready in time; check server.log"; exit 1
