#!/bin/bash
# ============================================================
# RUNPOD RTX 4090 - MUSETALK SAFE SETUP
# Python 3.10 + CUDA 11.8 + PyTorch 2.1
# ============================================================

set -euo pipefail

export TORCH_CUDA_TAG=cu118
export CUDA_HOME="${CUDA_HOME:-/usr/local/cuda-11.8}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"
export PIP_NO_CACHE_DIR=1

WORKER_DIR="/workspace/ai_live_worker"

echo ""
echo "============================================================"
echo " MuseTalk RunPod RTX 4090 - SAFE SETUP"
echo "============================================================"
echo ""

# ------------------------------------------------------------
# 0. BASIC CHECK
# ------------------------------------------------------------

echo "[0/10] Mengecek environment..."

python --version
which python

if ! command -v nvidia-smi >/dev/null 2>&1; then
    echo "[ERROR] nvidia-smi tidak ditemukan."
    exit 1
fi

if ! command -v nvcc >/dev/null 2>&1; then
    echo "[ERROR] nvcc tidak ditemukan."
    exit 1
fi

if ! command -v gcc >/dev/null 2>&1; then
    echo "[ERROR] gcc tidak ditemukan."
    exit 1
fi

echo ""
echo "GPU:"
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader

echo ""
echo "CUDA toolkit:"
nvcc --version | tail -5

echo ""
echo "Compiler:"
gcc --version | head -1

echo ""
echo "Python:"
python --version

# ------------------------------------------------------------
# 1. VALIDATE PYTHON
# ------------------------------------------------------------

PY_MAJOR_MINOR="$(python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"

if [ "$PY_MAJOR_MINOR" != "3.10" ]; then
    echo "[ERROR] Python 3.10 dibutuhkan."
    echo "Current: $PY_MAJOR_MINOR"
    exit 1
fi

echo "[OK] Python 3.10"

# ------------------------------------------------------------
# 1.1 OLLAMA
# ------------------------------------------------------------

echo ""
echo "[1.1/10] Menyiapkan Ollama (${OLLAMA_MODEL})..."

if ! command -v curl >/dev/null 2>&1; then
    echo "curl belum ada. Installing..."
    apt-get update -qq
    apt-get install -y -qq curl
fi

if ! command -v ollama >/dev/null 2>&1; then
    echo "Ollama belum ada. Installing..."
    curl -fsSL https://ollama.com/install.sh | sh
else
    echo "Ollama sudah terinstall: $(ollama --version)"
fi

if ! command -v ollama >/dev/null 2>&1; then
    echo "[ERROR] Ollama gagal diinstall."
    exit 1
fi

echo "[OK] Ollama tersedia. Model akan dipastikan setelah setup dependensi selesai."

# ------------------------------------------------------------
# 2. VALIDATE CUDA TOOLKIT
# ------------------------------------------------------------

NVCC_VERSION="$(nvcc --version | sed -n 's/.*release \([0-9]*\.[0-9]*\).*/\1/p' | tail -1)"

if [ "$NVCC_VERSION" != "11.8" ]; then
    echo "[ERROR] Script ini ditujukan untuk CUDA toolkit 11.8."
    echo "Detected nvcc: $NVCC_VERSION"
    exit 1
fi

echo "[OK] CUDA toolkit 11.8"

# ------------------------------------------------------------
# 3. HF TOKEN
# ------------------------------------------------------------

echo ""
echo "[3/10] Mengecek Hugging Face token..."

if [ -z "${HF_TOKEN:-}" ]; then
    echo ""
    echo "[ERROR] HF_TOKEN belum diset."
    echo ""
    echo "Jalankan:"
    echo ""
    echo "  export HF_TOKEN='hf_xxxxxxxxxxxxxxxxx'"
    echo ""
    echo "Kemudian jalankan script ini lagi."
    exit 1
fi

echo "[OK] HF_TOKEN tersedia."

# ------------------------------------------------------------
# 4. DISK
# ------------------------------------------------------------

