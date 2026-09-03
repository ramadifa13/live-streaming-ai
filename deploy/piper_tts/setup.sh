#!/bin/bash
# Setup Piper TTS — venv TERPISAH di /workspace/piper_tts (bukan ai_live_worker/env).
# Dipanggil otomatis dari deploy/setup.sh SETELAH MuseTalk lolos verifikasi.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIPER_DIR="${PIPER_DIR:-/workspace/piper_tts}"
VENV_DIR="$PIPER_DIR/env"
MODELS_DIR="$PIPER_DIR/models"
VOICE_ID="${PIPER_VOICE:-id_ID-news_tts-medium}"
DEFAULT_HOST="${PIPER_DEFAULT_HOST:-namira}"
HF_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium"
MUSETALK_PY="${MUSETALK_PY:-/workspace/ai_live_worker/env/bin/python}"

echo "============================================================"
echo " Piper TTS setup (CPU, isolated venv)"
echo " Dir: $PIPER_DIR"
echo "============================================================"

if [ -n "${VIRTUAL_ENV:-}" ] && [ "$VIRTUAL_ENV" = "/workspace/ai_live_worker/env" ]; then
	echo "[WARN] VIRTUAL_ENV mengarah ke MuseTalk — diabaikan; Piper pakai venv sendiri."
fi

if [ "${FORCE_PIPER:-0}" != "1" ] && [ -f "$PIPER_DIR/.setup_complete" ] && [ -x "$VENV_DIR/bin/python" ]; then
	ONNX_CHECK="$MODELS_DIR/${VOICE_ID}.onnx"
	if [ -f "$ONNX_CHECK" ]; then
		echo "[OK] Piper sudah pernah di-setup ($PIPER_DIR/.setup_complete)."
		echo "     Ulangi paksa: FORCE_PIPER=1 bash $SCRIPT_DIR/setup.sh"
		cp -f "$SCRIPT_DIR/server.py" "$PIPER_DIR/server.py"
		cp -f "$SCRIPT_DIR/start.sh" "$PIPER_DIR/start.sh" 2>/dev/null || true
		chmod +x "$PIPER_DIR/start.sh" 2>/dev/null || true
		exit 0
	fi
fi

mkdir -p "$PIPER_DIR" "$MODELS_DIR" "$PIPER_DIR/logs"
cp -f "$SCRIPT_DIR/server.py" "$PIPER_DIR/server.py"
cp -f "$SCRIPT_DIR/requirements.txt" "$PIPER_DIR/requirements.txt"
cp -f "$SCRIPT_DIR/start.sh" "$PIPER_DIR/start.sh" 2>/dev/null || true
chmod +x "$PIPER_DIR/start.sh" 2>/dev/null || true

if [ ! -x "$VENV_DIR/bin/python" ]; then
	echo "[*] Membuat venv Piper (terpisah dari MuseTalk)..."
	python3 -m venv "$VENV_DIR"
fi

PIPER_REAL="$(readlink -f "$VENV_DIR" 2>/dev/null || echo "$VENV_DIR")"
MT_REAL="$(readlink -f /workspace/ai_live_worker/env 2>/dev/null || echo /workspace/ai_live_worker/env)"
if [ "$PIPER_REAL" = "$MT_REAL" ]; then
	echo "[ERROR] Piper venv sama dengan MuseTalk — abort."
	exit 1
fi

echo "[*] Install deps Piper (onnxruntime CPU — tanpa torch)..."
"$VENV_DIR/bin/pip" install --upgrade pip wheel
"$VENV_DIR/bin/pip" install --no-cache-dir -r "$PIPER_DIR/requirements.txt"

if "$VENV_DIR/bin/python" -c "import torch" 2>/dev/null; then
	echo "[WARN] torch terdeteksi di venv Piper — menghapus..."
	"$VENV_DIR/bin/pip" uninstall -y torch torchvision torchaudio 2>/dev/null || true
fi

ONNX="$MODELS_DIR/${VOICE_ID}.onnx"
JSON="$MODELS_DIR/${VOICE_ID}.onnx.json"
if [ ! -f "$ONNX" ] || [ ! -f "$JSON" ]; then
	echo "[*] Download voice ID: $VOICE_ID ..."
	if command -v curl >/dev/null 2>&1; then
		curl -fL "${HF_BASE}/${VOICE_ID}.onnx" -o "$ONNX"
		curl -fL "${HF_BASE}/${VOICE_ID}.onnx.json" -o "$JSON"
	else
		wget -q -O "$ONNX" "${HF_BASE}/${VOICE_ID}.onnx"
		wget -q -O "$JSON" "${HF_BASE}/${VOICE_ID}.onnx.json"
	fi
else
	echo "[OK] Model sudah ada: $ONNX"
fi

HOST_ONNX="$MODELS_DIR/${DEFAULT_HOST}.onnx"
HOST_JSON="$MODELS_DIR/${DEFAULT_HOST}.onnx.json"
if [ ! -e "$HOST_ONNX" ]; then
	ln -sfn "$(basename "$ONNX")" "$HOST_ONNX" 2>/dev/null || cp -f "$ONNX" "$HOST_ONNX"
fi
if [ ! -e "$HOST_JSON" ]; then
	ln -sfn "$(basename "$JSON")" "$HOST_JSON" 2>/dev/null || cp -f "$JSON" "$HOST_JSON"
fi
echo "[OK] Host alias: $DEFAULT_HOST → $VOICE_ID"

export PIPER_MODELS_DIR="$MODELS_DIR"
"$VENV_DIR/bin/python" - <<PY
from pathlib import Path
import os
models = Path(os.environ["PIPER_MODELS_DIR"])
onnx = sorted(models.glob("*.onnx"))
assert onnx, f"Tidak ada model di {models}"
from piper import PiperVoice
path = models / "${DEFAULT_HOST}.onnx"
if not path.is_file():
    path = onnx[0]
try:
    PiperVoice.load(str(path), use_cuda=False)
except TypeError:
    PiperVoice.load(str(path))
print("[OK] Piper load:", path.name)
PY

if [ -x "$MUSETALK_PY" ]; then
	if "$MUSETALK_PY" -c "import piper" 2>/dev/null; then
		echo "[WARN] Modul piper terlihat dari MuseTalk python — cek isolasi venv."
	else
		echo "[OK] MuseTalk python tidak melihat paket piper."
	fi
fi

date -Iseconds > "$PIPER_DIR/.setup_complete"
echo ""
echo "Setup Piper selesai."
echo "  Start: bash $PIPER_DIR/start.sh"
echo "  Health: curl -s http://127.0.0.1:${PIPER_PORT:-8090}/health"
echo "  MuseTalk env TIDAK diubah."
echo "============================================================"
