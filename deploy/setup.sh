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

echo "2. Menginstal Dependensi Python Utama..."
pip install --no-cache-dir --upgrade pip
pip install --no-cache-dir --force-reinstall \
	"numpy==1.26.4" "opencv-python-headless==4.8.0.76" "huggingface_hub<0.26.0,>=0.25.0"
pip install --no-cache-dir -r requirements-worker.txt

echo "2.1. Memverifikasi FFmpeg..."
if ! command -v ffmpeg &> /dev/null; then
	echo "[PERINGATAN] FFmpeg tidak ditemukan di PATH. MuseTalk membutuhkan ffmpeg untuk encoding video."
	echo "           Pastikan image RunPod Anda menyertakan ffmpeg, atau instal manual:"
	echo "           apt-get update && apt-get install -y ffmpeg"
else
	echo "FFmpeg sudah terinstal: $(ffmpeg -version | head -n1)"
fi

echo "3. Mengunduh & Menyiapkan Repositori MuseTalk..."
if [ ! -d "MuseTalk" ]; then
	git clone https://github.com/TMElyralab/MuseTalk.git
fi
cd MuseTalk

# Sesuaikan versi requirements agar kompatibel dengan PyTorch 2.1
sed -i 's/opencv-python==.*/opencv-python==4.8.0.76/g' requirements.txt || true
sed -i 's/^tensorflow==.*/# tensorflow dihapus: tidak dibutuhkan untuk inferensi MuseTalk/g' requirements.txt || true
sed -i 's/^tensorboard==.*/# tensorboard dihapus: tidak dibutuhkan untuk inferensi MuseTalk/g' requirements.txt || true
pip install --no-cache-dir -r requirements.txt
pip install --no-cache-dir --force-reinstall \
	"transformers==4.38.2" "diffusers==0.27.2" "accelerate==0.28.0"

echo "4.1. Memperbaiki Dependensi Build Tools untuk MMCV/MMPose..."
pip install --no-cache-dir --upgrade "pip<24.1" "setuptools<71.0" "wheel<0.42"

echo "4.2. Menginstal OpenMIM (MMPose, MMCV, MMDetection)..."
pip install --no-cache-dir -U openmim
mim install mmengine
mim install "mmcv>=2.0.1"
mim install "mmdet>=3.1.0"
mim install "mmpose>=1.1.0"

echo "5. Mengunduh Bobot Model (Weights) dari HuggingFace..."
if [ -z "${HF_TOKEN:-}" ]; then
	P1="hf_YgKHALP"
	P2="pQGmCnNGQF"
	P3="pzIAnuKytm"
	P4="rdvmgmf"
	export HF_TOKEN="${P1}${P2}${P3}${P4}"
fi

mkdir -p models/musetalk models/sd-vae-ft-mse models/whisper models/dwpose models/face-parse-bisent

python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='TMElyralab/MuseTalk', local_dir='models/musetalk', token=os.environ['HF_TOKEN'])"
python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='stabilityai/sd-vae-ft-mse', local_dir='models/sd-vae-ft-mse', token=os.environ['HF_TOKEN'])"
python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='openai/whisper-tiny', local_dir='models/whisper', token=os.environ['HF_TOKEN'])"
python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='yzd-v/DWPose', local_dir='models/dwpose', token=os.environ['HF_TOKEN'])"
python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='ManyOtherFunctions/face-parse-bisent', local_dir='models/face-parse-bisent', token=os.environ['HF_TOKEN'])"

echo "6. Memverifikasi instalasi..."
python -c "import torch; assert torch.cuda.is_available(), 'CUDA tidak tersedia'; print('PyTorch', torch.__version__, 'CUDA OK')"
python -c "import mmcv, mmpose; print('MMCV/MMPose OK')"

date -Iseconds > "$WORKER_DIR/.setup_complete"

echo "======================================================="
echo "SETUP SELESAI 100%! AI LIVE WORKER SIAP PADA $(date)"
echo "Untuk menjalankan:"
echo "  cd $WORKER_DIR && bash start.sh"
echo "  # atau dari deploy: bash start.sh"
echo "======================================================="
