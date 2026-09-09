#!/usr/bin/env bash
# Bootstrap the AI worker on a fresh RunPod (MuseTalk only).
# Usage (container start / web terminal):
#   export HF_TOKEN=hf_xxx
#   bash bootstrap_pod.sh
set -euo pipefail

export CUDA_HOME="${CUDA_HOME:-/usr/local/cuda-11.8}"
export PATH="${CUDA_HOME}/bin:${PATH:-}"
export LD_LIBRARY_PATH="${CUDA_HOME}/lib64:${LD_LIBRARY_PATH:-}"
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
GIT_PULL=0 bash setup.sh

echo "[*] Restart API (TTS is owned by backend)"
mkdir -p "$WORKER_DIR"

FORCE_ASSETS=1 bash sync.sh --restart

echo "[*] Health checks"
health_ok=0
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8000/health >/tmp/worker_health.json; then
    echo "[OK] /health"
    cat /tmp/worker_health.json
    health_ok=1
    break
  fi
  sleep 5
done
if [ "$health_ok" -ne 1 ]; then
  echo "[ERROR] Worker health check gagal setelah 300 detik" >&2
  if [ -f "$WORKER_DIR/api_server.log" ]; then
    tail -n 80 "$WORKER_DIR/api_server.log" >&2 || true
  fi
  exit 1
fi
echo "[DONE] MuseTalk worker bootstrap selesai; audio TTS berasal dari backend."
