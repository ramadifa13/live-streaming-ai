#!/bin/bash
# Restart worker dengan sync penuh dari repo (GANTI cp manual satu file).
#
# Usage di RunPod:
#   bash /workspace/live-streaming-ai/deploy/pod-restart.sh
#
# Set STOP_BROADCAST=1 untuk hentikan siaran sebelum restart:
#   STOP_BROADCAST=1 bash pod-restart.sh

set -euo pipefail

REPO_DIR="${REPO_DIR:-/workspace/live-streaming-ai}"
WORKER_DIR="${WORKER_DIR:-/workspace/ai_live_worker}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8000}"

echo "============================================================"
echo " AI Worker — Pull + Sync + Restart"
echo "============================================================"

if [ ! -d "$REPO_DIR/.git" ]; then
	echo "[ERROR] Repo tidak ada di $REPO_DIR"
	exit 1
fi

cd "$REPO_DIR"
echo "[1/6] git pull ..."
git pull origin main || git reset --hard origin/main

echo "[2/6] Sync semua file deploy → $WORKER_DIR ..."
export REPO_DIR WORKER_DIR DEPLOY_DIR="$REPO_DIR/deploy" FORCE_ASSETS=0
# shellcheck source=sync-worker.sh
source "$SCRIPT_DIR/sync-worker.sh"
sync_worker_files
bootstrap_worker_env

if [ -f "$WORKER_DIR/.env" ]; then
	# shellcheck disable=SC1091
	source "$WORKER_DIR/.env"
	PORT="${PORT:-8000}"
fi

if [ "${STOP_BROADCAST:-0}" = "1" ]; then
	echo "[3/6] stop-broadcast ..."
	curl -fsS -X POST "http://127.0.0.1:${PORT}/stream/stop-broadcast" >/dev/null 2>&1 || true
else
	echo "[3/6] skip stop-broadcast (set STOP_BROADCAST=1 jika perlu)"
fi

echo "[4/6] Restart worker ..."
cd "$WORKER_DIR"
SKIP_WATCHDOG=1 FORCE_RESTART=1 bash start.sh

echo "[6/6] Verifikasi ..."
sleep 2
bash "$SCRIPT_DIR/verify-worker.sh"
