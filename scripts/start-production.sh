#!/bin/sh
set -eu

if [ "${FINAL_RENDER_BACKEND:-}" = "modal" ]; then
  MODAL_RENDER_BRIDGE_PORT="${MODAL_RENDER_BRIDGE_PORT:-8765}"
  python -m uvicorn python.modal_bridge.server:app \
    --host 127.0.0.1 \
    --port "${MODAL_RENDER_BRIDGE_PORT}" &
fi

exec node server.js
