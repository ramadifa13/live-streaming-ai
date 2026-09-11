from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from scipy.signal import butter, resample_poly, sosfiltfilt
from pocket_tts import TTSModel

CONFIG = os.environ.get(
    "POCKET_TTS_CONFIG",
    "hf://anak10thn/pocket-tts-indonesian/indonesian_6l.yaml@635cde7a28301861b120f57ec4dda8525073017c",
)
VOICE_ROOT = Path(os.environ.get("POCKET_TTS_VOICE_DIR", "voices")).resolve()
OUTPUT_SAMPLE_RATE = int(os.environ.get("POCKET_TTS_OUTPUT_RATE", "24000"))
PROMPT_SAMPLE_RATE = 24000
MAX_PROMPT_SECONDS = 12
# Aggressive band-pass ringing caused sudden buzz; keep native 24 kHz.
AUDIO_FILTER_ENABLED = os.environ.get("POCKET_TTS_AUDIO_FILTER", "0") != "0"
ONSET_FADE_MS = 20
TRAIL_FADE_MS = 280
TRAIL_PAD_MS = 40
TRAIL_MAX_TRIM_SEC = 0.9
TRAIL_RMS_FLOOR = 0.018


def smooth_onset(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    fade_samples = min(samples.size, max(1, int(sample_rate * ONSET_FADE_MS / 1000)))
    if fade_samples <= 1:
        return samples
    fade = np.sin(np.linspace(0, np.pi / 2, fade_samples, dtype=np.float32)) ** 2
    samples[:fade_samples] *= fade
    return samples


def trim_trailing_buzz(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    """Drop vocoder tail drone, then fade out. Never trim more than TRAIL_MAX_TRIM_SEC."""
    if samples.size < max(8, sample_rate // 4):
        return samples
    win = max(1, int(sample_rate * 0.01))
    env = np.convolve(np.abs(samples), np.ones(win, dtype=np.float32) / win, mode="same")
    peak = float(np.max(env)) if env.size else 0.0
    floor = max(TRAIL_RMS_FLOOR, peak * 0.04)
    active = np.flatnonzero(env > floor)
    if active.size == 0:
        return samples
    pad = int(sample_rate * TRAIL_PAD_MS / 1000)
    end = min(samples.size, int(active[-1]) + pad)
    min_end = max(1, samples.size - int(sample_rate * TRAIL_MAX_TRIM_SEC))
    end = max(end, min_end)
    out = np.array(samples[:end], dtype=np.float32, copy=True)
    fade = min(out.size, max(1, int(sample_rate * TRAIL_FADE_MS / 1000)))
    if fade > 1:
        ramp = np.sin(np.linspace(np.pi / 2, 0, fade, dtype=np.float32)) ** 2
        out[-fade:] *= ramp
    return out

model = TTSModel.load_model(config=CONFIG)
prompt_cache: dict[str, tuple[int, object]] = {}


def smooth_onset(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    fade_samples = min(samples.size, max(1, int(sample_rate * ONSET_FADE_MS / 1000)))
    if fade_samples <= 1:
        return samples
    fade = np.sin(np.linspace(0, np.pi / 2, fade_samples, dtype=np.float32)) ** 2
    samples[:fade_samples] *= fade
    return samples


def prepare_prompt_audio(reference_path: Path) -> torch.Tensor:
    samples, source_rate = sf.read(reference_path, dtype="float32", always_2d=True)
    samples = np.mean(samples, axis=1)
    samples = np.nan_to_num(samples, nan=0.0, posinf=0.0, neginf=0.0)
    samples -= np.mean(samples)

    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak <= 1e-5:
        raise ValueError("Reference voice kosong atau terlalu pelan")

    window = max(1, int(source_rate * 0.02))
    envelope = np.convolve(np.abs(samples), np.ones(window) / window, mode="same")
    active = np.flatnonzero(envelope > max(0.008, peak * 0.06))
    if active.size:
        pad = int(source_rate * 0.12)
        samples = samples[max(0, int(active[0]) - pad):min(samples.size, int(active[-1]) + pad)]

    samples = samples[:int(source_rate * MAX_PROMPT_SECONDS)]
    if source_rate != PROMPT_SAMPLE_RATE:
        samples = resample_poly(samples, PROMPT_SAMPLE_RATE, source_rate).astype(np.float32)
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak <= 1e-5:
        raise ValueError("Reference voice tidak memiliki sinyal suara")
    samples = (samples * min(0.95 / peak, 1.0)).astype(np.float32)
    return torch.from_numpy(samples).unsqueeze(0)


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
    prompt = model.get_state_for_audio_prompt(prepare_prompt_audio(voice_path))
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
    samples = np.asarray(audio, dtype=np.float32)
    if samples.ndim > 1:
        samples = samples.reshape(-1)
    source_sample_rate = int(getattr(model, "sample_rate", OUTPUT_SAMPLE_RATE) or OUTPUT_SAMPLE_RATE)
    if AUDIO_FILTER_ENABLED and samples.size >= source_sample_rate // 4:
        high_pass = butter(2, 35, btype="highpass", fs=source_sample_rate, output="sos")
        samples = sosfiltfilt(high_pass, samples).astype(np.float32)
    out_rate = int(OUTPUT_SAMPLE_RATE)
    if source_sample_rate != out_rate:
        samples = resample_poly(samples, out_rate, source_sample_rate).astype(np.float32)
    else:
        out_rate = source_sample_rate
    samples = smooth_onset(samples, out_rate)
    samples = trim_trailing_buzz(samples, out_rate)
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak > 0.98:
        samples = (samples * (0.98 / peak)).astype(np.float32)
    output = __import__("io").BytesIO()
    sf.write(output, samples, out_rate, format="WAV", subtype="PCM_16")
    return {
        "audio": base64.b64encode(output.getvalue()).decode("ascii"),
        "sample_rate": out_rate,
    }


print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    try:
        request = json.loads(line)
        response = {"id": request.get("id"), **generate(request)}
    except Exception as exc:
        response = {"id": request.get("id") if "request" in locals() else None, "error": str(exc)}
    print(json.dumps(response), flush=True)
