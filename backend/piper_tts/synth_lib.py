"""Piper synthesize helpers — dipakai worker stdin (tanpa HTTP)."""

from __future__ import annotations

import io
import os
import sys
import wave
from pathlib import Path
from typing import Any, Optional

PIPER_DIR = Path(os.environ.get("PIPER_DIR", "")).resolve()
MODELS_DIR = Path(
    os.environ.get("PIPER_MODELS_DIR") or str(PIPER_DIR / "models")
).resolve()
DEFAULT_VOICE = os.environ.get("PIPER_VOICE", "id_ID-news_tts-medium").strip()
DEFAULT_HOST = os.environ.get("PIPER_DEFAULT_HOST", "namira").strip().lower() or "namira"

HOST_VOICE_MAP = {
    "namira": DEFAULT_VOICE,
    "default": DEFAULT_VOICE,
}

_voice_cache: dict[str, Any] = {}


def _norm_host(raw: Optional[str]) -> str:
    name = (raw or "").strip().lower()
    name = name.replace(".png", "").replace(".jpg", "").replace(".jpeg", "")
    name = name.replace(".mp4", "").replace(".onnx", "")
    if "/" in name:
        name = name.split("/")[-1]
    if name.startswith("id-id-") or name.startswith("id_id_"):
        return DEFAULT_HOST
    return name or DEFAULT_HOST


def resolve_model_path(host_or_voice: str) -> Path:
    key = _norm_host(host_or_voice)
    host_onnx = MODELS_DIR / f"{key}.onnx"
    if host_onnx.is_file():
        return host_onnx
    mapped = HOST_VOICE_MAP.get(key, DEFAULT_VOICE)
    mapped_path = MODELS_DIR / f"{mapped}.onnx"
    if mapped_path.is_file():
        return mapped_path
    literal = MODELS_DIR / f"{key}.onnx"
    if literal.is_file():
        return literal
    matches = sorted(MODELS_DIR.glob("id_ID*.onnx"))
    if matches:
        return matches[0]
    raise FileNotFoundError(
        f"Model Piper tidak ditemukan untuk host/voice={key!r} di {MODELS_DIR}."
    )


def load_voice(host_or_voice: str):
    path = resolve_model_path(host_or_voice)
    cache_key = str(path)
    if cache_key in _voice_cache:
        return _voice_cache[cache_key], path
    from piper import PiperVoice

    try:
        v = PiperVoice.load(str(path), use_cuda=False)
    except TypeError:
        v = PiperVoice.load(str(path))
    _voice_cache[cache_key] = v
    print(f"[Piper] Loaded {path.name}", file=sys.stderr, flush=True)
    return v, path


def synthesize_wav_bytes(
    text: str,
    host_or_voice: str,
    length_scale: Optional[float] = None,
    noise_scale: Optional[float] = None,
    noise_w: Optional[float] = None,
) -> bytes:
    voice, _path = load_voice(host_or_voice)
    syn_kwargs: dict[str, Any] = {}
    try:
        from piper import SynthesisConfig

        cfg_kw: dict[str, Any] = {}
        if length_scale is not None:
            cfg_kw["length_scale"] = float(length_scale)
        if noise_scale is not None:
            cfg_kw["noise_scale"] = float(noise_scale)
        if noise_w is not None:
            cfg_kw["noise_w"] = float(noise_w)
        if cfg_kw:
            syn_kwargs["syn_config"] = SynthesisConfig(**cfg_kw)
    except Exception:
        pass

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        if hasattr(voice, "synthesize_wav"):
            try:
                voice.synthesize_wav(text, wav_file, **syn_kwargs)
            except TypeError:
                voice.synthesize_wav(text, wav_file)
        else:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            rate = int(getattr(getattr(voice, "config", None), "sample_rate", 22050) or 22050)
            wav_file.setframerate(rate)
            for chunk in voice.synthesize(text):
                audio = getattr(chunk, "audio_int16_bytes", None) or getattr(
                    chunk, "audio_bytes", None
                )
                if audio:
                    wav_file.writeframes(audio)
    return buf.getvalue()


def resample_wav_pcm16_mono(wav_bytes: bytes, target_rate: int) -> bytes:
    import audioop

    with wave.open(io.BytesIO(wav_bytes), "rb") as r:
        channels = r.getnchannels()
        sampwidth = r.getsampwidth()
        rate = r.getframerate()
        frames = r.readframes(r.getnframes())
    if channels > 1:
        frames = audioop.tomono(frames, sampwidth, 0.5, 0.5)
    if sampwidth != 2:
        frames = audioop.lin2lin(frames, sampwidth, 2)
        sampwidth = 2
    if rate != target_rate:
        frames, _ = audioop.ratecv(frames, sampwidth, 1, rate, target_rate, None)
        rate = target_rate
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames)
    return out.getvalue()


def synthesize(
    text: str,
    host: str = "",
    length_scale: Optional[float] = None,
    sample_rate: int = 16000,
) -> bytes:
    wav = synthesize_wav_bytes(text, host or DEFAULT_HOST, length_scale)
    if sample_rate and sample_rate > 0:
        wav = resample_wav_pcm16_mono(wav, int(sample_rate))
    return wav
