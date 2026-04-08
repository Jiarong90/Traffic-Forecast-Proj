#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/Users/apple/Desktop/fyp_demo"
APP_DIR="$ROOT_DIR/camera1"
VENV_PYTHON="$APP_DIR/.venv/bin/python"
FASTAPI_HOST="127.0.0.1"
FASTAPI_PORT="8000"
NODE_PORT="3000"
FASTAPI_LOG="$APP_DIR/fastapi.log"
NODE_LOG="$APP_DIR/node.log"

cleanup() {
  local exit_code=$?
  if [[ -n "${NODE_PID:-}" ]] && kill -0 "$NODE_PID" 2>/dev/null; then
    kill "$NODE_PID" 2>/dev/null || true
    wait "$NODE_PID" 2>/dev/null || true
  fi
  if [[ -n "${FASTAPI_PID:-}" ]] && kill -0 "$FASTAPI_PID" 2>/dev/null; then
    kill "$FASTAPI_PID" 2>/dev/null || true
    wait "$FASTAPI_PID" 2>/dev/null || true
  fi
  exit "$exit_code"
}

trap cleanup INT TERM EXIT

if [[ ! -d "$APP_DIR" ]]; then
  echo "camera1 directory not found: $APP_DIR" >&2
  exit 1
fi

if [[ ! -x "$VENV_PYTHON" ]]; then
  echo "Virtual environment python not found: $VENV_PYTHON" >&2
  echo "Create it first with:" >&2
  echo "cd $APP_DIR && python3 -m venv .venv" >&2
  exit 1
fi

if lsof -tiTCP:"$FASTAPI_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $FASTAPI_PORT is already in use. Stop the existing FastAPI process first." >&2
  exit 1
fi

if lsof -tiTCP:"$NODE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $NODE_PORT is already in use. Stop the existing Node process first." >&2
  exit 1
fi

cd "$APP_DIR"

echo "Starting FastAPI on http://$FASTAPI_HOST:$FASTAPI_PORT ..."
"$VENV_PYTHON" -m uvicorn py.combined_api_server:app --host "$FASTAPI_HOST" --port "$FASTAPI_PORT" >"$FASTAPI_LOG" 2>&1 &
FASTAPI_PID=$!

sleep 2
if ! kill -0 "$FASTAPI_PID" 2>/dev/null; then
  echo "FastAPI failed to start. Check $FASTAPI_LOG" >&2
  exit 1
fi

echo "Starting Node on http://localhost:$NODE_PORT/ui2/ ..."
node server.js >"$NODE_LOG" 2>&1 &
NODE_PID=$!

sleep 2
if ! kill -0 "$NODE_PID" 2>/dev/null; then
  echo "Node failed to start. Check $NODE_LOG" >&2
  exit 1
fi

echo "FASTAPI PID: $FASTAPI_PID"
echo "NODE PID: $NODE_PID"
echo "Open: http://localhost:$NODE_PORT/ui2/"
echo "Logs: $FASTAPI_LOG and $NODE_LOG"
echo "Press Ctrl+C to stop both services."

wait "$NODE_PID"
