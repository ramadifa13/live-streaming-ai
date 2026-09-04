#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/cuda-11.8/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CUDA_HOME=/usr/local/cuda-11.8
export LD_LIBRARY_PATH=/usr/local/cuda-11.8/lib64:${LD_LIBRARY_PATH:-}
cd /workspace/ai_live_worker

PY="/workspace/ai_live_worker/env/bin/python"
if [[ ! -x "$PY" ]]; then
  echo "[ERROR] Venv tidak ada: $PY"
  echo "        Jalankan: bash /workspace/live-streaming-ai/deploy/setup.sh"
  exit 1
fi
if ! "$PY" -c "import fastapi, uvicorn" 2>/dev/null; then
  echo "[DEPS] fastapi/uvicorn hilang — install requirements-worker.txt ..."
  "$PY" -m pip install --no-cache-dir -r /workspace/ai_live_worker/requirements-worker.txt \
    || "$PY" -m pip install --no-cache-dir "fastapi>=0.104" "uvicorn>=0.24" "pydantic>=2"
fi

pkill -f 'api_server.py' 2>/dev/null || true
pkill -f 'voxcpm2_tts/worker.py' 2>/dev/null || true
sleep 2
nohup "$PY" api_server.py >> api_server.log 2>&1 &
echo "STARTED pid=$! py=$PY"
sleep 12
curl -sf --max-time 8 http://127.0.0.1:8000/health || echo FAIL_HEALTH
echo
curl -sf --max-time 8 http://127.0.0.1:8000/tts/health || echo FAIL_TTS_WARMING
echo
pgrep -af 'api_server|voxcpm2' | head -5 || true
