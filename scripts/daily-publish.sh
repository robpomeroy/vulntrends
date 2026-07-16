#!/usr/bin/env bash
#
# Daily publish runner — invoked by the Synology Task Scheduler.
#
# Replaces the one-liner previously in the scheduler:
#   cd /volume1/deployments/vulntrends && \
#     git switch main && git pull && \
#     npm run publish >> logs/publish.log 2>&1
#
# Improvements:
#   * Pulls fast-forward only (refuses to silently merge if main
#     has diverged from the local clone — keeps unreviewed commits
#     out of production).
#   * Runs `npm ci` when package-lock.json changes between the old
#     and new HEAD. Prevents the Windows↔Linux esbuild native-binary
#     mismatch from breaking the very first publish after a sync
#     (see scripts/check-platform.mjs for the inline rationale).
#   * Exits non-zero on git/sync failures so the Task Scheduler
#     "command failed" branch fires and emails you.
#   * Mirrors all output to logs/publish.log while still streaming
#     stdout to the task scheduler email digest.
#   * Uses `set -euo pipefail` so a failure in any step aborts the
#     rest — no half-published state.
#
# Required environment: bash 4+, git, rsync, npm, node (>=22 per
# `engines.node` in package.json), and the `.env` file at the repo
# root with DEPLOY_* and NVD_API_KEY set.
#
# Override paths via env vars if needed (defaults shown):
#   REPO_DIR  — /volume1/deployments/vulntrends
#   LOG_DIR   — $REPO_DIR/logs
#   LOG_FILE  — $LOG_DIR/publish.log

set -euo pipefail

REPO_DIR="${REPO_DIR:-/volume1/deployments/vulntrends}"
LOG_DIR="${LOG_DIR:-$REPO_DIR/logs}"
LOG_FILE="${LOG_FILE:-$LOG_DIR/publish.log}"

cd "$REPO_DIR"
mkdir -p "$LOG_DIR"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE" ; }
err() { printf '[%s] ERROR: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE" >&2 ; }

log "══════════════════════════════════════════════════════"
log " daily-publish start"
log "══════════════════════════════════════════════════════"

# Fail-fast environment checks. Each prints an actionable hint
# rather than a cryptic "command not found" downstream.
for cmd in git rsync npm node; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "Required command '$cmd' not on PATH"
    exit 2
  fi
done
if [[ ! -f .env ]]; then
  err ".env not found at $REPO_DIR/.env (needed for DEPLOY_* and NVD_API_KEY)"
  exit 2
fi

# Record the current HEAD so we can tell whether package-lock.json
# changed as a result of the pull. If it did we need `npm ci` to
# avoid loading a possibly-wrong-platform esbuild binary on the
# next command (see scripts/check-platform.mjs).
HEAD_BEFORE="$(git rev-parse HEAD)"

log "git fetch origin main"
git fetch --quiet origin main

log "git switch main (fast-forward only)"
git switch --quiet main
git merge --quiet --ff-only "origin/main" || {
  err "git pull failed: main has diverged. Resolve manually."
  err "  Local HEAD: $HEAD_BEFORE"
  err "  origin/main: $(git rev-parse origin/main)"
  exit 2
}

LOCKFILE_CHANGED=0
if ! git diff --quiet "$HEAD_BEFORE" HEAD -- package-lock.json 2>/dev/null; then
  LOCKFILE_CHANGED=1
fi
if [[ "$LOCKFILE_CHANGED" -eq 1 ]]; then
  log "package-lock.json changed since last run — running npm ci"
  npm ci --no-audit --no-fund 2>&1 | tee -a "$LOG_FILE"
else
  log "package-lock.json unchanged — skipping npm ci"
fi

log "git status (sanity check, expect clean)"
git status --short | tee -a "$LOG_FILE" || true

log "npm run publish"
if npm run publish >> "$LOG_FILE" 2>&1; then
  log "══════════════════════════════════════════════════════"
  log " daily-publish complete"
  log "══════════════════════════════════════════════════════"
  exit 0
else
  err "npm run publish failed — see $LOG_FILE for the full log"
  err "Tail of log:"
  tail -n 30 "$LOG_FILE" >&2 | sed 's/^/  /' || true
  exit 1
fi