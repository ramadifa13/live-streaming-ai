#!/bin/bash
# Sync deploy → worker + restart TANPA git pull (untuk pod tanpa PAT GitHub).
set -euo pipefail

REPO_DIR="${REPO_DIR:-/workspace/live-streaming-ai}"
WORKER_DIR="${WORKER_DIR:-/workspace/ai_live_worker}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================================"
echo " AI Live Worker — Sync + Restart (no git)"
echo "============================================================"

export REPO_DIR WORKER_DIR DEPLOY_DIR="$REPO_DIR/deploy" FORCE_ASSETS=1
# shellcheck source=sync-worker.sh
source "$SCRIPT_DIR/sync-worker.sh"
sync_worker_files
bootstrap_worker_env
dedupe_worker_env
ensure_worker_python_deps

echo "[restart] Worker..."
cd "$WORKER_DIR"
SKIP_WATCHDOG=1 FORCE_RESTART=1 bash start.sh

echo ""
echo "[OK] Sync + restart selesai."
echo "     Health: curl -s http://127.0.0.1:\${PORT:-8000}/health"
