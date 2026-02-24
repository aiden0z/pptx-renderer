#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E_DIR="$ROOT_DIR/test/e2e"
PYTHON_BIN="$E2E_DIR/.venv/bin/python"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Missing Python venv: $PYTHON_BIN"
  echo "Run:"
  echo "  cd $E2E_DIR"
  echo "  python3 -m venv .venv && . .venv/bin/activate && python -m pip install -e ."
  exit 1
fi

cleanup() {
  if [[ -n "${PY_PID:-}" ]]; then
    kill "$PY_PID" 2>/dev/null || true
    wait "$PY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 5173 is already in use."
  echo "Stop the existing Vite process first, then rerun: pnpm dev:e2e"
  exit 1
fi

if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 8080 is already in use."
  echo "Stop the existing Python E2E server first, then rerun: pnpm dev:e2e"
  exit 1
fi

echo "[dev:e2e] Starting Python API server on http://127.0.0.1:8080"
"$PYTHON_BIN" "$E2E_DIR/server.py" &
PY_PID=$!

echo "[dev:e2e] Starting Vite on http://127.0.0.1:5173"
cd "$ROOT_DIR"
pnpm dev --host 127.0.0.1 --port 5173
