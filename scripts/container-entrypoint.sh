#!/bin/sh
set -eu

STATE_DIR="${KALEIDOAGENT_STATE_DIR:-/var/lib/kaleidoagent}"
CONFIG_PATH="${CONFIG_PATH:-$STATE_DIR/agent.config.json}"
TASKS_PATH="${TASKS_PATH:-$STATE_DIR/tasks.json}"
ENV_PATH="${STATE_DIR}/.env"

mkdir -p "$STATE_DIR" "$STATE_DIR/logs"

if [ ! -f "$CONFIG_PATH" ]; then
  cp /app/kaleidoagent/defaults/agent.config.json "$CONFIG_PATH"
fi

if [ ! -f "$TASKS_PATH" ]; then
  cp /app/kaleidoagent/defaults/tasks.json "$TASKS_PATH"
fi

if [ ! -f "$ENV_PATH" ]; then
  : > "$ENV_PATH"
fi

exec node /app/kaleidoagent/dist/index.js
