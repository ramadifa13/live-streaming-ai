#!/bin/bash
# ==========================================
# SKRIP SETUP INSTAN AI WORKER RUNPOD
# ==========================================

echo "1. Membuat struktur folder..."
mkdir -p /workspace/ai_live_worker/assets/2d
mkdir -p /workspace/ai_live_worker/assets/3d
mkdir -p /workspace/ai_live_worker/assets/voice_refs
mkdir -p /workspace/ai_live_worker/temp
mkdir -p /workspace/ai_live_worker/output

echo "2. Menyalin Skrip Python & Aset ke ruang kerja..."
cp *.py /workspace/ai_live_worker/
cp requirements-worker.txt /workspace/ai_live_worker/
cp -r assets/* /workspace/ai_live_worker/assets/ 2>/dev/null || true

echo "3. Menghapus folder Frontend & Backend dari Clone untuk menghemat disk..."
rm -rf ../frontend ../backend

cd /workspace/ai_live_worker

echo "4. Mengunduh Wav2Lip dan Model AI..."
git clone https://github.com/Rudrabha/Wav2Lip.git
mkdir -p Wav2Lip/checkpoints
# Mengunduh otak Wav2Lip langsung dari server HuggingFace
wget -O Wav2Lip/checkpoints/wav2lip_gan.pth "https://huggingface.co/camenduru/Wav2Lip/resolve/main/checkpoints/wav2lip_gan.pth"

echo "5. Menginstal Python Library (Mohon tunggu sebentar)..."
sed -i 's/==.*//g' Wav2Lip/requirements.txt
pip install -r Wav2Lip/requirements.txt
pip install "opencv-python-headless<4.10" "opencv-python<4.10" "opencv-contrib-python<4.10" librosa==0.9.2 "numpy<2.0.0"
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

echo "SETUP SELESAI! MESIN SIAP DIGUNAKAN."
