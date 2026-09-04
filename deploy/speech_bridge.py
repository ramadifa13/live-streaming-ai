"""Bridge antara API server (TTS audio + LLM action) dan AIVisualWorker.

Utterance masuk lewat ``enqueue()`` → PCM + Whisper chunks diprecompute di
background → ``get_audio_chunk()`` / ``get_llm_action()`` dipanggil oleh
thread FrameFetcher pada setiap tick 30 FPS.
"""

from __future__ import annotations

import os
import re
import subprocess
import tempfile
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Callable, Deque, List, Optional, Tuple

import numpy as np
import torch

try:
    from ffseg import audio_to_pcm_s16le
except ImportError:
    audio_to_pcm_s16le = None  # type: ignore

try:
    from worker_telemetry import get_telemetry
except ImportError:
    class _NoopTelemetry:
        def measure(self, _name: str):
            from contextlib import nullcontext
            return nullcontext()

    def get_telemetry():  # type: ignore
        return _NoopTelemetry()

TARGET_FPS = int(os.environ.get("AI_WORKER_FPS", os.environ.get("FRAME_FEED_FPS", "30")))
SAMPLE_RATE = 44100
SAMPLES_PER_FRAME = int(round(SAMPLE_RATE / float(TARGET_FPS)))
BYTES_PER_AUDIO_FRAME = SAMPLES_PER_FRAME * 2 * 2


def _sequence_key(task_id: str):
    match = re.match(r"^(prio_)?task_(\d{10,})_", task_id or "")
    if match:
        rank = 0 if match.group(1) else 1
        return (rank, int(match.group(2)), task_id)
    return (2, 0, task_id)


def _normalize_to_16k_wav(src_path: str) -> str:
    """Konversi audio apa pun ke mono 16 kHz PCM WAV (untuk Whisper)."""
    fd, dst = tempfile.mkstemp(suffix="_16k.wav", prefix="utter_")
    os.close(fd)
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-i", src_path,
        "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le",
        dst,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=60)
        return dst
    except Exception:
        if os.path.exists(dst):
            os.remove(dst)
        raise


def _feature_debug_shape(obj) -> str:
    if obj is None:
        return "None"
    if torch.is_tensor(obj):
        return str(tuple(obj.shape))
    if isinstance(obj, (list, tuple)):
        n = len(obj)
        first = obj[0] if n else None
        if torch.is_tensor(first):
            inner = tuple(first.shape)
        else:
            inner = getattr(first, "shape", type(first).__name__)
        return f"list[{n}] first={inner}"
    return type(obj).__name__


def _as_whisper_feature_list(raw_features):
    """MuseTalk get_audio_feature mengembalikan list of mel tensors (bukan satu Tensor).

    get_whisper_chunk melakukan ``for segment in features`` — jangan di-stack.
    """
    if raw_features is None:
        raise ValueError("Whisper features kosong")
    if hasattr(raw_features, "input_features") and not torch.is_tensor(raw_features):
        raw_features = raw_features.input_features
    elif isinstance(raw_features, dict) and "input_features" in raw_features:
        raw_features = raw_features["input_features"]

    if torch.is_tensor(raw_features):
        items = [raw_features]
    elif isinstance(raw_features, (list, tuple)):
        if not raw_features:
            raise ValueError("Whisper features list kosong")
        items = list(raw_features)
    else:
        items = [raw_features]

    out = []
    for item in items:
        if not torch.is_tensor(item):
            item = torch.as_tensor(np.asarray(item, dtype=np.float32))
        if item.dim() == 2:
            item = item.unsqueeze(0)
        out.append(item)
    return out


def _extract_pcm_stereo(audio_path: str, sample_rate: int = SAMPLE_RATE) -> bytes:
    if audio_to_pcm_s16le is not None:
        return audio_to_pcm_s16le(audio_path, sample_rate=sample_rate, channels=2)
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-i", audio_path,
        "-f", "s16le", "-acodec", "pcm_s16le",
        "-ac", "2", "-ar", str(sample_rate),
        "pipe:1",
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=120)
    if proc.returncode == 0 and proc.stdout:
        return proc.stdout
    return b""


