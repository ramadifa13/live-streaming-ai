from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from scipy.signal import butter, resample_poly, sosfiltfilt

PROMPT_SAMPLE_RATE = 24000
MAX_PROMPT_SECONDS = 8.0
ONSET_FADE_MS = 20
TRAIL_FADE_MS = 180
TRAIL_DECAY_MS = 220
TRAIL_PLATEAU_MS = 280
TRAIL_MAX_TRIM_SEC = 8.0
TRAIL_MAX_TRIM_RATIO = 0.55
PROMPT_EDGE_FADE_MS = 12
WORDS_PER_SEC = 2.2
DURATION_PAD_SEC = 1.6
DURATION_HARD_MULT = 1.75
MIN_KEEP_AFTER_STRONG_MS = 280
MIN_TRIMMABLE_TAIL_SEC = 0.85


def audio_filter_enabled() -> bool:
    # Default ON: cuts low-frequency hum that often rides with vocoder drones.
    return os.environ.get("POCKET_TTS_AUDIO_FILTER", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def estimate_max_speech_seconds(text: str) -> float:
    words = max(1, len(str(text or "").split()))
    return max(1.6, words / WORDS_PER_SEC + DURATION_PAD_SEC)


def estimate_min_speech_seconds(text: str) -> float:
    """Reject early-EOS / over-trimmed takes that leave hanging sentences."""
    words = max(1, len(str(text or "").split()))
    if words <= 2:
        return 0.45
    # ~3.6 words/sec is fast Indonesian; anything much shorter is truncated speech.
    return max(1.4, words / 3.6)


def smooth_onset(samples: np.ndarray, sample_rate: int, fade_ms: int = ONSET_FADE_MS) -> np.ndarray:
    fade_samples = min(samples.size, max(1, int(sample_rate * fade_ms / 1000)))
    if fade_samples <= 1:
        return samples
    fade = np.sin(np.linspace(0, np.pi / 2, fade_samples, dtype=np.float32)) ** 2
    samples[:fade_samples] *= fade
    return samples


def fade_out(samples: np.ndarray, sample_rate: int, fade_ms: int = TRAIL_FADE_MS) -> np.ndarray:
    fade = min(max(1, samples.size // 3), max(1, int(sample_rate * fade_ms / 1000)))
    if fade > 1:
        ramp = np.sin(np.linspace(np.pi / 2, 0, fade, dtype=np.float32)) ** 2
        samples[-fade:] *= ramp
    return samples


def _envelope(samples: np.ndarray, sample_rate: int, win_ms: float = 20.0) -> np.ndarray:
    win = max(1, int(sample_rate * win_ms / 1000.0))
    return np.convolve(np.abs(samples), np.ones(win, dtype=np.float32) / win, mode="same")


def _spectral_flatness(frame: np.ndarray) -> float:
    if frame.size < 32:
        return 0.0
    windowed = frame * np.hanning(frame.size)
    spec = np.abs(np.fft.rfft(windowed)) + 1e-12
    log_mean = float(np.mean(np.log(spec)))
    geom = float(np.exp(log_mean))
    arith = float(np.mean(spec))
    return geom / max(arith, 1e-12)


def trim_trailing_buzz(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    """Cut confirmed vocoder drone after speech — never nibble real sentence endings.

    Only trims when there is a clear quiet/flat tail *after* the last strong peak
    and that tail is long enough to be a drone (not a quieter syllable).
    """
    if samples.size < max(8, sample_rate // 4):
        return samples
    env = _envelope(samples, sample_rate)
    peak = float(np.max(env)) if env.size else 0.0
    if peak <= 1e-5:
        return samples

    # Higher bar so quieter phrase endings are not treated as drones.
    strong = max(0.055, peak * 0.24)
    weak = max(0.012, peak * 0.04)
    strong_idx = np.flatnonzero(env > strong)
    if strong_idx.size == 0:
        return samples

    # Last *speech-like* strong peak (skip flat vocoder holds that also clear `strong`).
    win = max(1, int(sample_rate * 0.02))
    last_strong = int(strong_idx[-1])
    for idx in reversed(strong_idx.tolist()):
        lo = max(0, int(idx) - win * 3)
        hi = min(env.size, int(idx) + win * 3)
        local = env[lo:hi]
        local_cv = float(np.std(local)) / max(float(np.mean(local)), 1e-6)
        if local_cv > 0.14:
            last_strong = int(idx)
            break

    remaining = samples.size - last_strong
    if remaining < int(sample_rate * MIN_TRIMMABLE_TAIL_SEC):
        # Ending already short — keep full utterance to avoid hanging words.
        return fade_out(np.array(samples, dtype=np.float32, copy=True), sample_rate, 120)

    min_keep = max(
        int(sample_rate * 0.5),
        last_strong + int(sample_rate * MIN_KEEP_AFTER_STRONG_MS / 1000),
    )
    search_from = min(samples.size, last_strong + int(sample_rate * TRAIL_DECAY_MS / 1000))
    hop = max(1, win)
    plateau_need = int(sample_rate * TRAIL_PLATEAU_MS / 1000)
    flat_need = int(sample_rate * 0.4)

    end = samples.size
    plateau_start = None
    plateau_len = 0
    flat_start = None
    flat_len = 0
    i = search_from
    while i + hop <= samples.size:
        seg = env[i : i + hop]
        mean = float(np.mean(seg))
        std = float(np.std(seg))
        cv = std / max(mean, 1e-6)
        frame = samples[i : i + hop]
        flatness = _spectral_flatness(frame)

        if mean < weak:
            end = i
            break

        # Steady mid-level hold (vocoder drone). Low CV matters more than flatness
        # because some drones are tonal (low flatness) rather than noisy.
        if mean <= strong * 1.05 and cv < 0.22 and (flatness > 0.35 or cv < 0.12):
            if flat_start is None:
                flat_start = i
            flat_len += hop
            if flat_len >= flat_need:
                end = flat_start
                break
        else:
            flat_start = None
            flat_len = 0

        if mean < strong and cv < 0.22:
            if plateau_start is None:
                plateau_start = i
            plateau_len += hop
            if plateau_len >= plateau_need:
                end = plateau_start
                break
        else:
            plateau_start = None
            plateau_len = 0
        i += hop

    if end >= samples.size:
        # Long flat overrun after last speech peak = classic no-EOS fill.
        if remaining >= int(sample_rate * 1.5):
            tail = env[search_from:]
            if tail.size:
                tail_cv = float(np.std(tail)) / max(float(np.mean(tail)), 1e-6)
                if tail_cv < 0.30 and float(np.mean(tail)) > weak:
                    end = max(min_keep, last_strong + int(sample_rate * 0.22))
                else:
                    return fade_out(np.array(samples, dtype=np.float32, copy=True), sample_rate, 120)
            else:
                return fade_out(np.array(samples, dtype=np.float32, copy=True), sample_rate, 120)
        else:
            return fade_out(np.array(samples, dtype=np.float32, copy=True), sample_rate, 120)
    else:
        end = max(min_keep, min(end, samples.size))
        # Refuse tiny trims that only clip a syllable.
        if samples.size - end < int(sample_rate * 0.35):
            return fade_out(np.array(samples, dtype=np.float32, copy=True), sample_rate, 120)

    out = np.array(samples[:end], dtype=np.float32, copy=True)
    return fade_out(out, sample_rate)


def cap_duration(
    samples: np.ndarray,
    sample_rate: int,
    max_seconds: float | None,
) -> np.ndarray:
    if not max_seconds or max_seconds <= 0 or samples.size <= 1:
        return samples
    max_n = int(sample_rate * max_seconds)
    if samples.size <= max_n:
        return samples
    # Prefer a quiet cut near the cap rather than a hard mid-phoneme chop.
    search_from = max(int(sample_rate * 0.5), max_n - int(sample_rate * 0.45))
    search_to = max_n
    env = _envelope(samples, sample_rate)
    region = env[search_from:search_to]
    if region.size:
        cut = search_from + int(np.argmin(region))
    else:
        cut = max_n
    cut = max(int(sample_rate * 0.4), min(cut, max_n))
    out = np.array(samples[:cut], dtype=np.float32, copy=True)
    return fade_out(out, sample_rate, 180)


def limit_peak(samples: np.ndarray, ceiling: float = 0.98) -> np.ndarray:
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak > ceiling:
        samples = (samples * (ceiling / peak)).astype(np.float32)
    return samples


def apply_optional_filter(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    if not audio_filter_enabled() or samples.size < sample_rate // 4:
        return samples
    high_pass = butter(2, 40, btype="highpass", fs=sample_rate, output="sos")
    return sosfiltfilt(high_pass, samples).astype(np.float32)


def _nearest_zero_crossing(samples: np.ndarray, index: int, window: int) -> int:
    start = max(1, index - window)
    end = min(samples.size - 1, index + window)
    best = index
    best_abs = abs(float(samples[index])) if 0 <= index < samples.size else 1.0
    for i in range(start, end):
        a = float(samples[i - 1])
        b = float(samples[i])
        if a == 0.0 or a * b <= 0:
            mag = min(abs(a), abs(b))
            if mag <= best_abs:
                best_abs = mag
                best = i
    return int(best)


def cut_prompt_at_quiet_boundary(samples: np.ndarray, sample_rate: int, max_seconds: float = MAX_PROMPT_SECONDS) -> np.ndarray:
    max_n = int(sample_rate * max_seconds)
    if samples.size <= max_n:
        return samples
    window = max(1, int(sample_rate * 0.03))
    env = np.convolve(np.abs(samples), np.ones(window, dtype=np.float32) / window, mode="same")
    search_from = max(int(sample_rate * 2), max_n - int(sample_rate * 0.6))
    search_to = max_n
    region = env[search_from:search_to]
    if region.size == 0:
        cut = max_n
    else:
        cut = search_from + int(np.argmin(region))
    cut = _nearest_zero_crossing(samples, cut, max(8, int(sample_rate * 0.01)))
    cut = max(int(sample_rate * 1.5), min(cut, max_n))
    out = np.array(samples[:cut], dtype=np.float32, copy=True)
    return fade_out(out, sample_rate, PROMPT_EDGE_FADE_MS)


def prepare_prompt_audio(reference, read_wav) -> "object":
    import torch

    reference_path = Path(reference)
    samples, source_rate = read_wav(reference_path)
    samples = np.asarray(samples, dtype=np.float32)
    if samples.ndim > 1:
        samples = np.mean(samples, axis=1)
    samples = np.nan_to_num(samples, nan=0.0, posinf=0.0, neginf=0.0)
    samples -= np.mean(samples)
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak <= 1e-5:
        raise ValueError("Reference voice kosong atau terlalu pelan")

    window = max(1, int(source_rate * 0.02))
    envelope = np.convolve(np.abs(samples), np.ones(window) / window, mode="same")
    # Drop quiet/noisy tails from long reference takes before cloning.
    active = np.flatnonzero(envelope > max(0.012, peak * 0.08))
    if active.size:
        pad = int(source_rate * 0.08)
        samples = samples[max(0, int(active[0]) - pad) : min(samples.size, int(active[-1]) + pad)]

    samples = cut_prompt_at_quiet_boundary(samples, source_rate)
    if source_rate != PROMPT_SAMPLE_RATE:
        samples = resample_poly(samples, PROMPT_SAMPLE_RATE, source_rate).astype(np.float32)
    samples = smooth_onset(samples, PROMPT_SAMPLE_RATE, PROMPT_EDGE_FADE_MS)
    samples = fade_out(samples, PROMPT_SAMPLE_RATE, PROMPT_EDGE_FADE_MS)
    samples = limit_peak(samples, 0.92)
    if float(np.max(np.abs(samples))) <= 1e-5:
        raise ValueError("Reference voice tidak memiliki sinyal suara")
    return torch.from_numpy(samples).unsqueeze(0)


def has_trailing_buzz(samples: np.ndarray, sample_rate: int) -> bool:
    """Heuristic: loud, flat, spectrally-flat tail after speech."""
    if samples.size < sample_rate:
        return False
    env = _envelope(samples, sample_rate)
    peak = float(np.max(env)) if env.size else 0.0
    if peak <= 1e-5:
        return False
    tail_n = max(1, int(sample_rate * 0.35))
    mid_n = max(1, int(sample_rate * 0.5))
    # Mid speech region vs very end.
    mid = env[max(0, samples.size // 3) : max(0, samples.size // 3) + mid_n]
    tail = env[-tail_n:]
    mid_rms = float(np.sqrt(np.mean(mid**2))) if mid.size else 0.0
    tail_rms = float(np.sqrt(np.mean(tail**2))) if tail.size else 0.0
    tail_cv = float(np.std(tail)) / max(float(np.mean(tail)), 1e-6)
    flatness = _spectral_flatness(samples[-tail_n:])
    if tail_rms > max(0.02, peak * 0.08) and mid_rms > 1e-5 and tail_rms / mid_rms > 0.45 and tail_cv < 0.38:
        return True
    if flatness > 0.42 and tail_rms > max(0.018, peak * 0.06) and tail_cv < 0.4:
        return True
    return False


def postprocess_generated(
    samples: np.ndarray,
    source_sample_rate: int,
    output_sample_rate: int,
    text: str | None = None,
) -> tuple[np.ndarray, int]:
    samples = np.asarray(samples, dtype=np.float32)
    if samples.ndim > 1:
        samples = samples.reshape(-1)
    samples = apply_optional_filter(samples, source_sample_rate)
    out_rate = int(output_sample_rate)
    if source_sample_rate != out_rate:
        samples = resample_poly(samples, out_rate, source_sample_rate).astype(np.float32)
    else:
        out_rate = source_sample_rate
    samples = smooth_onset(samples, out_rate)
    samples = trim_trailing_buzz(samples, out_rate)
    # Hard cap only for extreme no-EOS overruns — never pinch natural endings.
    if text:
        hard_cap = estimate_max_speech_seconds(text) * DURATION_HARD_MULT
        dur = samples.size / float(out_rate)
        if dur > hard_cap:
            samples = cap_duration(samples, out_rate, hard_cap)
            samples = trim_trailing_buzz(samples, out_rate)
    samples = limit_peak(samples)
    return samples, out_rate


def audio_debug_metrics(samples: np.ndarray, sample_rate: int) -> dict:
    x = np.asarray(samples, dtype=np.float32)
    if x.size == 0:
        return {
            "dc": 0.0,
            "rms_onset": 0.0,
            "rms_tail": 0.0,
            "hf_spike": 0.0,
            "duration_sec": 0.0,
            "trailing_buzz": False,
        }
    onset_n = max(1, int(sample_rate * 0.05))
    tail_n = max(1, int(sample_rate * 0.2))
    spec = np.abs(np.fft.rfft(x[-tail_n:]))
    freqs = np.fft.rfftfreq(tail_n, d=1.0 / sample_rate)
    hf = float(np.mean(spec[freqs > 6000])) if spec.size else 0.0
    mid = float(np.mean(spec[(freqs > 300) & (freqs < 3000)])) if spec.size else 1e-9
    return {
        "dc": float(np.mean(x)),
        "rms_onset": float(np.sqrt(np.mean(x[:onset_n] ** 2))),
        "rms_tail": float(np.sqrt(np.mean(x[-tail_n:] ** 2))),
        "hf_spike": hf / max(mid, 1e-9),
        "duration_sec": x.size / float(sample_rate),
        "trailing_buzz": bool(has_trailing_buzz(x, sample_rate)),
    }
