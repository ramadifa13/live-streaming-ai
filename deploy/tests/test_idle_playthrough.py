import sys
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from av_timing import SAMPLE_RATE, bytes_for_frame, samples_for_frame
from ai_worker import (
    BOOT_IDLE_CLIP_NAME,
    CONTINUOUS_CLIP_NAME,
    IDLE_CLIP_NAME,
    QUEUE_WAIT_SEC,
    ClipAsset,
    LipSyncEngine,
    PlayState,
    RawFramePacket,
    VideoStateMachine,
    _MouthSlot,
    _advance_broadcast_clock,
    _broadcast_queue_wait,
)
from speech_bridge import SpeechBridge, UtteranceJob


class _Bank:
    def __init__(self, talk_frames=3, idle_frames=3, boot_frames=0):
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
        if boot_frames:
            self.clips[BOOT_IDLE_CLIP_NAME] = ClipAsset(
                name=BOOT_IDLE_CLIP_NAME,
                path="",
                frames=[
                    np.full((8, 8, 3), 40 + i, dtype=np.uint8)
                    for i in range(boot_frames)
                ],
                base_pose_frame=0,
                end_pose_frame=boot_frames - 1,
                seamless_score=1.0,
            )
        self._idle_name = IDLE_CLIP_NAME

    def get_clip(self, name):
        return self.clips.get(name)

    def clip_has_musetalk(self, name):
        return name in self.clips


def _enter_talk(sm):
    """Leave boot idle by feeding one speech packet so tests start on talk."""
    sm.next_packet(b"\1", True, whisper_idx=0)


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
    assert QUEUE_WAIT_SEC <= period + 1e-9


def test_advance_broadcast_clock_late_rebases_without_catchup():
    class _Metrics:
        def __init__(self):
            self.names = []

        def inc(self, name):
            self.names.append(name)

    metrics = _Metrics()
    period = 1.0 / 24.0
    now = 100.0
    on_time = _advance_broadcast_clock(now, period, metrics, now=now + period)
    assert on_time == now + period
    assert metrics.names == []
    _advance_broadcast_clock(now, period, metrics, now=now + period * 4)
    assert "broadcast_pacer_reset" in metrics.names
    assert "broadcast_lag_catchup" not in metrics.names
    assert "broadcast_seq_fast_forward" not in metrics.names


def test_go_live_loops_idle_until_pcm_then_talk():
    sm = VideoStateMachine(_Bank(talk_frames=3, idle_frames=3))
    assert sm.current_name == IDLE_CLIP_NAME
    assert sm.state is PlayState.IDLE
    seen = []
    for _ in range(6):
        pkt = sm.next_packet(b"\0" * 4, False, next_ready=True, speech_may_start=True)
        seen.append((pkt.clip_name, pkt.frame_idx, pkt.state))
    assert all(row[0] == IDLE_CLIP_NAME for row in seen)
    pkt = sm.next_packet(b"\1", True, whisper_idx=0)
    assert pkt.clip_name == IDLE_CLIP_NAME
    pkt = sm.next_packet(b"\1", True, whisper_idx=1)
    assert pkt.clip_name == CONTINUOUS_CLIP_NAME
    assert pkt.state is PlayState.TALK
    assert pkt.needs_lipsync is True


def test_boot_namira_idle_ignores_ready_until_pcm():
    sm = VideoStateMachine(_Bank(talk_frames=3, idle_frames=3, boot_frames=3))
    assert sm.current_name == BOOT_IDLE_CLIP_NAME
    seen = []
    for _ in range(6):
        pkt = sm.next_packet(b"\0" * 4, False, next_ready=True, speech_may_start=True)
        seen.append(pkt.clip_name)
    assert seen == [BOOT_IDLE_CLIP_NAME] * 6
    pkt = sm.next_packet(b"\1", True, whisper_idx=0)
    assert pkt.clip_name == BOOT_IDLE_CLIP_NAME
    pkt = sm.next_packet(b"\1", True, whisper_idx=1)
    assert pkt.clip_name == CONTINUOUS_CLIP_NAME
    assert sm.state is PlayState.TALK


def test_talk_end_without_pcm_uses_idle():
    sm = VideoStateMachine(_Bank(talk_frames=3, idle_frames=3))
    _enter_talk(sm)
    seen = []
    for _ in range(6):
        pkt = sm.next_packet(b"\0" * 4, False, next_ready=False)
        seen.append((pkt.clip_name, pkt.state))
    assert seen[0][0] == CONTINUOUS_CLIP_NAME
    assert all(name == IDLE_CLIP_NAME for name, _st in seen[1:])
    assert all(state is PlayState.IDLE for _name, state in seen[1:])


def test_silence_never_holds_talk_when_next_ready():
    sm = VideoStateMachine(_Bank(talk_frames=3, idle_frames=3))
    _enter_talk(sm)
    seen = []
    for _ in range(6):
        pkt = sm.next_packet(
            b"\0" * 4,
            False,
            next_ready=True,
            next_almost_ready=True,
            speech_may_start=True,
        )
        seen.append((pkt.clip_name, pkt.state, pkt.needs_lipsync))
    assert seen[0][0] == CONTINUOUS_CLIP_NAME
    assert all(name == IDLE_CLIP_NAME for name, _st, _lip in seen[1:])
    assert all(lip is False for _name, _st, lip in seen)


def test_pcm_keeps_talk_body_and_lipsync():
    sm = VideoStateMachine(_Bank(talk_frames=3, idle_frames=3))
    _enter_talk(sm)
    sm.begin_utterance()
    seen = []
    for i in range(6):
        pkt = sm.next_packet(bytes([i + 1]), True, whisper_idx=i, next_ready=False)
        seen.append((pkt.clip_name, pkt.needs_lipsync, pkt.is_speech, pkt.whisper_idx))
    assert all(name == CONTINUOUS_CLIP_NAME for name, *_rest in seen)
    assert all(lip is True for _n, lip, *_r in seen)
    assert [row[3] for row in seen] == list(range(6))


