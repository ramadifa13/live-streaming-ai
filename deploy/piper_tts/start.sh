#!/bin/bash
# Start Piper TTS di :8090 — venv terpisah, CPU only.
set -euo pipefail

PIPER_DIR="${PIPER_DIR:-/workspace/piper_tts}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Prefer installed copy under /workspace/piper_tts
if [ -f "$PIPER_DIR/server.py" ]; then
	:
elif [ -f "$SCRIPT_DIR/server.py" ]; then
	PIPER_DIR="$SCRIPT_DIR"
fi

VENV_DIR="$PIPER_DIR/env"
PYTHON_BIN="$VENV_DIR/bin/python"
PORT="${PIPER_PORT:-8090}"
export PIPER_DIR
export PIPER_MODELS_DIR="${PIPER_MODELS_DIR:-$PIPER_DIR/models}"
export PIPER_VOICE="${PIPER_VOICE:-id_ID-news_tts-medium}"
export PIPER_DEFAULT_HOST="${PIPER_DEFAULT_HOST:-namira}"
export PIPER_PORT="$PORT"

if [ ! -x "$PYTHON_BIN" ] || [ ! -f "$PIPER_DIR/.setup_complete" ]; then
	echo "[ERROR] Piper belum di-setup."
	echo "        Jalankan: bash /workspace/live-streaming-ai/deploy/piper_tts/setup.sh"
	exit 1
fi

mkdir -p "$PIPER_DIR/logs"

# Stop instance lama
if [ -f "$PIPER_DIR/piper.pid" ]; then
	old="$(cat "$PIPER_DIR/piper.pid" 2>/dev/null || true)"
	if [ -n "${old:-}" ] && kill -0 "$old" 2>/dev/null; then
		echo "[INFO] Stop Piper lama PID $old"
		kill "$old" 2>/dev/null || true
		sleep 1
	fi
fi
pkill -f "[p]iper_tts/server.py|[ ]$PIPER_DIR/server.py|uvicorn.*8090" 2>/dev/null || true
# Lebih spesifik:
pkill -f "$PIPER_DIR/server.py" 2>/dev/null || true
sleep 0.5

# Sync server.py dari repo bila ada
REPO_SERVER="/workspace/live-streaming-ai/deploy/piper_tts/server.py"
if [ -f "$REPO_SERVER" ]; then
	cp -f "$REPO_SERVER" "$PIPER_DIR/server.py"
fi

echo "[INFO] Start Piper TTS port $PORT (CPU, isolated venv)"
: > "$PIPER_DIR/logs/piper.log"
nohup "$PYTHON_BIN" -u "$PIPER_DIR/server.py" >> "$PIPER_DIR/logs/piper.log" 2>&1 &
echo $! > "$PIPER_DIR/piper.pid"
PID="$(cat "$PIPER_DIR/piper.pid")"

for i in $(seq 1 60); do
	if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
		echo "[OK] Piper TTS ready: http://127.0.0.1:${PORT}/health (PID $PID)"
		exit 0
	fi
	if ! kill -0 "$PID" 2>/dev/null; then
		echo "[ERROR] Piper mati saat start. Log:"
		tail -40 "$PIPER_DIR/logs/piper.log" || true
		exit 1
	fi
	sleep 1
done

echo "[ERROR] Piper timeout. Log:"
tail -40 "$PIPER_DIR/logs/piper.log" || true
exit 1
