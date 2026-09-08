import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from speech_bridge import _split_pcm_frames


def test_split_pcm_frames_does_not_append_silence_tail():
    pcm = b"\x00" * (667 * 2 * 2)

    frames = _split_pcm_frames(pcm)

    assert sum(len(frame) for frame in frames) == len(pcm)
    assert all(frame[:1] == b"\x00" for frame in frames)
    assert len(frames) >= 1
