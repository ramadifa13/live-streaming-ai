"""VoxCPM2 TTS service — satu engine, short-sentence, voice_id + reference cache.

Load model sekali di startup. Reference voice diganti dengan mengganti
``voices/<voice_id>/reference.wav`` tanpa mengubah API contract.
"""

from __future__ import annotations

import os
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np

# ---------------------------------------------------------------------------
# Paths / env
# ---------------------------------------------------------------------------

DEFAULT_VOICE_ID = (os.environ.get("VOICE_ID") or "default_host").strip() or "default_host"
VOICE_ROOT = Path(
    os.environ.get("VOICE_ROOT")
    or os.environ.get("VOXCPM2_VOICE_ROOT")
    or "/workspace/voices"
).resolve()
MODEL_PATH = (
    os.environ.get("VOXCPM2_MODEL_PATH")
    or os.environ.get("VOXCPM2_MODEL")
    or "/workspace/models/voxcpm2"
).strip()
TTS_LANGUAGE = (os.environ.get("TTS_LANGUAGE") or "id").strip() or "id"
CFG_VALUE = float(os.environ.get("VOXCPM2_CFG_VALUE") or "2.0")
INFERENCE_TIMESTEPS = int(os.environ.get("VOXCPM2_INFERENCE_TIMESTEPS") or "10")
# Jika reference.wav belum ada: izinkan voice-design sementara (dev/bootstrap).
ALLOW_VOICE_DESIGN = (os.environ.get("VOXCPM2_ALLOW_VOICE_DESIGN") or "1").strip() not in (
    "0",
    "false",
    "False",
)
VOICE_DESIGN_PROMPT = (
    os.environ.get("VOXCPM2_VOICE_DESIGN")
    or "A young Indonesian woman, energetic live-commerce host, clear and warm"
).strip()


@dataclass
class TtsMetrics:
    request_id: str
    voice_id: str
    queue_ms: float = 0.0
    inference_ms: float = 0.0
    total_ms: float = 0.0
    audio_duration_sec: float = 0.0
    rtf: float = 0.0
    sample_rate: int = 0
    gpu_memory_used_mb: Optional[float] = None
    live_session_id: Optional[str] = None


@dataclass
class TtsResult:
    wav: np.ndarray
    sample_rate: int
    metrics: TtsMetrics
    voice_id: str
    reference_path: Optional[str] = None


@dataclass
class _VoiceCacheEntry:
    reference_path: Path
    mtime: float
    # Reserved for future embedding/cache hooks if VoxCPM exposes them.
    meta: Dict[str, Any] = field(default_factory=dict)


def _gpu_memory_used_mb() -> Optional[float]:
    try:
        import torch

        if not torch.cuda.is_available():
            return None
        return round(torch.cuda.memory_allocated() / (1024 * 1024), 1)
    except Exception:
        return None


def _resolve_voice_dir(voice_id: str) -> Path:
    safe = (voice_id or DEFAULT_VOICE_ID).strip().replace("\\", "/").split("/")[-1]
    if not safe or safe in (".", ".."):
        safe = DEFAULT_VOICE_ID
    return VOICE_ROOT / safe


def resolve_reference_wav(voice_id: str) -> Optional[Path]:
    """Return reference.wav path if present and non-empty."""
    ref = _resolve_voice_dir(voice_id) / "reference.wav"
    if ref.is_file() and ref.stat().st_size > 44:
        return ref
    return None


