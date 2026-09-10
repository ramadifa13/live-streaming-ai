import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from av_timing import FPS, SAMPLE_RATE, bytes_for_frame, samples_for_frame


def test_shared_clock_has_no_cumulative_sample_drift():
    frames = FPS * 60
    total = sum(samples_for_frame(i) for i in range(frames))
    assert total == SAMPLE_RATE * 60
    assert {samples_for_frame(i) for i in range(FPS)} == {SAMPLE_RATE // FPS}


def test_pcm_packets_are_stereo_s16le_aligned():
    assert all(bytes_for_frame(i) % 4 == 0 for i in range(FPS * 2))
