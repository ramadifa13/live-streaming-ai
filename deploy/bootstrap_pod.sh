#!/usr/bin/env bash
# Bootstrap full AI worker on a fresh RunPod (MuseTalk + VoxCPM2).
# Usage (container start / web terminal):
#   export HF_TOKEN=hf_xxx
#   bash bootstrap_pod.sh
set -euo pipefail

export TMPDIR="${TMPDIR:-/workspace/tmp}"
export PIP_CACHE_DIR="${PIP_CACHE_DIR:-/workspace/tmp/pip_cache}"
mkdir -p "$TMPDIR" "$PIP_CACHE_DIR" /workspace

REPO_DIR="${REPO_DIR:-/workspace/live-streaming-ai}"
WORKER_DIR="${WORKER_DIR:-/workspace/ai_live_worker}"
REPO_URL="${REPO_URL:-https://github.com/ramadifa13/live-streaming-ai.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"

if [ -z "${HF_TOKEN:-}" ]; then
  echo "[ERROR] HF_TOKEN wajib untuk download model MuseTalk / HF assets."
  echo "        export HF_TOKEN='hf_...'"
  exit 1
fi

echo "[*] GPU / CUDA check"
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader || true
nvcc --version | tail -3 || true
python3 --version

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[*] Cloning $REPO_URL → $REPO_DIR"
  git clone --branch "$REPO_BRANCH" "$REPO_URL" "$REPO_DIR"
else
  echo "[*] Updating repo"
  git -C "$REPO_DIR" fetch origin
  git -C "$REPO_DIR" checkout "$REPO_BRANCH"
  git -C "$REPO_DIR" pull --ff-only origin "$REPO_BRANCH" || true
fi

cd "$REPO_DIR/deploy"

echo "[*] MuseTalk setup (idempotent jika .setup_complete ada)"
bash setup.sh

echo "[*] VoxCPM2 dedicated venv"
bash voxcpm2_tts/setup.sh

echo "[*] Worker .env + assets + restart API (VoxCPM2 bridge on :8091)"
mkdir -p "$WORKER_DIR" /workspace/voices/default_host /workspace/models/voxcpm2
if [ -f "$REPO_DIR/deploy/voices/default_host/reference.wav" ]; then
  cp -n "$REPO_DIR/deploy/voices/default_host/reference.wav" \
    /workspace/voices/default_host/reference.wav || true
fi
cp -n .env.example "$WORKER_DIR/.env"
# Pastikan VoxCPM2 + MuseTalk flags ada di .env worker
grep -q '^TTS_ENABLED=' "$WORKER_DIR/.env" || cat >> "$WORKER_DIR/.env" <<'EOF'

TTS_ENABLED=true
VOICE_ID=default_host
TTS_LANGUAGE=id
VOXCPM2_MODEL_PATH=/workspace/models/voxcpm2
VOICE_ROOT=/workspace/voices
VOXCPM2_VENV=/workspace/voxcpm2_env
VOXCPM2_BIND_HOST=127.0.0.1
VOXCPM2_BIND_PORT=8091
VOXCPM2_ALLOW_VOICE_DESIGN=1
VOXCPM2_READY_TIMEOUT=600
EOF

FORCE_ASSETS=1 bash sync.sh --restart

echo "[*] Health checks"
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8000/health >/tmp/worker_health.json; then
    echo "[OK] /health"
    cat /tmp/worker_health.json
    break
  fi
  sleep 5
done
curl -sf http://127.0.0.1:8000/tts/health && echo || echo "[WARN] /tts/health belum ready (VoxCPM2 masih warm-up)"

echo "[DONE] MuseTalk + VoxCPM2 worker bootstrap selesai."
