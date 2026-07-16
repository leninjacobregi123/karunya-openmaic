#!/bin/bash
# Stop the local VoxCPM2 TTS server by freeing its port (does NOT pkill by name —
# that would match this shell's own command line and kill it).
PORT="${PORT:-8000}"
fuser -k "${PORT}/tcp" 2>/dev/null && echo "stopped server on :$PORT" || echo "nothing on :$PORT"
