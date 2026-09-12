from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from scipy.signal import butter, resample_poly, sosfiltfilt

PROMPT_SAMPLE_RATE = 24000
MAX_PROMPT_SECONDS = 8.0
ONSET_FADE_MS = 20
TRAIL_FADE_MS = 8
CLICK_FADE_MS = 8
TRAIL_DECAY_MS = 220
TRAIL_PLATEAU_MS = 800
TRAIL_MAX_TRIM_SEC = 8.0
TRAIL_MAX_TRIM_RATIO = 0.55
PROMPT_EDGE_FADE_MS = 12
WORDS_PER_SEC = 2.2
DURATION_PAD_SEC = 1.6
DURATION_HARD_MULT = 1.75
MIN_KEEP_AFTER_STRONG_MS = 600
MIN_TRIMMABLE_TAIL_SEC = 0.9
DRONE_FLAT_SEC = 0.8
DRONE_TONAL_SEC = 1.4


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
    """Short click soften only — never eat a third of the clip or a final syllable."""
    fade = min(samples.size, max(1, int(sample_rate * fade_ms / 1000)))
    if fade > 1:
        ramp = np.sin(np.linspace(np.pi / 2, 0, fade, dtype=np.float32)) ** 2
        samples[-fade:] *= ramp
    return samples


def _keep_natural_ending(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    """Keep last words at full level. Fade only a near-silent tip to avoid a click."""
    out = np.array(samples, dtype=np.float32, copy=True)
    if out.size < 16:
        return out
    peak = float(np.max(np.abs(out)))
    if peak <= 1e-5:
        return out
    tip_n = max(1, int(sample_rate * 0.012))
    tip_peak = float(np.max(np.abs(out[-tip_n:])))
    if tip_peak < peak * 0.03:
        return fade_out(out, sample_rate, CLICK_FADE_MS)
    return out


def _last_modulated_end(env: np.ndarray, strong: float, weak: float, sample_rate: int) -> int:
    """Index just after the last syllabic (modulated) speech window."""
    win = max(1, int(sample_rate * 0.04))
    hop = max(1, win // 2)
    # Convolution tapers the last window; that fake CV must not count as speech.
    scan_end = max(0, env.size - win)
    last = 0
    i = 0
    run = 0
    quiet_floor = max(weak * 2.5, 0.012)
    while i + win <= scan_end:
        seg = env[i : i + win]
        mean = float(np.mean(seg))
        cv = float(np.std(seg)) / max(mean, 1e-6)
        modulated = (mean > strong and cv > 0.11) or (mean > quiet_floor and cv > 0.18)
        if modulated:
            run += 1
            if run >= 2:
                last = i + win
        else:
            run = 0
        i += hop
    return last


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
    """Cut a confirmed vocoder drone after speech. Leave natural endings alone.

    Long sentences get quieter and slower at the end. That decay is speech, not
    a drone — never treat it as a plateau and never fade the last words down.
    """
    if samples.size < max(8, sample_rate // 4):
        return samples
    env = _envelope(samples, sample_rate)
    peak = float(np.max(env)) if env.size else 0.0
    if peak <= 1e-5:
        return samples

    strong = max(0.035, peak * 0.12)
    weak = max(0.008, peak * 0.025)
    last_speech = _last_modulated_end(env, strong, weak, sample_rate)
    if last_speech <= 0:
        return _keep_natural_ending(samples, sample_rate)

    remaining = samples.size - last_speech
    if remaining < int(sample_rate * MIN_TRIMMABLE_TAIL_SEC):
        return _keep_natural_ending(samples, sample_rate)

    tail = env[last_speech:]
    tail_mean = float(np.mean(tail))
    tail_cv = float(np.std(tail)) / max(tail_mean, 1e-6)
    # Decaying last words have a high CV (energy keeps falling / syllabic).
    # A drone is a long, almost-constant hold after speech has already ended.
    if tail_cv >= 0.13:
        return _keep_natural_ending(samples, sample_rate)
    if tail_mean <= weak:
        # Already faded to near-silence — keep the words, soften the tip only.
        return _keep_natural_ending(samples, sample_rate)

    tail_flat = _spectral_flatness(samples[last_speech:])
    remaining_sec = remaining / float(sample_rate)
    is_noisy_drone = tail_flat > 0.32 and remaining_sec >= DRONE_FLAT_SEC
    is_tonal_drone = remaining_sec >= DRONE_TONAL_SEC
    if not (is_noisy_drone or is_tonal_drone):
        return _keep_natural_ending(samples, sample_rate)

    pad = int(sample_rate * 0.08)
    end = min(samples.size, last_speech + pad)
    # Never pinch just after the last syllable; only drop the long hold.
    if samples.size - end < int(sample_rate * 0.55):
        return _keep_natural_ending(samples, sample_rate)
    out = np.array(samples[:end], dtype=np.float32, copy=True)
    return fade_out(out, sample_rate, CLICK_FADE_MS)


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
    return fade_out(out, sample_rate, CLICK_FADE_MS)


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
