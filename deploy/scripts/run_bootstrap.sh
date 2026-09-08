#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/cuda-11.8/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CUDA_HOME=/usr/local/cuda-11.8
export LD_LIBRARY_PATH=/usr/local/cuda-11.8/lib64:${LD_LIBRARY_PATH:-}
export TMPDIR=/workspace/tmp
export PIP_CACHE_DIR=/workspace/tmp/pip_cache
mkdir -p "$TMPDIR" "$PIP_CACHE_DIR" /workspace/ai_live_worker

REPO_DIR="${REPO_DIR:-/workspace/live-streaming-ai}"
REPO_URL="${REPO_URL:-https://github.com/ramadifa13/live-streaming-ai.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"

if [[ -f /workspace/.hf_token ]]; then
  export HF_TOKEN="$(tr -d '\r\n' </workspace/.hf_token)"
fi
if [[ -z "${HF_TOKEN:-}" ]]; then
  echo "[ERROR] HF_TOKEN missing (/workspace/.hf_token atau export HF_TOKEN=...)"
  exit 1
fi

if [[ -f "$REPO_DIR/deploy/sync.sh" ]]; then
  source "$REPO_DIR/deploy/sync.sh"
  pull_repo || true
else
  echo "[BOOT] Clone $REPO_URL → $REPO_DIR"
  rm -rf "$REPO_DIR"
  git clone --branch "$REPO_BRANCH" "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR/deploy"
chmod +x *.sh scripts/*.sh 2>/dev/null || true

echo "[BOOT] MuseTalk setup start $(date -Iseconds)"
bash setup.sh

echo "[BOOT] env + sync + restart $(date -Iseconds)"
cp -n .env.example /workspace/ai_live_worker/.env || true

FORCE_ASSETS=1 bash sync.sh --restart

echo "[BOOT] DONE $(date -Iseconds)"
sleep 5
curl -sf http://127.0.0.1:8000/health || echo "[WARN] /health not ready"