echo ""
echo "[4/10] Mengecek disk..."

ROOT_AVAIL_GB="$(df -Pk / | awk 'NR==2 {print int($4/1024/1024)}')"

echo "Root free: ${ROOT_AVAIL_GB} GB"

if [ "$ROOT_AVAIL_GB" -lt 15 ]; then
    echo "[ERROR] Root disk kurang dari 15 GB."
    echo "Tambahkan Container Disk RunPod."
    exit 1
fi

mkdir -p \
    "$WORKER_DIR/assets/2d" \
    "$WORKER_DIR/assets/3d" \
    "$WORKER_DIR/temp" \
    "$WORKER_DIR/output"

echo "[OK] Disk cukup."

# ------------------------------------------------------------
# 5. STOP OLD API
# ------------------------------------------------------------

echo ""
echo "[5/10] Menghentikan API lama jika ada..."

pkill -f "api_server.py" 2>/dev/null || true
sleep 2

echo "[OK] API lama dihentikan."

# ------------------------------------------------------------
# 6. CLEAN OLD TORCH STACK
# ------------------------------------------------------------

echo ""
echo "[6/10] Membersihkan PyTorch stack lama..."

python -m pip uninstall -y \
    torch \
    torchvision \
    torchaudio \
    2>/dev/null || true

echo "[OK] Torch lama dibersihkan."

# ------------------------------------------------------------
# 7. INSTALL EXACT PYTORCH STACK
# ------------------------------------------------------------

echo ""
echo "[7/10] Menginstall PyTorch 2.1 + CUDA 11.8..."

python -m pip install \
    --no-cache-dir \
    --no-deps \
    "torch==2.1.0+cu118" \
    "torchvision==0.16.0+cu118" \
    "torchaudio==2.1.0+cu118" \
    --index-url https://download.pytorch.org/whl/cu118

python -m pip install \
    --no-cache-dir \
    --no-deps \
    "numpy==1.26.4"

echo ""
echo "Memverifikasi PyTorch..."

python - <<'PY'
import sys
import torch
import torchvision
import torchaudio
import numpy

print("Python      :", sys.version.split()[0])
print("Torch       :", torch.__version__)
print("Torch CUDA  :", torch.version.cuda)
print("Torchvision :", torchvision.__version__)
print("Torchaudio  :", torchaudio.__version__)
print("NumPy       :", numpy.__version__)
print("CUDA OK     :", torch.cuda.is_available())

if not torch.__version__.startswith("2.1."):
    raise SystemExit("[ERROR] Torch bukan 2.1.x")

if torch.version.cuda != "11.8":
    raise SystemExit("[ERROR] Torch CUDA bukan 11.8")

if not torchvision.__version__.startswith("0.16."):
    raise SystemExit("[ERROR] Torchvision bukan 0.16.x")

if not torchaudio.__version__.startswith("2.1."):
    raise SystemExit("[ERROR] Torchaudio bukan 2.1.x")

if numpy.__version__ != "1.26.4":
    raise SystemExit("[ERROR] NumPy bukan 1.26.4")

if not torch.cuda.is_available():
    raise SystemExit("[ERROR] CUDA tidak tersedia di PyTorch")

gpu = torch.cuda.get_device_name(0)
print("GPU         :", gpu)

if "4090" not in gpu:
    print("[WARNING] GPU bukan RTX 4090.")

print("")
print("PYTORCH STACK OK")
PY

# ------------------------------------------------------------
# 8. INSTALL WORKER FILES
# ------------------------------------------------------------

echo ""
echo "[8/10] Menyiapkan worker..."

