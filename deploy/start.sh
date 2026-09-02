#!/bin/bash
set -euo pipefail

# Jangan timpa start.sh saat sedang dijalankan (bash baca file incremental → syntax error).
export START_SH_RUNNING=1

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
WORKER_PORT="${PORT:-8000}"
echo "[INFO] BROADCAST_MODE=${BROADCAST_MODE:-segment}"
echo "[INFO] PORT=${WORKER_PORT}"

# DNS pod RunPod kadang gagal resolve fbcdn.net → RTMP Instagram tidak pernah connect.
ensure_worker_dns() {
	local probe="${1:-live-upload.instagram.com}"
	if getent ahostsv4 "$probe" >/dev/null 2>&1; then
		return 0
	fi
	if getent hosts "$probe" >/dev/null 2>&1; then
		echo "[WARN] DNS hanya IPv6 untuk $probe — FFmpeg dipaksa IPv4 (-4); pastikan A record ada."
	fi
	if getent hosts "$probe" >/dev/null 2>&1; then
		return 0
	fi
	echo "[WARN] DNS gagal resolve $probe — mencoba perbaiki nameserver..."
	if [ -w /etc/resolv.conf ]; then
		{
			echo "nameserver 8.8.8.8"
			echo "nameserver 1.1.1.1"
			echo "nameserver 8.8.4.4"
		} >> /etc/resolv.conf
	fi
	if getent hosts "$probe" >/dev/null 2>&1; then
		echo "[OK] DNS pulih setelah update resolv.conf"
		return 0
	fi
	echo "[WARN] DNS masih gagal — RTMP Instagram kemungkinan tidak connect."
	echo "       Manual: echo -e 'nameserver 8.8.8.8\\nnameserver 1.1.1.1' | sudo tee /etc/resolv.conf"
	return 1
}
ensure_worker_dns || true

worker_health_url() {
	echo "http://127.0.0.1:${WORKER_PORT}/health"
}

is_worker_healthy() {
	curl -fsS "$(worker_health_url)" >/dev/null 2>&1 \
		|| curl -fsS "http://127.0.0.1:${WORKER_PORT}/" >/dev/null 2>&1
}

stop_supervisor() {
	local spid=""
	if [ -f "$WORKER_DIR/.start_supervisor.pid" ]; then
		spid="$(tr -d '[:space:]' < "$WORKER_DIR/.start_supervisor.pid" 2>/dev/null || true)"
	fi
	if [ -n "$spid" ] && [ "$spid" != "$$" ] && kill -0 "$spid" 2>/dev/null; then
		echo "[INFO] Menghentikan supervisor start.sh lama (PID $spid) ..."
		kill -TERM "$spid" 2>/dev/null || true
		sleep 2
		kill -9 "$spid" 2>/dev/null || true
	fi
	rm -f "$WORKER_DIR/.start_supervisor.pid"
}

cleanup_worker_stack() {
	stop_supervisor
	echo "[INFO] Membersihkan proses worker (api_server, broadcaster, ffmpeg RTMP) ..."
	pkill -9 -f "[a]pi_server.py" 2>/dev/null || true
	pkill -9 -f "[b]roadcaster.py" 2>/dev/null || true
	pkill -9 -f "[f]rame_feed.py" 2>/dev/null || true
	pkill -9 -f "ffmpeg.*rtmp" 2>/dev/null || true
	if command -v fuser >/dev/null 2>&1; then
		fuser -k "${WORKER_PORT}/tcp" 2>/dev/null || true
	elif command -v lsof >/dev/null 2>&1; then
		lsof -ti:"${WORKER_PORT}" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
	fi
	sleep 2
	if command -v nvidia-smi >/dev/null 2>&1; then
		echo "[INFO] GPU setelah cleanup:"
		nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>/dev/null || true
	fi
}

