from __future__ import annotations

import io
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
from pocket_tts import TTSModel

from audio_post import postprocess_generated, prepare_prompt_audio

CONFIG = os.environ.get(
    "POCKET_TTS_CONFIG",
    "hf://anak10thn/pocket-tts-indonesian/indonesian_6l.yaml@635cde7a28301861b120f57ec4dda8525073017c",
)
VOICE_ROOT = Path(os.environ.get("POCKET_TTS_VOICE_ROOT", "../voices")).resolve()
HOST = os.environ.get("POCKET_TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("POCKET_TTS_PORT", "8092"))
OUTPUT_SAMPLE_RATE = int(os.environ.get("POCKET_TTS_OUTPUT_RATE", "24000"))
EOS_THRESHOLD = float(os.environ.get("POCKET_TTS_EOS_THRESHOLD", "-5.0"))
FRAMES_AFTER_EOS = int(os.environ.get("POCKET_TTS_FRAMES_AFTER_EOS", "3"))
os.environ.setdefault("KPOCKET_TTS_ERROR_WITHOUT_EOS", "1")

print(f"[PocketTTS] loading config={CONFIG} eos={EOS_THRESHOLD}", flush=True)
MODEL = TTSModel.load_model(config=CONFIG, eos_threshold=EOS_THRESHOLD)
VOICE_STATES: dict[str, Any] = {}
VOICE_LOCK = threading.Lock()


def _read_wav(path: Path):
    samples, rate = sf.read(path, dtype="float32", always_2d=True)
    return samples, rate


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
                prepare_prompt_audio(voice_path(voice_id), _read_wav)
            )
        return VOICE_STATES[voice_id]


def synthesize(text: str, voice_id: str) -> bytes:
    try:
        audio = MODEL.generate_audio(
            get_voice_state(voice_id),
            text,
            frames_after_eos=FRAMES_AFTER_EOS,
            copy_state=True,
        )
    except RuntimeError as exc:
        if "without EOS" not in str(exc):
            raise
        # Soft regenerate once so postprocess can strip the drone instead of failing hard.
        prev = os.environ.get("KPOCKET_TTS_ERROR_WITHOUT_EOS", "1")
        os.environ["KPOCKET_TTS_ERROR_WITHOUT_EOS"] = "0"
        MODEL.eos_threshold = min(MODEL.eos_threshold, EOS_THRESHOLD - 2.0)
        try:
            audio = MODEL.generate_audio(
                get_voice_state(voice_id),
                text,
                frames_after_eos=FRAMES_AFTER_EOS,
                copy_state=True,
            )
        finally:
            os.environ["KPOCKET_TTS_ERROR_WITHOUT_EOS"] = prev
            MODEL.eos_threshold = EOS_THRESHOLD
    if hasattr(audio, "detach"):
        audio = audio.detach().cpu().numpy()
    samples, out_rate = postprocess_generated(
        np.asarray(audio, dtype=np.float32),
        int(getattr(MODEL, "sample_rate", OUTPUT_SAMPLE_RATE) or OUTPUT_SAMPLE_RATE),
        OUTPUT_SAMPLE_RATE,
        text=text,
    )
    output = io.BytesIO()
    sf.write(output, samples, out_rate, format="WAV", subtype="PCM_16")
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
