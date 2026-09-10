#!/usr/bin/env bash
# One-shot MuseTalk worker bootstrap on a fresh RunPod volume.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export CUDA_HOME="${CUDA_HOME:-/usr/local/cuda-11.8}"
export PATH="${CUDA_HOME}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export LD_LIBRARY_PATH="${CUDA_HOME}/lib64:${LD_LIBRARY_PATH:-}"
export TMPDIR="${TMPDIR:-/workspace/tmp}"
export PIP_CACHE_DIR="${PIP_CACHE_DIR:-/workspace/tmp/pip_cache}"
mkdir -p "$TMPDIR" "$PIP_CACHE_DIR" /workspace

if [[ -f /workspace/.hf_token ]]; then
  export HF_TOKEN="$(tr -d '\r\n' </workspace/.hf_token)"
fi
if [[ -z "${HF_TOKEN:-}" ]]; then
  echo "[ERROR] HF_TOKEN missing (/workspace/.hf_token)"
  exit 1
fi
export HUGGING_FACE_HUB_TOKEN="$HF_TOKEN"
# Avoid hf_transfer hard-fail if the extra package is not installed yet.
unset HF_HUB_ENABLE_HF_TRANSFER || true

echo "[BOOT] start $(date -Iseconds)"
echo "[BOOT] GPU:"
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader || true

echo "[1/5] apt: git git-lfs curl ffmpeg"
apt-get update -qq
apt-get install -y git git-lfs curl ffmpeg ca-certificates
git --version
git lfs install --system || git lfs install || true
git config --global user.name "ramadifa13"
git config --global user.email "ramadifa13@gmail.com"
git config --global init.defaultBranch main

REPO_DIR="${REPO_DIR:-/workspace/live-streaming-ai}"
REPO_URL="${REPO_URL:-https://github.com/ramadifa13/live-streaming-ai.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"

echo "[2/5] git clone/update $REPO_URL"
if [[ ! -d "$REPO_DIR/.git" ]]; then
  git clone --branch "$REPO_BRANCH" "$REPO_URL" "$REPO_DIR"
else
  git -C "$REPO_DIR" fetch origin
  git -C "$REPO_DIR" checkout "$REPO_BRANCH"
  git -C "$REPO_DIR" pull --ff-only origin "$REPO_BRANCH" || true
fi
git -C "$REPO_DIR" log -1 --oneline
git -C "$REPO_DIR" remote -v
git -C "$REPO_DIR" status -sb

echo "[3/5] MuseTalk setup.sh"
cd "$REPO_DIR/deploy"
chmod +x ./*.sh scripts/*.sh 2>/dev/null || true
GIT_PULL=0 bash setup.sh

echo "[4/5] sync + restart"
FORCE_ASSETS=1 bash sync.sh --restart

echo "[5/5] health"
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8000/health; then
    echo
    echo "[BOOT] DONE $(date -Iseconds)"
    exit 0
  fi
  sleep 5
done
echo "[ERROR] /health not ready" >&2
tail -n 80 /workspace/ai_live_worker/api_server.log >&2 || true
exit 1
