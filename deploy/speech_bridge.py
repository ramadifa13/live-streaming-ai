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
from concurrent.futures import ThreadPoolExecutor
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


TARGET_FPS = 24
# Keep the bridge contract identical to core_pipeline and MuseTalk input.
SAMPLE_RATE = 16000
SAMPLES_PER_FRAME = int(round(SAMPLE_RATE / float(TARGET_FPS)))
BYTES_PER_AUDIO_FRAME = SAMPLES_PER_FRAME * 2 * 2


def _samples_for_frame(frame_index: int) -> int:
    """Distribute 16 kHz samples across 30 FPS without cumulative clock drift."""
    start = int(frame_index * SAMPLE_RATE / TARGET_FPS)
    end = int((frame_index + 1) * SAMPLE_RATE / TARGET_FPS)
    return max(1, end - start)


def _sequence_key(task_id: str):
    match = re.match(r"^(prio_)?task_(\d{10,})_", task_id or "")
    if match:
        rank = 0 if match.group(1) else 1
        return (rank, int(match.group(2)), task_id)
    return (2, 0, task_id)


TARGET_MIN_SEC = 8.5
TARGET_MAX_SEC = 9.5
TARGET_WPM = 150.0
FILLER_PATTERNS = [
    "yang sebenarnya",
    "pada dasarnya",
    "jadi, secara umum",
    "yang penting",
    "sebenarnya",
    "sekadar",
]
EXPANDERS = [
    " Jadi, ini penting untuk dipahami dengan baik.",
    " Secara sederhana, ini yang paling relevan.",
    " Yang perlu diingat, konsistensi lebih penting daripada sekadar ambisi.",
]


def normalize_script(text: str) -> str:
    if not text:
        return ""
    text = text.strip()
    text = re.sub(r"\s+", " ", text)
    return text


def estimate_duration_seconds(text: str) -> float:
    cleaned = normalize_script(text)
    if not cleaned:
        return 0.0
    words = len(cleaned.split())
    return (words / TARGET_WPM) * 60.0


def shorten_script(text: str) -> str:
    cleaned = normalize_script(text)
    if not cleaned:
        return ""

    candidate = cleaned
    for filler in FILLER_PATTERNS:
        candidate = candidate.replace(filler, "").strip()
        candidate = re.sub(r"\s+", " ", candidate)

    if TARGET_MIN_SEC <= estimate_duration_seconds(candidate) <= TARGET_MAX_SEC:
        return candidate

    sentences = [s.strip() for s in cleaned.split(".") if s.strip()]
    for count in range(len(sentences), 1, -1):
        trial = ". ".join(sentences[:count]).strip()
        if TARGET_MIN_SEC <= estimate_duration_seconds(trial) <= TARGET_MAX_SEC:
            return trial

    chunked = [p.strip() for p in re.split(r"[.;!?]\s+|,\s*", cleaned) if p.strip()]
    for count in range(len(chunked), 1, -1):
        trial = " ".join(chunked[:count]).strip()
        if TARGET_MIN_SEC <= estimate_duration_seconds(trial) <= TARGET_MAX_SEC:
            return trial

    words = cleaned.split()
    target_words = max(10, int(round(((TARGET_MIN_SEC + TARGET_MAX_SEC) / 2.0) * TARGET_WPM / 60.0)))
    if len(words) > target_words:
        trimmed = " ".join(words[:target_words]).rstrip(" ,.;:!?")
        if trimmed:
            return trimmed

    return cleaned


def expand_script(text: str) -> str:
    cleaned = normalize_script(text)
    if not cleaned:
        return ""

    for extra in EXPANDERS:
        trial = cleaned + extra
        if TARGET_MIN_SEC <= estimate_duration_seconds(trial) <= TARGET_MAX_SEC:
            return trial
    return cleaned + " Jadi, ini penting untuk dipahami dengan baik."


def fit_script_to_target(text: str) -> str:
    """Pastikan script tetap natural di rentang 8,5–9,5 detik tanpa memotong audio."""
    cleaned = normalize_script(text)
    if not cleaned:
        return ""

    duration = estimate_duration_seconds(cleaned)
    if TARGET_MIN_SEC <= duration <= TARGET_MAX_SEC:
        return cleaned
    if duration < TARGET_MIN_SEC:
        return expand_script(cleaned)
    return shorten_script(cleaned)