class VoxCPM2TtsService:
    """Singleton-style service: load once, synthesize short sentences."""

    def __init__(self) -> None:
        self._model = None
        self._sample_rate = 48000
        self._lock = threading.Lock()  # serialize GPU TTS (share RTX 4090 with MuseTalk)
        self._voice_cache: Dict[str, _VoiceCacheEntry] = {}
        self._ready = False
        self._load_error: Optional[str] = None

    @property
    def ready(self) -> bool:
        return self._ready and self._model is not None

    @property
    def load_error(self) -> Optional[str]:
        return self._load_error

    @property
    def sample_rate(self) -> int:
        return int(self._sample_rate)

    def load(self) -> None:
        """Load VoxCPM2 into GPU VRAM once. Safe to call multiple times."""
        if self._ready and self._model is not None:
            return
        t0 = time.perf_counter()
        try:
            import torch
            from voxcpm import VoxCPM

            # L40S / Ada: aktifkan TF32 + matmul precision tinggi (hilangkan warning inductor).
            if torch.cuda.is_available():
                torch.set_float32_matmul_precision("high")
                torch.backends.cuda.matmul.allow_tf32 = True
                torch.backends.cudnn.allow_tf32 = True
                torch.backends.cudnn.benchmark = True

            model_src = MODEL_PATH
            local = Path(model_src)
            if local.is_dir() and any(local.iterdir()):
                print(f"[VoxCPM2] Loading from local path: {local}", flush=True)
                self._model = VoxCPM.from_pretrained(str(local), load_denoiser=False)
            else:
                # HF hub id fallback when network volume belum di-populate
                hub_id = os.environ.get("VOXCPM2_HUB_ID") or "openbmb/VoxCPM2"
                print(
                    f"[VoxCPM2] Local path empty ({model_src}); loading hub={hub_id}",
                    flush=True,
                )
                self._model = VoxCPM.from_pretrained(hub_id, load_denoiser=False)

            sr = getattr(getattr(self._model, "tts_model", None), "sample_rate", None)
            if sr:
                self._sample_rate = int(sr)
            self._ready = True
            self._load_error = None
            elapsed = (time.perf_counter() - t0) * 1000
            print(
                f"[VoxCPM2] Ready sample_rate={self._sample_rate} "
                f"load_ms={elapsed:.0f} gpu_mb={_gpu_memory_used_mb()}",
                flush=True,
            )
        except Exception as exc:
            self._ready = False
            self._model = None
            self._load_error = str(exc)
            print(f"[VoxCPM2] Load FAILED: {exc}", flush=True)
            raise

    def _cached_reference(self, voice_id: str) -> Optional[Path]:
        ref = resolve_reference_wav(voice_id)
        if ref is None:
            self._voice_cache.pop(voice_id, None)
            return None
        mtime = ref.stat().st_mtime
        entry = self._voice_cache.get(voice_id)
        if entry is None or entry.mtime != mtime or entry.reference_path != ref:
            self._voice_cache[voice_id] = _VoiceCacheEntry(
                reference_path=ref, mtime=mtime
            )
            print(f"[VoxCPM2] Voice cache refresh voice_id={voice_id} path={ref}", flush=True)
        return self._voice_cache[voice_id].reference_path

    def invalidate_voice(self, voice_id: Optional[str] = None) -> None:
        if voice_id:
            self._voice_cache.pop(voice_id, None)
        else:
            self._voice_cache.clear()

    def generate_speech(
        self,
        text: str,
        voice_id: str = DEFAULT_VOICE_ID,
        language: str = TTS_LANGUAGE,
        style: Optional[str] = None,
        emotion: Optional[str] = None,
        *,
        request_id: Optional[str] = None,
        live_session_id: Optional[str] = None,
        cfg_value: Optional[float] = None,
        inference_timesteps: Optional[int] = None,
    ) -> TtsResult:
        """Synthesize one short utterance. Raises on failure (no engine fallback)."""
        if not self.ready or self._model is None:
            raise RuntimeError(
                self._load_error or "VoxCPM2 belum di-load. Panggil load() di startup."
            )

        clean = (text or "").strip()
        if not clean:
            raise ValueError("text kosong")

        vid = (voice_id or DEFAULT_VOICE_ID).strip() or DEFAULT_VOICE_ID
        rid = request_id or str(uuid.uuid4())
        t_start = time.perf_counter()
        queue_wait_start = t_start

        # Style / emotion → parenthetical control instruction (VoxCPM2 controllable clone)
        control_bits = []
        if style:
            control_bits.append(str(style).strip())
        if emotion and emotion.lower() not in ("neutral", ""):
            control_bits.append(str(emotion).strip())
        # language hint for cross-lingual stability (Indonesian supported natively)
        if language and language.lower().startswith("id"):
            control_bits.append("speak Indonesian")
        elif language and language.lower().startswith("en"):
            control_bits.append("speak English")

        gen_text = clean
        if control_bits:
            gen_text = f"({', '.join(control_bits)}){clean}"

        ref_path = self._cached_reference(vid)
        use_voice_design = False
        if ref_path is None:
            if not ALLOW_VOICE_DESIGN:
                raise FileNotFoundError(
                    f"reference.wav tidak ditemukan untuk voice_id={vid} "
                    f"di { _resolve_voice_dir(vid) / 'reference.wav' }"
                )
            use_voice_design = True
            gen_text = f"({VOICE_DESIGN_PROMPT}){clean}"
            print(
                f"[VoxCPM2] voice_id={vid} tanpa reference.wav — voice design fallback",
                flush=True,
            )

        print(
            f"tts.request.started request_id={rid} live_session_id={live_session_id} "
            f"voice_id={vid} chars={len(clean)}",
            flush=True,
        )

        with self._lock:
            queued_ms = (time.perf_counter() - queue_wait_start) * 1000
            t_inf0 = time.perf_counter()
            try:
                kwargs: Dict[str, Any] = {
                    "text": gen_text,
                    "cfg_value": float(cfg_value if cfg_value is not None else CFG_VALUE),
                    "inference_timesteps": int(
                        inference_timesteps
                        if inference_timesteps is not None
                        else INFERENCE_TIMESTEPS
                    ),
                    "normalize": True,
                    "retry_badcase": True,
                }
                if ref_path is not None and not use_voice_design:
                    kwargs["reference_wav_path"] = str(ref_path)

                wav = self._model.generate(**kwargs)
            except Exception as exc:
                total_ms = (time.perf_counter() - t_start) * 1000
                print(
                    f"tts.request.failed request_id={rid} voice_id={vid} "
                    f"error={exc} total_ms={total_ms:.1f}",
                    flush=True,
                )
                raise

            inference_ms = (time.perf_counter() - t_inf0) * 1000

        wav_arr = np.asarray(wav, dtype=np.float32).reshape(-1)
        sr = self._sample_rate
        duration = float(len(wav_arr) / sr) if sr > 0 else 0.0
        total_ms = (time.perf_counter() - t_start) * 1000
        rtf = (inference_ms / 1000.0) / duration if duration > 0 else 0.0
        gpu_mb = _gpu_memory_used_mb()

        metrics = TtsMetrics(
            request_id=rid,
            voice_id=vid,
            queue_ms=round(queued_ms, 2),
            inference_ms=round(inference_ms, 2),
            total_ms=round(total_ms, 2),
            audio_duration_sec=round(duration, 3),
            rtf=round(rtf, 4),
            sample_rate=sr,
            gpu_memory_used_mb=gpu_mb,
            live_session_id=live_session_id,
        )

        print(
            f"tts.request.completed request_id={rid} live_session_id={live_session_id} "
            f"voice_id={vid} audio_duration={metrics.audio_duration_sec} "
            f"tts_latency={metrics.total_ms} queue_ms={metrics.queue_ms} "
            f"inference_ms={metrics.inference_ms} rtf={metrics.rtf} "
            f"gpu_memory_used={gpu_mb}",
            flush=True,
        )

        return TtsResult(
            wav=wav_arr,
            sample_rate=sr,
            metrics=metrics,
            voice_id=vid,
            reference_path=str(ref_path) if ref_path else None,
        )


