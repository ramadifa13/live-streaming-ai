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
    git clone https://github.com/Tencent/MuseTalk.git
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
huggingface-cli download TencentARC/MuseTalk --local-dir models/musetalk
huggingface-cli download stabilityai/sd-vae-ft-mse --local-dir models/sd-vae-ft-mse
huggingface-cli download openai/whisper-small --local-dir models/whisper
huggingface-cli download yzd-v/DWPose --local-dir models/dwpose

echo "SETUP SELESAI! MESIN MUSETALK SIAP DIGUNAKAN PADA $(date)."
