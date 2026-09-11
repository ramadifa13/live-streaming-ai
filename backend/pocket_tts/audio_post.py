from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from scipy.signal import butter, resample_poly, sosfiltfilt

PROMPT_SAMPLE_RATE = 24000
MAX_PROMPT_SECONDS = 12
ONSET_FADE_MS = 20
TRAIL_FADE_MS = 400
TRAIL_DECAY_MS = 220
TRAIL_PLATEAU_MS = 160
TRAIL_MAX_TRIM_SEC = 4.0
TRAIL_MAX_TRIM_RATIO = 0.5
PROMPT_EDGE_FADE_MS = 12


def audio_filter_enabled() -> bool:
    return os.environ.get("POCKET_TTS_AUDIO_FILTER", "0").strip() not in (
        "0",
        "false",
        "no",
        "off",
        "",
    )


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


def trim_trailing_buzz(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    """Cut a loud flat vocoder drone after the last speech peak, then fade out."""
    if samples.size < max(8, sample_rate // 4):
        return samples
    win = max(1, int(sample_rate * 0.02))
    env = np.convolve(np.abs(samples), np.ones(win, dtype=np.float32) / win, mode="same")
    peak = float(np.max(env)) if env.size else 0.0
    if peak <= 1e-5:
        return samples
    strong = max(0.06, peak * 0.22)
    weak = max(0.02, peak * 0.07)
    strong_idx = np.flatnonzero(env > strong)
    if strong_idx.size == 0:
        return samples
    last_strong = int(strong_idx[-1])
    search_from = min(samples.size, last_strong + int(sample_rate * TRAIL_DECAY_MS / 1000))
    hop = max(1, win)
    plateau_need = int(sample_rate * TRAIL_PLATEAU_MS / 1000)
    end = samples.size
    plateau_start = None
    plateau_len = 0
    i = search_from
    while i + hop <= samples.size:
        seg = env[i : i + hop]
        mean = float(np.mean(seg))
        std = float(np.std(seg))
        cv = std / max(mean, 1e-6)
        if mean < weak:
            end = i
            break
        if mean < strong and cv < 0.28:
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
    max_trim = min(int(sample_rate * TRAIL_MAX_TRIM_SEC), int(samples.size * TRAIL_MAX_TRIM_RATIO))
    min_end = max(int(sample_rate * 0.5), samples.size - max_trim)
    end = max(min(end, samples.size), min_end)
    out = np.array(samples[:end], dtype=np.float32, copy=True)
    return fade_out(out, sample_rate)


def limit_peak(samples: np.ndarray, ceiling: float = 0.98) -> np.ndarray:
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak > ceiling:
        samples = (samples * (ceiling / peak)).astype(np.float32)
    return samples


def apply_optional_filter(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    if not audio_filter_enabled() or samples.size < sample_rate // 4:
        return samples
    high_pass = butter(2, 35, btype="highpass", fs=sample_rate, output="sos")
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
    active = np.flatnonzero(envelope > max(0.008, peak * 0.06))
    if active.size:
        pad = int(source_rate * 0.12)
        samples = samples[max(0, int(active[0]) - pad) : min(samples.size, int(active[-1]) + pad)]

    samples = cut_prompt_at_quiet_boundary(samples, source_rate)
    if source_rate != PROMPT_SAMPLE_RATE:
        samples = resample_poly(samples, PROMPT_SAMPLE_RATE, source_rate).astype(np.float32)
    samples = smooth_onset(samples, PROMPT_SAMPLE_RATE, PROMPT_EDGE_FADE_MS)
    samples = fade_out(samples, PROMPT_SAMPLE_RATE, PROMPT_EDGE_FADE_MS)
    samples = limit_peak(samples, 0.95)
    if float(np.max(np.abs(samples))) <= 1e-5:
        raise ValueError("Reference voice tidak memiliki sinyal suara")
    return torch.from_numpy(samples).unsqueeze(0)


def postprocess_generated(samples: np.ndarray, source_sample_rate: int, output_sample_rate: int) -> tuple[np.ndarray, int]:
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
    samples = limit_peak(samples)
    return samples, out_rate


def audio_debug_metrics(samples: np.ndarray, sample_rate: int) -> dict:
    x = np.asarray(samples, dtype=np.float32)
    if x.size == 0:
        return {"dc": 0.0, "rms_onset": 0.0, "rms_tail": 0.0, "hf_spike": 0.0, "duration_sec": 0.0}
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
    }
