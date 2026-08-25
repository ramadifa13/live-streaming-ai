#!/bin/bash
# Perbaiki worker RunPod tanpa setup penuh (symlink, deps, verifikasi, restart API)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="/workspace/ai_live_worker"

detect_cuda_tag() {
	if [ -n "${TORCH_CUDA_TAG:-}" ]; then
		echo "$TORCH_CUDA_TAG"
		return
	fi
	local from_torch
	from_torch="$(python - <<'PY' 2>/dev/null || true
try:
    import torch
    v = torch.__version__
    if "cu121" in v:
        print("cu121")
    elif "cu118" in v:
        print("cu118")
except Exception:
    pass
PY
)"
	if [ -n "$from_torch" ]; then
		echo "$from_torch"
		return
	fi
	if command -v nvidia-smi &>/dev/null; then
		local cuda_major
		cuda_major="$(nvidia-smi 2>/dev/null | sed -n 's/.*CUDA Version: \([0-9]*\)\..*/\1/p' | head -1)"
		if [ "${cuda_major:-0}" -ge 12 ] 2>/dev/null; then
			echo "cu121"
			return
		fi
	fi
	echo "cu118"
}

if [ ! -d "$WORKER_DIR/MuseTalk" ]; then
	echo "[ERROR] $WORKER_DIR/MuseTalk tidak ditemukan. Jalankan bash setup.sh dulu."
	exit 1
fi

if [ ! -d "$WORKER_DIR/MuseTalk" ]; then
	echo "[ERROR] $WORKER_DIR/MuseTalk tidak ditemukan. Jalankan bash setup.sh dulu."
	exit 1
fi

if [ -f "$SCRIPT_DIR/live_worker.py" ]; then
	cp "$SCRIPT_DIR/live_worker.py" "$WORKER_DIR/"
fi

cd "$WORKER_DIR"
TORCH_CUDA_TAG="$(detect_cuda_tag)"
TORCH_INDEX_URL="https://download.pytorch.org/whl/${TORCH_CUDA_TAG}"

echo "======================================================="
echo "Repair Worker — $(date)"
echo "CUDA tag: ${TORCH_CUDA_TAG}"
echo "======================================================="

echo "1. Membuat symlink layout MuseTalk (./musetalk, ./models)..."
ln -sfn "$WORKER_DIR/MuseTalk/musetalk" "$WORKER_DIR/musetalk"
ln -sfn "$WORKER_DIR/MuseTalk/models" "$WORKER_DIR/models"

echo "2. Menyetel ulang deps kritis (torch/numpy/huggingface_hub)..."
pip install --no-cache-dir --force-reinstall \
	"torch==2.1.0+${TORCH_CUDA_TAG}" \
	"torchvision==0.16.0+${TORCH_CUDA_TAG}" \
	"torchaudio==2.1.0+${TORCH_CUDA_TAG}" \
	--index-url "$TORCH_INDEX_URL"
pip install --no-cache-dir --force-reinstall \
	"numpy==1.26.4" \
	"huggingface_hub>=0.25.0,<0.26.0" \
	"transformers==4.38.2" "diffusers==0.27.2" "accelerate==0.28.0"

echo "3. Memverifikasi file wajib..."
python - <<'PY'
import os
import re
import sys

base = "/workspace/ai_live_worker"
required = [
    "musetalk/utils/dwpose/rtmpose-l_8xb32-270e_coco-ubody-wholebody-384x288.py",
    "models/dwpose/dw-ll_ucoco_384.pth",
    "models/musetalk/musetalk.json",
    "models/musetalk/musetalkV15/unet.pth",
    "models/whisper/config.json",
    "models/face-parse-bisent/79999_iter.pth",
    "models/sd-vae-ft-mse/config.json",
]

missing = [rel for rel in required if not os.path.exists(os.path.join(base, rel))]
if missing:
    print("[ERROR] File/model belum lengkap:")
    for rel in missing:
        print(f"  - {rel}")
    sys.exit(1)

import torch
import torchvision

def cuda_tag(version: str):
    match = re.search(r"cu(\d+)", version)
    return match.group(1) if match else None

torch_tag = cuda_tag(torch.__version__) or (torch.version.cuda or "0").split(".")[0]
tv_tag = cuda_tag(torchvision.__version__)
if tv_tag and torch_tag and tv_tag != torch_tag:
    raise SystemExit(
        f"CUDA mismatch: torch {torch.__version__} vs torchvision {torchvision.__version__}"
    )

import numpy
from huggingface_hub import cached_download

print("numpy", numpy.__version__)
print("torch", torch.__version__)
print("torchvision", torchvision.__version__)
print("huggingface_hub cached_download OK")
print("Semua file wajib ada.")
PY

echo "4. Restart api_server..."
pkill -f api_server.py 2>/dev/null || true
sleep 1
python api_server.py > "$WORKER_DIR/api_server.log" 2>&1 &
sleep 3
if ! pgrep -f api_server.py >/dev/null; then
	echo "[ERROR] api_server gagal start. Lihat: tail -50 $WORKER_DIR/api_server.log"
	exit 1
fi

echo "======================================================="
echo "REPAIR SELESAI — worker siap"
echo "Log: $WORKER_DIR/api_server.log"
echo "Test: curl http://localhost:8000/"
echo "======================================================="
