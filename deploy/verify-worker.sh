#!/bin/bash
# Verifikasi worker setelah deploy/restart.
# Usage: bash /workspace/live-streaming-ai/deploy/verify-worker.sh

set -euo pipefail

WORKER_DIR="${WORKER_DIR:-/workspace/ai_live_worker}"
PORT="${PORT:-8000}"
if [ -f "$WORKER_DIR/.env" ]; then
	# shellcheck disable=SC1091
	source "$WORKER_DIR/.env"
	PORT="${PORT:-8000}"
fi

FAIL=0
ok() { echo "[OK]   $*"; }
warn() { echo "[WARN] $*"; }
bad() { echo "[FAIL] $*"; FAIL=1; }

echo "============================================================"
echo " AI Worker — Verify"
echo "============================================================"

# --- Files ---
for f in api_server.py ai_worker.py speech_bridge.py live_worker.py start.sh rtmp_utils.py; do
	if [ -f "$WORKER_DIR/$f" ]; then
		ok "$f ada"
	else
		bad "$f TIDAK ADA di $WORKER_DIR"
	fi
done

# --- Patch markers (pastikan kode terbaru tersync) ---
if grep -q "total_videos_rendered = 0" "$WORKER_DIR/api_server.py" 2>/dev/null; then
	ok "api_server.py: fix total_videos_rendered"
else
	bad "api_server.py belum ter-update (total_videos_rendered)"
fi

if grep -q "on_progress=lambda: write_rtmp_status" "$WORKER_DIR/ai_worker.py" 2>/dev/null; then
	ok "ai_worker.py: RTMP on_progress fix"
else
	bad "ai_worker.py belum ter-update (RTMP on_progress)"
fi

if grep -q "_precache_clip_names" "$WORKER_DIR/ai_worker.py" 2>/dev/null; then
	ok "ai_worker.py: MuseTalk precache terbatas (anti-OOM)"
else
	bad "ai_worker.py belum ter-update (AI_WORKER_PRECACHE_CLIPS)"
fi

if grep -q "_eager_clip_names" "$WORKER_DIR/ai_worker.py" 2>/dev/null; then
	ok "ai_worker.py: lazy decode clips"
else
	warn "ai_worker.py belum lazy decode (AI_WORKER_EAGER_CLIPS)"
fi

if grep -q "start_supervisor.pid" "$WORKER_DIR/start.sh" 2>/dev/null; then
	ok "start.sh: supervisor lock (anti kill ganda)"
else
	warn "start.sh mungkin versi lama (supervisor)"
fi

if grep -q "MUSETALK_WARMUP_ON_START" "$WORKER_DIR/live_worker.py" 2>/dev/null; then
	ok "live_worker.py: warmup deferred"
else
	warn "live_worker.py mungkin versi lama (warmup)"
fi

if grep -q "SPEECH_BRIDGE_MODEL_WAIT_SEC" "$WORKER_DIR/speech_bridge.py" 2>/dev/null; then
	ok "speech_bridge.py: boot-queue wait models"
else
	warn "speech_bridge.py mungkin versi lama"
fi

# --- .env ---
if [ -f "$WORKER_DIR/.env" ]; then
	ok ".env ada"
	grep -q "^BROADCAST_MODE=ai_worker" "$WORKER_DIR/.env" && ok "BROADCAST_MODE=ai_worker" || warn "BROADCAST_MODE bukan ai_worker"
	grep -q "^MUSETALK_WARMUP_ON_START=0" "$WORKER_DIR/.env" && ok "MUSETALK_WARMUP_ON_START=0" || warn "Set MUSETALK_WARMUP_ON_START=0"
	grep -q "^AI_WORKER_PRECACHE_CLIPS=talk_expressive" "$WORKER_DIR/.env" && ok "AI_WORKER_PRECACHE_CLIPS=talk_expressive" || warn "Set AI_WORKER_PRECACHE_CLIPS=talk_expressive"
	grep -q "^AI_WORKER_EAGER_CLIPS=" "$WORKER_DIR/.env" && ok "AI_WORKER_EAGER_CLIPS set" || warn "Set AI_WORKER_EAGER_CLIPS=idle,talk_expressive"
	grep -q "^AI_WORKER_FPS=25" "$WORKER_DIR/.env" && ok "AI_WORKER_FPS=25" || warn "AI_WORKER_FPS tidak 25"
else
	bad ".env tidak ada — cp deploy/.env.example $WORKER_DIR/.env"
fi

# --- Process ---
if pgrep -f "[a]pi_server.py" >/dev/null; then
	API_PID="$(pgrep -f '[a]pi_server.py' | head -n 1)"
	ok "api_server.py berjalan (PID $API_PID)"
else
	bad "api_server.py TIDAK berjalan"
fi

# --- Health ---
HEALTH="$(curl -fsS "http://127.0.0.1:${PORT}/health" 2>/dev/null || echo "")"
if [ -n "$HEALTH" ]; then
	ok "GET /health → $HEALTH"
else
	bad "GET /health gagal di port $PORT"
fi

# --- Queue status ---
QS="$(curl -fsS "http://127.0.0.1:${PORT}/stream/queue-status" 2>/dev/null || echo "")"
if [ -n "$QS" ]; then
	ok "GET /stream/queue-status merespons"
	echo "       $QS" | head -c 200
	echo ""
else
	bad "GET /stream/queue-status gagal (cek api_server.log)"
fi

# --- Assets ---
if [ -f "$WORKER_DIR/assets/3d/namira_idle.mp4" ]; then
	ok "namira_idle.mp4 ada"
else
	warn "namira_idle.mp4 tidak ada"
fi

if [ -d "$WORKER_DIR/MuseTalk/models/musetalkV15" ]; then
	ok "MuseTalk models ada"
else
	bad "MuseTalk models tidak ada — jalankan setup-safe.sh"
fi

echo "============================================================"
if [ "$FAIL" -eq 0 ]; then
	echo " HASIL: SEMUA CEK PENTING LULUS"
else
	echo " HASIL: ADA MASALAH — perbaiki item [FAIL] di atas"
	echo "        Deploy ulang: bash $WORKER_DIR/../live-streaming-ai/deploy/redeploy-worker.sh"
fi
echo "============================================================"
exit "$FAIL"
