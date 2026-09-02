#!/bin/bash
# Redeploy penuh AI worker di RunPod: git pull → sync semua file → restart.
# Tanpa git pull: bash deploy/sync-restart.sh
#
# Usage (di terminal RunPod):
#   bash /workspace/live-streaming-ai/deploy/redeploy-worker.sh
#
# Background:
#   nohup bash /workspace/live-streaming-ai/deploy/redeploy-worker.sh > /workspace/ai_live_worker/redeploy.log 2>&1 &
#
# Paksa reset git jika pull konflik:
#   FORCE_GIT_RESET=1 bash redeploy-worker.sh

set -euo pipefail

REPO_DIR="${REPO_DIR:-/workspace/live-streaming-ai}"
WORKER_DIR="${WORKER_DIR:-/workspace/ai_live_worker}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORCE_GIT_RESET="${FORCE_GIT_RESET:-0}"
SKIP_GIT_PULL="${SKIP_GIT_PULL:-0}"

echo "============================================================"
echo " AI Live Worker — Redeploy"
echo "============================================================"

if [ "$SKIP_GIT_PULL" = "1" ]; then
	echo "[1/5] SKIP_GIT_PULL=1 — lewati git fetch/pull (pakai kode lokal di repo)."
elif [ ! -d "$REPO_DIR/.git" ]; then
	echo "[ERROR] Repo tidak ditemukan di $REPO_DIR"
	echo "        Clone dulu: git clone https://github.com/ramadifa13/live-streaming-ai.git $REPO_DIR"
	exit 1
else
	cd "$REPO_DIR"
	echo "[1/5] Mengambil kode terbaru dari origin/main ..."
	if ! git fetch origin main; then
		echo "[WARN] git fetch gagal (401? gunakan PAT atau SKIP_GIT_PULL=1)."
		echo "       Lanjut sync dari kode yang ada di $REPO_DIR ..."
	elif [ "$FORCE_GIT_RESET" = "1" ]; then
		echo "      FORCE_GIT_RESET=1 → reset hard ke origin/main"
		git reset --hard origin/main
	elif ! git pull origin main; then
		echo "[WARN] git pull gagal — lanjut sync dari kode lokal di repo."
	fi
fi

echo "[2/5] Menyinkronkan semua skrip & assets ke worker ..."
export REPO_DIR WORKER_DIR DEPLOY_DIR="$REPO_DIR/deploy" FORCE_ASSETS=1
# shellcheck source=sync-worker.sh
source "$SCRIPT_DIR/sync-worker.sh"
	sync_worker_files
	bootstrap_worker_env
	dedupe_worker_env

echo "[3/5] Memastikan dependensi Python API (fastapi) ..."
ensure_worker_python_deps

echo "[4/5] Restart worker ..."
cd "$WORKER_DIR"
SKIP_WATCHDOG=1 FORCE_RESTART=1 bash start.sh

echo ""
echo "[OK] Redeploy selesai."
WORKER_PORT="${PORT:-8000}"
if [ -f "$WORKER_DIR/.env" ]; then
	# shellcheck disable=SC1091
	source "$WORKER_DIR/.env"
	WORKER_PORT="${PORT:-8000}"
fi
echo "     Health: curl -s http://localhost:${WORKER_PORT}/health"
echo "     Log:    tail -f $WORKER_DIR/api_server.log"