cp "$SCRIPT_DIR"/*.py "$WORKER_DIR"/ 2>/dev/null || true
cp "$SCRIPT_DIR"/*.sh "$WORKER_DIR"/ 2>/dev/null || true

if [ -d "$SCRIPT_DIR/assets" ]; then
    cp -r "$SCRIPT_DIR/assets"/* "$WORKER_DIR/assets"/ 2>/dev/null || true
fi

if [ -f "$SCRIPT_DIR/requirements-worker.txt" ]; then
    cp "$SCRIPT_DIR/requirements-worker.txt" "$WORKER_DIR/"
fi

cd "$WORKER_DIR"

# ------------------------------------------------------------
# 9. CORE PYTHON DEPENDENCIES
# ------------------------------------------------------------

echo ""
echo "[9/10] Installing dependency utama..."

python -m pip install \
    --no-cache-dir \
    "pip<24.1" \
    "setuptools>=65,<71" \
    "wheel<0.42"

python -m pip install \
    --no-cache-dir \
    "numpy==1.26.4" \
    "opencv-python-headless==4.8.0.76" \
    "huggingface_hub>=0.25.0,<0.26.0" \
    "transformers==4.38.2" \
    "diffusers==0.27.2" \
    "accelerate==0.28.0"

# requirements worker
if [ -f "$WORKER_DIR/requirements-worker.txt" ]; then

    echo ""
    echo "Installing requirements-worker.txt..."

    python -m pip install \
        --no-cache-dir \
        -r "$WORKER_DIR/requirements-worker.txt"

fi

# Restore critical versions after requirements-worker
python -m pip install \
    --no-cache-dir \
    --force-reinstall \
    "numpy==1.26.4" \
    "huggingface_hub>=0.25.0,<0.26.0" \
    "transformers==4.38.2" \
    "diffusers==0.27.2" \
    "accelerate==0.28.0"

# IMPORTANT:
# requirements-worker jangan sampai mengubah Torch.
python -m pip install \
    --no-cache-dir \
    --no-deps \
    "torch==2.1.0+cu118" \
    "torchvision==0.16.0+cu118" \
    "torchaudio==2.1.0+cu118" \
    --index-url https://download.pytorch.org/whl/cu118

# ------------------------------------------------------------
# FFMPEG
# ------------------------------------------------------------

echo ""
echo "Mengecek FFmpeg..."

if ! command -v ffmpeg >/dev/null 2>&1; then

    echo "FFmpeg belum ada. Installing..."

    apt-get update -qq
    apt-get install -y -qq ffmpeg

fi

ffmpeg -version | head -1

# ------------------------------------------------------------
# 10. CLONE MUSETALK + INJECT _load_models_cached
# ------------------------------------------------------------

echo ""
echo "============================================================"
echo " Menyiapkan MuseTalk"
echo "============================================================"

cd "$WORKER_DIR"

if [ ! -d "$WORKER_DIR/MuseTalk/.git" ]; then
    git clone https://github.com/TMElyralab/MuseTalk.git
else
    echo "MuseTalk sudah ada, skip clone."
fi

cd "$WORKER_DIR/MuseTalk"

# Backup requirements asli
if [ ! -f requirements.original.txt ]; then
    cp requirements.txt requirements.original.txt
fi

# Patch dependency upstream
sed -i 's/^numpy==.*/numpy==1.26.4/g' requirements.txt || true
sed -i 's/^numpy>=.*/numpy==1.26.4/g' requirements.txt || true
sed -i 's/^opencv-python==.*/opencv-python==4.8.0.76/g' requirements.txt || true
sed -i 's/^tensorflow==.*/# tensorflow dihapus untuk inference headless/g' requirements.txt || true
sed -i 's/^tensorboard==.*/# tensorboard dihapus untuk inference headless/g' requirements.txt || true
sed -i 's/^gradio==.*/# gradio dihapus untuk inference headless/g' requirements.txt || true
sed -i 's/^transformers==.*/transformers==4.38.2/g' requirements.txt || true
sed -i 's/^diffusers==.*/diffusers==0.27.2/g' requirements.txt || true
sed -i 's/^huggingface_hub==.*/huggingface_hub>=0.25.0,<0.26.0/g' requirements.txt || true

python -m pip install \
    --no-cache-dir \
    -r requirements.txt

