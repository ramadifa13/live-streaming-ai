#!/bin/bash
# warmup.sh — muat MuseTalk ke VRAM SEBELUM demo / Go Live.
# Siaran pertama tidak menunggu load model, host tidak diam lama di depan penonton.
#
# Di pod:
#   bash /workspace/live-streaming-ai/deploy/warmup.sh
#   bash /workspace/ai_live_worker/warmup.sh
#
# Kalau API lama belum punya /stream/warmup:
#   bash /workspace/live-streaming-ai/deploy/warmup.sh --restart

set -euo pipefail

WORKER_DIR="${WORKER_DIR:-/workspace/ai_live_worker}"
REPO_DIR="${REPO_DIR:-/workspace/live-streaming-ai}"
DEPLOY_DIR="${DEPLOY_DIR:-$REPO_DIR/deploy}"
WORKER_PORT="${PORT:-${WORKER_PORT:-8000}}"
HEALTH_URL="http://127.0.0.1:${WORKER_PORT}/health"
WARMUP_URL="http://127.0.0.1:${WORKER_PORT}/stream/warmup"
WAIT_SEC="${WARMUP_WAIT_SEC:-180}"
DO_RESTART=0

for _a in "$@"; do
	case "$_a" in
		--restart|-r) DO_RESTART=1 ;;
		--help|-h)
			echo "Usage: bash warmup.sh [--restart]"
			echo "  Memuat MuseTalk ke GPU sebelum demo."
			echo "  --restart  sync + start.sh dulu (API lama / proses beku)"
			exit 0
			;;
	esac
done

health_json() {
	curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true
}

is_warm() {
	echo "$1" | grep -Eq '"warmed_up"[[:space:]]*:[[:space:]]*true'
}

echo "============================================================"
echo "  Warmup MuseTalk — siapkan GPU sebelum demo"
echo "============================================================"

if [ "$DO_RESTART" = "1" ]; then
	echo "[INFO] --restart: sync + start worker (model ikut di-load)..."
	if [ -f "$DEPLOY_DIR/sync.sh" ]; then
		SKIP_PULL="${SKIP_PULL:-1}" bash "$DEPLOY_DIR/sync.sh" --restart
	elif [ -f "$WORKER_DIR/start.sh" ]; then
		FORCE_RESTART=1 MUSETALK_WARMUP_ON_START=1 bash "$WORKER_DIR/start.sh"
	else
		echo "[ERROR] sync.sh / start.sh tidak ditemukan."
		exit 1
	fi
fi

_json="$(health_json)"
if [ -z "$_json" ]; then
	echo "[INFO] API belum merespons — menyalakan worker..."
	if [ -f "$DEPLOY_DIR/start.sh" ]; then
		MUSETALK_WARMUP_ON_START=1 bash "$DEPLOY_DIR/start.sh"
	elif [ -f "$WORKER_DIR/start.sh" ]; then
		MUSETALK_WARMUP_ON_START=1 bash "$WORKER_DIR/start.sh"
	else
		echo "[ERROR] start.sh tidak ditemukan. Jalankan setup.sh dulu."
		exit 1
	fi
	_json="$(health_json)"
fi

if [ -z "$_json" ]; then
	echo "[ERROR] API tidak merespons di $HEALTH_URL"
	echo "        Coba: bash $DEPLOY_DIR/warmup.sh --restart"
	exit 1
fi

if is_warm "$_json"; then
	echo "[OK] MuseTalk sudah di VRAM. Siap demo / Go Live."
	nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader 2>/dev/null || true
	exit 0
fi

echo "[INFO] Memicu load model ke GPU (tanpa mulai siaran)..."
_warm_http="$(curl -sS --max-time 8 -X POST "$WARMUP_URL" -H 'Content-Type: application/json' -d '{}' 2>/dev/null || true)"
if [ -z "$_warm_http" ]; then
	echo "[WARN] Endpoint /stream/warmup belum ada di API yang sedang jalan."
	echo "       Restart sekali supaya skrip terbaru masuk:"
	echo "         bash $DEPLOY_DIR/warmup.sh --restart"
	exit 1
fi
echo "$_warm_http"

echo "[INFO] Menunggu model masuk VRAM (max ${WAIT_SEC}s)..."
for _i in $(seq 1 "$WAIT_SEC"); do
	_json="$(health_json)"
	if is_warm "$_json"; then
		echo ""
		echo "[OK] MuseTalk siap di VRAM. Host tidak akan nunggu load di siaran pertama."
		nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader 2>/dev/null || true
		echo "Health: curl -s $HEALTH_URL"
		exit 0
	fi
	if [ "$((_i % 10))" -eq 0 ]; then
		echo "  ... masih memuat (${_i}s)"
	fi
	sleep 1
done

echo "[ERROR] Warmup belum selesai dalam ${WAIT_SEC}s. Cek log:"
echo "        tail -50 $WORKER_DIR/api_server.log"
exit 1