def test_idle_to_talk_resumes_continuous_index():
    sm = VideoStateMachine(_Bank(talk_frames=5, idle_frames=3))
    _enter_talk(sm)
    for i in range(3):
        sm.next_packet(b"\1", True, whisper_idx=i)
    saved = sm._continuous_idx
    sm.next_packet(b"\0", False)
    assert sm.current_name == IDLE_CLIP_NAME
    sm.next_packet(b"\1", True, whisper_idx=0)
    pkt = sm.next_packet(b"\1", True, whisper_idx=1)
    assert pkt.clip_name == CONTINUOUS_CLIP_NAME
    assert pkt.frame_idx == (saved + 1) % 5 or pkt.frame_idx > 0


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
    silences = [bridge.get_audio_chunk() for _ in range(bridge.BETWEEN_UTTERANCE_GAP_FRAMES)]
    assert all(item[1] is False for item in silences)
    assert bridge._current is current or bridge._current is None
    pcm, is_speech, idx = bridge.get_audio_chunk()
    assert pcm == b"C"
    assert is_speech is True
    assert idx == 0
    assert bridge._current is nxt


def test_ready_next_gets_idle_gap():
    bridge = SpeechBridge(output_folder="/tmp/ai_live_worker_test")
    assert 12 <= bridge.BETWEEN_UTTERANCE_GAP_FRAMES <= 24
    assert bridge.BETWEEN_UTTERANCE_GAP_FRAMES == 18
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

    first = bridge.get_audio_chunk()
    assert first[1] is False
    assert first[0] != b"C"
    assert bridge.in_between_utterance_gap() is True
    assert bridge.current_audio_phase() == "INTER_GAP"
    rest = [bridge.get_audio_chunk() for _ in range(bridge.BETWEEN_UTTERANCE_GAP_FRAMES - 1)]
    assert all(item[1] is False for item in rest)
    assert all(item[0] != b"C" for item in rest)
    assert bridge.in_between_utterance_gap() is False
    pcm, is_speech, idx = bridge.get_audio_chunk()
    assert pcm == b"C"
    assert is_speech is True
    assert idx == 0


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


def _ready_job(task_id: str) -> UtteranceJob:
    job = UtteranceJob(task_id=task_id, audio_path="")
    job.pcm_frames = [b"X"]
    job.num_frames = 1
    job.whisper_chunks = torch.zeros((1, 1))
    job.ready.set()
    job.lipsync_ready.set()
    job.lipsync_primed = True
    return job


def test_opening_gate_waits_three_then_rolls_one():
    bridge = SpeechBridge(output_folder="/tmp/ai_live_worker_test")
    assert bridge.MIN_READY_UTTERANCES == 3
    bridge._pending.append(_ready_job("task_1"))
    bridge._start_next_if_needed(allow_playback=True)
    assert bridge._current is None
    assert bridge._prequeue_gate_active is True
    bridge._pending.append(_ready_job("task_2"))
    bridge._pending.append(_ready_job("task_3"))
    bridge._start_next_if_needed(allow_playback=True)
    assert bridge._current is not None
    assert bridge._current.task_id == "task_1"
    assert bridge._ever_started is True
    assert bridge._prequeue_gate_active is False
    bridge._current = None
    bridge._frame_cursor = 0
    bridge._start_next_if_needed(allow_playback=True)
    assert bridge._current is not None
    assert bridge._current.task_id == "task_2"


def test_queue_underrun_after_speech_uses_idle_2s():
    sm = VideoStateMachine(_Bank(talk_frames=4, idle_frames=3))
    _enter_talk(sm)
    sm.begin_utterance()
    sm.next_packet(b"\1", True, whisper_idx=0)
    sm.end_utterance()
    seen = []
    for _ in range(6):
        pkt = sm.next_packet(b"\0" * 4, False, next_ready=False)
        seen.append((pkt.clip_name, pkt.needs_lipsync, pkt.is_speech))
    assert seen[0][0] == CONTINUOUS_CLIP_NAME
    assert all(name == IDLE_CLIP_NAME for name, _lip, _speech in seen[1:])
    assert all(lip is False for _name, lip, _speech in seen)
    assert all(speech is False for _name, _lip, speech in seen)


def test_twelve_utterances_keep_forward_body_index():
    sm = VideoStateMachine(_Bank(talk_frames=8, idle_frames=3))
    _enter_talk(sm)
    last_idx = None
    talk_count = 0
    for utterance in range(12):
        sm.begin_utterance()
        uttered = 0
        prev_in_utt = None
        for i in range(12):
            pkt = sm.next_packet(bytes([utterance + 1]), True, whisper_idx=i)
            if pkt.clip_name != CONTINUOUS_CLIP_NAME:
                prev_in_utt = None
                continue
            assert pkt.needs_lipsync is True
            if prev_in_utt is not None:
                assert pkt.frame_idx == (prev_in_utt + 1) % 8
            if last_idx is not None and pkt.frame_idx < last_idx:
                # Idle can consume the last clip frame, so wrap may resume at 0
                # from 6 rather than from 7. Snapping back from mid-clip is not allowed.
                assert last_idx >= 6
            last_idx = pkt.frame_idx
            prev_in_utt = pkt.frame_idx
            uttered += 1
            talk_count += 1
            if uttered >= 3:
                break
        assert uttered >= 3
        sm.end_utterance()
        sm.next_packet(b"\0", False)
    assert talk_count >= 36