# Restore critical versions
python -m pip install \
    --no-cache-dir \
    --force-reinstall \
    "numpy==1.26.4" \
    "transformers==4.38.2" \
    "diffusers==0.27.2" \
    "accelerate==0.28.0" \
    "huggingface_hub>=0.25.0,<0.26.0"

# Restore EXACT torch stack AGAIN
python -m pip install \
    --no-cache-dir \
    --no-deps \
    "torch==2.1.0+cu118" \
    "torchvision==0.16.0+cu118" \
    "torchaudio==2.1.0+cu118" \
    --index-url https://download.pytorch.org/whl/cu118

# ------------------------------------------------------------
# INJECT _load_models_cached ke inference.py
# ------------------------------------------------------------

echo ""
echo "[*] Menginject _load_models_cached ke MuseTalk..."

cd "$WORKER_DIR/MuseTalk/scripts"

if ! grep -q "_load_models_cached" inference.py 2>/dev/null; then

    cp inference.py inference.py.original

    python3 << 'PYINJECT'
with open("inference.py.original", "r") as f:
    content = f.read()

inject_code = '''
# ============================================================
# INJECTED: _load_models_cached (for live_worker.py warmup)
# ============================================================
import threading as _threading

_lock = _threading.Lock()
_models_cache = {}

def _load_models_cached(args):
    global _models_cache
    cache_key = (
        args.gpu_id,
        args.use_float16,
        args.version,
        args.left_cheek_width,
        args.right_cheek_width,
        args.unet_model_path,
        args.unet_config,
        args.whisper_dir,
        args.vae_type,
    )
    if cache_key not in _models_cache:
        with _lock:
            if cache_key not in _models_cache:
                device = torch.device(f"cuda:{args.gpu_id}" if torch.cuda.is_available() else "cpu")
                vae, unet, pe = load_all_model(
                    unet_model_path=args.unet_model_path,
                    vae_type=args.vae_type,
                    unet_config=args.unet_config,
                    device=device
                )
                timesteps = torch.tensor([0], device=device)
                if args.use_float16:
                    pe = pe.half()
                    vae.vae = vae.vae.half()
                    unet.model = unet.model.half()
                pe = pe.to(device)
                vae.vae = vae.vae.to(device)
                unet.model = unet.model.to(device)
                audio_processor = AudioProcessor(feature_extractor_path=args.whisper_dir)
                weight_dtype = unet.model.dtype
                whisper = WhisperModel.from_pretrained(args.whisper_dir)
                whisper = whisper.to(device=device, dtype=weight_dtype).eval()
                whisper.requires_grad_(False)
                if args.version == "v15":
                    fp = FaceParsing(
                        left_cheek_width=args.left_cheek_width,
                        right_cheek_width=args.right_cheek_width
                    )
                else:
                    fp = FaceParsing()
                _models_cache[cache_key] = {
                    "vae": vae, "unet": unet, "pe": pe,
                    "whisper": whisper, "fp": fp,
                    "audio_processor": audio_processor,
                    "device": device, "weight_dtype": weight_dtype,
                    "timesteps": timesteps,
                }
    return _models_cache[cache_key]

'''

# Inject at END of file (after all imports and existing code)
new_content = content.rstrip() + "\n\n" + inject_code

with open("inference.py", "w") as f:
    f.write(new_content)

print("[OK] _load_models_cached berhasil diinject di akhir file.")
PYINJECT

else
    echo "[SKIP] _load_models_cached sudah ada."
fi

# ------------------------------------------------------------
# MMENGINE / OPENMIM
# ------------------------------------------------------------

echo ""
echo "============================================================"
echo " Installing OpenMMLab stack"
echo "============================================================"

cd "$WORKER_DIR"

python -m pip install \
    --no-cache-dir \
    "mmengine==0.10.7"

python -m pip install \
    --no-cache-dir \
    -U openmim

# ------------------------------------------------------------
# MMCV
# ------------------------------------------------------------

echo ""
echo "============================================================"
echo " BUILDING MMCV 2.1.0"
echo "============================================================"

