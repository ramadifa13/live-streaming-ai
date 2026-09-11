from __future__ import annotations

import base64
import json
import os
import sys
from io import BytesIO
from pathlib import Path

import numpy as np
import soundfile as sf
from pocket_tts import TTSModel

from audio_post import audio_debug_metrics, postprocess_generated, prepare_prompt_audio

CONFIG = os.environ.get(
    "POCKET_TTS_CONFIG",
    "hf://anak10thn/pocket-tts-indonesian/indonesian_6l.yaml@635cde7a28301861b120f57ec4dda8525073017c",
)
VOICE_ROOT = Path(os.environ.get("POCKET_TTS_VOICE_DIR", "voices")).resolve()
OUTPUT_SAMPLE_RATE = int(os.environ.get("POCKET_TTS_OUTPUT_RATE", "24000"))
DEBUG_TAP_DIR = os.environ.get("TTS_DEBUG_TAP_DIR", "").strip()

model = TTSModel.load_model(config=CONFIG)
prompt_cache: dict[str, tuple[int, object]] = {}


def _read_wav(path: Path):
    samples, rate = sf.read(path, dtype="float32", always_2d=True)
    return samples, rate


def load_prompt(voice_id: str):
    voice_path = (VOICE_ROOT / voice_id / "reference.wav").resolve()
    if VOICE_ROOT not in voice_path.parents:
        raise ValueError("voice_id tidak valid")
    if not voice_path.is_file():
        raise FileNotFoundError(f"Reference voice tidak ditemukan: {voice_id}")
    stamp = voice_path.stat().st_mtime_ns
    cached = prompt_cache.get(voice_id)
    if cached and cached[0] == stamp:
        return cached[1]
    prompt = model.get_state_for_audio_prompt(prepare_prompt_audio(voice_path, _read_wav))
    prompt_cache[voice_id] = (stamp, prompt)
    return prompt


def generate(request: dict) -> dict:
    voice_id = str(request.get("voice_id") or "girl_cute_kids")
    text = str(request.get("text") or "").strip()
    if not text:
        raise ValueError("text kosong")
    state = load_prompt(voice_id)
    audio = model.generate_audio(state, text)
    if hasattr(audio, "detach"):
        audio = audio.detach().cpu().numpy()
    source_sample_rate = int(getattr(model, "sample_rate", OUTPUT_SAMPLE_RATE) or OUTPUT_SAMPLE_RATE)
    samples, out_rate = postprocess_generated(audio, source_sample_rate, OUTPUT_SAMPLE_RATE)
    metrics = audio_debug_metrics(samples, out_rate)
    if DEBUG_TAP_DIR:
        os.makedirs(DEBUG_TAP_DIR, exist_ok=True)
        tap = Path(DEBUG_TAP_DIR) / f"tts_{request.get('id') or 'anon'}.wav"
        sf.write(str(tap), samples, out_rate, subtype="PCM_16")
        print(f"[PocketTTS] metrics {metrics}", file=sys.stderr)
    output = BytesIO()
    sf.write(output, samples, out_rate, format="WAV", subtype="PCM_16")
    return {
        "audio": base64.b64encode(output.getvalue()).decode("ascii"),
        "sample_rate": out_rate,
        "metrics": metrics,
    }


print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    request_id = None
    try:
        request = json.loads(line)
        request_id = request.get("id")
        response = {"id": request_id, **generate(request)}
    except Exception as exc:
        response = {"id": request_id, "error": str(exc)}
    print(json.dumps(response), flush=True)
