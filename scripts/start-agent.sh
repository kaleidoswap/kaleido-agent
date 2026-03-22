#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
MODE=${1:-dev}

log() {
  printf '%s\n' "[startup] $*" >&2
}

update_repo() {
  if ! command -v git >/dev/null 2>&1; then
    log "git not found; skipping repo update"
    return 0
  fi

  if ! git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log "not a git checkout; skipping repo update"
    return 0
  fi

  if [ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]; then
    log "working tree has local changes; skipping repo update"
    return 0
  fi

  if ! git -C "$ROOT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
    log "no upstream configured; skipping repo update"
    return 0
  fi

  before=$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || printf 'unknown')
  if env GIT_TERMINAL_PROMPT=0 git -C "$ROOT_DIR" pull --ff-only >/dev/null 2>&1; then
    after=$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || printf 'unknown')
    if [ "$before" = "$after" ]; then
      log "repo already up to date at $after"
    else
      log "repo updated $before -> $after"
    fi
  else
    log "git pull --ff-only failed; continuing with current checkout"
  fi
}

update_repo

case "$MODE" in
  dev)
    exec npx tsx src/index.ts
    ;;
  start)
    npm run build:agent
    exec node dist/index.js
    ;;
  *)
    log "unknown mode: $MODE"
    exit 1
    ;;
esac
