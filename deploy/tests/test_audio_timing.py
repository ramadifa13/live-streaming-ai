import sys
import time
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from speech_bridge import (
    SpeechBridge,
    _split_pcm_frames,
    build_live_script,
    ensure_no_idle_policy,
)


def test_split_pcm_frames_keeps_partial_tail_without_cutting_audio():
    pcm = b"\x00" * (667 * 2 * 2)

    frames = _split_pcm_frames(pcm)

    joined = b"".join(frames)
    assert joined.startswith(pcm)
    assert len(joined) - len(pcm) < len(frames[-1])
    assert all(frame[:1] == b"\x00" for frame in frames)
    assert len(frames) >= 1


def test_hard_deadline_does_not_cut_active_pcm():
    bridge = SpeechBridge(output_folder="/tmp/ai_live_worker_test")
    bridge._current = type("Job", (), {})()
    bridge._current.task_id = "task_deadline_guard"
    bridge._current.pcm_frames = [b"A", b"B", b"C", b"D"]
    bridge._current.num_frames = 4
    bridge._current.whisper_chunks = torch.zeros((4, 1))
    bridge._current.audio_path = ""
    bridge._current.action = "talk"
    bridge._current.ready = type("Ready", (), {"is_set": lambda self: True})()
    bridge._current.lipsync_ready = type("Ready", (), {"is_set": lambda self: True})()
    bridge._current.error = ""
    bridge._frame_cursor = 0
    bridge._audio_exhausted = False
    bridge._awaiting_visual_tail = False
    bridge._active_deadline = time.monotonic() - 1.0
    bridge._ever_started = True

    pcm, is_speech, idx = bridge.get_audio_chunk()

    assert pcm == b"A"
    assert is_speech is True
    assert idx == 0
    assert bridge._current is not None
    assert bridge._frame_cursor == 1


def test_script_is_not_rewritten_for_continuous_video_mode():
    raw = "Baik teman-teman hari ini saya ingin menjelaskan bahwa keberhasilan itu tidak datang dari satu langkah besar tetapi dari konsistensi kecil yang kita lakukan setiap hari."
    fixed = build_live_script(raw)

    assert fixed == raw


def test_idle_policy_keeps_talk_when_queue_still_has_work():
    keep_talk, enter_idle = ensure_no_idle_policy(
        queue_has_work=True,
        current_pcm_remaining=False,
        current_audio_done=True,
        visual_tail_active=False,
        idle_since=None,
        now=None,
    )

    assert keep_talk is True
    assert enter_idle is False


def test_ready_count_requires_full_mouth_prerender():
    bridge = SpeechBridge(output_folder="/tmp/ai_live_worker_test")
    job = type("Job", (), {})()
    job.ready = type("Ready", (), {"is_set": lambda self: True})()
    job.lipsync_ready = type(
        "MouthReady", (), {"is_set": lambda self: self.value}
    )()
    job.lipsync_ready.value = False
    job.error = ""
    job.num_frames = 24
    job.whisper_chunks = torch.zeros((24, 1))
    bridge._pending.append(job)

    assert bridge.ready_pending_count() == 0
    assert bridge.queued_audio_seconds() == 0
    job.lipsync_ready.value = True
    assert bridge.ready_pending_count() == 1
    assert bridge.queued_audio_seconds() == 1.0
