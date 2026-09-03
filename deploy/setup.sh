#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="/workspace/ai_live_worker"
VENV_DIR="$WORKER_DIR/env"
PYTHON_BIN="$VENV_DIR/bin/python"
PIP_BIN="$VENV_DIR/bin/pip"

export TMPDIR="/workspace/tmp"
export PIP_CACHE_DIR="/workspace/tmp/pip_cache"
echo "[*] Membersihkan cache temporary lama..."
rm -rf /workspace/tmp/* /workspace/tmp/.* /root/.cache/pip /root/.cache/huggingface 2>/dev/null || true
mkdir -p "$TMPDIR" "$PIP_CACHE_DIR" "$WORKER_DIR"

export TORCH_CUDA_TAG=cu118
export CUDA_HOME="${CUDA_HOME:-/usr/local/cuda-11.8}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"
export PIP_NO_CACHE_DIR=1

if [ -f "$WORKER_DIR/.setup_complete" ] && [ -d "$WORKER_DIR/env" ] && [ -d "$WORKER_DIR/models" ]; then
    echo "[INFO] MuseTalk sudah complete — lewati install MuseTalk."
    # Tetap pastikan Piper ada (venv terpisah).
    PIPER_SETUP="$SCRIPT_DIR/piper_tts/setup.sh"
    if [ "${SKIP_PIPER_SETUP:-0}" = "1" ]; then
        echo "[INFO] SKIP_PIPER_SETUP=1 — selesai."
        exit 0
    fi
    if [ -f "$PIPER_SETUP" ]; then
        echo "[INFO] Melanjutkan setup Piper TTS saja..."
        bash "$PIPER_SETUP"
        echo ""
        echo "Start: cd /workspace/ai_live_worker && bash start.sh"
    else
        echo "[WARN] piper_tts/setup.sh tidak ditemukan."
    fi
    exit 0
fi

echo ""
echo "============================================================"
echo " MuseTalk RunPod RTX 4090/3090 - SAFE SETUP"
echo "============================================================"
echo ""

echo "[0/10] Mengecek environment sistem..."

python3 --version
which python3

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

PY_MAJOR_MINOR="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"

if [ "$PY_MAJOR_MINOR" != "3.10" ]; then
    echo "[ERROR] Python 3.10 dibutuhkan."
    echo "Current: $PY_MAJOR_MINOR"
    exit 1
fi

echo "[OK] Python 3.10"

echo ""
echo "[1/10] Menyiapkan Ollama (${OLLAMA_MODEL})..."

# Ollama di RunPod bersifat opsional. LLM diproses terpusat di backend lokal,
# sehingga instalasi binary Ollama di RunPod dilewati secara default untuk
# menghemat waktu setup & disk.
if [ "${ENABLE_RUNPOD_OLLAMA:-0}" = "1" ]; then
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

    echo "[OK] Ollama tersedia."
else
    echo "[SKIP] Ollama dijalankan di backend lokal (ENABLE_RUNPOD_OLLAMA != 1)."
    echo "[OK] Melewati instalasi Ollama di RunPod."
fi

NVCC_VERSION="$(nvcc --version | sed -n 's/.*release \([0-9]*\.[0-9]*\).*/\1/p' | tail -1)"

if [ "$NVCC_VERSION" != "11.8" ]; then
    echo "[ERROR] Script ini ditujukan untuk CUDA toolkit 11.8."
    echo "Detected nvcc: $NVCC_VERSION"
    exit 1
fi

echo "[OK] CUDA toolkit 11.8"

echo ""
echo "[2/10] Mengecek Hugging Face token..."

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
# 3. DISK & VIRTUAL ENVIRONMENT
# ------------------------------------------------------------

echo ""
echo "[3/10] Mengecek disk & menginisialisasi Virtual Environment..."

ROOT_AVAIL_GB="$(df -Pk / | awk 'NR==2 {print int($4/1024/1024)}')"
WORKSPACE_AVAIL_GB="$(df -Pk /workspace 2>/dev/null | awk 'NR==2 {print int($4/1024/1024)}' || echo '0')"

echo "Root free: ${ROOT_AVAIL_GB} GB | Workspace free: ${WORKSPACE_AVAIL_GB} GB"

