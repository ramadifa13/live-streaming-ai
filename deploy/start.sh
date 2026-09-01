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

# Install ffmpeg if not present
if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "[INFO] Menginstall ffmpeg..."
    apt-get update -qq && apt-get install -y -qq ffmpeg 2>/dev/null || \
    apk add --no-cache ffmpeg 2>/dev/null || \
    yum install -y -q ffmpeg 2>/dev/null || \
    conda install -y -q ffmpeg 2>/dev/null || \
    echo "[WARNING] Gagal menginstall ffmpeg secara otomatis"
fi

if [ ! -f "$WORKER_DIR/api_server.py" ]; then
	echo "[ERROR] api_server.py tidak ditemukan di $WORKER_DIR"
	exit 1
fi

REPO_DIR="${REPO_DIR:-/workspace/live-streaming-ai}"
DEPLOY_DIR="${DEPLOY_DIR:-$REPO_DIR/deploy}"
SYNC_SCRIPT="${SYNC_SCRIPT:-$DEPLOY_DIR/sync-worker.sh}"
if [ -f "$SYNC_SCRIPT" ]; then
	# shellcheck source=sync-worker.sh
	source "$SYNC_SCRIPT"
	bootstrap_worker_env
fi

# Load worker .env (BROADCAST_MODE / MuseTalk flags)
if [ -f "$WORKER_DIR/.env" ]; then
	echo "[INFO] Memuat $WORKER_DIR/.env ..."
	set -a
	# shellcheck disable=SC1091
	source "$WORKER_DIR/.env"
	set +a
fi
echo "[INFO] BROADCAST_MODE=${BROADCAST_MODE:-segment}"

if [ -f "$WORKER_DIR/env/bin/python" ]; then
	PYTHON_BIN="$WORKER_DIR/env/bin/python"
	export PATH="$WORKER_DIR/env/bin:$PATH"
	# shellcheck disable=SC1091
	source "$WORKER_DIR/env/bin/activate" || true
else
	echo "[ERROR] Python venv tidak ditemukan di $WORKER_DIR/env"
	echo "        Jalankan setup terlebih dahulu:"
	echo "          cd $DEPLOY_DIR && export HF_TOKEN=hf_... && bash setup-safe.sh"
	exit 1
fi

if [ -f "$SYNC_SCRIPT" ]; then
	ensure_worker_python_deps "$PYTHON_BIN"
fi

export COQUI_TOS_AGREED=1
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"
export OLLAMA_HOST="${OLLAMA_HOST:-0.0.0.0:11434}"

echo "Menyiapkan symlink MuseTalk (./musetalk, ./models)..."
ln -sfn "$WORKER_DIR/MuseTalk/musetalk" "$WORKER_DIR/musetalk"
ln -sfn "$WORKER_DIR/MuseTalk/models" "$WORKER_DIR/models"

echo "Menyinkronkan skrip worker dari repo ..."
if [ -f "$SYNC_SCRIPT" ]; then
	sync_worker_files
elif [ -d "/workspace/live-streaming-ai/deploy" ]; then
	cp -f /workspace/live-streaming-ai/deploy/*.py "$WORKER_DIR/" 2>/dev/null || true
	cp -f /workspace/live-streaming-ai/deploy/*.sh "$WORKER_DIR/" 2>/dev/null || true
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
