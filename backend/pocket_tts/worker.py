from __future__ import annotations

import base64
import json
import logging
import os
import sys
from io import BytesIO
from pathlib import Path

import numpy as np
import soundfile as sf
from pocket_tts import TTSModel

from audio_post import (
    audio_debug_metrics,
    estimate_max_speech_seconds,
    estimate_min_speech_seconds,
    has_trailing_buzz,
    postprocess_generated,
    prepare_prompt_audio,
)

CONFIG = os.environ.get(
    "POCKET_TTS_CONFIG",
    "hf://anak10thn/pocket-tts-indonesian/indonesian_6l.yaml@635cde7a28301861b120f57ec4dda8525073017c",
)
VOICE_ROOT = Path(os.environ.get("POCKET_TTS_VOICE_DIR", "voices")).resolve()
OUTPUT_SAMPLE_RATE = int(os.environ.get("POCKET_TTS_OUTPUT_RATE", "24000"))
DEBUG_TAP_DIR = os.environ.get("TTS_DEBUG_TAP_DIR", "").strip()
# Milder than -6.5/-8.5: still helps EOS vs default -4.0, without chopping sentences.
EOS_THRESHOLD = float(os.environ.get("POCKET_TTS_EOS_THRESHOLD", "-5.0"))
EOS_RETRY_THRESHOLD = float(os.environ.get("POCKET_TTS_EOS_RETRY_THRESHOLD", "-6.0"))
FRAMES_AFTER_EOS = int(os.environ.get("POCKET_TTS_FRAMES_AFTER_EOS", "8"))
MAX_GENERATE_ATTEMPTS = max(1, int(os.environ.get("POCKET_TTS_MAX_ATTEMPTS", "2")))

# Prefer raising on no-EOS so we can retry instead of shipping a vocoder drone.
os.environ.setdefault("KPOCKET_TTS_ERROR_WITHOUT_EOS", "1")

model = TTSModel.load_model(config=CONFIG, eos_threshold=EOS_THRESHOLD)
prompt_cache: dict[str, tuple[int, object]] = {}


class _EosWarningFlag(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.WARNING)
        self.hit = False

    def emit(self, record: logging.LogRecord) -> None:
        msg = record.getMessage()
        if "without EOS" in msg:
            self.hit = True


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


def _raw_generate(state, text: str, eos_threshold: float) -> tuple[np.ndarray, bool]:
    """Returns (audio_ndarray, without_eos_flag)."""
    model.eos_threshold = eos_threshold
    flag = _EosWarningFlag()
    root = logging.getLogger()
    # Pocket TTS logs the warning on its package loggers; attach broadly.
    root.addHandler(flag)
    without_eos = False
    try:
        try:
            audio = model.generate_audio(
                state,
                text,
                frames_after_eos=FRAMES_AFTER_EOS,
                copy_state=True,
            )
        except RuntimeError as exc:
            if "without EOS" in str(exc):
                without_eos = True
                # Soft path: temporarily allow no-EOS so we still get audio to trim,
                # then retry with a stricter threshold on the next attempt.
                prev = os.environ.get("KPOCKET_TTS_ERROR_WITHOUT_EOS", "1")
                os.environ["KPOCKET_TTS_ERROR_WITHOUT_EOS"] = "0"
                try:
                    audio = model.generate_audio(
                        state,
                        text,
                        frames_after_eos=FRAMES_AFTER_EOS,
                        copy_state=True,
                    )
                finally:
                    os.environ["KPOCKET_TTS_ERROR_WITHOUT_EOS"] = prev
            else:
                raise
    finally:
        root.removeHandler(flag)

    without_eos = without_eos or flag.hit
    if hasattr(audio, "detach"):
        audio = audio.detach().cpu().numpy()
    return np.asarray(audio, dtype=np.float32), without_eos


def _needs_retry(samples: np.ndarray, sample_rate: int, text: str, without_eos: bool) -> bool:
    dur = samples.size / float(sample_rate)
    min_sec = estimate_min_speech_seconds(text)
    if dur < min_sec:
        return True
    if without_eos and dur > estimate_max_speech_seconds(text) * 1.45:
        return True
    if has_trailing_buzz(samples, sample_rate) and dur > estimate_max_speech_seconds(text) * 1.25:
        return True
    return False