@dataclass
class RuntimeGuard:
    """Menjaga host tetap TALK/hold talk sampai benar-benar ada alasan idle."""

    idle_timeout_sec: float = 2.5
    tail_visual_grace_sec: float = 0.5

    def should_keep_talk(
        self,
        *,
        queue_has_work: bool,
        current_pcm_remaining: bool,
        current_audio_done: bool,
        visual_tail_active: bool,
    ) -> bool:
        if queue_has_work:
            return True
        if current_pcm_remaining:
            return True
        if current_audio_done and visual_tail_active:
            return True
        return False

    def should_enter_idle(
        self,
        *,
        queue_has_work: bool,
        current_pcm_remaining: bool,
        idle_since: Optional[float],
        now: Optional[float],
    ) -> bool:
        if queue_has_work:
            return False
        if current_pcm_remaining:
            return False
        if idle_since is None:
            return False
        if now is None:
            now = time.monotonic()
        return (now - idle_since) >= self.idle_timeout_sec


def build_live_script(raw_text: str) -> str:
    """Wrapper production: ubah teks saja agar durasi tetap natural tanpa memotong audio."""
    return fit_script_to_target(raw_text)


def ensure_no_idle_policy(
    *,
    queue_has_work: bool,
    current_pcm_remaining: bool,
    current_audio_done: bool,
    visual_tail_active: bool,
    idle_since: Optional[float],
    now: Optional[float],
) -> Tuple[bool, bool]:
    guard = RuntimeGuard()
    keep_talk = guard.should_keep_talk(
        queue_has_work=queue_has_work,
        current_pcm_remaining=current_pcm_remaining,
        current_audio_done=current_audio_done,
        visual_tail_active=visual_tail_active,
    )
    enter_idle = guard.should_enter_idle(
        queue_has_work=queue_has_work,
        current_pcm_remaining=current_pcm_remaining,
        idle_since=idle_since,
        now=now,
    )
    return keep_talk, enter_idle


def _normalize_to_16k_wav(src_path: str) -> str:
    """Konversi audio apa pun ke mono 16 kHz PCM WAV (untuk Whisper)."""
    fd, dst = tempfile.mkstemp(suffix="_16k.wav", prefix="utter_")
    os.close(fd)
    cmd = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        src_path,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
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
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        audio_path,
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "-ac",
        "2",
        "-ar",
        str(sample_rate),
        "pipe:1",
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=120)
    if proc.returncode == 0 and proc.stdout:
        return proc.stdout
    return b""


def _split_pcm_frames(
    pcm: bytes, bytes_per_frame: int = BYTES_PER_AUDIO_FRAME
) -> List[bytes]:
    """Split PCM by exact sample count per frame — no drift, no synthetic tail."""
    if not pcm:
        return []
    frames: List[bytes] = []
    bytes_per_sample = 2 * 2  # stereo s16le
    total_samples = len(pcm) // bytes_per_sample
    pos = 0
    for frame_index in range(100000):  # safety cap
        start = int(frame_index * SAMPLE_RATE / TARGET_FPS)
        end = int((frame_index + 1) * SAMPLE_RATE / TARGET_FPS)
        frame_samples = max(1, end - start)
        frame_bytes = frame_samples * bytes_per_sample
        if pos >= len(pcm):
            break
        chunk = pcm[pos : pos + frame_bytes]
        if len(chunk) < frame_bytes:
            # Last frame: pad only if we have substantial data
            if len(chunk) >= frame_bytes // 2:
                chunk += b"\x00" * (frame_bytes - len(chunk))
            else:
                break
        frames.append(chunk)
        pos += frame_bytes
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
    started_at: float = 0.0


