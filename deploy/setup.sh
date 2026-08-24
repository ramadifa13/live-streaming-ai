#!/bin/bash
# ==========================================
# SKRIP SETUP INSTAN AI WORKER RUNPOD (MUSETALK)
# ==========================================
# Seluruh proses akan dilog ke setup_log.txt
exec > >(tee -a /workspace/ai_live_worker/setup_log.txt) 2>&1

echo "Memulai Instalasi MuseTalk pada $(date)..."

echo "1. Mempersiapkan Sistem & Folder..."
apt-get update && apt-get install -y ffmpeg
mkdir -p /workspace/ai_live_worker/assets/2d
mkdir -p /workspace/ai_live_worker/assets/3d
mkdir -p /workspace/ai_live_worker/temp
mkdir -p /workspace/ai_live_worker/output

echo "2. Menyalin Skrip Python & Aset ke ruang kerja..."
cp *.py /workspace/ai_live_worker/
cp requirements-worker.txt /workspace/ai_live_worker/
cp -r assets/* /workspace/ai_live_worker/assets/ 2>/dev/null || true
rm -rf ../frontend ../backend

cd /workspace/ai_live_worker

echo "3. Mengunduh Repositori MuseTalk..."
if [ ! -d "MuseTalk" ]; then
    git clone https://github.com/TMElyralab/MuseTalk.git
fi
cd MuseTalk

echo "4. Menginstal Library Inti MuseTalk..."
pip install -r requirements.txt
pip install huggingface_hub

echo "5. Menginstal Library MMPose & MMCV via OpenMIM (Proses ini mungkin memakan waktu)..."
pip install --no-cache-dir -U openmim
mim install mmengine
mim install "mmcv>=2.0.1"
mim install "mmdet>=3.1.0"
mim install "mmpose>=1.1.0"

echo "6. Mengunduh Bobot Model (Weights) dari HuggingFace (Proses 5-10 GB)..."

if [ -z "$HF_TOKEN" ]; then
    echo "============================================================"
    echo "                      ERROR 429 TREETECTED                   "
    echo "============================================================"
    echo "IP RunPod Anda masuk daftar hitam (Error 429) oleh HuggingFace."
    echo "Satu-satunya cara untuk mengunduh adalah dengan menggunakan Token Anda."
    echo ""
    echo "LANGKAH:"
    echo "1. Buka https://huggingface.co/settings/tokens"
    echo "2. Buat token baru (tipe READ) lalu Copy."
    echo "3. Jalankan ulang setup ini dengan perintah:"
    echo "   HF_TOKEN=\"hf_xxxx_token_anda\" bash setup.sh"
    echo "============================================================"
    exit 1
fi

mkdir -p models/musetalk models/sd-vae-ft-mse models/whisper models/dwpose

python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='TMElyralab/MuseTalk', local_dir='models/musetalk', token=os.environ['HF_TOKEN'])"
python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='stabilityai/sd-vae-ft-mse', local_dir='models/sd-vae-ft-mse', token=os.environ['HF_TOKEN'])"
python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='openai/whisper-small', local_dir='models/whisper', token=os.environ['HF_TOKEN'])"
python -c "import os; from huggingface_hub import snapshot_download; snapshot_download(repo_id='yzd-v/DWPose', local_dir='models/dwpose', token=os.environ['HF_TOKEN'])"

echo "SETUP SELESAI! MESIN MUSETALK SIAP DIGUNAKAN PADA $(date)."
