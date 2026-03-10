#!/bin/sh
set -eu

cleanup() {
  if [ "${AGENT_PID:-}" ]; then
    kill "$AGENT_PID" 2>/dev/null || true
  fi
  if [ "${WEBAPP_PID:-}" ]; then
    kill "$WEBAPP_PID" 2>/dev/null || true
  fi
}

trap cleanup INT TERM EXIT

npm run dev:agent &
AGENT_PID=$!

npm run dev:webapp &
WEBAPP_PID=$!

wait "$AGENT_PID" "$WEBAPP_PID"