def _score_take(samples: np.ndarray, sample_rate: int, text: str, without_eos: bool, metrics: dict) -> int:
    """Lower is better. Heavily penalize truncated / empty takes so they never win."""
    dur = samples.size / float(sample_rate)
    min_sec = estimate_min_speech_seconds(text)
    max_sec = estimate_max_speech_seconds(text)
    score = 0
    if dur < min_sec:
        score += 20 + int((min_sec - dur) * 10)
    if metrics.get("trailing_buzz"):
        score += 2
    if without_eos:
        score += 1
    if dur > max_sec * 1.45:
        score += 1
    return score


def generate(request: dict) -> dict:
    voice_id = str(request.get("voice_id") or "girl_cute_kids")
    text = str(request.get("text") or "").strip()
    if not text:
        raise ValueError("text kosong")
    state = load_prompt(voice_id)
    source_sample_rate = int(getattr(model, "sample_rate", OUTPUT_SAMPLE_RATE) or OUTPUT_SAMPLE_RATE)

    thresholds = [EOS_THRESHOLD]
    if MAX_GENERATE_ATTEMPTS > 1:
        # If first take truncates (early EOS), retry closer to stock threshold so speech finishes.
        thresholds.append(-4.0)

    best: tuple[np.ndarray, int, dict, int] | None = None
    last_error: Exception | None = None

    for attempt, threshold in enumerate(thresholds[:MAX_GENERATE_ATTEMPTS], start=1):
        try:
            raw, without_eos = _raw_generate(state, text, threshold)
            samples, out_rate = postprocess_generated(
                raw, source_sample_rate, OUTPUT_SAMPLE_RATE, text=text
            )
            metrics = audio_debug_metrics(samples, out_rate)
            metrics["without_eos"] = without_eos
            metrics["eos_threshold"] = threshold
            metrics["attempt"] = attempt
            score = _score_take(samples, out_rate, text, without_eos, metrics)
            metrics["score"] = score

            if best is None or score < best[3]:
                best = (samples, out_rate, metrics, score)

            if not _needs_retry(samples, out_rate, text, without_eos):
                break
            if attempt < MAX_GENERATE_ATTEMPTS:
                print(
                    f"[PocketTTS] retry attempt={attempt + 1} reason="
                    f"{'too_short' if samples.size / out_rate < estimate_min_speech_seconds(text) else 'buzz_or_long'} "
                    f"eos={threshold} dur={metrics['duration_sec']:.2f}s score={score}",
                    file=sys.stderr,
                )
        except Exception as exc:
            last_error = exc
            print(f"[PocketTTS] generate attempt={attempt} failed: {exc}", file=sys.stderr)
            if attempt >= MAX_GENERATE_ATTEMPTS:
                raise

    if best is None:
        raise last_error or RuntimeError("Pocket TTS gagal menghasilkan audio")

    samples, out_rate, metrics, score = best
    min_sec = estimate_min_speech_seconds(text)
    if metrics["duration_sec"] < min_sec:
        print(
            f"[PocketTTS] WARN truncated_take kept dur={metrics['duration_sec']:.2f}s "
            f"min={min_sec:.2f}s text_words={len(text.split())}",
            file=sys.stderr,
        )
    # Only strip extreme leftover drone — never pinch below ~natural length.
    elif metrics.get("trailing_buzz") and metrics["duration_sec"] > estimate_max_speech_seconds(text) * 1.5:
        from audio_post import cap_duration, trim_trailing_buzz

        soft_cap = estimate_max_speech_seconds(text) * 1.35
        samples = trim_trailing_buzz(samples, out_rate)
        if samples.size / float(out_rate) > soft_cap:
            samples = cap_duration(samples, out_rate, soft_cap)
        metrics = audio_debug_metrics(samples, out_rate)
        metrics["soft_overrun_trim"] = True

    if DEBUG_TAP_DIR:
        os.makedirs(DEBUG_TAP_DIR, exist_ok=True)
        tap = Path(DEBUG_TAP_DIR) / f"tts_{request.get('id') or 'anon'}.wav"
        sf.write(str(tap), samples, out_rate, subtype="PCM_16")
        print(f"[PocketTTS] metrics {metrics}", file=sys.stderr)

    if metrics.get("trailing_buzz"):
        print(f"[PocketTTS] WARN residual_buzz metrics={metrics}", file=sys.stderr)
    elif metrics.get("without_eos"):
        print(f"[PocketTTS] trimmed_no_eos metrics={metrics}", file=sys.stderr)

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
