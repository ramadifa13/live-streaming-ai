#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/cuda-11.8/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CUDA_HOME=/usr/local/cuda-11.8
export LD_LIBRARY_PATH=/usr/local/cuda-11.8/lib64:${LD_LIBRARY_PATH:-}
export TMPDIR=/workspace/tmp
export PIP_CACHE_DIR=/workspace/tmp/pip_cache
mkdir -p "$TMPDIR" "$PIP_CACHE_DIR" /workspace/ai_live_worker /workspace/voices /workspace/models/voxcpm2

if [[ -f /workspace/.hf_token ]]; then
  export HF_TOKEN="$(tr -d '\r\n' </workspace/.hf_token)"
fi
if [[ -z "${HF_TOKEN:-}" ]]; then
  echo "[ERROR] HF_TOKEN missing (/workspace/.hf_token)"
  exit 1
fi

cd /workspace/live-streaming-ai/deploy
chmod +x *.sh voxcpm2_tts/*.sh 2>/dev/null || true

echo "[BOOT] MuseTalk setup start $(date -Iseconds)"
bash setup.sh

echo "[BOOT] VoxCPM2 setup start $(date -Iseconds)"
VOICE_ID="${VOICE_ID:-girl_cute_kids}" bash voxcpm2_tts/setup.sh

echo "[BOOT] env + sync + restart $(date -Iseconds)"
cp -n .env.example /workspace/ai_live_worker/.env || true
if ! grep -q '^TTS_ENABLED=' /workspace/ai_live_worker/.env 2>/dev/null; then
  cat >> /workspace/ai_live_worker/.env <<'EOF'

TTS_ENABLED=true
VOICE_ID=girl_cute_kids
TTS_LANGUAGE=id
VOXCPM2_MODEL_PATH=/workspace/models/voxcpm2
VOICE_ROOT=/workspace/voices
VOXCPM2_VENV=/workspace/voxcpm2_env
VOXCPM2_BIND_HOST=127.0.0.1
VOXCPM2_BIND_PORT=8091
VOXCPM2_ALLOW_VOICE_DESIGN=1
VOXCPM2_READY_TIMEOUT=600
MUSETALK_BATCH_SIZE=16
EOF
fi
# Sync katalog suara perempuan (bukan default_host)
for vid in girl_cute_kids girl_warm_youthful girl_warm_friendly girl_calm_professional; do
  mkdir -p "/workspace/voices/$vid"
  src="voices/$vid/reference.wav"
  if [[ -f "$src" ]]; then
    cp -n "$src" "/workspace/voices/$vid/reference.wav" 2>/dev/null || true
  fi
done
# Hapus leftover default_host jika ada
rm -rf /workspace/voices/default_host /workspace/ai_live_worker/voices/default_host 2>/dev/null || true

FORCE_ASSETS=1 bash sync.sh --restart

echo "[BOOT] DONE $(date -Iseconds)"
sleep 5
curl -sf http://127.0.0.1:8000/health || echo "[WARN] /health not ready"
curl -sf http://127.0.0.1:8000/tts/health || echo "[WARN] /tts/health not ready"
