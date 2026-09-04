#!/usr/bin/env python3
"""VoxCPM2 HTTP micro-server — venv terpisah, bind localhost saja.

API:
  GET  /health
  POST /synthesize  JSON → WAV bytes (+ metrics headers)
  POST /invalidate-voice  { "voice_id": "..." }
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

# Pastikan package lokal ter-import
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field
from typing import Optional
import uvicorn

from tts_service import (
    DEFAULT_VOICE_ID,
    get_tts_service,
    resample_to_16k_mono,
    wav_to_pcm16_bytes,
)

HOST = os.environ.get("VOXCPM2_BIND_HOST") or "127.0.0.1"
PORT = int(os.environ.get("VOXCPM2_BIND_PORT") or "8091")
OUTPUT_SR = int(os.environ.get("VOXCPM2_OUTPUT_SR") or "16000")  # MuseTalk = 16k


class SynthRequest(BaseModel):
    text: str = Field(..., min_length=1)
    voice_id: str = DEFAULT_VOICE_ID
    language: str = "id"
    style: Optional[str] = None
    emotion: Optional[str] = None
    request_id: Optional[str] = None
    live_session_id: Optional[str] = None
    cfg_value: Optional[float] = None
    inference_timesteps: Optional[int] = None
    # Jika true, kembalikan native sample rate (48k). Default 16k mono untuk MuseTalk.
    native_sr: bool = False


class InvalidateRequest(BaseModel):
    voice_id: Optional[str] = None


app = FastAPI(title="VoxCPM2 TTS", docs_url=None, redoc_url=None)


@app.on_event("startup")
def _startup() -> None:
    t0 = time.perf_counter()
    print("[VoxCPM2-worker] startup — loading model…", flush=True)
    svc = get_tts_service()
    try:
        svc.load()
        print(
            f"[VoxCPM2-worker] warm OK in {(time.perf_counter() - t0) * 1000:.0f}ms",
            flush=True,
        )
    except Exception as exc:
        # Tetap hidup agar /health bisa melaporkan error; synth akan 503.
        print(f"[VoxCPM2-worker] warm FAILED: {exc}", flush=True)


@app.get("/health")
def health():
    svc = get_tts_service()
    return {
        "status": "ok" if svc.ready else "degraded",
        "engine": "voxcpm2",
        "ready": svc.ready,
        "load_error": svc.load_error,
        "sample_rate": svc.sample_rate if svc.ready else None,
        "default_voice_id": DEFAULT_VOICE_ID,
    }


@app.post("/synthesize")
def synthesize(req: SynthRequest):
    svc = get_tts_service()
    if not svc.ready:
        try:
            svc.load()
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"VoxCPM2 not ready: {exc}") from exc

    try:
        result = svc.generate_speech(
            text=req.text,
            voice_id=req.voice_id or DEFAULT_VOICE_ID,
            language=req.language or "id",
            style=req.style,
            emotion=req.emotion,
            request_id=req.request_id,
            live_session_id=req.live_session_id,
            cfg_value=req.cfg_value,
            inference_timesteps=req.inference_timesteps,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"VoxCPM2 inference failed: {exc}") from exc

    wav = result.wav
    sr = result.sample_rate
    if not req.native_sr and OUTPUT_SR == 16000 and sr != 16000:
        wav, sr = resample_to_16k_mono(wav, sr)

    body = wav_to_pcm16_bytes(wav, sr)
    m = result.metrics
    headers = {
        "Content-Type": "audio/wav",
        "X-TTS-Engine": "voxcpm2",
        "X-TTS-Voice-Id": result.voice_id,
        "X-TTS-Request-Id": m.request_id,
        "X-TTS-Queue-Ms": str(m.queue_ms),
        "X-TTS-Inference-Ms": str(m.inference_ms),
        "X-TTS-Latency-Ms": str(m.total_ms),
        "X-TTS-Audio-Duration": str(m.audio_duration_sec),
        "X-TTS-RTF": str(m.rtf),
        "X-TTS-Sample-Rate": str(sr),
    }
    if m.gpu_memory_used_mb is not None:
        headers["X-TTS-GPU-Memory-MB"] = str(m.gpu_memory_used_mb)
    if m.live_session_id:
        headers["X-TTS-Live-Session-Id"] = m.live_session_id
    return Response(content=body, media_type="audio/wav", headers=headers)


@app.post("/invalidate-voice")
def invalidate(req: InvalidateRequest):
    get_tts_service().invalidate_voice(req.voice_id)
    return {"success": True, "voice_id": req.voice_id}


def main() -> None:
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    main()