def _split_pcm_frames(pcm: bytes, bytes_per_frame: int = BYTES_PER_AUDIO_FRAME) -> List[bytes]:
    if not pcm:
        return []
    frames = []
    pos = 0
    total = len(pcm)
    while pos < total:
        chunk = pcm[pos : pos + bytes_per_frame]
        if len(chunk) < bytes_per_frame:
            chunk = chunk + b"\x00" * (bytes_per_frame - len(chunk))
        frames.append(chunk)
        pos += bytes_per_frame
    return frames


@dataclass
class UtteranceJob:
    task_id: str
    audio_path: str
    action: Optional[str] = None
    priority: bool = False
    pcm_frames: List[bytes] = field(default_factory=list)
    whisper_chunks: Optional[torch.Tensor] = None
    num_frames: int = 0
    ready: threading.Event = field(default_factory=threading.Event)
    lipsync_ready: threading.Event = field(default_factory=threading.Event)
    lipsync_primed: bool = False
    primed_at: float = 0.0
    error: str = ""
    created_at: float = field(default_factory=time.time)


class SpeechBridge:
    """Antrian utterance + streaming PCM per frame."""

    def __init__(self, output_folder: str = ""):
        self.output_folder = output_folder or os.environ.get(
            "OUTPUT_FOLDER", "/workspace/ai_live_worker/output"
        )
        self._pending: Deque[UtteranceJob] = deque()
        self._current: Optional[UtteranceJob] = None
        self._frame_cursor = 0
        self._lock = threading.Lock()
        self._models = None
        self._on_utterance_start: Optional[Callable[[UtteranceJob], None]] = None
        self._on_utterance_end: Optional[Callable[[UtteranceJob], None]] = None
        self._on_utterance_ready: Optional[Callable[[UtteranceJob], None]] = None
        self._silence = b"\x00" * BYTES_PER_AUDIO_FRAME
        self._audio_exhausted = False
        self._awaiting_visual_tail = False

    def set_models(self, models_bundle) -> None:
        self._models = models_bundle
        with self._lock:
            stale = [
                j
                for j in list(self._pending)
                if j.ready.is_set()
                and j.whisper_chunks is None
                and j.num_frames > 0
                and not j.error
            ]
        for job in stale:
            job.ready.clear()
            threading.Thread(
                target=self._prepare_job,
                args=(job,),
                name=f"RePrep-{job.task_id[:20]}",
                daemon=True,
            ).start()

    def set_callbacks(
        self,
        on_start: Optional[Callable[[UtteranceJob], None]] = None,
        on_end: Optional[Callable[[UtteranceJob], None]] = None,
        on_ready: Optional[Callable[[UtteranceJob], None]] = None,
    ) -> None:
        self._on_utterance_start = on_start
        self._on_utterance_end = on_end
        self._on_utterance_ready = on_ready

    def playback_active(self) -> bool:
        flag = os.path.join(self.output_folder, "playback_active.flag")
        return os.path.exists(flag)

    def enqueue(
        self,
        audio_path: str,
        *,
        task_id: str,
        action: Optional[str] = None,
        priority: bool = False,
    ) -> UtteranceJob:
        if not audio_path or not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio tidak ditemukan: {audio_path}")

        job = UtteranceJob(
            task_id=task_id,
            audio_path=audio_path,
            action=(action or "").strip() or None,
            priority=priority,
        )
        with self._lock:
            self._pending.append(job)
            ordered = sorted(self._pending, key=lambda j: _sequence_key(j.task_id))
            self._pending.clear()
            self._pending.extend(ordered)

        threading.Thread(
            target=self._prepare_job,
            args=(job,),
            name=f"Prep-{task_id[:24]}",
            daemon=True,
        ).start()
        print(f"[SpeechBridge] Enqueued {task_id} action={action or 'idle_1'}")
        return job

    def _prepare_job(self, job: UtteranceJob) -> None:
        wav_16k = None
        metrics = get_telemetry()
        prep_start = time.perf_counter()
        try:
            pcm = _extract_pcm_stereo(job.audio_path)
            job.pcm_frames = _split_pcm_frames(pcm)
            job.num_frames = len(job.pcm_frames)

            if job.num_frames > 0 and not self._models:
                wait_sec = float(os.environ.get("SPEECH_BRIDGE_MODEL_WAIT_SEC", "300"))
                deadline = time.monotonic() + wait_sec
                while not self._models and time.monotonic() < deadline:
                    time.sleep(0.25)

            if self._models and job.num_frames > 0:
                wav_16k = _normalize_to_16k_wav(job.audio_path)
                with metrics.measure("utterance_whisper_ms"):
                    job.whisper_chunks = self._compute_whisper_chunks(wav_16k, job.num_frames)
                if job.whisper_chunks is None:
                    job.error = "whisper_chunks kosong"
            elif job.num_frames > 0 and not self._models:
                print(
                    f"[SpeechBridge] {job.task_id}: PCM siap, Whisper ditunda "
                    "(model MuseTalk belum load)"
                )
            job.ready.set()
            metrics.record_latency(
                "utterance_prep_ms", (time.perf_counter() - prep_start) * 1000.0
            )
            print(
                f"[SpeechBridge] Ready {job.task_id}: "
                f"{job.num_frames} frames @ {TARGET_FPS}fps "
                f"whisper={'ok' if job.whisper_chunks is not None else 'MISSING'}"
            )
        except Exception as err:
            job.error = str(err)
            job.ready.set()
            metrics.record_latency(
                "utterance_prep_ms", (time.perf_counter() - prep_start) * 1000.0
            )
            metrics.inc("utterance_prep_failed")
            print(f"[SpeechBridge] Prep failed {job.task_id}: {err}")
        finally:
            if wav_16k and os.path.exists(wav_16k):
                try:
                    os.remove(wav_16k)
                except Exception:
                    pass

    def _compute_whisper_chunks(self, wav_16k_path: str, num_frames: int) -> torch.Tensor:
        ap = self._models["audio_processor"]
        whisper = self._models["whisper"]
        device = self._models["device"]
        weight_dtype = self._models["weight_dtype"]

        print(f"[SpeechBridge] Computing whisper chunks for {num_frames} frames...")
        try:
            try:
                raw_features, librosa_len = ap.get_audio_feature(
                    wav_16k_path, weight_dtype=weight_dtype
                )
            except TypeError:
                raw_features, librosa_len = ap.get_audio_feature(wav_16k_path)
            print(
                f"[SpeechBridge] Audio features: raw={_feature_debug_shape(raw_features)}, "
                f"librosa_len={librosa_len}"
            )
            features = _as_whisper_feature_list(raw_features)
            print(
                f"[SpeechBridge] Audio feature segments={len(features)} "
                f"first={tuple(features[0].shape)}"
            )
            chunks = ap.get_whisper_chunk(
                features,
                device,
                weight_dtype,
                whisper,
                librosa_len,
                fps=TARGET_FPS,
                audio_padding_length_left=2,
                audio_padding_length_right=2,
            )
            if isinstance(chunks, (list, tuple)):
                chunks = torch.cat(
                    [c if torch.is_tensor(c) else torch.as_tensor(c) for c in chunks],
                    dim=0,
                )
            elif not torch.is_tensor(chunks):
                chunks = torch.as_tensor(chunks)
            print(f"[SpeechBridge] Whisper chunks: shape={tuple(chunks.shape)}")
        except Exception as e:
            import traceback
            print(f"[SpeechBridge] ERROR computing whisper chunks: {e}")
            traceback.print_exc()
            raise
        
        # Sesuaikan panjang dengan PCM frames.
        # Jangan pad dengan viseme terakhir — mulut akan tertahan terbuka di akhir audio.
        if chunks.shape[0] > num_frames:
            chunks = chunks[:num_frames]
        elif chunks.shape[0] < num_frames and chunks.shape[0] > 0:
            pad_n = num_frames - chunks.shape[0]
            zeros = torch.zeros(
                (pad_n,) + tuple(chunks.shape[1:]),
                dtype=chunks.dtype,
                device=chunks.device,
            )
            chunks = torch.cat([chunks, zeros], dim=0)
        return chunks.cpu()

    def _start_next_if_needed(self) -> None:
        """Idle tetap jalan sampai job siap + preroll mulut selesai (tanpa freeze frame)."""
        if self._current is not None:
            return
        preroll_timeout = float(os.environ.get("MUSETALK_PREROLL_TIMEOUT_SEC", "2.0"))
        candidate = None
        with self._lock:
            while self._pending:
                nxt = self._pending[0]
                if not nxt.ready.is_set():
                    return
                nxt = self._pending.popleft()
                if nxt.error or nxt.num_frames <= 0:
                    print(f"[SpeechBridge] Skip {nxt.task_id}: {nxt.error or 'empty'}")
                    continue
                if nxt.whisper_chunks is None:
                    if self._models:
                        print(
                            f"[SpeechBridge] {nxt.task_id}: Whisper belum siap — "
                            "re-prep, tidak diputar dulu"
                        )
                        nxt.ready.clear()
                        threading.Thread(
                            target=self._prepare_job,
                            args=(nxt,),
                            name=f"RePrep-{nxt.task_id[:20]}",
                            daemon=True,
                        ).start()
                    self._pending.appendleft(nxt)
                    return
                candidate = nxt
                break
        if candidate is None:
            return

        if not candidate.lipsync_primed:
            candidate.lipsync_primed = True
            candidate.primed_at = time.monotonic()
            if self._on_utterance_ready is not None:
                try:
                    self._on_utterance_ready(candidate)
                except Exception as err:
                    print(f"[SpeechBridge] on_ready notice: {err}")
                    candidate.lipsync_ready.set()
            else:
                candidate.lipsync_ready.set()

        if not candidate.lipsync_ready.is_set():
            waited = time.monotonic() - (candidate.primed_at or candidate.created_at)
            if waited < preroll_timeout:
                with self._lock:
                    self._pending.appendleft(candidate)
                return

        with self._lock:
            self._current = candidate
            self._frame_cursor = 0
            self._audio_exhausted = False
            self._awaiting_visual_tail = False
        if self._on_utterance_start:
            try:
                self._on_utterance_start(candidate)
            except Exception as err:
                print(f"[SpeechBridge] on_start notice: {err}")
        print(f"[SpeechBridge] ▶ Playing {candidate.task_id}")

    def _finish_current(self) -> None:
        finished = self._current
        self._current = None
        self._frame_cursor = 0
        self._audio_exhausted = False
        self._awaiting_visual_tail = False
        if finished and self._on_utterance_end:
            try:
                self._on_utterance_end(finished)
            except Exception as err:
                print(f"[SpeechBridge] on_end notice: {err}")
        if finished:
            temp_dir = os.environ.get(
                "WORKER_TEMP",
                os.path.join(os.path.dirname(self.output_folder or ""), "temp"),
            )
            if (
                finished.audio_path
                and temp_dir
                and finished.audio_path.startswith(temp_dir)
                and os.path.exists(finished.audio_path)
            ):
                try:
                    os.remove(finished.audio_path)
                except Exception:
                    pass

    def clear_pending(self) -> None:
        """Kosongkan antrian utterance (dipanggil saat stop-broadcast / sesi baru)."""
        with self._lock:
            self._pending.clear()
            self._current = None
            self._frame_cursor = 0
            self._audio_exhausted = False
            self._awaiting_visual_tail = False

    def signal_visual_complete(self) -> None:
        """Dipanggil state machine setelah clip talk mencapai end_pose."""
        with self._lock:
            if self._current is None:
                return
        # Jangan gate on _audio_exhausted — SM sudah konfirmasi visual selesai.
        # Cek _audio_exhausted saja bisa bikin _current stuck → utterance #2+ tidak pernah play.
        self._finish_current()

    def is_utterance_active(self) -> bool:
        return self._current is not None

    def is_audio_exhausted(self) -> bool:
        return self._audio_exhausted

    def is_awaiting_visual_tail(self) -> bool:
        return self._awaiting_visual_tail

    def peek_audio_state(self) -> Tuple[bool, Optional[int]]:
        """Non-consuming peek — untuk state machine / lipsync index tanpa mengambil PCM."""
        if not self.playback_active():
            return False, None
        self._start_next_if_needed()
        if self._current is None:
            return False, None
        if self._frame_cursor >= self._current.num_frames:
            if not self._audio_exhausted:
                self._audio_exhausted = True
                self._awaiting_visual_tail = True
            return False, None
        return True, self._frame_cursor

    def audio_progress(self) -> float:
        """0..1 progress audio utterance aktif (untuk early CTA gesture)."""
        with self._lock:
            job = self._current
        if job is None or job.num_frames <= 0:
            return 0.0
        return min(1.0, float(self._frame_cursor) / float(job.num_frames))

    def current_action(self) -> Optional[str]:
        job = self._current
        return (job.action or None) if job else None

    def get_audio_chunk(self) -> Tuple[bytes, bool, Optional[int]]:
        """Return (pcm_stereo, is_speech, whisper_frame_index).

        Audio boleh habis sebelum video selesai — visual tail dilanjutkan
        dengan silence sampai state machine memanggil ``signal_visual_complete``.
        """
        if not self.playback_active():
            return self._silence, False, None

        self._start_next_if_needed()

        if self._current is None:
            return self._silence, False, None

        if self._frame_cursor >= self._current.num_frames:
            if not self._audio_exhausted:
                self._audio_exhausted = True
                self._awaiting_visual_tail = True
            return self._silence, False, None

        pcm = self._current.pcm_frames[self._frame_cursor]
        idx = self._frame_cursor
        self._frame_cursor += 1
        return pcm, True, idx

    def get_llm_action(self) -> Optional[str]:
        """Peek disabled — CTA point dijadwalkan di on_start (post-speech saja)."""
        return None

    def current_utterance(self) -> Optional[UtteranceJob]:
        return self._current

    def pending_count(self) -> int:
        with self._lock:
            return len(self._pending) + (1 if self._current else 0)

    def has_ready_pending(self) -> bool:
        """True jika ada utterance *berikutnya* di antrian (bukan yang sedang main)."""
        return self.ready_pending_count() > 0

    def ready_pending_count(self) -> int:
        """Jumlah job di `_pending` yang sudah prepared — jangan hitung `_current`.

        Dipakai `end_utterance(another_utterance_ready=...)`. Kalau `_current`
        ikut dihitung, hold-talk selalu aktif meski antrian kosong → stuck di
        idle_2 saat BE mati/reload.
        """
        with self._lock:
            n = 0
            for job in self._pending:
                if job.ready.is_set() and not job.error and job.num_frames > 0:
                    n += 1
            return n

    def is_speaking(self) -> bool:
        return self._current is not None

    def make_audio_hook(self) -> Callable[[], Tuple[bytes, bool]]:
        def _hook() -> Tuple[bytes, bool]:
            pcm, speech, _idx = self.get_audio_chunk()
            return pcm, speech

        return _hook

    def make_action_hook(self) -> Callable[[], Optional[str]]:
        return self.get_llm_action


_bridge_singleton: Optional[SpeechBridge] = None
_bridge_lock = threading.Lock()


def get_speech_bridge(output_folder: str = "") -> SpeechBridge:
    global _bridge_singleton
    with _bridge_lock:
        if _bridge_singleton is None:
            _bridge_singleton = SpeechBridge(output_folder=output_folder)
        elif output_folder and _bridge_singleton.output_folder != output_folder:
            _bridge_singleton.output_folder = output_folder
        return _bridge_singleton


def is_ai_worker_mode() -> bool:
    mode = (os.environ.get("BROADCAST_MODE") or "segment").strip().lower()
    return mode in ("ai_worker", "ai-worker", "realtime", "visual_worker")
