#!/usr/bin/env bash
# Setup VoxCPM2 di venv TERPISAH dari MuseTalk (torch 2.5+ / CUDA 12 vs MuseTalk cu118).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="${VOXCPM2_VENV:-/workspace/voxcpm2_env}"
MODEL_DIR="${VOXCPM2_MODEL_PATH:-/workspace/models/voxcpm2}"
VOICE_ROOT="${VOICE_ROOT:-/workspace/voices}"
VOICE_ID="${VOICE_ID:-girl_cute_kids}"

echo "================================================"
echo " VoxCPM2 TTS setup (dedicated venv)"
echo " Venv : $VENV_DIR"
echo " Model: $MODEL_DIR"
echo " Voice: $VOICE_ROOT/$VOICE_ID"
echo "================================================"

mkdir -p "$VENV_DIR" "$MODEL_DIR" "$VOICE_ROOT/$VOICE_ID" "$SCRIPT_DIR"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  python3 -m venv "$VENV_DIR"
fi
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

python -m pip install --upgrade pip wheel setuptools

# Torch CUDA 12.1+ (VoxCPM2 requirement). Jangan campur dengan MuseTalk cu118.
TORCH_INDEX="${VOXCPM2_TORCH_INDEX:-https://download.pytorch.org/whl/cu121}"
python -m pip install --no-cache-dir \
  "torch>=2.5.0" "torchaudio>=2.5.0" \
  --index-url "$TORCH_INDEX"

python -m pip install --no-cache-dir -r "$SCRIPT_DIR/requirements.txt"

# Optional: pre-download weights ke network volume
if [[ "${VOXCPM2_DOWNLOAD_MODEL:-1}" == "1" ]]; then
  if [[ ! -f "$MODEL_DIR/config.json" ]] && [[ -z "$(ls -A "$MODEL_DIR" 2>/dev/null || true)" ]]; then
    echo "[INFO] Downloading openbmb/VoxCPM2 → $MODEL_DIR …"
    python - <<PY
from huggingface_hub import snapshot_download
import os
snapshot_download(
    repo_id=os.environ.get("VOXCPM2_HUB_ID", "openbmb/VoxCPM2"),
    local_dir=os.environ.get("VOXCPM2_MODEL_PATH", "$MODEL_DIR"),
)
print("[OK] model downloaded")
PY
  else
    echo "[INFO] Model dir sudah terisi: $MODEL_DIR"
  fi
fi

if [[ ! -f "$VOICE_ROOT/$VOICE_ID/reference.wav" ]]; then
  echo "[WARN] Belum ada $VOICE_ROOT/$VOICE_ID/reference.wav"
  echo "       Letakkan WAV referensi 5–30 detik di path itu."
  echo "       Sementara VOXCPM2_ALLOW_VOICE_DESIGN=1 memakai voice design."
  # Salin dari deploy/voices bila ada
  if [[ -f "$DEPLOY_DIR/voices/$VOICE_ID/reference.wav" ]]; then
    cp -f "$DEPLOY_DIR/voices/$VOICE_ID/reference.wav" "$VOICE_ROOT/$VOICE_ID/reference.wav"
    echo "[OK] Copied reference dari deploy/voices"
  fi
fi

python - <<'PY'
import torch
print("Torch", torch.__version__, "CUDA", torch.version.cuda, "avail", torch.cuda.is_available())
import voxcpm
print("voxcpm OK", getattr(voxcpm, "__version__", "?"))
PY

date -Iseconds > "$SCRIPT_DIR/.setup_complete" 2>/dev/null || date > "$SCRIPT_DIR/.setup_complete"
echo "[OK] VoxCPM2 setup selesai. Worker: $VENV_DIR/bin/python $SCRIPT_DIR/worker.py"
