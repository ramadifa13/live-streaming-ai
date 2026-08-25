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
	echo "          cd /workspace/live-streaming-ai/deploy && bash setup-safe.sh"
	exit 1
fi

if [ ! -f "$WORKER_DIR/.setup_complete" ]; then
	echo "[ERROR] Setup belum selesai (file .setup_complete tidak ditemukan)."
	echo "        Jalankan: cd /workspace/live-streaming-ai/deploy && bash setup-safe.sh"
	echo "        Log setup: $WORKER_DIR/setup_log.txt"
	exit 1
fi

if [ ! -f "$WORKER_DIR/api_server.py" ]; then
	echo "[ERROR] api_server.py tidak ditemukan di $WORKER_DIR"
	exit 1
fi

export COQUI_TOS_AGREED=1
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"
export OLLAMA_HOST="${OLLAMA_HOST:-0.0.0.0:11434}"

echo "Menyiapkan symlink MuseTalk (./musetalk, ./models)..."
ln -sfn "$WORKER_DIR/MuseTalk/musetalk" "$WORKER_DIR/musetalk"
ln -sfn "$WORKER_DIR/MuseTalk/models" "$WORKER_DIR/models"

echo "Memastikan model Ollama tersedia (${OLLAMA_MODEL})..."
if ! command -v ollama >/dev/null 2>&1; then
	echo "[ERROR] Ollama tidak ditemukan. Jalankan setup-safe.sh terlebih dahulu."
	exit 1
fi

if ! pgrep -f "ollama serve" >/dev/null 2>&1; then
	echo "Memulai Ollama (${OLLAMA_HOST})..."
	OLLAMA_HOST="$OLLAMA_HOST" ollama serve > "$WORKER_DIR/ollama.log" 2>&1 &
	OLLAMA_PID=$!
	for attempt in $(seq 1 30); do
		if curl -fsS "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
			break
		fi
		sleep 1
		if ! kill -0 "$OLLAMA_PID" 2>/dev/null; then
			echo "[ERROR] Ollama gagal start. Lihat $WORKER_DIR/ollama.log"
			exit 1
		fi
	done
fi

if ! curl -fsS "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
	echo "[ERROR] Ollama tidak merespons di port 11434."
	exit 1
fi

if ! ollama list | awk 'NR > 1 {print $1}' | grep -Fxq "$OLLAMA_MODEL"; then
	echo "Model belum ada, mengunduh ${OLLAMA_MODEL}..."
	ollama pull "$OLLAMA_MODEL"
fi

echo "[OK] Ollama siap di ${OLLAMA_HOST}"

echo "Memulai AI Worker API (Port 8000)..."
python api_server.py > "$WORKER_DIR/api_server.log" 2>&1 &
API_PID=$!

sleep 2
if ! kill -0 "$API_PID" 2>/dev/null; then
	echo "[ERROR] api_server.py gagal start. Lihat log:"
	echo "        tail -50 $WORKER_DIR/api_server.log"
	exit 1
fi

echo "Broadcaster menunggu perintah backend melalui /stream/start-broadcast."

echo "Sistem berhasil dijalankan di background! (api_server PID: $API_PID)"
echo "Log API: $WORKER_DIR/api_server.log"
# Menahan container agar tidak mati
sleep infinity
