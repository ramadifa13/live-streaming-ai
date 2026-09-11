import sys
import time
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from speech_bridge import (
    SpeechBridge,
    UtteranceJob,
    _apply_pcm_edge_fades,
    _split_pcm_frames,
    build_live_script,
    ensure_no_idle_policy,
)


def test_split_pcm_frames_keeps_partial_tail_without_cutting_audio():
    pcm = b"\x00" * (2000 * 2 * 2)

    frames = _split_pcm_frames(pcm)

    joined = b"".join(frames)
    assert joined.startswith(pcm)
    assert len(joined) - len(pcm) < len(frames[-1])
    assert all(frame[:1] == b"\x00" for frame in frames)
    assert len(frames) >= 1


def test_pcm_edge_fades_keep_frame_sizes_and_only_soften_edges():
    frame = b"\x00\x40" * (2000 * 2)
    frames = [frame for _ in range(24)]
    faded = _apply_pcm_edge_fades(frames, fade_frames=3)

    assert len(faded) == 24
    assert all(len(item) == len(frame) for item in faded)
    assert faded[12] == frame
    assert faded[0] != frame
    assert faded[-1] != frame


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


def test_prerender_runs_before_playback_is_armed():
    bridge = SpeechBridge(output_folder="/tmp/ai_live_worker_test")
    job = UtteranceJob(task_id="task_prerender", audio_path="")
    job.pcm_frames = [b"A"]
    job.num_frames = 1
    job.whisper_chunks = torch.zeros((1, 1))
    job.ready.set()
    bridge._pending.append(job)
    bridge.set_callbacks(on_ready=lambda ready_job: ready_job.lipsync_ready.set())

    bridge._start_next_if_needed(allow_playback=False)

    assert bridge._current is None
    assert job.lipsync_primed is True
    assert job.lipsync_ready.is_set()
    assert bridge.ready_pending_count() == 1
    assert list(bridge._pending) == [job]

    # Opening gate (3 READY) still holds the first sentence even after arm.
    bridge._start_next_if_needed(allow_playback=True)
    assert bridge._current is None
    assert list(bridge._pending) == [job]


def test_prime_upcoming_while_current_is_playing():
    bridge = SpeechBridge(output_folder="/tmp/ai_live_worker_test")
    current = UtteranceJob(task_id="task_n", audio_path="")
    current.pcm_frames = [b"A", b"B"]
    current.num_frames = 2
    current.whisper_chunks = torch.zeros((2, 1))
    current.ready.set()
    current.lipsync_ready.set()
    current.lipsync_primed = True
    bridge._current = current
    bridge._frame_cursor = 0
    bridge._ever_started = True

    nxt = UtteranceJob(task_id="task_n1", audio_path="")
    nxt.pcm_frames = [b"C"]
    nxt.num_frames = 1
    nxt.whisper_chunks = torch.zeros((1, 1))
    nxt.ready.set()
    primed = []

    def _on_ready(ready_job):
        primed.append(ready_job.task_id)
        ready_job.lipsync_ready.set()

    bridge._pending.append(nxt)
    bridge.set_callbacks(on_ready=_on_ready)

    bridge._start_next_if_needed(allow_playback=True)

    assert bridge._current is current
    assert nxt.lipsync_primed is True
    assert primed == ["task_n1"]
    assert nxt.lipsync_ready.is_set()


def test_playback_takes_ready_next_without_waiting_for_visual_tail():
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

    silences = [bridge.get_audio_chunk() for _ in range(bridge.BETWEEN_UTTERANCE_GAP_FRAMES)]
    assert all(item[1] is False for item in silences)
    assert all(item[2] is None for item in silences)
    assert bridge._current is current

    pcm, is_speech, idx = bridge.get_audio_chunk()

    assert pcm == b"C"
    assert is_speech is True
    assert idx == 0
    assert bridge._current is nxt
