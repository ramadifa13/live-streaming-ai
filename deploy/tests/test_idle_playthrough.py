import sys
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from av_timing import SAMPLE_RATE, bytes_for_frame, samples_for_frame
from ai_worker import (
    CONTINUOUS_CLIP_NAME,
    IDLE_CLIP_NAME,
    ClipAsset,
    PlayState,
    VideoStateMachine,
)
from speech_bridge import SpeechBridge, UtteranceJob


class _Bank:
    def __init__(self, talk_frames=3, idle_frames=3):
        self.clips = {
            CONTINUOUS_CLIP_NAME: ClipAsset(
                name=CONTINUOUS_CLIP_NAME,
                path="",
                frames=[
                    np.full((8, 8, 3), 10 + i, dtype=np.uint8)
                    for i in range(talk_frames)
                ],
                base_pose_frame=0,
                end_pose_frame=talk_frames - 1,
                seamless_score=1.0,
            ),
            IDLE_CLIP_NAME: ClipAsset(
                name=IDLE_CLIP_NAME,
                path="",
                frames=[
                    np.full((8, 8, 3), 80 + i, dtype=np.uint8)
                    for i in range(idle_frames)
                ],
                base_pose_frame=0,
                end_pose_frame=idle_frames - 1,
                seamless_score=1.0,
            ),
        }
        self._idle_name = IDLE_CLIP_NAME

    def get_clip(self, name):
        return self.clips.get(name)

    def clip_has_musetalk(self, name):
        return name in self.clips


def test_clock_stays_24fps_48k():
    assert samples_for_frame(0) == 2000
    assert SAMPLE_RATE == 48_000
    assert bytes_for_frame(0) == 2000 * 2 * 2


def test_talk_end_without_ready_plays_full_idle_cycles():
    sm = VideoStateMachine(_Bank(talk_frames=3, idle_frames=3))
    seen = []
    for _ in range(9):
        pkt = sm.next_packet(b"\0" * 4, False, next_ready=False)
        seen.append((pkt.clip_name, pkt.frame_idx))
    assert seen[:3] == [
        (CONTINUOUS_CLIP_NAME, 0),
        (CONTINUOUS_CLIP_NAME, 1),
        (CONTINUOUS_CLIP_NAME, 2),
    ]
    assert seen[3:6] == [
        (IDLE_CLIP_NAME, 0),
        (IDLE_CLIP_NAME, 1),
        (IDLE_CLIP_NAME, 2),
    ]
    assert seen[6:9] == [
        (IDLE_CLIP_NAME, 0),
        (IDLE_CLIP_NAME, 1),
        (IDLE_CLIP_NAME, 2),
    ]
    assert sm.allows_next_utterance_start() is False


def test_ready_mid_idle_waits_for_cycle_then_talk():
    sm = VideoStateMachine(_Bank(talk_frames=3, idle_frames=3))
    seen = []
    for i in range(9):
        next_ready = i >= 4
        pkt = sm.next_packet(b"\0" * 4, False, next_ready=next_ready)
        seen.append((pkt.clip_name, pkt.frame_idx, pkt.state))
    idle_run = [(n, idx) for n, idx, _st in seen if n == IDLE_CLIP_NAME]
    assert idle_run[:3] == [(IDLE_CLIP_NAME, 0), (IDLE_CLIP_NAME, 1), (IDLE_CLIP_NAME, 2)]
    assert seen[-1][0] == CONTINUOUS_CLIP_NAME
    assert seen[-1][2] is PlayState.TALK
    assert sm.allows_next_utterance_start() is True


def test_leftover_speech_moves_to_idle_with_lipsync():
    sm = VideoStateMachine(_Bank(talk_frames=3, idle_frames=3))
    sm.begin_utterance()
    seen = []
    for i in range(6):
        pkt = sm.next_packet(b"\0" * 4, True, whisper_idx=i, next_ready=False)
        seen.append((pkt.clip_name, pkt.frame_idx, pkt.needs_lipsync))
    assert seen[:3] == [
        (CONTINUOUS_CLIP_NAME, 0, True),
        (CONTINUOUS_CLIP_NAME, 1, True),
        (CONTINUOUS_CLIP_NAME, 2, True),
    ]
    assert seen[3:] == [
        (IDLE_CLIP_NAME, 0, True),
        (IDLE_CLIP_NAME, 1, True),
        (IDLE_CLIP_NAME, 2, True),
    ]


def test_visual_gate_blocks_next_sentence_until_idle_done():
    bridge = SpeechBridge(output_folder="/tmp/ai_live_worker_test")
    current = UtteranceJob(task_id="task_n", audio_path="")
    current.pcm_frames = [b"A"]
    current.num_frames = 1
    current.whisper_chunks = torch.zeros((1, 1))
    current.ready.set()
    current.lipsync_ready.set()
    current.lipsync_primed = True
    bridge._current = current
    bridge._frame_cursor = 1
    bridge._ever_started = True

    nxt = UtteranceJob(task_id="task_n1", audio_path="")
    nxt.pcm_frames = [b"C"]
    nxt.num_frames = 1
    nxt.whisper_chunks = torch.zeros((1, 1))
    nxt.ready.set()
    nxt.lipsync_ready.set()
    nxt.lipsync_primed = True
    bridge._pending.append(nxt)

    gate = {"allow": False}
    bridge.set_visual_gate(lambda: gate["allow"])

    pcm, is_speech, idx = bridge.get_audio_chunk()
    assert is_speech is False
    assert bridge._current is current or bridge._current is None
    assert list(bridge._pending)[0] is nxt

    gate["allow"] = True
    pcm, is_speech, idx = bridge.get_audio_chunk()
    assert pcm == b"C"
    assert is_speech is True
    assert idx == 0
    assert bridge._current is nxt
