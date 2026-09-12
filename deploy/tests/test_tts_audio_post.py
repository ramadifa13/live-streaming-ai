import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
AUDIO_POST = ROOT / "backend" / "pocket_tts"
if str(AUDIO_POST) not in sys.path:
    sys.path.insert(0, str(AUDIO_POST))

from audio_post import audio_debug_metrics, cut_prompt_at_quiet_boundary, trim_trailing_buzz


def test_audio_debug_metrics_report_dc_onset_tail_and_hf():
    sr = 24000
    dc = np.full(sr, 0.05, dtype=np.float32)
    metrics = audio_debug_metrics(dc, sr)
    assert metrics["dc"] > 0.04
    assert metrics["duration_sec"] == 1.0
    assert "rms_onset" in metrics
    assert "rms_tail" in metrics
    assert "hf_spike" in metrics


def test_prompt_cut_uses_quiet_boundary_instead_of_hard_12s():
    sr = 24000
    samples = np.zeros(sr * 14, dtype=np.float32)
    samples[: sr * 3] = 0.2
    cut = cut_prompt_at_quiet_boundary(samples, sr, max_seconds=12)
    assert cut.size <= sr * 12
    assert cut.size >= int(sr * 1.5)


def test_trim_keeps_natural_speech_ending_without_long_drone():
    sr = 24000
    # 8s of speech-like varying energy, short quiet fade — must not be chopped short.
    t = np.linspace(0, 8.0, sr * 8, dtype=np.float32)
    speech = (0.25 * np.sin(2 * np.pi * 180 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * t))).astype(
        np.float32
    )
    out = trim_trailing_buzz(speech, sr)
    assert out.size / sr >= 7.2


def test_trim_cuts_long_flat_drone_after_speech():
    sr = 24000
    speech = (0.35 * np.sin(2 * np.pi * np.linspace(0, 6, sr * 6) * 160)).astype(np.float32)
    # Amplitude modulation so speech is not a flat plateau.
    speech *= (0.55 + 0.45 * np.sin(2 * np.pi * np.linspace(0, 6, sr * 6) * 4)).astype(np.float32)
    drone = np.full(sr * 6, 0.08, dtype=np.float32)
    samples = np.concatenate([speech, drone])
    out = trim_trailing_buzz(samples, sr)
    assert out.size / sr < 8.5
    assert out.size / sr > 5.0


def test_trim_keeps_long_decaying_sentence_at_full_level():
    sr = 24000
    dur = 14.0
    t = np.linspace(0, dur, int(sr * dur), dtype=np.float32)
    envelope = (0.55 + 0.45 * np.sin(2 * np.pi * 3.2 * t)).astype(np.float32)
    decay = np.clip(1.15 - 0.16 * t, 0.22, 1.0).astype(np.float32)
    speech = (0.28 * np.sin(2 * np.pi * 175 * t) * envelope * decay).astype(np.float32)
    out = trim_trailing_buzz(speech, sr)
    assert out.size / sr >= 13.5
    tail = out[-int(sr * 0.25) :]
    src_tail = speech[-int(sr * 0.25) :]
    assert float(np.max(np.abs(tail))) > 0.02
    assert float(np.max(np.abs(tail))) >= float(np.max(np.abs(src_tail))) * 0.92
