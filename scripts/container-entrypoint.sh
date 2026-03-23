#!/bin/sh
set -eu

STATE_DIR="${KALEIDOAGENT_STATE_DIR:-/var/lib/kaleidoagent}"
CONFIG_PATH="${CONFIG_PATH:-$STATE_DIR/agent.config.json}"
TASKS_PATH="${TASKS_PATH:-$STATE_DIR/tasks.json}"
ENV_PATH="${STATE_DIR}/.env"
WORKSPACE_DIR="${STATE_DIR}/.nanobot/workspace"

mkdir -p "$STATE_DIR" "$STATE_DIR/logs" "$WORKSPACE_DIR"

if [ ! -f "$CONFIG_PATH" ]; then
  cp /app/kaleidoagent/defaults/agent.config.json "$CONFIG_PATH"
fi

if [ ! -f "$TASKS_PATH" ]; then
  cp /app/kaleidoagent/defaults/tasks.json "$TASKS_PATH"
fi

if [ ! -f "$ENV_PATH" ]; then
  : > "$ENV_PATH"
fi

# Bootstrap workspace markdown files on first run (preserve any agent edits on restart)
for src in /app/kaleidoagent/defaults/workspace/*.md; do
  [ -f "$src" ] || continue
  dest="$WORKSPACE_DIR/$(basename "$src")"
  if [ ! -f "$dest" ]; then
    cp "$src" "$dest"
  fi
done

exec node /app/kaleidoagent/dist/index.js
