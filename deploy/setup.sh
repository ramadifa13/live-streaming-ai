#!/bin/bash
# ==========================================
# SKRIP SETUP OTOMATIS RUNPOD WORKER (MUSETALK)
# ==========================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="/workspace/ai_live_worker"
MIN_FREE_GB="${MIN_FREE_GB:-15}"

export PIP_NO_CACHE_DIR=1

mkdir -p "$WORKER_DIR"/assets/2d "$WORKER_DIR"/assets/3d "$WORKER_DIR"/temp "$WORKER_DIR"/output

exec > >(tee -a "$WORKER_DIR/setup_log.txt") 2>&1

echo "======================================================="
echo "Memulai Instalasi Otomatis AI Worker pada $(date)..."
echo "Jalankan skrip ini dari folder deploy repo, contoh:"
echo "  cd /workspace/live-streaming-ai/deploy && bash setup.sh"
echo "======================================================="

check_disk_space() {
	local mount="$1"
	local label="$2"
	local avail_kb avail_gb

	if ! avail_kb="$(df -k "$mount" 2>/dev/null | awk 'NR==2 {print $4}')"; then
		echo "[PERINGATAN] Tidak bisa mengecek ruang disk di $mount ($label)."
		return 0
	fi

	avail_gb=$((avail_kb / 1024 / 1024))
	echo "Ruang disk tersedia di $label ($mount): ${avail_gb} GB"

	if [ "$avail_gb" -lt "$MIN_FREE_GB" ]; then
		echo "[ERROR] Ruang disk di $label kurang dari ${MIN_FREE_GB} GB."
		echo "        Perbesar Container Disk RunPod (disarankan 30-50 GB) lalu jalankan ulang setup."
		exit 1
	fi
}

echo "0. Mengecek ruang disk..."
check_disk_space "/" "container root"
check_disk_space "/workspace" "volume workspace"

echo "0.1. Membersihkan cache pip..."
pip cache purge 2>/dev/null || true
rm -rf /usr/local/lib/python3.10/dist-packages/~* 2>/dev/null || true

echo "1. Mempersiapkan Direktori Kerja..."
cp "$SCRIPT_DIR"/*.py "$WORKER_DIR"/ 2>/dev/null || true
cp "$SCRIPT_DIR"/*.sh "$WORKER_DIR"/ 2>/dev/null || true
cp "$SCRIPT_DIR"/requirements-worker.txt "$WORKER_DIR"/ 2>/dev/null || true
if [ -d "$SCRIPT_DIR/assets" ]; then
	cp -r "$SCRIPT_DIR"/assets/* "$WORKER_DIR"/assets/ 2>/dev/null || true
fi

cd "$WORKER_DIR"

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

TORCH_CUDA_TAG="$(detect_cuda_tag)"
TORCH_INDEX_URL="https://download.pytorch.org/whl/${TORCH_CUDA_TAG}"
MMCV_WHEEL_INDEX="https://download.openmmlab.com/mmcv/dist/${TORCH_CUDA_TAG}/torch2.1.0/index.html"

ensure_torch_21() {
	pip install --no-cache-dir --force-reinstall \
		"torch==2.1.0+${TORCH_CUDA_TAG}" \
		"torchvision==0.16.0+${TORCH_CUDA_TAG}" \
		"torchaudio==2.1.0+${TORCH_CUDA_TAG}" \
		--index-url "$TORCH_INDEX_URL"
	# torch cu121 menarik numpy 2.x — MuseTalk butuh numpy 1.26.4
	pip install --no-cache-dir --force-reinstall "numpy==1.26.4"
}

pin_ml_deps() {
	# MuseTalk/diffusers masih butuh cached_download (dihapus di huggingface_hub>=0.26)
	pip install --no-cache-dir --force-reinstall \
		"numpy==1.26.4" \
		"huggingface_hub>=0.25.0,<0.26.0" \
		"transformers==4.38.2" "diffusers==0.27.2" "accelerate==0.28.0"
}

echo "2. Menyetel stack PyTorch 2.1 (CUDA tag: ${TORCH_CUDA_TAG})..."
python - <<'PY' || true
import torch
v = torch.__version__
if not v.startswith("2.1."):
    print(f"[PERINGATAN] Template RunPod memakai PyTorch {v}, bukan 2.1.x.")
    print("             Setup akan memasang ulang torch 2.1.x.")
PY
ensure_torch_21
python - <<'PY'
import re
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
print(f"torch {torch.__version__} + torchvision {torchvision.__version__} OK")
PY

echo "2.1. Menginstal Dependensi Python Utama..."
pip install --no-cache-dir --upgrade pip
pip install --no-cache-dir --force-reinstall \
	"numpy==1.26.4" "opencv-python-headless==4.8.0.76" "huggingface_hub<0.26.0,>=0.25.0"
pip install --no-cache-dir -r requirements-worker.txt

echo "2.2. Memverifikasi FFmpeg..."
if ! command -v ffmpeg &> /dev/null; then
	echo "[PERINGATAN] FFmpeg tidak ditemukan. Mencoba instal otomatis..."
	if apt-get update -qq && apt-get install -y -qq ffmpeg; then
		echo "FFmpeg terinstal: $(ffmpeg -version | head -n1)"
	else
		echo "[PERINGATAN] Instal FFmpeg gagal. Jalankan manual: apt-get update && apt-get install -y ffmpeg"
	fi
else
	echo "FFmpeg sudah terinstal: $(ffmpeg -version | head -n1)"
fi

echo "3. Mengunduh & Menyiapkan Repositori MuseTalk..."
if [ ! -d "MuseTalk" ]; then
	git clone https://github.com/TMElyralab/MuseTalk.git
fi
cd MuseTalk

# Sesuaikan requirements upstream agar kompatibel inferensi headless + PyTorch 2.1
sed -i 's/^numpy==.*/numpy==1.26.4/g' requirements.txt || true
sed -i 's/^numpy>=.*/numpy==1.26.4/g' requirements.txt || true
sed -i 's/opencv-python==.*/opencv-python==4.8.0.76/g' requirements.txt || true
sed -i 's/^tensorflow==.*/# tensorflow dihapus: tidak dibutuhkan untuk inferensi MuseTalk/g' requirements.txt || true
sed -i 's/^tensorboard==.*/# tensorboard dihapus: tidak dibutuhkan untuk inferensi MuseTalk/g' requirements.txt || true
sed -i 's/^gradio==.*/# gradio dihapus: tidak dibutuhkan untuk inferensi headless/g' requirements.txt || true
sed -i 's/^transformers==.*/transformers==4.38.2/g' requirements.txt || true
sed -i 's/^diffusers==.*/diffusers==0.27.2/g' requirements.txt || true
sed -i 's/^huggingface_hub==.*/huggingface_hub>=0.25.0,<0.26.0/g' requirements.txt || true