# Prioritaskan cek ruang di /workspace jika terpasang Network Volume
if [ "$WORKSPACE_AVAIL_GB" -gt 0 ]; then
    if [ "$WORKSPACE_AVAIL_GB" -lt 5 ]; then
        echo "[ERROR] Workspace disk (/workspace) kurang dari 5 GB."
        exit 1
    fi
    echo "[OK] Ruang penyimpanan Network Volume (/workspace) mencukupi: ${WORKSPACE_AVAIL_GB} GB."
fi

mkdir -p \
    "$WORKER_DIR/assets/2d" \
    "$WORKER_DIR/assets/3d" \
    "$WORKER_DIR/temp" \
    "$WORKER_DIR/output"

# Inisialisasi Virtual Environment mandiri di /workspace
if [ ! -f "$PYTHON_BIN" ] || [ ! -f "$PIP_BIN" ]; then
    echo "Membuat Python Virtual Environment baru di $VENV_DIR..."
    rm -rf "$VENV_DIR"
    python3 -m venv "$VENV_DIR"
fi

export PATH="$VENV_DIR/bin:$PATH"
source "$VENV_DIR/bin/activate"

# Update tools di dalam venv
"$PYTHON_BIN" -m ensurepip --upgrade 2>/dev/null || true
# openmim still imports pkg_resources; setuptools 82+ dropped it.
"$PYTHON_BIN" -m pip install --no-cache-dir --upgrade pip "setuptools<81" wheel

echo "[OK] Virtual Environment siap: $($PYTHON_BIN --version) at $VENV_DIR"

# ------------------------------------------------------------
# 4. STOP OLD API
# ------------------------------------------------------------

echo ""
echo "[4/10] Menghentikan API lama jika ada..."

pkill -f "api_server.py" 2>/dev/null || true
sleep 2

echo "[OK] API lama dihentikan."

# ------------------------------------------------------------
# 5. INSTALL EXACT PYTORCH STACK & RUNTIME DEPENDENCIES
# ------------------------------------------------------------

echo ""
echo "[5/10] Menginstall PyTorch 2.1 + CUDA 11.8 ke Virtual Environment..."

# Install dependensi dasar PyTorch & Torchvision secara lengkap
"$PIP_BIN" install \
    --no-cache-dir \
    "typing_extensions>=4.8.0" \
    "mpmath>=1.3.0" \
    "sympy>=1.12" \
    "networkx>=3.0" \
    "jinja2" \
    "MarkupSafe" \
    "filelock" \
    "fsspec" \
    "pillow>=9.0,<11.0" \
    "requests" \
    "numpy==1.26.4"

"$PIP_BIN" install \
    --no-cache-dir \
    --no-deps \
    "torch==2.1.0+cu118" \
    "torchvision==0.16.0+cu118" \
    "torchaudio==2.1.0+cu118" \
    --index-url https://download.pytorch.org/whl/cu118

echo ""
echo "Memverifikasi PyTorch..."

"$PYTHON_BIN" - <<'PY'
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

print("")
print("PYTORCH STACK OK")
PY

# ------------------------------------------------------------
# 6. INSTALL WORKER FILES
# ------------------------------------------------------------

echo ""
echo "[6/10] Menyiapkan file worker..."

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
# 7. CORE PYTHON DEPENDENCIES & FFMPEG
# ------------------------------------------------------------

echo ""
echo "[7/10] Installing dependency utama worker..."
echo "NOTE: Jangan install MuseTalk/requirements.txt upstream (numpy/torch/transformers bentrok)."

"$PIP_BIN" install \
    --no-cache-dir \
    "numpy==1.26.4" \
    "opencv-python-headless==4.8.0.76" \
    "huggingface_hub>=0.25.0,<0.26.0" \
    "transformers==4.38.2" \
    "diffusers==0.27.2" \
    "accelerate==0.28.0"

# requirements worker
if [ -f "$WORKER_DIR/requirements-worker.txt" ]; then
    echo "Installing requirements-worker.txt..."
    "$PIP_BIN" install \
        --no-cache-dir \
        -r "$WORKER_DIR/requirements-worker.txt"
fi

# Ensure critical torch and numpy are untouched
"$PIP_BIN" install \
    --no-cache-dir \
    --no-deps \
    "numpy==1.26.4" \
    "torch==2.1.0+cu118" \
    "torchvision==0.16.0+cu118" \
    "torchaudio==2.1.0+cu118" \
    --index-url https://download.pytorch.org/whl/cu118