class SpeechBridge:
    """Antrian utterance + streaming PCM per frame.

    Pre-queue gate: playback tidak mulai sampai MIN_READY_UTTERANCES utterances
    sudah siap di antrian (default 2). Ini menghilangkan idle di awal live —
    AI langsung bicara begitu stream dibuka. Set ke 1 atau 0 untuk disable gate.
    """

    # Mulai langsung saat utterance pertama siap; ini menjaga host terasa natural
    # dan tidak menahan kalimat pertama agar stream terlihat "terlambat".
    MIN_READY_UTTERANCES: int = 1
    MAX_PENDING_UTTERANCES: int = 12
    PREP_WORKERS: int = 2

    def __init__(self, output_folder: str = ""):
        self.output_folder = output_folder or "/workspace/ai_live_worker/output"
        self._pending: Deque[UtteranceJob] = deque()
        self._current: Optional[UtteranceJob] = None
        self._frame_cursor = 0
        self._lock = threading.Lock()
        self._models = None
        self._on_utterance_start: Optional[Callable[[UtteranceJob], None]] = None
        self._on_utterance_end: Optional[Callable[[UtteranceJob], None]] = None
        self._on_utterance_ready: Optional[Callable[[UtteranceJob], None]] = None
        self._silence = b"\x00" * BYTES_PER_AUDIO_FRAME
        self._silence_frame_index = 0
        self._audio_exhausted = False
        self._awaiting_visual_tail = False
        self._active_deadline = 0.0
        self._prep_executor = ThreadPoolExecutor(
            max_workers=self.PREP_WORKERS,
            thread_name_prefix="SpeechPrep",
        )
        # Pre-queue gate: True selama belum ada utterance pertama yang dimulai.
        self._prequeue_gate_active: bool = self.MIN_READY_UTTERANCES > 1
        self._ever_started: bool = False  # False sampai utterance pertama mulai

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
            self._submit_prep(job)

    def _submit_prep(self, job: UtteranceJob) -> None:
        self._prep_executor.submit(self._prepare_job, job)

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
        return os.path.exists(flag) or self._ever_started or self._current is not None

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
            if len(self._pending) >= max(1, self.MAX_PENDING_UTTERANCES):
                raise RuntimeError(
                    "SpeechBridge queue penuh; retry setelah playback maju"
                )
            self._pending.append(job)
            ordered = sorted(self._pending, key=lambda j: _sequence_key(j.task_id))
            self._pending.clear()
            self._pending.extend(ordered)

        self._submit_prep(job)
        print(f"[SpeechBridge] Enqueued {task_id} action={action or 'talk'}")
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
                wait_sec = 300.0
                deadline = time.monotonic() + wait_sec
                while not self._models and time.monotonic() < deadline:
                    time.sleep(0.25)

            if self._models and job.num_frames > 0:
                wav_16k = _normalize_to_16k_wav(job.audio_path)
                with metrics.measure("utterance_whisper_ms"):
                    job.whisper_chunks = self._compute_whisper_chunks(
                        wav_16k, job.num_frames
                    )
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

    def _compute_whisper_chunks(
        self, wav_16k_path: str, num_frames: int
    ) -> torch.Tensor:
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

        # Sesuaikan panjang dengan PCM frames tanpa menambah durasi buatan.
        # Whisper boleh lebih dekat ke PCM, tetapi tidak diperbolehkan memanjang
        # di luar panjang audio aktual.
        if chunks.shape[0] > num_frames:
            chunks = chunks[:num_frames]
        if chunks.shape[0] < num_frames and chunks.shape[0] > 0:
            pad_n = num_frames - chunks.shape[0]
            zeros = torch.zeros(
                (pad_n,) + tuple(chunks.shape[1:]),
                dtype=chunks.dtype,
                device=chunks.device,
            )
            chunks = torch.cat([chunks, zeros], dim=0)
        return chunks.cpu()

    def _start_next_if_needed(self) -> None:
        """Idle tetap jalan sampai job siap + preroll mulut selesai (tanpa freeze frame).

        Pre-queue gate: saat _prequeue_gate_active=True, tahan sampai
        MIN_READY_UTTERANCES utterances siap di antrian sebelum mulai yang pertama.
        Tujuan: stream dimulai langsung bicara tanpa idle.
        """
        if self._current is not None:
            return

        # Pre-queue gate: tunggu buffer cukup sebelum utterance pertama.
        if self._prequeue_gate_active and not self._ever_started:
            ready_count = self.ready_pending_count()
            min_ready = max(1, self.MIN_READY_UTTERANCES)
            if ready_count < min_ready:
                # Belum cukup — cek apakah perlu log (setiap 5 detik).
                return
            print(
                f"[SpeechBridge] Pre-queue gate terpenuhi: {ready_count}/{min_ready} utterances siap — mulai playback."
            )
            self._prequeue_gate_active = False

        preroll_timeout = 4.0
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
                        self._submit_prep(nxt)
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
            hard_preroll = True
            preroll_timeout = 2.5
            # Hard preroll avoids a partial mouth, but never blocks audio forever.
            if hard_preroll:
                # The worker has an absolute deadline; the bridge keeps retrying
                # while that deadline is in progress and preserves idle rendering.
                with self._lock:
                    self._pending.appendleft(candidate)
                if int(waited) > 0 and int(waited) % 5 == 0:
                    print(
                        f"[SpeechBridge] Waiting hard preroll {candidate.task_id} "
                        f"({waited:.1f}s)"
                    )
                return
            # Soft legacy: tunggu lalu mulai parsial.
            hard_cap = max(1.2, preroll_timeout) * 3.0
            if waited < hard_cap:
                with self._lock:
                    self._pending.appendleft(candidate)
                return
            print(
                f"[SpeechBridge] Preroll lambat {candidate.task_id} "
                f"({waited:.1f}s) — mulai dengan mouths parsial"
            )

        with self._lock:
            self._current = candidate
            self._frame_cursor = 0
            self._audio_exhausted = False
            self._awaiting_visual_tail = False
            candidate.started_at = time.monotonic()
            duration = max(1.0, candidate.num_frames / float(TARGET_FPS))
            tail = max(1.0, 3.0 / TARGET_FPS)
            self._active_deadline = candidate.started_at + duration + tail + 30.0
            # Gate selamanya off setelah utterance pertama mulai.
            self._ever_started = True
            self._prequeue_gate_active = False
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
        self._active_deadline = 0.0
        if finished and self._on_utterance_end:
            try:
                self._on_utterance_end(finished)
            except Exception as err:
                print(f"[SpeechBridge] on_end notice: {err}")
        if finished:
            temp_dir = os.path.join(os.path.dirname(self.output_folder or ""), "temp")
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
            self._active_deadline = 0.0
            # Reset gate untuk sesi Go Live berikutnya.
            self._ever_started = False
            self._prequeue_gate_active = self.MIN_READY_UTTERANCES > 1

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
        # PCM aktif.
        if self._frame_cursor < self._current.num_frames:
            return True, self._frame_cursor
        # Dalam grace tail whisper — masih ada viseme untuk dirender.
        grace_tail = 3
        whisper_total = (
            int(self._current.whisper_chunks.shape[0])
            if self._current.whisper_chunks is not None
            else self._current.num_frames
        )
        if (
            self._frame_cursor < whisper_total
            and self._frame_cursor < self._current.num_frames + grace_tail
        ):
            return False, self._frame_cursor
        if not self._audio_exhausted:
            self._audio_exhausted = True
            self._awaiting_visual_tail = True
        return False, None

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
        Grace tail: setelah PCM habis, izinkan beberapa frame silence sambil
        whisper index terus maju (mouth masih bergerak untuk suku kata akhir).
        """
        if (
            self._current is not None
            and self._active_deadline > 0
            and time.monotonic() > self._active_deadline
            and self._frame_cursor >= self._current.num_frames
        ):
            print("[SpeechBridge] Active utterance deadline reached; advancing queue")
            self._finish_current()

        if not self.playback_active() and not self._ever_started and self._current is None:
            size = _samples_for_frame(self._silence_frame_index) * 2 * 2
            self._silence_frame_index += 1
            return b"\x00" * size, False, None

        self._start_next_if_needed()

        if self._current is None:
            size = _samples_for_frame(self._silence_frame_index) * 2 * 2
            self._silence_frame_index += 1
            return b"\x00" * size, False, None

        # PCM masih ada — kirim audio + whisper index.
        if self._frame_cursor < self._current.num_frames:
            pcm = self._current.pcm_frames[self._frame_cursor]
            idx = self._frame_cursor
            self._frame_cursor += 1
            return pcm, True, idx

        # Setelah PCM habis, jangan mengembalikan padding tersembunyi yang
        # memperpanjang durasi utterance. Whisper tail yang "natural" tidak boleh
        # menambah audio aktual di luar file asli.
        whisper_total = (
            int(self._current.whisper_chunks.shape[0])
            if self._current.whisper_chunks is not None
            else self._current.num_frames
        )
        if (
            self._frame_cursor < whisper_total
            and self._frame_cursor < self._current.num_frames
        ):
            idx = self._frame_cursor
            self._frame_cursor += 1
            return b"\x00" * (_samples_for_frame(idx) * 2 * 2), False, idx

        # Benar-benar selesai.
        if not self._audio_exhausted:
            self._audio_exhausted = True
            self._awaiting_visual_tail = True
        size = _samples_for_frame(self._silence_frame_index) * 2 * 2
        self._silence_frame_index += 1
        return b"\x00" * size, False, None

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

    def has_upcoming_work(self) -> bool:
        """True jika ada job berikutnya, termasuk job yang masih dipersiapkan."""
        with self._lock:
            return any(
                not job.error and (not job.ready.is_set() or job.num_frames > 0)
                for job in self._pending
            )

    def ready_pending_count(self) -> int:
        """Jumlah job di `_pending` yang sudah prepared — jangan hitung `_current`.

        Dipakai `end_utterance(another_utterance_ready=...)`. Kalau `_current`
        ikut dihitung, hold-talk selalu aktif meski antrian kosong → stuck di
        Hold talk agar tubuh tidak lompat ke idle saat BE mati/reload.
        """
        with self._lock:
            n = 0
            for job in self._pending:
                if (
                    job.ready.is_set()
                    and not job.error
                    and job.num_frames > 0
                    and job.whisper_chunks is not None
                ):
                    n += 1
            return n

    def queued_audio_seconds(self, fps: float = float(TARGET_FPS)) -> float:
        """Durasi aktual antrian + sisa current (bukan 12s × count)."""
        rate = max(1.0, float(fps))
        with self._lock:
            total_frames = 0
            if self._current is not None and self._current.num_frames > 0:
                remain = max(0, int(self._current.num_frames) - int(self._frame_cursor))
                total_frames += remain
            for job in self._pending:
                if job.error or job.num_frames <= 0 or job.whisper_chunks is None:
                    continue
                if not job.ready.is_set():
                    continue
                total_frames += int(job.num_frames)
            return round(total_frames / rate, 2)

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
    """Mode ai_worker (Continuous Frame Feed) adalah satu-satunya mode baku siaran."""
    return True