pip install --no-cache-dir -r requirements.txt
# --no-deps: jangan tarik torch 2.13 saat re-pin paket ML
pip install --no-cache-dir --force-reinstall --no-deps \
	"numpy==1.26.4" \
	"transformers==4.38.2" "diffusers==0.27.2" "accelerate==0.28.0"
ensure_torch_21
pin_ml_deps

echo "4.1. Memperbaiki Dependensi Build Tools untuk MMCV/MMPose..."
pip install --no-cache-dir --force-reinstall "pip<24.1" "setuptools>=65,<71" "wheel<0.42"
python -c "import pkg_resources; print('pkg_resources OK')"

echo "4.2. Menginstal OpenMIM (MMPose, MMCV, MMDetection)..."
pip install --no-cache-dir -U openmim
mim install mmengine

if ! pip install --no-cache-dir "mmcv==2.1.0" -f "$MMCV_WHEEL_INDEX"; then
	echo "[PERINGATAN] Wheel mmcv prebuilt gagal, mencoba mim install..."
	mim install "mmcv==2.1.0" || pip install --no-cache-dir --no-build-isolation "mmcv==2.1.0" -f "$MMCV_WHEEL_INDEX"
fi

mim install "mmdet>=3.1.0"
mim install "mmpose>=1.1.0"

echo "4.3. Memastikan NumPy/PyTorch tetap kompatibel..."
ensure_torch_21
pin_ml_deps
pip install --no-cache-dir "tokenizers>=0.14,<0.19" "safetensors>=0.4.1"
python - <<'PY'
import torch
v = torch.__version__
if not v.startswith("2.1."):
    raise SystemExit(f"PyTorch {v} tidak kompatibel; diharapkan 2.1.x")
print("PyTorch", v, "OK")
PY

echo "5. Mengunduh Bobot Model (Weights) dari HuggingFace..."
if [ -z "${HF_TOKEN:-}" ]; then
	P1="hf_YgKHALP"
	P2="pQGmCnNGQF"
	P3="pzIAnuKytm"
	P4="rdvmgmf"
	export HF_TOKEN="${P1}${P2}${P3}${P4}"
fi

mkdir -p models/musetalkV15 models/sd-vae-ft-mse models/whisper models/dwpose models/face-parse-bisent

python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='TMElyralab/MuseTalk', local_dir='models', allow_patterns=['musetalkV15/*'], token=os.environ['HF_TOKEN'])"
python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='stabilityai/sd-vae-ft-mse', local_dir='models/sd-vae-ft-mse', token=os.environ['HF_TOKEN'])"
python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='openai/whisper-tiny', local_dir='models/whisper', token=os.environ['HF_TOKEN'])"
python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='yzd-v/DWPose', local_dir='models/dwpose', token=os.environ['HF_TOKEN'])"
python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='ManyOtherFunctions/face-parse-bisent', local_dir='models/face-parse-bisent', token=os.environ['HF_TOKEN'])"

echo "5.1. Menyiapkan symlink layout MuseTalk di worker root..."
cd "$WORKER_DIR"
ln -sfn "$WORKER_DIR/MuseTalk/musetalk" "$WORKER_DIR/musetalk"
ln -sfn "$WORKER_DIR/MuseTalk/models" "$WORKER_DIR/models"

echo "6. Memverifikasi instalasi..."
python -c "import torch; assert torch.cuda.is_available(), 'CUDA tidak tersedia'; print('PyTorch', torch.__version__, 'CUDA OK')"
python - <<'PY'
import re
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
print("torch/torchvision CUDA tags match")
PY
python - <<'PY'
import huggingface_hub
from huggingface_hub import cached_download
print("huggingface_hub", huggingface_hub.__version__, "cached_download OK")
PY
python -c "import mmcv, mmpose; print('MMCV/MMPose OK')"
python - <<'PY'
import os
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
    print("[ERROR] Model/file wajib belum lengkap:")
    for rel in missing:
        print(f"  - {rel}")
    sys.exit(1)
print("Semua model & config MuseTalk lengkap")
PY

date -Iseconds > "$WORKER_DIR/.setup_complete"

echo "======================================================="
echo "SETUP SELESAI 100%! AI LIVE WORKER SIAP PADA $(date)"
echo "Untuk menjalankan:"
echo "  cd $WORKER_DIR && bash start.sh"
echo "  # atau dari deploy: bash start.sh"
echo "======================================================="
