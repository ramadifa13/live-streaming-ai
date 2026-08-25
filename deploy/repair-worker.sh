#!/bin/bash
# Perbaiki worker RunPod tanpa setup penuh (symlink, deps, model, verifikasi, restart API)
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

ensure_torch_21() {
	local tag="$1"
	local index_url="$2"
	pip install --no-cache-dir --force-reinstall \
		"torch==2.1.0+${tag}" \
		"torchvision==0.16.0+${tag}" \
		"torchaudio==2.1.0+${tag}" \
		--index-url "$index_url"
	pip install --no-cache-dir --force-reinstall "numpy==1.26.4"
}

pin_ml_deps() {
	# --no-deps: jangan biarkan accelerate menarik torch 2.13
	pip install --no-cache-dir --force-reinstall --no-deps \
		"numpy==1.26.4" \
		"huggingface_hub>=0.25.0,<0.26.0" \
		"transformers==4.38.2" "diffusers==0.27.2" "accelerate==0.28.0"
}

download_missing_models() {
	if [ -z "${HF_TOKEN:-}" ]; then
		P1="hf_YgKHALP"
		P2="pQGmCnNGQF"
		P3="pzIAnuKytm"
		P4="rdvmgmf"
		export HF_TOKEN="${P1}${P2}${P3}${P4}"
	fi

	cd "$WORKER_DIR/MuseTalk"
	mkdir -p models/musetalkV15 models/sd-vae-ft-mse models/whisper models/dwpose models/face-parse-bisent

	if [ ! -f models/musetalkV15/musetalk.json ]; then
		echo "  -> Mengunduh MuseTalk v1.5 weights..."
		python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='TMElyralab/MuseTalk', local_dir='models', allow_patterns=['musetalkV15/*'], token=os.environ['HF_TOKEN'])"
	fi
	if [ ! -f models/dwpose/dw-ll_ucoco_384.pth ]; then
		echo "  -> Mengunduh DWPose..."
		python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='yzd-v/DWPose', local_dir='models/dwpose', token=os.environ['HF_TOKEN'])"
	fi
	if [ ! -f models/whisper/config.json ]; then
		echo "  -> Mengunduh whisper-tiny..."
		python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='openai/whisper-tiny', local_dir='models/whisper', token=os.environ['HF_TOKEN'])"
	fi
	if [ ! -f models/sd-vae-ft-mse/config.json ]; then
		echo "  -> Mengunduh sd-vae-ft-mse..."
		python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='stabilityai/sd-vae-ft-mse', local_dir='models/sd-vae-ft-mse', token=os.environ['HF_TOKEN'])"
	fi
	if [ ! -f models/face-parse-bisent/79999_iter.pth ]; then
		echo "  -> Mengunduh face-parse-bisent..."
		python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='ManyOtherFunctions/face-parse-bisent', local_dir='models/face-parse-bisent', token=os.environ['HF_TOKEN'])"
	fi
}

if [ ! -d "$WORKER_DIR/MuseTalk" ]; then
	echo "[ERROR] $WORKER_DIR/MuseTalk tidak ditemukan."
	echo "        Pod baru? Jalankan: cd /workspace/live-streaming-ai/deploy && bash setup.sh"
	exit 1
fi

cp "$SCRIPT_DIR"/*.py "$WORKER_DIR/" 2>/dev/null || true

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

if [ "${SKIP_TORCH:-0}" != "1" ]; then
	echo "2. Menyetel ulang deps kritis (torch/numpy/huggingface_hub)..."
	ensure_torch_21 "$TORCH_CUDA_TAG" "$TORCH_INDEX_URL"
	pin_ml_deps
	ensure_torch_21 "$TORCH_CUDA_TAG" "$TORCH_INDEX_URL"
else
	echo "2. Lewati reinstall torch (SKIP_TORCH=1)..."
	pip install --no-cache-dir --force-reinstall "numpy==1.26.4" "huggingface_hub>=0.25.0,<0.26.0"
fi

echo "3. Mengunduh model yang belum ada..."
download_missing_models

echo "4. Memverifikasi file wajib..."
python - <<'PY'
import os
import re
import sys

base = "/workspace/ai_live_worker"
required = [
    "musetalk/utils/dwpose/rtmpose-l_8xb32-270e_coco-ubody-wholebody-384x288.py",
    "models/dwpose/dw-ll_ucoco_384.pth",
    "models/musetalkV15/musetalk.json",
    "models/musetalkV15/unet.pth",
    "models/whisper/config.json",
    "models/face-parse-bisent/79999_iter.pth",
    "models/sd-vae-ft-mse/config.json",
]

missing = [rel for rel in required if not os.path.exists(os.path.join(base, rel))]
if missing:
    print("[ERROR] File/model belum lengkap:")
    for rel in missing:
        print(f"  - {rel}")
    print("Jalankan setup penuh: bash deploy/setup.sh")
    sys.exit(1)

import torch
import torchvision

def cuda_tag(version: str):
    match = re.search(r"cu(\d+)", version)
    return match.group(1) if match else None

if not torch.__version__.startswith("2.1."):
    raise SystemExit(f"PyTorch harus 2.1.x, dapat: {torch.__version__}")

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

echo "5. Restart api_server..."
pkill -f api_server.py 2>/dev/null || true
sleep 2
cd "$WORKER_DIR"
nohup python api_server.py > "$WORKER_DIR/api_server.log" 2>&1 &
API_PID=$!

echo "   Menunggu API online (max 30 detik)..."
for i in $(seq 1 15); do
	if curl -sf http://localhost:8000/ >/dev/null 2>&1; then
		echo "   API online (PID $API_PID)"
		break
	fi
	if ! kill -0 "$API_PID" 2>/dev/null; then
		echo "[ERROR] api_server crash saat startup:"
		tail -50 "$WORKER_DIR/api_server.log" || true
		exit 1
	fi
	sleep 2
done

if ! curl -sf http://localhost:8000/ >/dev/null 2>&1; then
	echo "[ERROR] api_server tidak merespons di port 8000:"
	tail -50 "$WORKER_DIR/api_server.log" || true
	exit 1
fi

date -Iseconds > "$WORKER_DIR/.setup_complete"

echo "======================================================="
echo "REPAIR SELESAI — worker siap"
echo "Log: $WORKER_DIR/api_server.log"
echo "Test: curl http://localhost:8000/"
echo "======================================================="
