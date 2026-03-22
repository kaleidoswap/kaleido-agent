#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PID_FILE="$ROOT_DIR/logs/kaleidoagent.pid"
LOG_FILE="$ROOT_DIR/logs/kaleidoagent.out"
GATEWAY_LOG_FILE="$ROOT_DIR/.nanobot/gateway.log"

is_running() {
  if [ ! -f "$PID_FILE" ]; then
    return 1
  fi
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  [ -n "${pid:-}" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

start() {
  if is_running; then
    echo "kaleidoagent already running (pid $(cat "$PID_FILE"))"
    return 0
  fi
  mkdir -p "$ROOT_DIR/logs"
  cd "$ROOT_DIR"
  npm run build:agent >/dev/null
  nohup sh -c 'exec node dist/index.js' </dev/null >>"$LOG_FILE" 2>&1 &
  pid=$!
  echo "$pid" >"$PID_FILE"
  echo "started kaleidoagent (pid $pid)"
}

stop() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "kaleidoagent is not running"
    return 0
  fi
  pid=$(cat "$PID_FILE")
  kill "$pid"
  rm -f "$PID_FILE"
  echo "stopped kaleidoagent (pid $pid)"
}

status() {
  if is_running; then
    echo "kaleidoagent running (pid $(cat "$PID_FILE"))"
  else
    echo "kaleidoagent stopped"
    return 1
  fi
}

logs() {
  mkdir -p "$ROOT_DIR/logs"
  touch "$LOG_FILE"
  mkdir -p "$ROOT_DIR/.nanobot"
  touch "$GATEWAY_LOG_FILE"
  exec tail -n 80 -f "$LOG_FILE" "$GATEWAY_LOG_FILE"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop || true; start ;;
  status) status ;;
  logs) logs ;;
  *)
    echo "usage: $0 <start|stop|restart|status|logs>" >&2
    exit 1
    ;;
esac
