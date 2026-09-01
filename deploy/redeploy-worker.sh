#!/bin/bash
# Redeploy penuh AI worker di RunPod: git pull → sync semua file → restart.
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

echo "============================================================"
echo " AI Live Worker — Redeploy"
echo "============================================================"

if [ ! -d "$REPO_DIR/.git" ]; then
	echo "[ERROR] Repo tidak ditemukan di $REPO_DIR"
	echo "        Clone dulu: git clone https://github.com/ramadifa13/live-streaming-ai.git $REPO_DIR"
	exit 1
fi

cd "$REPO_DIR"
echo "[1/5] Mengambil kode terbaru dari origin/main ..."
git fetch origin main

if [ "$FORCE_GIT_RESET" = "1" ]; then
	echo "      FORCE_GIT_RESET=1 → reset hard ke origin/main"
	git reset --hard origin/main
else
	if ! git pull origin main; then
		echo "[WARN] git pull gagal (kemungkinan konflik lokal)."
		echo "       Menjalankan reset hard ke origin/main ..."
		git reset --hard origin/main
	fi
fi

echo "[2/5] Menyinkronkan semua skrip & assets ke worker ..."
export REPO_DIR WORKER_DIR DEPLOY_DIR="$REPO_DIR/deploy" FORCE_ASSETS=1
# shellcheck source=sync-worker.sh
source "$SCRIPT_DIR/sync-worker.sh"
sync_worker_files
bootstrap_worker_env

echo "[3/5] Memastikan dependensi Python API (fastapi) ..."
ensure_worker_python_deps

echo "[4/5] Menghentikan proses worker lama ..."
pkill -9 -f "api_server.py" 2>/dev/null || true
pkill -9 -f "broadcaster.py" 2>/dev/null || true
pkill -9 -f "frame_feed.py" 2>/dev/null || true
pkill -9 -f "live_worker.py" 2>/dev/null || true
sleep 1

echo "[5/5] Memulai worker ..."
cd "$WORKER_DIR"
bash start.sh

echo ""
echo "[OK] Redeploy selesai."
echo "     Health: curl -s http://localhost:8000/health"
echo "     Log:    tail -f $WORKER_DIR/api_server.log"
