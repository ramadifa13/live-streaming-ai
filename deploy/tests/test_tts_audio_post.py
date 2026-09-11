import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
AUDIO_POST = ROOT / "backend" / "pocket_tts"
if str(AUDIO_POST) not in sys.path:
    sys.path.insert(0, str(AUDIO_POST))

from audio_post import audio_debug_metrics, cut_prompt_at_quiet_boundary


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
