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
	if [ -f "$WORKER_DIR/env/bin/python" ] && [ -d "$WORKER_DIR/MuseTalk/models" ]; then
		echo "[INFO] Marker .setup_complete tidak ada, tetapi venv dan models terdeteksi. Melanjutkan..."
		date -Iseconds > "$WORKER_DIR/.setup_complete" 2>/dev/null || true
	else
		echo "[ERROR] Setup belum selesai (file .setup_complete tidak ditemukan)."
		echo "        Jalankan: cd /workspace/live-streaming-ai/deploy && bash setup-safe.sh"
		exit 1
	fi
fi

if [ ! -f "$WORKER_DIR/api_server.py" ]; then
	echo "[ERROR] api_server.py tidak ditemukan di $WORKER_DIR"
	exit 1
fi

if [ -f "$WORKER_DIR/env/bin/python" ]; then
    PYTHON_BIN="$WORKER_DIR/env/bin/python"
    export PATH="$WORKER_DIR/env/bin:$PATH"
    source "$WORKER_DIR/env/bin/activate" || true
else
    PYTHON_BIN="python"
fi

export COQUI_TOS_AGREED=1
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"
export OLLAMA_HOST="${OLLAMA_HOST:-0.0.0.0:11434}"

echo "Menyiapkan symlink MuseTalk (./musetalk, ./models)..."
ln -sfn "$WORKER_DIR/MuseTalk/musetalk" "$WORKER_DIR/musetalk"
ln -sfn "$WORKER_DIR/MuseTalk/models" "$WORKER_DIR/models"

echo "Menyinkronkan skrip inferensi & preprocessing MuseTalk terbaru..."
if [ -d "/workspace/live-streaming-ai/deploy" ]; then
	cp -f /workspace/live-streaming-ai/deploy/inference.py "$WORKER_DIR/MuseTalk/scripts/inference.py" 2>/dev/null || true
	cp -f /workspace/live-streaming-ai/deploy/preprocessing.py "$WORKER_DIR/MuseTalk/musetalk/utils/preprocessing.py" 2>/dev/null || true
	cp -f /workspace/live-streaming-ai/deploy/api_server.py "$WORKER_DIR/api_server.py" 2>/dev/null || true
	cp -f /workspace/live-streaming-ai/deploy/live_worker.py "$WORKER_DIR/live_worker.py" 2>/dev/null || true
	cp -f /workspace/live-streaming-ai/deploy/broadcaster.py "$WORKER_DIR/broadcaster.py" 2>/dev/null || true
	if [ -f "/workspace/live-streaming-ai/MuseTalk/musetalk/utils/face_detection/detection/sfd/sfd_detector.py" ]; then
		mkdir -p "$WORKER_DIR/MuseTalk/musetalk/utils/face_detection/detection/sfd"
		cp -f /workspace/live-streaming-ai/MuseTalk/musetalk/utils/face_detection/detection/sfd/sfd_detector.py "$WORKER_DIR/MuseTalk/musetalk/utils/face_detection/detection/sfd/sfd_detector.py" 2>/dev/null || true
	fi
	mkdir -p "$WORKER_DIR/assets/2d" "$WORKER_DIR/assets/3d"
	if [ -d "/workspace/live-streaming-ai/deploy/assets" ]; then
		cp -rn /workspace/live-streaming-ai/deploy/assets/* "$WORKER_DIR/assets/" 2>/dev/null || true
	fi
fi

# Ollama di RunPod bersifat opsional karena LLM diproses terpusat di Backend
if [ "${ENABLE_RUNPOD_OLLAMA:-0}" = "1" ]; then
	echo "Memastikan model Ollama tersedia (${OLLAMA_MODEL})..."
	if command -v ollama >/dev/null 2>&1; then
		if ! pgrep -f "ollama serve" >/dev/null 2>&1; then
			echo "Memulai Ollama (${OLLAMA_HOST})..."
			OLLAMA_HOST="$OLLAMA_HOST" ollama serve > "$WORKER_DIR/ollama.log" 2>&1 &
		fi
	fi
else
	echo "[INFO] LLM dipusatkan di Backend (Ollama RunPod dinonaktifkan untuk menghemat VRAM GPU)."
fi

echo "Memulai AI Worker API (Port 8000)..."
"$PYTHON_BIN" api_server.py > "$WORKER_DIR/api_server.log" 2>&1 &
API_PID=$!



for attempt in $(seq 1 120); do
	if curl -fsS "http://127.0.0.1:8000/health" >/dev/null 2>&1 || curl -fsS "http://127.0.0.1:8000/" >/dev/null 2>&1; then
		echo "[OK] AI Worker API aktif dan merespon!"
		break
	fi
	sleep 1
	if ! kill -0 "$API_PID" 2>/dev/null; then
		echo "[ERROR] api_server.py gagal start (proses mati). Log:"
		tail -50 "$WORKER_DIR/api_server.log" 2>/dev/null || true
		exit 1
	fi
	if [ "$attempt" -eq 120 ]; then
		echo "[ERROR] api_server.py timeout 120s. Log:"
		tail -50 "$WORKER_DIR/api_server.log" 2>/dev/null || true
		exit 1
	fi
done

if ! kill -0 "$API_PID" 2>/dev/null; then
	echo "[ERROR] api_server.py gagal start. Lihat log:"
	echo "        tail -50 $WORKER_DIR/api_server.log"
	exit 1
fi

echo "Broadcaster menunggu perintah backend melalui /stream/start-broadcast."

echo "Sistem berhasil dijalankan di background! (api_server PID: $API_PID)"
echo "Log API: $WORKER_DIR/api_server.log"

# Container Watchdog Supervisor: Pantau terus status api_server
echo "[WATCHDOG] Memulai container supervisor monitor..."
while true; do
	sleep 10
	if ! kill -0 "$API_PID" 2>/dev/null; then
		echo "[WATCHDOG ALERT] api_server.py mati! Me-restart api_server..."
		"$PYTHON_BIN" api_server.py >> "$WORKER_DIR/api_server.log" 2>&1 &
		API_PID=$!
		echo "[WATCHDOG] api_server di-restart (PID: $API_PID)"
	fi
done