# Process-wide singleton
_service: Optional[VoxCPM2TtsService] = None
_service_lock = threading.Lock()


def get_tts_service() -> VoxCPM2TtsService:
    global _service
    with _service_lock:
        if _service is None:
            _service = VoxCPM2TtsService()
        return _service


def generate_speech(
    text: str,
    voice_id: str = DEFAULT_VOICE_ID,
    language: str = TTS_LANGUAGE,
    style: Optional[str] = None,
    emotion: Optional[str] = None,
    **kwargs: Any,
) -> TtsResult:
    """Public API matching product contract."""
    svc = get_tts_service()
    if not svc.ready:
        svc.load()
    return svc.generate_speech(
        text=text,
        voice_id=voice_id,
        language=language,
        style=style,
        emotion=emotion,
        **kwargs,
    )


def wav_to_pcm16_bytes(wav: np.ndarray, sample_rate: int) -> bytes:
    """Encode float32 wav → 16-bit PCM WAV bytes (RIFF)."""
    import io
    import soundfile as sf

    buf = io.BytesIO()
    clipped = np.clip(wav, -1.0, 1.0)
    sf.write(buf, clipped, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def resample_to_16k_mono(wav: np.ndarray, sample_rate: int) -> Tuple[np.ndarray, int]:
    """MuseTalk expects 16 kHz mono."""
    if sample_rate == 16000:
        return wav.astype(np.float32), 16000
    try:
        import librosa

        out = librosa.resample(wav.astype(np.float32), orig_sr=sample_rate, target_sr=16000)
        return out.astype(np.float32), 16000
    except Exception:
        # Linear fallback
        if sample_rate <= 0:
            return wav.astype(np.float32), sample_rate
        ratio = 16000 / float(sample_rate)
        n = max(1, int(round(len(wav) * ratio)))
        x_old = np.linspace(0.0, 1.0, num=len(wav), endpoint=False)
        x_new = np.linspace(0.0, 1.0, num=n, endpoint=False)
        out = np.interp(x_new, x_old, wav.astype(np.float64)).astype(np.float32)
        return out, 16000


if __name__ == "__main__":
    # Smoke: load + one short ID sentence (requires GPU + model).
    svc = get_tts_service()
    svc.load()
    result = generate_speech(
        "Halo kak, selamat datang di live hari ini.",
        voice_id=DEFAULT_VOICE_ID,
        language="id",
    )
    out = Path(os.environ.get("VOXCPM2_TEST_OUT") or "/tmp/voxcpm2_smoke.wav")
    out.write_bytes(wav_to_pcm16_bytes(result.wav, result.sample_rate))
    print(f"[OK] wrote {out} metrics={result.metrics}", flush=True)
