#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/cuda-11.8/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

export MUSETALK_BATCH_SIZE="16"
export MUSETALK_USE_FLOAT16="1"
# Perbaikan mulut terlalu besar & getaran avatar:
# upper_boundary_ratio kecil = area blending mulut lebih kecil = lebih natural
export MUSETALK_UPPER_BOUNDARY_RATIO="0.46"
# cheek_width kecil = sudut bibir tidak melebar keluar
export MUSETALK_CHEEK_WIDTH="10"
# bbox_smooth_window = temporal smoothing frame → kurangi goyang/jitter
export MUSETALK_BBOX_SMOOTH_WINDOW="7"

cp -f /workspace/live-streaming-ai/deploy/gpu_compat.py \
  /workspace/ai_live_worker/gpu_compat.py

cd /workspace/live-streaming-ai/deploy
bash sync.sh --restart
echo "[OK] optimize+restart finished"
curl -sf --max-time 10 http://127.0.0.1:8000/health || true
echo
curl -sf --max-time 10 http://127.0.0.1:8000/tts/health || true
echo
