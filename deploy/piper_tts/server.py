#!/usr/bin/env python3
"""Piper TTS HTTP service — proses & venv terpisah dari MuseTalk.

Default: CPU only (onnxruntime). Port 8090.
Voice = id host (namira, …), bukan Edge Neural ids.
Jangan import / jalankan dari ai_live_worker/env.
"""

from __future__ import annotations

import io
import os
import wave
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

PIPER_DIR = Path(os.environ.get("PIPER_DIR", "/workspace/piper_tts")).resolve()
MODELS_DIR = Path(os.environ.get("PIPER_MODELS_DIR", str(PIPER_DIR / "models"))).resolve()
DEFAULT_VOICE = os.environ.get("PIPER_VOICE", "id_ID-news_tts-medium").strip()
DEFAULT_HOST = os.environ.get("PIPER_DEFAULT_HOST", "namira").strip().lower() or "namira"
PORT = int(os.environ.get("PIPER_PORT", "8090"))

# Host avatar → file model Piper (stem tanpa .onnx).
# Bisa override: taruh models/namira.onnx (+ .onnx.json) untuk suara khusus host.
HOST_VOICE_MAP = {
    "namira": DEFAULT_VOICE,
    "default": DEFAULT_VOICE,
}

app = FastAPI(title="Piper TTS", version="1.1.0")
_voice_cache: dict[str, Any] = {}


class SynthesizeBody(BaseModel):
    text: str = Field(..., min_length=1)
    # Prefer host/avatar id: namira. Field "voice" = alias host atau stem model.
    host: Optional[str] = None
    voice: Optional[str] = None
    avatar: Optional[str] = None
    length_scale: Optional[float] = None
    noise_scale: Optional[float] = None
    noise_w: Optional[float] = None
    sample_rate: int = Field(16000, description="Target rate for MuseTalk (default 16k)")


def _norm_host(raw: Optional[str]) -> str:
    name = (raw or "").strip().lower()
    name = name.replace(".png", "").replace(".jpg", "").replace(".jpeg", "")
    name = name.replace(".mp4", "").replace(".onnx", "")
    if "/" in name:
        name = name.split("/")[-1]
    if name.startswith("id-id-") or name.startswith("id_id_"):
        # Legacy Edge ids diabaikan → default host
        return DEFAULT_HOST
    return name or DEFAULT_HOST


def _resolve_model_path(host_or_voice: str) -> Path:
    key = _norm_host(host_or_voice)

    # 1) models/{host}.onnx — suara khusus host
    host_onnx = MODELS_DIR / f"{key}.onnx"
    if host_onnx.is_file():
        return host_onnx

    # 2) map host → shared Indonesian voice
    mapped = HOST_VOICE_MAP.get(key, DEFAULT_VOICE)
    mapped_path = MODELS_DIR / f"{mapped}.onnx"
    if mapped_path.is_file():
        return mapped_path

    # 3) literal stem
    literal = MODELS_DIR / f"{key}.onnx"
    if literal.is_file():
        return literal

    matches = sorted(MODELS_DIR.glob("id_ID*.onnx"))
    if matches:
        return matches[0]

    raise FileNotFoundError(
        f"Model Piper tidak ditemukan untuk host/voice={key!r} di {MODELS_DIR}. "
        f"Jalankan: bash {PIPER_DIR}/setup.sh"
    )


def _load_voice(host_or_voice: str):
    path = _resolve_model_path(host_or_voice)
    cache_key = str(path)
    if cache_key in _voice_cache:
        return _voice_cache[cache_key], path
    from piper import PiperVoice

    try:
        v = PiperVoice.load(str(path), use_cuda=False)
    except TypeError:
        v = PiperVoice.load(str(path))
    _voice_cache[cache_key] = v
    print(f"[Piper] Loaded host/voice → {path.name}", flush=True)
    return v, path


def _synthesize_wav_bytes(
    text: str,
    host_or_voice: str,
    length_scale: Optional[float],
    noise_scale: Optional[float],
    noise_w: Optional[float],
) -> tuple[bytes, int]:
    voice, _path = _load_voice(host_or_voice)
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
    raw = buf.getvalue()
    with wave.open(io.BytesIO(raw), "rb") as r:
        src_rate = int(r.getframerate())
    return raw, src_rate


def _resample_wav_pcm16_mono(wav_bytes: bytes, target_rate: int) -> bytes:
    import audioop

    with wave.open(io.BytesIO(wav_bytes), "rb") as r:
        channels = r.getnchannels()
        sampwidth = r.getsampwidth()
        rate = r.getframerate()
        frames = r.readframes(r.getnframes())
    if channels > 1:
        frames = audioop.tomono(frames, sampwidth, 0.5, 0.5)
        channels = 1
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


@app.get("/health")
def health():
    try:
        p = _resolve_model_path(DEFAULT_HOST)
        return {
            "ok": True,
            "engine": "piper",
            "default_host": DEFAULT_HOST,
            "voice_file": p.name,
            "model_ready": p.is_file(),
            "models_dir": str(MODELS_DIR),
            "device": "cpu",
            "note": "Live-only TTS. Pre-live samples harus dari storage/DB, bukan endpoint ini.",
        }
    except Exception as err:
        return {
            "ok": False,
            "engine": "piper",
            "default_host": DEFAULT_HOST,
            "models_dir": str(MODELS_DIR),
            "error": str(err),
        }


@app.get("/voices")
def voices():
    files = sorted(MODELS_DIR.glob("*.onnx")) if MODELS_DIR.is_dir() else []
    hosts = sorted({*HOST_VOICE_MAP.keys(), DEFAULT_HOST})
    return {
        "success": True,
        "default_host": DEFAULT_HOST,
        "hosts": hosts,
        "host_voice_map": HOST_VOICE_MAP,
        "models": [f.stem for f in files],
    }


@app.post("/synthesize")
def synthesize(body: SynthesizeBody):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "text kosong")
    host_key = body.host or body.avatar or body.voice or DEFAULT_HOST
    try:
        wav, _src = _synthesize_wav_bytes(
            text,
            host_key,
            body.length_scale,
            body.noise_scale,
            body.noise_w,
        )
        target = int(body.sample_rate or 16000)
        if target > 0:
            wav = _resample_wav_pcm16_mono(wav, target)
        resolved = _resolve_model_path(host_key).stem
        return Response(
            content=wav,
            media_type="audio/wav",
            headers={
                "X-TTS-Engine": "piper",
                "X-TTS-Host": _norm_host(host_key),
                "X-TTS-Voice": resolved,
                "X-Sample-Rate": str(target or 16000),
            },
        )
    except FileNotFoundError as err:
        raise HTTPException(503, str(err)) from err
    except Exception as err:
        raise HTTPException(500, f"Piper synthesize gagal: {err}") from err


if __name__ == "__main__":
    import uvicorn

    print(
        f"[Piper] models={MODELS_DIR} host={DEFAULT_HOST} voice={DEFAULT_VOICE} port={PORT}",
        flush=True,
    )
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
