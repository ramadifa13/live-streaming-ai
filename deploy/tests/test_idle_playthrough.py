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
    LipSyncEngine,
    PlayState,
    RawFramePacket,
    VideoStateMachine,
    _MouthSlot,
    _broadcast_queue_wait,
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


def _skip_boot_idle(sm, idle_frames=3):
    """Drain the opening idle cycle with READY set so tests start on talk."""
    for _ in range(idle_frames):
        sm.next_packet(b"\0" * 4, False, next_ready=True)


def test_clock_stays_24fps_48k():
    assert samples_for_frame(0) == 2000
    assert SAMPLE_RATE == 48_000
    assert bytes_for_frame(0) == 2000 * 2 * 2


def test_broadcast_wait_never_stalls_past_one_frame():
    period = 1.0 / 24.0
    now = 100.0
    assert _broadcast_queue_wait(now + 5.0, period, now=now) == period
    assert _broadcast_queue_wait(now - 1.0, period, now=now) == 0.0
    half = _broadcast_queue_wait(now + period * 0.5, period, now=now)
    assert 0.0 < half <= period


def test_go_live_loops_idle_until_ready_then_talk():
    sm = VideoStateMachine(_Bank(talk_frames=3, idle_frames=3))
    assert sm.current_name == IDLE_CLIP_NAME
    assert sm.state is PlayState.IDLE
    assert sm.allows_next_utterance_start() is False
    seen = []
    for i in range(7):
        pkt = sm.next_packet(b"\0" * 4, False, next_ready=(i >= 2))
        seen.append((pkt.clip_name, pkt.frame_idx, pkt.state))
    assert [row[0] for row in seen[:3]] == [IDLE_CLIP_NAME] * 3
    assert [row[1] for row in seen[:3]] == [0, 1, 2]
    assert seen[3][0] == CONTINUOUS_CLIP_NAME
    assert seen[3][2] is PlayState.TALK
    assert sm.allows_next_utterance_start() is True


def test_talk_end_without_ready_plays_full_idle_cycles():
    sm = VideoStateMachine(_Bank(talk_frames=3, idle_frames=3))
    _skip_boot_idle(sm)
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
    _skip_boot_idle(sm)
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


def test_leftover_speech_keeps_talking_across_idle_loops():
    sm = VideoStateMachine(_Bank(talk_frames=3, idle_frames=3))
    _skip_boot_idle(sm)
    sm.begin_utterance()
    seen = []
    for i in range(12):
        pcm = bytes([i + 1])
        pkt = sm.next_packet(pcm, True, whisper_idx=i, next_ready=False)
        seen.append(
            (
                pkt.clip_name,
                pkt.frame_idx,
                pkt.needs_lipsync,
                pkt.is_speech,
                pkt.whisper_idx,
                pkt.audio_pcm,
            )
        )
    assert [row[0] for row in seen[:3]] == [CONTINUOUS_CLIP_NAME] * 3
    idle = seen[3:]
    assert [row[0] for row in idle] == [IDLE_CLIP_NAME] * 9
    assert [row[1] for row in idle] == [0, 1, 2, 0, 1, 2, 0, 1, 2]
    assert all(row[2] is True for row in seen)
    assert all(row[3] is True for row in seen)
    assert [row[4] for row in seen] == list(range(12))
    assert [row[5] for row in seen] == [bytes([i + 1]) for i in range(12)]


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


def test_idle_gate_does_not_cut_remaining_pcm():
    bridge = SpeechBridge(output_folder="/tmp/ai_live_worker_test")
    current = UtteranceJob(task_id="task_tail", audio_path="")
    current.pcm_frames = [b"A", b"B", b"C"]
    current.num_frames = 3
    current.whisper_chunks = torch.zeros((3, 1))
    current.ready.set()
    current.lipsync_ready.set()
    current.lipsync_primed = True
    current.error = ""
    bridge._current = current
    bridge._frame_cursor = 0
    bridge._ever_started = True
    bridge.set_visual_gate(lambda: False)

    nxt = UtteranceJob(task_id="task_next", audio_path="")
    nxt.pcm_frames = [b"Z"]
    nxt.num_frames = 1
    nxt.whisper_chunks = torch.zeros((1, 1))
    nxt.ready.set()
    nxt.lipsync_ready.set()
    nxt.lipsync_primed = True
    nxt.error = ""
    bridge._pending.append(nxt)

    heard = [bridge.get_audio_chunk() for _ in range(3)]
    assert [item[0] for item in heard] == [b"A", b"B", b"C"]
    assert all(item[1] is True for item in heard)
    silence, is_speech, idx = bridge.get_audio_chunk()
    assert is_speech is False
    assert idx is None
    assert silence != b"Z"
    assert bridge._current is current
    assert list(bridge._pending)[0] is nxt


def _engine_with_slots():
    engine = LipSyncEngine(
        {"device": "cpu", "weight_dtype": torch.float32},
        _Bank(),
        batch_size=1,
    )
    playing = _MouthSlot(
        utterance_id="task_a",
        whisper_chunks=torch.zeros((160, 1)),
        talk_clip_name=CONTINUOUS_CLIP_NAME,
    )
    playing.mouths[0] = np.zeros((8, 8, 3), dtype=np.uint8)
    playing.infer_cursor = 160
    upcoming = _MouthSlot(
        utterance_id="task_b",
        whisper_chunks=torch.zeros((200, 1)),
        talk_clip_name=CONTINUOUS_CLIP_NAME,
    )
    upcoming.infer_cursor = 10
    engine._slots["task_a"] = playing
    engine._slots["task_b"] = upcoming
    engine._active_id = "task_a"
    engine._utterance_id = "task_b"
    return engine, playing, upcoming


def test_slot_for_does_not_steal_upcoming_cache():
    engine, playing, upcoming = _engine_with_slots()
    assert engine._slot_for("task_a") is playing
    assert engine._slot_for("task_b") is upcoming
    assert engine._slot_for("task_gone") is None


def test_missing_mouth_does_not_raise_or_use_wrong_slot():
    engine, playing, _upcoming = _engine_with_slots()
    body = np.full((8, 8, 3), 7, dtype=np.uint8)
    pkt = RawFramePacket(
        seq=1486,
        frame=body,
        clip_name=CONTINUOUS_CLIP_NAME,
        frame_idx=157,
        cycle_idx=157,
        state=PlayState.TALK,
        needs_lipsync=True,
        audio_pcm=b"\0" * 4,
        is_speech=True,
        whisper_idx=157,
        utterance_id="task_a",
    )
    clip = engine.bank.get_clip(CONTINUOUS_CLIP_NAME)
    out = engine.process(pkt, clip)
    assert out is not None
    assert out.shape == body.shape
    gone = RawFramePacket(
        seq=1487,
        frame=body,
        clip_name=CONTINUOUS_CLIP_NAME,
        frame_idx=157,
        cycle_idx=157,
        state=PlayState.TALK,
        needs_lipsync=True,
        audio_pcm=b"\0" * 4,
        is_speech=True,
        whisper_idx=157,
        utterance_id="task_gone",
    )
    out_gone = engine.process(gone, clip)
    assert np.array_equal(out_gone, body)
