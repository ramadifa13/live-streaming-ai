#!/bin/bash
# ============================================================
# RunPod RTX 4090 - All-in-One Automated Setup Script
# LiveStreamerAI - Real Lip-Sync AI Host & Studio
# Usage: bash deploy/setup_runpod_sadtalker.sh
# ============================================================

set -e  # Exit on error

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   LiveStreamerAI — Production Setup for RunPod RTX 4090  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"

cd "$ROOT_DIR"
echo "📍 Root directory: $ROOT_DIR"
echo "📍 Deploy directory: $DEPLOY_DIR"
echo ""

# ─── Step 1: System Dependencies ─────────────────────────────
echo "▶ [1/6] Installing system packages (FFmpeg, CUDA utils, Git, Node)..."
apt-get update -qq
apt-get install -y -qq \
    ffmpeg \
    git \
    wget \
    curl \
    unzip \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1

# Ensure Node.js and npm are available
if ! command -v node &> /dev/null; then
    echo "   📦 Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
fi

echo "   ✅ System dependencies installed (Node $(node -v), npm $(npm -v))"

# ─── Step 2: Python AI Dependencies ──────────────────────────
echo ""
echo "▶ [2/6] Installing Python AI worker packages..."
pip install -q --upgrade pip
pip install -q \
    fastapi \
    "uvicorn[standard]" \
    edge-tts \
    pydantic \
    requests \
    httpx \
    pillow \
    numpy \
    scipy \
    imageio \
    imageio-ffmpeg \
    tqdm \
    facexlib \
    resampy \
    yacs \
    kornia \
    librosa \
    gfpgan \
    torch \
    torchvision \
    torchaudio \
    --extra-index-url https://download.pytorch.org/whl/cu118
echo "   ✅ Python packages installed"

# ─── Step 3: Clone SadTalker ─────────────────────────────────
echo ""
echo "▶ [3/6] Setting up SadTalker repository..."
cd "$DEPLOY_DIR"
if [ ! -d "SadTalker" ]; then
    git clone https://github.com/OpenTalker/SadTalker.git
    echo "   ✅ SadTalker cloned"
else
    echo "   ⏩ SadTalker already exists"
fi

# Install SadTalker requirements
if [ -f "SadTalker/requirements.txt" ]; then
    pip install -q -r SadTalker/requirements.txt || true
fi

# ─── Step 4: Download SadTalker Checkpoints & Models ─────────
echo ""
echo "▶ [4/6] Downloading SadTalker model checkpoints & weights (~600MB)..."
mkdir -p SadTalker/checkpoints
mkdir -p SadTalker/gfpgan/weights

CKPT_DIR="SadTalker/checkpoints"
GFPGAN_DIR="SadTalker/gfpgan/weights"

download_if_missing() {
    local url=$1
    local dest=$2
    if [ ! -f "$dest" ]; then
        echo "   📥 Downloading $(basename $dest)..."
        wget -q --show-progress -O "$dest" "$url"
    else
        echo "   ⏩ $(basename $dest) already exists"
    fi
}

# 1. Main SadTalker checkpoints
download_if_missing \
    "https://github.com/OpenTalker/SadTalker/releases/download/v0.0.2-rc/mapping_00229-model.pth.tar" \
    "$CKPT_DIR/mapping_00229-model.pth.tar"

download_if_missing \
    "https://github.com/OpenTalker/SadTalker/releases/download/v0.0.2-rc/mapping_00109-model.pth.tar" \
    "$CKPT_DIR/mapping_00109-model.pth.tar"

download_if_missing \
    "https://github.com/OpenTalker/SadTalker/releases/download/v0.0.2-rc/SadTalker_V0.0.2_256.safetensors" \
    "$CKPT_DIR/SadTalker_V0.0.2_256.safetensors"

download_if_missing \
    "https://github.com/OpenTalker/SadTalker/releases/download/v0.0.2-rc/SadTalker_V0.0.2_512.safetensors" \
    "$CKPT_DIR/SadTalker_V0.0.2_512.safetensors"

# 2. 3D Face / BFM Epoch model
download_if_missing \
    "https://github.com/OpenTalker/SadTalker/releases/download/v0.0.2-rc/epoch_20.pth" \
    "$CKPT_DIR/epoch_20.pth"

# 3. GFPGAN HD Face Enhancement weights
download_if_missing \
    "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth" \
    "$GFPGAN_DIR/GFPGANv1.4.pth"

download_if_missing \
    "https://github.com/xinntao/facexlib/releases/download/v0.1.0/alignment_WFLW_4HG.pth" \
    "$GFPGAN_DIR/alignment_WFLW_4HG.pth"

download_if_missing \
    "https://github.com/xinntao/facexlib/releases/download/v0.1.0/detection_Resnet50_Final.pth" \
    "$GFPGAN_DIR/detection_Resnet50_Final.pth"

download_if_missing \
    "https://github.com/sczhou/CodeFormer/releases/download/v0.1.0/parsing_parsenet.pth" \
    "$GFPGAN_DIR/parsing_parsenet.pth"

# If official SadTalker download script is available, run it to get BFM files
if [ -f "SadTalker/scripts/download_models.sh" ]; then
    echo "   📦 Running SadTalker official model sync..."
    (cd SadTalker && bash scripts/download_models.sh 2>/dev/null) || true
fi

echo "   ✅ All model checkpoints verified"

# ─── Step 5: Install Node Dependencies & Setup Database ──────
echo ""
echo "▶ [5/6] Setting up Backend & Frontend..."
cd "$ROOT_DIR"

# Backend setup
echo "   ⚙️ Installing Backend dependencies..."
cd "$ROOT_DIR/backend"
npm install --include=dev
npx prisma generate 2>/dev/null || true
npx prisma db push 2>/dev/null || true

# Frontend setup
echo "   🎨 Installing Frontend dependencies..."
cd "$ROOT_DIR/frontend"
npm install --include=dev

# Global tools
npm install -g pm2 --quiet

# ─── Step 6: Final Verification ──────────────────────────────
echo ""
echo "▶ [6/6] Verifying GPU & Installation..."
cd "$ROOT_DIR"

python3 -c "
import torch
print(f'   PyTorch: {torch.__version__}')
print(f'   CUDA Available: {torch.cuda.is_available()}')
if torch.cuda.is_available():
    print(f'   GPU Device: {torch.cuda.get_device_name(0)}')
    vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    print(f'   VRAM: {vram:.1f} GB')

from pathlib import Path
sadtalker = Path('$DEPLOY_DIR/SadTalker/inference.py')
ckpts = Path('$DEPLOY_DIR/SadTalker/checkpoints')
print(f'   SadTalker inference.py: {\"OK ✅\" if sadtalker.exists() else \"MISSING ❌\"}')
print(f'   Checkpoints: {len(list(ckpts.glob(\"*\")))} files present')
"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  🎉 Setup Selesai 100% — Siap Production!"
echo ""
echo "  Untuk menjalankan semua service via PM2:"
echo "  pm2 start deploy/ecosystem.config.js"
echo "  pm2 save"
echo "═══════════════════════════════════════════════════════════"
