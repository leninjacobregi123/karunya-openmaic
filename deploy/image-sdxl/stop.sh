#!/bin/bash
# Stop the SDXL image server by freeing its port (never pkill -f server.py: it
# matches this shell's own command line and would kill the shell).
PORT="${PORT:-8001}"
fuser -k "${PORT}/tcp" 2>/dev/null && echo "stopped server on :$PORT" || echo "nothing on :$PORT"