stop_existing_worker() {
	cleanup_worker_stack
}

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
elif [ -d "$DEPLOY_DIR" ]; then
	cp -f "$DEPLOY_DIR"/*.py "$WORKER_DIR/" 2>/dev/null || true
	for shf in "$DEPLOY_DIR"/*.sh; do
		[ -f "$shf" ] || continue
		base="$(basename "$shf")"
		if [ "$base" = "start.sh" ] && [ "${START_SH_RUNNING:-0}" = "1" ]; then
			echo "[SYNC] Skip start.sh (sedang dijalankan — di-update di akhir start.sh)"
			continue
		fi
		cp -f "$shf" "$WORKER_DIR/$base"
	done
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

if [ "${FORCE_RESTART:-0}" = "1" ]; then
	echo "[INFO] FORCE_RESTART=1 — restart api_server meski health OK."
	cleanup_worker_stack
elif is_worker_healthy; then
	echo "[OK] AI Worker API sudah aktif di port ${WORKER_PORT} — tidak memulai duplikat."
	API_PID="$(pgrep -f '[a]pi_server.py' | head -n 1 || true)"
	if [ -z "${API_PID:-}" ]; then
		echo "[WARN] Health OK tetapi PID api_server tidak ditemukan — restart bersih."
		stop_existing_worker
	else
		echo "Sistem sudah berjalan! (api_server PID: $API_PID)"
		echo "Log API: $WORKER_DIR/api_server.log"
		echo "Pantau log: tail -f $WORKER_DIR/api_server.log"
		exit 0
	fi
else
	cleanup_worker_stack
fi

export PYTHONUNBUFFERED=1

echo "Memulai AI Worker API (port ${WORKER_PORT})..."
: > "$WORKER_DIR/api_server.log"
"$PYTHON_BIN" -u api_server.py >> "$WORKER_DIR/api_server.log" 2>&1 &
API_PID=$!

for attempt in $(seq 1 300); do
	if is_worker_healthy; then
		echo "[OK] AI Worker API aktif dan merespon di port ${WORKER_PORT}!"
		break
	fi
	sleep 1
	if ! kill -0 "$API_PID" 2>/dev/null; then
		echo "[ERROR] api_server.py gagal start (proses mati). Log:"
		tail -80 "$WORKER_DIR/api_server.log" 2>/dev/null || true
		if command -v dmesg >/dev/null 2>&1; then
			echo "[HINT] Cek OOM killer:"
			dmesg 2>/dev/null | tail -5 | grep -i -E 'oom|killed' || true
		fi
		exit 1
	fi
	if [ "$((attempt % 15))" -eq 0 ]; then
		echo "[INFO] Menunggu api_server... (${attempt}s, PID $API_PID masih hidup)"
		tail -3 "$WORKER_DIR/api_server.log" 2>/dev/null || true
	fi
	if [ "$attempt" -eq 300 ]; then
		echo "[ERROR] api_server.py timeout 300s. Log:"
		tail -80 "$WORKER_DIR/api_server.log" 2>/dev/null || true
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
echo "Health: curl -s http://127.0.0.1:${WORKER_PORT}/health"
echo "Pantau log: tail -f $WORKER_DIR/api_server.log"

if [ "${SKIP_WATCHDOG:-0}" = "1" ]; then
	if [ -f "$DEPLOY_DIR/start.sh" ]; then
		cp -f "$DEPLOY_DIR/start.sh" "$WORKER_DIR/start.sh"
	fi
	echo "[INFO] SKIP_WATCHDOG=1 — api_server berjalan tanpa supervisor loop (untuk redeploy/CI)."
	exit 0
fi

# Update start.sh untuk run berikutnya (tidak ditimpa saat sync di atas).
if [ -f "$DEPLOY_DIR/start.sh" ]; then
	cp -f "$DEPLOY_DIR/start.sh" "$WORKER_DIR/start.sh"
fi

# Container Watchdog Supervisor: Pantau terus status api_server
echo $$ > "$WORKER_DIR/.start_supervisor.pid"
echo "[WATCHDOG] Memulai container supervisor monitor (PID $$)..."
while true; do
	sleep 10
	if is_worker_healthy; then
		API_PID="$(pgrep -f '[a]pi_server.py' | head -n 1 || true)"
		continue
	fi
	echo "[WATCHDOG ALERT] api_server tidak merespons di port ${WORKER_PORT} — restart..."
	cleanup_worker_stack
	"$PYTHON_BIN" -u api_server.py >> "$WORKER_DIR/api_server.log" 2>&1 &
	API_PID=$!
	echo "[WATCHDOG] api_server di-restart (PID: $API_PID)"
done
