#!/usr/bin/env bash
# Restart the pi-web dev server on 127.0.0.1:30141 without port conflicts.
# Usage: ./restart-dev.sh [-Log] [-Clean] [-IfDown] [-CheckOnly] [-Lan] [-Port N]
set -euo pipefail

PORT=30141
CLEAN=false
LOG=false
IF_DOWN=false
CHECK_ONLY=false
LAN=false

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
  -Port | -p | --port)
    PORT="$2"
    shift 2
    ;;
  -Clean | --clean)
    CLEAN=true
    shift
    ;;
  -Log | --log)
    LOG=true
    shift
    ;;
  -IfDown | --if-down)
    IF_DOWN=true
    shift
    ;;
  -CheckOnly | --check-only)
    CHECK_ONLY=true
    shift
    ;;
  -Lan | --lan)
    LAN=true
    shift
    ;;
  *)
    # Pass through any other flags
    shift
    ;;
  esac
done

# If PowerShell is available on Windows/WSL and user passes native flags, we can also use restart-dev.ps1
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]] && command -v powershell >/dev/null 2>&1; then
  PS_PATH="$(pwd -W 2>/dev/null || cygpath -w "$SCRIPT_DIR")/restart-dev.ps1"
  ARGS=()
  [[ "$PORT" != "30141" ]] && ARGS+=("-Port" "$PORT")
  [[ "$CLEAN" == "true" ]] && ARGS+=("-Clean")
  [[ "$LOG" == "true" ]] && ARGS+=("-Log")
  [[ "$IF_DOWN" == "true" ]] && ARGS+=("-IfDown")
  [[ "$CHECK_ONLY" == "true" ]] && ARGS+=("-CheckOnly")
  [[ "$LAN" == "true" ]] && ARGS+=("-Lan")
  powershell -NoProfile -ExecutionPolicy Bypass -File "$PS_PATH" "${ARGS[@]}"
  exit $?
fi

# Native Bash Port Cleanup & Dev Start (Linux / macOS / WSL)
echo "[restart] Checking port $PORT for conflicting processes..."

# If -IfDown was requested, check health first
if [[ "$IF_DOWN" == "true" ]]; then
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
    echo "[restart] Server already healthy on http://127.0.0.1:$PORT (HTTP 200) - not restarting."
    exit 0
  fi
  echo "[restart] -IfDown: no healthy server detected, continuing restart..."
fi

# Find PIDs holding the port
find_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser "$PORT"/tcp 2>/dev/null || true
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tlpn 2>/dev/null | grep ":$PORT " | awk '{print $7}' | cut -d'/' -f1 || true
  fi
}

PIDS="$(find_pids)"

if [[ -z "$PIDS" ]]; then
  echo "[restart] Port $PORT is free; nothing to kill."
else
  echo "[restart] Port $PORT held by PID(s): $PIDS"
  if [[ "$CHECK_ONLY" == "true" ]]; then
    echo "[restart] CheckOnly - leaving it running."
    exit 0
  fi

  echo "[restart] Terminating conflicting process(es)..."
  for PID in $PIDS; do
    kill -9 "$PID" 2>/dev/null || true
  done

  # Wait for port to clear
  for i in {1..10}; do
    sleep 0.5
    STILL="$(find_pids)"
    if [[ -z "$STILL" ]]; then
      break
    fi
  done

  STILL="$(find_pids)"
  if [[ -n "$STILL" ]]; then
    echo "[restart] Warning: Port $PORT still held by $STILL"
  else
    echo "[restart] Port $PORT is now free."
  fi
fi

if [[ "$CHECK_ONLY" == "true" ]]; then
  exit 0
fi

# Optional clean of .next
if [[ "$CLEAN" == "true" ]]; then
  if [[ -d ".next" ]]; then
    STAMP="$(date +%Y%m%d-%H%M%S)"
    BAK=".next.bak-$STAMP"
    mv ".next" "$BAK"
    echo "[restart] Moved .next -> $BAK (fresh compile)"
  fi
fi

SCRIPT_NAME="dev"
if [[ "$LAN" == "true" ]]; then
  SCRIPT_NAME="dev:lan"
fi

echo "[restart] Starting: npm run $SCRIPT_NAME (port $PORT)..."

if [[ "$LOG" == "true" ]]; then
  nohup npm run "$SCRIPT_NAME" >.dsh-dev.log 2>.dsh-dev.err.log &
  echo "[restart] Detached; logs -> .dsh-dev.log / .dsh-dev.err.log"
else
  exec npm run "$SCRIPT_NAME"
fi