python -m pip uninstall -y \
    mmcv \
    mmcv-full \
    2>/dev/null || true

export MIM_BUILD_TORCH_VERSION=2.1.0

# Ensure build uses CUDA 11.8
export CUDA_HOME=/usr/local/cuda-11.8

echo ""
echo "Torch sebelum MMCV:"
python -c "import torch; print(torch.__version__); print(torch.version.cuda)"

echo ""
echo "CUDA_HOME=$CUDA_HOME"
echo "TORCH_CUDA_TAG=$TORCH_CUDA_TAG"

echo ""
echo "Mulai build MMCV 2.1.0..."
echo "Ini bagian yang paling lama."

mim install "mmcv==2.1.0"

# ------------------------------------------------------------
# MMDET / MMPOSE
# ------------------------------------------------------------

echo ""
echo "Installing MMDetection..."

mim install "mmdet>=3.1.0"

echo ""
echo "Installing MMPose..."

mim install "mmpose>=1.1.0"

# ------------------------------------------------------------
# RESTORE TORCH ONE FINAL TIME
# ------------------------------------------------------------

echo ""
echo "============================================================"
echo " FINAL TORCH RESTORE"
echo "============================================================"

python -m pip install \
    --no-cache-dir \
    --no-deps \
    "torch==2.1.0+cu118" \
    "torchvision==0.16.0+cu118" \
    "torchaudio==2.1.0+cu118" \
    --index-url https://download.pytorch.org/whl/cu118

python -m pip install \
    --no-cache-dir \
    --no-deps \
    "numpy==1.26.4"

# ------------------------------------------------------------
# DOWNLOAD MODELS
# ------------------------------------------------------------

echo ""
echo "============================================================"
echo " Downloading MuseTalk models"
echo "============================================================"

cd "$WORKER_DIR/MuseTalk"

mkdir -p \
    models/musetalkV15 \
    models/sd-vae-ft-mse \
    models/whisper \
    models/dwpose \
    models/face-parse-bisent

# MuseTalk
if [ ! -f models/musetalkV15/musetalk.json ]; then

    echo "Downloading MuseTalk v1.5..."

    python - <<'PY'
import os
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="TMElyralab/MuseTalk",
    local_dir="models",
    allow_patterns=["musetalkV15/*"],
    token=os.environ["HF_TOKEN"],
)
PY

else
    echo "MuseTalk model sudah ada."
fi

# DWPose
if [ ! -f models/dwpose/dw-ll_ucoco_384.pth ]; then

    echo "Downloading DWPose..."

    python - <<'PY'
import os
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="yzd-v/DWPose",
    local_dir="models/dwpose",
    token=os.environ["HF_TOKEN"],
)
PY

else
    echo "DWPose sudah ada."
fi

# Whisper
if [ ! -f models/whisper/config.json ]; then

    echo "Downloading Whisper Tiny..."

    python - <<'PY'
import os
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="openai/whisper-tiny",
    local_dir="models/whisper",
    token=os.environ["HF_TOKEN"],
)
PY

else
    echo "Whisper sudah ada."
fi

# VAE
if [ ! -f models/sd-vae-ft-mse/config.json ]; then

    echo "Downloading SD VAE..."

    python - <<'PY'
import os
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="stabilityai/sd-vae-ft-mse",
    local_dir="models/sd-vae-ft-mse",
    token=os.environ["HF_TOKEN"],
)
PY

else
    echo "SD VAE sudah ada."
fi

# Face Parse
if [ ! -f models/face-parse-bisent/79999_iter.pth ]; then

    echo "Downloading face-parse-bisent..."

    python - <<'PY'
import os
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="ManyOtherFunctions/face-parse-bisent",
    local_dir="models/face-parse-bisent",
    token=os.environ["HF_TOKEN"],
)
PY

else
    echo "Face parse model sudah ada."
fi

# ------------------------------------------------------------
# SYMLINK
# ------------------------------------------------------------

echo ""
echo "Menyiapkan symlink..."

