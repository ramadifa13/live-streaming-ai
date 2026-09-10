from __future__ import annotations

import io
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import scipy.io.wavfile
import numpy as np
import torch
from scipy.signal import butter, resample_poly, sosfiltfilt
from pocket_tts import TTSModel

CONFIG = os.environ.get(
    "POCKET_TTS_CONFIG",
    "hf://anak10thn/pocket-tts-indonesian/indonesian_6l.yaml@635cde7a28301861b120f57ec4dda8525073017c",
)
VOICE_ROOT = Path(os.environ.get("POCKET_TTS_VOICE_ROOT", "../voices")).resolve()
HOST = os.environ.get("POCKET_TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("POCKET_TTS_PORT", "8092"))
AUDIO_FILTER_ENABLED = os.environ.get("POCKET_TTS_AUDIO_FILTER", "1") != "0"
ONSET_FADE_MS = 20
PROMPT_SAMPLE_RATE = 24000
MAX_PROMPT_SECONDS = 12

print(f"[PocketTTS] loading config={CONFIG}", flush=True)
MODEL = TTSModel.load_model(config=CONFIG)
VOICE_STATES: dict[str, Any] = {}
VOICE_LOCK = threading.Lock()


def smooth_onset(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    fade_samples = min(audio.size, max(1, int(sample_rate * ONSET_FADE_MS / 1000)))
    if fade_samples <= 1:
        return audio
    fade = np.sin(np.linspace(0, np.pi / 2, fade_samples, dtype=np.float32)) ** 2
    audio[:fade_samples] *= fade
    return audio


def prepare_prompt_audio(reference: Path) -> torch.Tensor:
    audio, source_rate = sf.read(reference, dtype="float32", always_2d=True)
    audio = np.mean(audio, axis=1)
    audio = np.nan_to_num(audio, nan=0.0, posinf=0.0, neginf=0.0)
    audio -= np.mean(audio)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak <= 1e-5:
        raise ValueError("Reference voice kosong atau terlalu pelan")

    window = max(1, int(source_rate * 0.02))
    envelope = np.convolve(np.abs(audio), np.ones(window) / window, mode="same")
    active = np.flatnonzero(envelope > max(0.008, peak * 0.06))
    if active.size:
        pad = int(source_rate * 0.12)
        audio = audio[
            max(0, int(active[0]) - pad) : min(audio.size, int(active[-1]) + pad)
        ]

    audio = audio[: int(source_rate * MAX_PROMPT_SECONDS)]
    if source_rate != PROMPT_SAMPLE_RATE:
        audio = resample_poly(audio, PROMPT_SAMPLE_RATE, source_rate).astype(np.float32)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak <= 1e-5:
        raise ValueError("Reference voice tidak memiliki sinyal suara")
    audio = (audio * min(0.95 / peak, 1.0)).astype(np.float32)
    return torch.from_numpy(audio).unsqueeze(0)


def voice_path(voice_id: str) -> Path:
    candidate = (VOICE_ROOT / voice_id / "reference.wav").resolve()
    if VOICE_ROOT not in candidate.parents:
        raise ValueError("voice_id tidak valid")
    if not candidate.is_file():
        raise FileNotFoundError(f"reference voice tidak ditemukan: {candidate}")
    return candidate


def get_voice_state(voice_id: str) -> Any:
    with VOICE_LOCK:
        if voice_id not in VOICE_STATES:
            VOICE_STATES[voice_id] = MODEL.get_state_for_audio_prompt(
                prepare_prompt_audio(voice_path(voice_id))
            )
        return VOICE_STATES[voice_id]


def synthesize(text: str, voice_id: str) -> bytes:
    audio = MODEL.generate_audio(get_voice_state(voice_id), text)
    audio = audio.detach().cpu().numpy().astype(np.float32)
    if AUDIO_FILTER_ENABLED and audio.size >= MODEL.sample_rate // 4:
        high_pass = butter(2, 35, btype="highpass", fs=MODEL.sample_rate, output="sos")
        low_pass = butter(
            2,
            min(7600, MODEL.sample_rate * 0.45),
            btype="lowpass",
            fs=MODEL.sample_rate,
            output="sos",
        )
        audio = sosfiltfilt(high_pass, audio)
        audio = sosfiltfilt(low_pass, audio)
    audio = smooth_onset(audio, MODEL.sample_rate)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0.98:
        audio = audio * (0.98 / peak)
    output = io.BytesIO()
    scipy.io.wavfile.write(output, MODEL.sample_rate, audio)
    return output.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        print(f"[PocketTTS] {format % args}", flush=True)

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, {"status": "ok", "ready": True, "engine": "pocket-tts"})
            return
        self.send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/synthesize":
            self.send_json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            request = json.loads(self.rfile.read(length))
            text = str(request.get("text", "")).strip()
            voice_id = str(request.get("voice_id", "girl_cute_kids")).strip()
            if not text:
                raise ValueError("text wajib diisi")
            wav = synthesize(text, voice_id)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav)))
            self.end_headers()
            self.wfile.write(wav)
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})


if __name__ == "__main__":
    print(f"[PocketTTS] listening on http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