echo ""
echo "Mengecek FFmpeg..."

if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "FFmpeg & system libraries belum ada. Installing..."
    apt-get update -qq
    apt-get install -y -qq ffmpeg espeak-ng libgl1 libglib2.0-0
fi

ffmpeg -version | head -1

# ------------------------------------------------------------
# 8. CLONE MUSETALK + INJECT _load_models_cached
# ------------------------------------------------------------

echo ""
echo "============================================================"
echo " [8/10] Menyiapkan MuseTalk"
echo "============================================================"

cd "$WORKER_DIR"

if [ ! -d "$WORKER_DIR/MuseTalk/.git" ]; then
    git clone https://github.com/TMElyralab/MuseTalk.git
else
    echo "MuseTalk sudah ada, skip clone."
fi

cd "$WORKER_DIR/MuseTalk/scripts"

if ! grep -q "_load_models_cached" inference.py 2>/dev/null; then

    cp inference.py inference.py.original

    "$PYTHON_BIN" << 'PYINJECT'
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

new_content = content.rstrip() + "\n\n" + inject_code

with open("inference.py", "w") as f:
    f.write(new_content)

print("[OK] _load_models_cached berhasil diinject di akhir file.")
PYINJECT

else
    echo "[SKIP] _load_models_cached sudah ada."
fi

# ------------------------------------------------------------
# 9. OPENMMLAB / MMCV / MMPOSE
# ------------------------------------------------------------

echo ""
echo "============================================================"
echo " [9/10] Installing OpenMMLab Stack (MMCV, MMDetection, MMPose)"
echo "============================================================"

cd "$WORKER_DIR"

"$PIP_BIN" install \
    --no-cache-dir \
    "mmengine==0.10.7"

"$PIP_BIN" install \
    --no-cache-dir \
    -U openmim \
    "setuptools<81"

# Kunci numpy 1.26.4 agar OpenMIM tidak memakai NumPy 2.x
"$PIP_BIN" install --no-cache-dir "numpy==1.26.4"

echo "Installing mmcv==2.1.0..."
"$PYTHON_BIN" -m mim install "mmcv==2.1.0"

echo "Installing mmdet..."
"$PYTHON_BIN" -m mim install "mmdet>=3.1.0"

echo "Installing chumpy & mmpose..."
"$PIP_BIN" install --no-cache-dir --no-build-isolation "chumpy" || true
"$PYTHON_BIN" -m mim install "mmpose>=1.1.0" --no-build-isolation || "$PIP_BIN" install --no-cache-dir "mmpose>=1.1.0" --no-build-isolation

# Pastikan torch/numpy tidak ter-upgrade oleh requirements / mim
"$PIP_BIN" install \
    --no-cache-dir \
    --no-deps \
    "numpy==1.26.4" \
    "torch==2.1.0+cu118" \
    "torchvision==0.16.0+cu118" \
    "torchaudio==2.1.0+cu118" \
    --index-url https://download.pytorch.org/whl/cu118

# Pin ulang stack worker setelah mim (hindari drift dari MuseTalk upstream reqs)
if [ -f "$WORKER_DIR/requirements-worker.txt" ]; then
    echo "Re-pin requirements-worker.txt setelah OpenMMLab..."
    "$PIP_BIN" install --no-cache-dir -r "$WORKER_DIR/requirements-worker.txt"
    "$PIP_BIN" install --no-cache-dir --no-deps "numpy==1.26.4" \
        "torch==2.1.0+cu118" "torchvision==0.16.0+cu118" "torchaudio==2.1.0+cu118" \
        --index-url https://download.pytorch.org/whl/cu118
fi

# ------------------------------------------------------------
# 10. TTS note — Piper dijalankan SETELAH MuseTalk lolos verifikasi
# ------------------------------------------------------------
echo ""
echo "[INFO] Piper TTS akan di-setup otomatis di akhir (venv terpisah /workspace/piper_tts)."
echo "[INFO] MuseTalk env ($VENV_DIR) tidak akan di-install piper/onnxruntime."



# ------------------------------------------------------------
# 11. DOWNLOAD MODELS & VERIFICATION
# ------------------------------------------------------------

