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
# Struktur folder models yang dibutuhkan MuseTalk
mkdir -p models/musetalk models/sd-vae-ft-mse models/whisper models/dwpose

# Menggunakan Python murni untuk mengunduh agar terhindar dari error "hf command not found" di bash script
# Menggunakan Mirror (hf-mirror) untuk menghindari pemblokiran (Error 429 Too Many Requests) dari HuggingFace ke IP RunPod
export HF_ENDPOINT="https://hf-mirror.com"
python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='TMElyralab/MuseTalk', local_dir='models/musetalk')"
python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='stabilityai/sd-vae-ft-mse', local_dir='models/sd-vae-ft-mse')"
python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='openai/whisper-small', local_dir='models/whisper')"
python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='yzd-v/DWPose', local_dir='models/dwpose')"

echo "SETUP SELESAI! MESIN MUSETALK SIAP DIGUNAKAN PADA $(date)."
