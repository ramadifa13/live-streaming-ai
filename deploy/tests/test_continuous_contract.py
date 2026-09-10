import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ai_worker import (
    CONTINUOUS_CLIP_NAME,
    ClipAsset,
    PlayState,
    VideoStateMachine,
)


class _Bank:
    def __init__(self):
        frames = [
            np.full((8, 8, 3), value, dtype=np.uint8) for value in (10, 20, 10)
        ]
        self.clips = {
            CONTINUOUS_CLIP_NAME: ClipAsset(
                name=CONTINUOUS_CLIP_NAME,
                path="",
                frames=frames,
                base_pose_frame=0,
                end_pose_frame=2,
                seamless_score=1.0,
            )
        }
        self._idle_name = CONTINUOUS_CLIP_NAME

    def get_clip(self, name):
        return self.clips.get(name)

    def clip_has_musetalk(self, name):
        return name == CONTINUOUS_CLIP_NAME


def test_body_index_is_strictly_forward_and_wraps_without_idle():
    sm = VideoStateMachine(_Bank())
    seen = []
    for _ in range(7):
        packet = sm.next_packet(b"\0" * 4, False)
        seen.append(packet.frame_idx)
        assert packet.state is PlayState.TALK
        assert packet.clip_name == CONTINUOUS_CLIP_NAME
    assert seen == [0, 1, 2, 0, 1, 2, 0]


def test_utterance_lifecycle_never_resets_body_index():
    sm = VideoStateMachine(_Bank())
    sm.next_packet(b"\0" * 4, False)
    before = sm.frame_idx
    sm.pin_talk_body("task")
    sm.begin_utterance()
    sm.end_utterance()
    assert sm.frame_idx == before
    assert sm.state is PlayState.TALK


def test_compute_body_matte_thins_white_halo():
    scripts = ROOT / "scripts"
    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))
    from compile_continuous_timeline import compute_body_matte

    frame = np.full((64, 64, 3), 250, dtype=np.uint8)
    frame[16:48, 16:48] = (40, 40, 40)
    matte = compute_body_matte(frame)
    assert matte.shape == (64, 64)
    assert matte[0, 0] < 40
    assert matte[32, 32] > 200
    # Inward erode should keep a thin dark edge instead of a white halo ring.
    assert int(matte[16, 32]) <= int(matte[32, 32])