cd "$WORKER_DIR"

ln -sfn \
    "$WORKER_DIR/MuseTalk/musetalk" \
    "$WORKER_DIR/musetalk"

ln -sfn \
    "$WORKER_DIR/MuseTalk/models" \
    "$WORKER_DIR/models"

# ------------------------------------------------------------
# FINAL VERIFICATION
# ------------------------------------------------------------

echo ""
echo "============================================================"
echo " FINAL VERIFICATION"
echo "============================================================"

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

missing = []

for rel in required:
    path = os.path.join(base, rel)
    if not os.path.exists(path):
        missing.append(rel)

if missing:
    print("[ERROR] Model/file belum lengkap:")
    for x in missing:
        print(" -", x)
    sys.exit(1)

import torch
import torchvision
import torchaudio
import numpy
import huggingface_hub

print("")
print("Python       :", sys.version.split()[0])
print("Torch        :", torch.__version__)
print("Torch CUDA   :", torch.version.cuda)
print("Torchvision  :", torchvision.__version__)
print("Torchaudio   :", torchaudio.__version__)
print("NumPy        :", numpy.__version__)
print("HF Hub       :", huggingface_hub.__version__)
print("CUDA available:", torch.cuda.is_available())

if not torch.__version__.startswith("2.1."):
    raise SystemExit("[ERROR] Torch harus 2.1.x")

if torch.version.cuda != "11.8":
    raise SystemExit("[ERROR] Torch CUDA harus 11.8")

if not torchvision.__version__.startswith("0.16."):
    raise SystemExit("[ERROR] Torchvision harus 0.16.x")

if not torchaudio.__version__.startswith("2.1."):
    raise SystemExit("[ERROR] Torchaudio harus 2.1.x")

if numpy.__version__ != "1.26.4":
    raise SystemExit("[ERROR] NumPy harus 1.26.4")

if not torch.cuda.is_available():
    raise SystemExit("[ERROR] PyTorch tidak melihat GPU")

print("GPU          :", torch.cuda.get_device_name(0))

# Test CUDA tensor
x = torch.randn(2, 3, device="cuda")
print("CUDA tensor  :", x.device)
print("CUDA test    : OK")

# MMCV
import mmcv
print("MMCV         :", mmcv.__version__)

# MMEngine
import mmengine
print("MMEngine     :", mmengine.__version__)

# MMPose
try:
    import mmpose
    print("MMPose       :", mmpose.__version__)
except Exception as e:
    print("[WARNING] MMPose import:", e)

# Test _load_models_cached import
sys.path.insert(0, "/workspace/ai_live_worker/MuseTalk")
from scripts.inference import _load_models_cached
print("_load_models_cached: OK")

print("")
print("ALL CORE VERIFICATION PASSED")
PY

# ------------------------------------------------------------
# SAVE COMPLETE FLAG
# ------------------------------------------------------------

date -Iseconds > "$WORKER_DIR/.setup_complete"

echo ""
echo "============================================================"
echo " SETUP SELESAI"
echo "============================================================"
echo ""
echo "Worker directory:"
echo "  $WORKER_DIR"
echo ""
echo "PyTorch:"
python -c "import torch; print(torch.__version__, torch.version.cuda)"

echo ""
echo "GPU:"
python -c "import torch; print(torch.cuda.get_device_name(0))"

echo ""
echo "MMCV:"
python -c "import mmcv; print(mmcv.__version__)"

echo ""
echo "Model files:"
find "$WORKER_DIR/MuseTalk/models" -type f | wc -l

echo ""
echo "============================================================"
echo " PENTING"
echo "============================================================"
echo ""
echo "Setup TIDAK menjalankan api_server.py."
echo ""
echo "Setelah setup sukses, jalankan:"
echo ""
echo "  cd /workspace/ai_live_worker"
echo "  bash start.sh"
echo ""
echo "Health check:"
echo ""
echo "  curl http://localhost:8000/"
echo ""
echo "============================================================"
