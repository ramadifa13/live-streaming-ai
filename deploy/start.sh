#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="/workspace/ai_live_worker"

if [ -d "$WORKER_DIR" ] && [ -f "$WORKER_DIR/api_server.py" ]; then
	cd "$WORKER_DIR"
elif [ -f "$SCRIPT_DIR/api_server.py" ]; then
	WORKER_DIR="$SCRIPT_DIR"
	cd "$WORKER_DIR"
else
	echo "[ERROR] Worker belum disiapkan."
	echo "        Jalankan setup terlebih dahulu:"
	echo "          cd /workspace/live-streaming-ai/deploy && bash setup.sh"
	exit 1
fi

if [ ! -f "$WORKER_DIR/.setup_complete" ]; then
	echo "[ERROR] Setup belum selesai (file .setup_complete tidak ditemukan)."
	echo "        Jalankan: cd /workspace/live-streaming-ai/deploy && bash setup.sh"
	echo "        Log setup: $WORKER_DIR/setup_log.txt"
	exit 1
fi

if [ ! -f "$WORKER_DIR/api_server.py" ]; then
	echo "[ERROR] api_server.py tidak ditemukan di $WORKER_DIR"
	exit 1
fi

export COQUI_TOS_AGREED=1

echo "Memulai AI Worker API (Port 8000)..."
python api_server.py > "$WORKER_DIR/api_server.log" 2>&1 &
API_PID=$!

sleep 2
if ! kill -0 "$API_PID" 2>/dev/null; then
	echo "[ERROR] api_server.py gagal start. Lihat log:"
	echo "        tail -50 $WORKER_DIR/api_server.log"
	exit 1
fi

if [ "${START_BROADCASTER:-false}" = "true" ]; then
	echo "Memulai Broadcaster (RTMP Streaming)..."
	: "${RTMP_URL:?RTMP_URL wajib diisi jika START_BROADCASTER=true}"
	: "${STREAM_KEY:?STREAM_KEY wajib diisi jika START_BROADCASTER=true}"
	python broadcaster.py > "$WORKER_DIR/broadcaster.log" 2>&1 &
else
	echo "Broadcaster Python tidak dijalankan; gunakan publisher Node utama."
fi

echo "Sistem berhasil dijalankan di background! (api_server PID: $API_PID)"
echo "Log API: $WORKER_DIR/api_server.log"
# Menahan container agar tidak mati
sleep infinity
