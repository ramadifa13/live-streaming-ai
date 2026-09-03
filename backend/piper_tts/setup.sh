#!/bin/bash
# Setup Piper CPU di mesin backend (Linux/VPS). Tidak untuk AI worker GPU.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PIPER_DIR="${PIPER_DIR:-$BACKEND_DIR/piper_data}"
VENV_DIR="$PIPER_DIR/env"
MODELS_DIR="$PIPER_DIR/models"
VOICE_ID="${PIPER_VOICE:-id_ID-news_tts-medium}"
DEFAULT_HOST="${PIPER_DEFAULT_HOST:-namira}"
HF_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium"
REQ="$SCRIPT_DIR/requirements.txt"

echo "============================================================"
echo " Piper TTS setup (CPU, backend)"
echo " Dir: $PIPER_DIR"
echo "============================================================"

mkdir -p "$PIPER_DIR" "$MODELS_DIR" "$PIPER_DIR/logs"
cp -f "$REQ" "$PIPER_DIR/requirements.txt"

if [ ! -x "$VENV_DIR/bin/python" ]; then
	python3 -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/pip" install --upgrade pip wheel
"$VENV_DIR/bin/pip" install --no-cache-dir -r "$PIPER_DIR/requirements.txt"

ONNX="$MODELS_DIR/${VOICE_ID}.onnx"
JSON="$MODELS_DIR/${VOICE_ID}.onnx.json"
if [ ! -f "$ONNX" ] || [ ! -f "$JSON" ]; then
	echo "[*] Download voice $VOICE_ID ..."
	curl -fL "${HF_BASE}/${VOICE_ID}.onnx" -o "$ONNX"
	curl -fL "${HF_BASE}/${VOICE_ID}.onnx.json" -o "$JSON"
fi

HOST_ONNX="$MODELS_DIR/${DEFAULT_HOST}.onnx"
HOST_JSON="$MODELS_DIR/${DEFAULT_HOST}.onnx.json"
if [ ! -e "$HOST_ONNX" ]; then
	ln -sfn "$(basename "$ONNX")" "$HOST_ONNX" 2>/dev/null || cp -f "$ONNX" "$HOST_ONNX"
fi
if [ ! -e "$HOST_JSON" ]; then
	ln -sfn "$(basename "$JSON")" "$HOST_JSON" 2>/dev/null || cp -f "$JSON" "$HOST_JSON"
fi

export PIPER_MODELS_DIR="$MODELS_DIR"
"$VENV_DIR/bin/python" - <<PY
from pathlib import Path
import os
from piper import PiperVoice
models = Path(os.environ["PIPER_MODELS_DIR"])
path = models / "${DEFAULT_HOST}.onnx"
if not path.is_file():
    path = sorted(models.glob("*.onnx"))[0]
try:
    PiperVoice.load(str(path), use_cuda=False)
except TypeError:
    PiperVoice.load(str(path))
print("[OK] Piper load:", path.name)
PY

date -Iseconds > "$PIPER_DIR/.setup_complete"
echo "[OK] Setup selesai. Backend mem-spawn Piper (tanpa port)."
echo "     Custom: $MODELS_DIR/${DEFAULT_HOST}.onnx"
echo "============================================================"
