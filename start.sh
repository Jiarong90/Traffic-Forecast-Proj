#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
PYTHON_DIR="$ROOT_DIR/python"
PYTHON_BIN="$BACKEND_DIR/.venv/bin/python"
FASTAPI_LOG="$BACKEND_DIR/fastapi.log"
NODE_LOG="$BACKEND_DIR/node.log"

FASTAPI_PID=""
NODE_PID=""
LOG_TAIL_PID=""
SHUTTING_DOWN=0

print_log_tail() {
  local label="$1"
  local file="$2"
  echo
  echo "$label log tail:"
  if [[ -f "$file" ]]; then
    tail -80 "$file" || true
  else
    echo "Log file not found: $file"
  fi
}

cleanup() {
  if [[ "$SHUTTING_DOWN" -eq 1 ]]; then
    return
  fi
  SHUTTING_DOWN=1
  echo
  echo "Stopping FAST services..."
  if [[ -n "$LOG_TAIL_PID" ]] && kill -0 "$LOG_TAIL_PID" 2>/dev/null; then
    kill "$LOG_TAIL_PID" 2>/dev/null || true
  fi
  if [[ -n "$NODE_PID" ]] && kill -0 "$NODE_PID" 2>/dev/null; then
    kill "$NODE_PID" 2>/dev/null || true
  fi
  if [[ -n "$FASTAPI_PID" ]] && kill -0 "$FASTAPI_PID" 2>/dev/null; then
    kill "$FASTAPI_PID" 2>/dev/null || true
  fi
}

require_file() {
  local path="$1"
  local message="$2"
  if [[ ! -e "$path" ]]; then
    echo "$message"
    exit 1
  fi
}

require_command() {
  local command_name="$1"
  local message="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$message"
    exit 1
  fi
}

port_in_use() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

monitor_services() {
  while true; do
    if [[ -n "$FASTAPI_PID" ]] && ! kill -0 "$FASTAPI_PID" 2>/dev/null; then
      echo
      echo "FastAPI stopped unexpectedly."
      print_log_tail "FastAPI" "$FASTAPI_LOG"
      cleanup
      exit 1
    fi
    if [[ -n "$NODE_PID" ]] && ! kill -0 "$NODE_PID" 2>/dev/null; then
      echo
      echo "Node stopped unexpectedly."
      print_log_tail "Node" "$NODE_LOG"
      cleanup
      exit 1
    fi
    sleep 2
  done
}

require_command node "Node.js is not installed or not in PATH."
require_command npm "npm is not installed or not in PATH."
require_command lsof "lsof is required to check ports."
require_command tail "tail is required to stream logs."

require_file "$BACKEND_DIR/package.json" "Missing $BACKEND_DIR/package.json."
require_file "$PYTHON_DIR/api_server.py" "Missing $PYTHON_DIR/api_server.py."
require_file "$PYTHON_BIN" "Missing Python virtual environment. Run: cd $BACKEND_DIR && python3 -m venv .venv && source .venv/bin/activate && python -m pip install -r ../python/requirements-fastapi.txt"
require_file "$BACKEND_DIR/node_modules" "Missing Node dependencies. Run: cd $BACKEND_DIR && npm install"

if port_in_use 8000; then
  echo "Port 8000 is already in use. Stop the existing FastAPI process first."
  exit 1
fi

if port_in_use 3000; then
  echo "Port 3000 is already in use. Stop the existing Node process first."
  exit 1
fi

trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

: >"$FASTAPI_LOG"
: >"$NODE_LOG"

tail -n 0 -F "$FASTAPI_LOG" "$NODE_LOG" &
LOG_TAIL_PID="$!"

echo "Starting FastAPI on http://127.0.0.1:8000"
cd "$ROOT_DIR"
PYTHONPATH="$ROOT_DIR" "$PYTHON_BIN" -m uvicorn python.api_server:app --host 127.0.0.1 --port 8000 >"$FASTAPI_LOG" 2>&1 &
FASTAPI_PID="$!"

sleep 2
if ! kill -0 "$FASTAPI_PID" 2>/dev/null; then
  echo "FastAPI failed to start. Last log lines:"
  tail -40 "$FASTAPI_LOG" || true
  exit 1
fi

echo "Starting Node on http://localhost:3000/"
cd "$BACKEND_DIR"
PYTHON_BIN="$PYTHON_BIN" npm start >"$NODE_LOG" 2>&1 &
NODE_PID="$!"

sleep 2
if ! kill -0 "$NODE_PID" 2>/dev/null; then
  echo "Node failed to start. Last log lines:"
  tail -40 "$NODE_LOG" || true
  exit 1
fi

echo
echo "FAST demo is running:"
echo "  Web app:  http://localhost:3000/"
echo "  FastAPI:  http://127.0.0.1:8000"
echo
echo "Logs:"
echo "  FastAPI:  $FASTAPI_LOG"
echo "  Node:     $NODE_LOG"
echo
echo "Live logs are shown below. Press Ctrl+C to stop both services."

monitor_services