echo ""
echo "============================================================"
echo " [10/10] Downloading MuseTalk AI Weights & Final Verification"
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
    "$PYTHON_BIN" - <<'PY'
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
    "$PYTHON_BIN" - <<'PY'
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
    "$PYTHON_BIN" - <<'PY'
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
    "$PYTHON_BIN" - <<'PY'
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
    "$PYTHON_BIN" - <<'PY'
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

# Bersihkan total semua cache temporary
rm -rf /workspace/tmp/* /workspace/tmp/.* /root/.cache/pip /root/.cache/huggingface 2>/dev/null || true
mkdir -p "$TMPDIR" "$PIP_CACHE_DIR" "$WORKER_DIR"

# Symlinks
echo ""
echo "Menyiapkan symlink..."
cd "$WORKER_DIR"
ln -sfn "$WORKER_DIR/MuseTalk/musetalk" "$WORKER_DIR/musetalk"
ln -sfn "$WORKER_DIR/MuseTalk/models" "$WORKER_DIR/models"

# Final Verification
echo ""
echo "============================================================"
echo " FINAL VERIFICATION TEST"
echo "============================================================"

"$PYTHON_BIN" - <<'PY'
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

date -Iseconds > "$WORKER_DIR/.setup_complete"

echo ""
echo "============================================================"
echo " SETUP MUSETALK SELESAI SUKSES!"
echo "============================================================"
echo ""
echo "Worker directory:"
echo "  $WORKER_DIR"
echo ""
echo "PyTorch:"
"$PYTHON_BIN" -c "import torch; print(torch.__version__, torch.version.cuda)"
echo ""
echo "GPU:"
"$PYTHON_BIN" -c "import torch; print(torch.cuda.get_device_name(0))"
echo ""
echo "MMCV:"
"$PYTHON_BIN" -c "import mmcv; print(mmcv.__version__)"
echo ""
echo "Model files count:"
find "$WORKER_DIR/MuseTalk/models" -type f | wc -l
echo ""

# ------------------------------------------------------------
# 12. PIPER TTS — hanya setelah MuseTalk aman (venv TERPISAH)
# ------------------------------------------------------------
echo "============================================================"
echo " [TTS] Setup Piper (setelah MuseTalk OK)"
echo "============================================================"
PIPER_SETUP="$SCRIPT_DIR/piper_tts/setup.sh"
if [ "${SKIP_PIPER_SETUP:-0}" = "1" ]; then
    echo "[INFO] SKIP_PIPER_SETUP=1 — lewati Piper."
elif [ ! -f "$PIPER_SETUP" ]; then
    echo "[WARN] $PIPER_SETUP tidak ada — lewati Piper."
else
    # Pastikan MuseTalk venv masih sehat sebelum/sesudah Piper
    if ! "$PYTHON_BIN" -c "import torch; assert torch.__version__.startswith('2.1.')" 2>/dev/null; then
        echo "[ERROR] MuseTalk torch pin rusak sebelum Piper — abort TTS setup."
        exit 1
    fi
    echo "[INFO] Menjalankan Piper setup (CPU venv terpisah)..."
    if bash "$PIPER_SETUP"; then
        echo "[OK] Piper TTS siap di /workspace/piper_tts"
    else
        echo "[ERROR] Piper setup gagal. MuseTalk tetap OK (.setup_complete sudah ada)."
        echo "        Coba manual: bash $PIPER_SETUP"
        exit 1
    fi
    # Re-cek pin MuseTalk tidak berubah (Piper tidak boleh menyentuh env ini)
    if ! "$PYTHON_BIN" -c "import torch; assert torch.__version__.startswith('2.1.')" 2>/dev/null; then
        echo "[ERROR] MuseTalk torch berubah setelah Piper — ini tidak seharusnya terjadi."
        exit 1
    fi
    echo "[OK] Verifikasi: MuseTalk torch pin tetap aman setelah Piper."
fi

echo ""
echo "============================================================"
echo " SETUP LENGKAP (MuseTalk + Piper)"
echo "============================================================"
echo ""
echo "Start worker (Piper auto-start di dalamnya):"
echo "  cd /workspace/ai_live_worker && bash start.sh"
echo ""
echo "Health:"
echo "  curl -s http://127.0.0.1:8000/health"
echo "  curl -s http://127.0.0.1:8000/tts/health"
echo "  curl -s http://127.0.0.1:8090/health"
echo ""
echo "Skip Piper lain kali: SKIP_PIPER_SETUP=1 bash setup.sh"
echo "============================================================"
