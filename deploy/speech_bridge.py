"""Bridge antara API server (TTS audio + LLM action) dan AIVisualWorker.

Utterance masuk lewat ``enqueue()`` → PCM 48 kHz + Whisper 16 kHz diprecompute
dari file asli (satu resample masing-masing) → MuseTalk N+1 diprime sementara
N diputar → ``get_audio_chunk()`` hanya mengambil segment READY pada tick 24 FPS.
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

from av_timing import (
    FPS as TARGET_FPS,
    BROADCAST_SAMPLE_RATE,
    WHISPER_SAMPLE_RATE,
    bytes_for_frame,
    samples_for_frame as _samples_for_frame,
    silence_for_frame,
)

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


BYTES_PER_AUDIO_FRAME = bytes_for_frame(0)


def _sequence_key(task_id: str):
    match = re.match(r"^(prio_)?task_(\d{10,})_", task_id or "")
    if match:
        rank = 0 if match.group(1) else 1
        return (rank, int(match.group(2)), task_id)
    return (2, 0, task_id)


TARGET_MIN_SEC = 8.8
TARGET_MAX_SEC = 9.2
TARGET_WPM = 140.0
FILLER_PATTERNS = [
    "yang sebenarnya",
    "pada dasarnya",
    "jadi, secara umum",
    "yang penting",
    "sebenarnya",
    "sekadar",
]
EXPANDERS = [
    ", jadi ini sangat penting untuk diperhatikan.",
    ", secara sederhana, ini yang paling bermanfaat.",
    ", yang pasti, kualitas dan kenyamanan tetap nomor satu.",
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
        trial = cleaned.rstrip(" .!?,;") + extra
        if TARGET_MIN_SEC <= estimate_duration_seconds(trial) <= TARGET_MAX_SEC:
            return trial
    return cleaned.rstrip(" .!?,;") + ", jadi ini sangat penting untuk diperhatikan."


def fit_script_to_target(text: str) -> str:
    """Pastikan script tetap natural di rentang ~9 detik tanpa memotong audio."""
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
    """Normalize text only; video timeline loops independently from audio length."""
    return normalize_script(raw_text)


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
        str(WHISPER_SAMPLE_RATE),
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


def _extract_pcm_stereo(audio_path: str, sample_rate: int = BROADCAST_SAMPLE_RATE) -> bytes:
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
    del bytes_per_frame
    if not pcm:
        return []
    frames: List[bytes] = []
    bytes_per_sample = 2 * 2  # stereo s16le
    pos = 0
    for frame_index in range(100000):  # safety cap
        frame_bytes = bytes_for_frame(frame_index)
        if pos >= len(pcm):
            break
        chunk = pcm[pos : pos + frame_bytes]
        if len(chunk) < frame_bytes:
            # Last frame: keep every real sample and pad only to satisfy the
            # fixed-size frame contract. Dropping this tail can audibly cut
            # short natural TTS.
            if not chunk:
                break
            chunk += b"\x00" * (frame_bytes - len(chunk))
        frames.append(chunk)
        pos += frame_bytes
    return _apply_pcm_edge_fades(frames)


# ~125 ms at 24 fps. Softens AAC clicks between utterances without changing duration.
PCM_EDGE_FADE_FRAMES = 3


def _scale_pcm_frame(frame: bytes, gain: float) -> bytes:
    if not frame or gain >= 0.999:
        return frame
    samples = np.frombuffer(frame, dtype=np.int16).astype(np.float32)
    samples *= max(0.0, min(1.0, float(gain)))
    return np.clip(samples, -32768, 32767).astype(np.int16).tobytes()


def _apply_pcm_edge_fades(
    frames: List[bytes], fade_frames: int = PCM_EDGE_FADE_FRAMES
) -> List[bytes]:
    """Fade in/out at utterance edges. Sample count per frame stays identical."""
    n = len(frames)
    if n == 0 or fade_frames <= 0:
        return frames
    fade = min(max(1, int(fade_frames)), max(1, n // 4))
    out = list(frames)
    for i in range(fade):
        in_gain = ((i + 1) / float(fade)) ** 2
        out[i] = _scale_pcm_frame(out[i], in_gain)
        out_gain = ((fade - i) / float(fade)) ** 2
        out[n - fade + i] = _scale_pcm_frame(out[n - fade + i], out_gain)
    return out


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
    # MuseTalk jobs to start while the current READY segment is still playing.
    MAX_RENDER_AHEAD: int = 2

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
        self._visual_allows_next: Optional[Callable[[], bool]] = None
        self._silence_frame_index = 0
        self._audio_exhausted = False
        self._awaiting_visual_tail = False
        self._visual_complete_signaled = False
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

    def set_visual_gate(self, fn: Optional[Callable[[], bool]] = None) -> None:
        """Block starting a new sentence until the idle cycle has finished."""
        self._visual_allows_next = fn

    def _visual_allows_next_start(self) -> bool:
        if self._visual_allows_next is None:
            return True
        try:
            return bool(self._visual_allows_next())
        except Exception as err:
            print(f"[SpeechBridge] visual gate notice: {err}")
            return True

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
            pcm = _extract_pcm_stereo(job.audio_path, sample_rate=BROADCAST_SAMPLE_RATE)
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
                f"pcm={BROADCAST_SAMPLE_RATE}Hz whisper={WHISPER_SAMPLE_RATE}Hz "
                f"(from original, no chained resample) "
                f"whisper={'ok' if job.whisper_chunks is not None else 'MISSING'}"
            )
            self._prime_upcoming_renders()
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

    def is_full(self) -> bool:
        with self._lock:
            return len(self._pending) >= max(1, self.MAX_PENDING_UTTERANCES)

    def render_queue_size(self) -> int:
        """Jobs with Whisper ready that are still waiting on MuseTalk."""
        with self._lock:
            n = 0
            for job in self._pending:
                if job.error or not job.ready.is_set() or job.whisper_chunks is None:
                    continue
                if not job.lipsync_ready.is_set():
                    n += 1
            return n

    def ready_upcoming_count(self) -> int:
        """READY segments waiting behind the currently playing job."""
        with self._lock:
            n = 0
            for job in self._pending:
                if (
                    job.ready.is_set()
                    and job.lipsync_ready.is_set()
                    and not job.error
                    and job.num_frames > 0
                    and job.whisper_chunks is not None
                ):
                    n += 1
            return n

    def _prime_upcoming_renders(self) -> None:
        """Start MuseTalk for N+1 while N is still playing. Never wait for N to finish."""
        if self._on_utterance_ready is None:
            return
        to_prime: List[UtteranceJob] = []
        with self._lock:
            inflight = 0
            for job in self._pending:
                if job.error or job.num_frames <= 0:
                    continue
                if not job.ready.is_set() or job.whisper_chunks is None:
                    continue
                if job.lipsync_ready.is_set():
                    continue
                if job.lipsync_primed:
                    inflight += 1
                    continue
                if inflight >= max(1, self.MAX_RENDER_AHEAD):
                    break
                job.lipsync_primed = True
                job.primed_at = time.monotonic()
                to_prime.append(job)
                inflight += 1
        for job in to_prime:
            try:
                print(f"[SpeechBridge] Prime MuseTalk ahead {job.task_id}")
                self._on_utterance_ready(job)
            except Exception as err:
                print(f"[SpeechBridge] prime notice: {err}")
                job.error = str(err) or "prime failed"
                job.lipsync_ready.set()

    def _start_next_if_needed(self, *, allow_playback: bool = True) -> None:
        self._prime_upcoming_renders()

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
                    candidate.error = str(err) or "on_ready failed"
                    candidate.lipsync_ready.set()
            else:
                candidate.lipsync_ready.set()

        if not candidate.lipsync_ready.is_set():
            with self._lock:
                self._pending.appendleft(candidate)
            return
        if candidate.error:
            print(f"[SpeechBridge] Skip {candidate.task_id}: {candidate.error}")
            return
        if not allow_playback:
            # Prerender is allowed before the backend arms playback. Expose the
            # fully-ready job through queue status, but do not consume PCM yet.
            with self._lock:
                self._pending.appendleft(candidate)
            return

        with self._lock:
            self._current = candidate
            self._frame_cursor = 0
            self._audio_exhausted = False
            self._awaiting_visual_tail = False
            candidate.started_at = time.monotonic()
            duration = max(1.0, candidate.num_frames / float(TARGET_FPS))
            self._active_deadline = candidate.started_at + duration + 30.0
            # Gate selamanya off setelah utterance pertama mulai.
            self._ever_started = True
            self._prequeue_gate_active = False
        if self._on_utterance_start:
            try:
                self._on_utterance_start(candidate)
            except Exception as err:
                import traceback
                traceback.print_exc()
                print(f"[SpeechBridge] on_start notice: {err}")
        print(f"[SpeechBridge] ▶ Playing {candidate.task_id}")

    def _finish_current(self) -> None:
        finished = self._current
        self._current = None
        self._frame_cursor = 0
        self._audio_exhausted = False
        self._awaiting_visual_tail = False
        self._visual_complete_signaled = False
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
            self._visual_complete_signaled = False
            self._active_deadline = 0.0
            # Reset gate untuk sesi Go Live berikutnya.
            self._ever_started = False
            self._prequeue_gate_active = self.MIN_READY_UTTERANCES > 1

    def signal_visual_complete(self) -> None:
        """Dipanggil state machine setelah clip talk mencapai end_pose."""
        with self._lock:
            if self._current is None:
                return
            # Proteksi agar audio tidak dipotong: jika PCM audio masih belum habis dimainkan,
            # tandai visual selesai tapi jangan finish dulu sampai seluruh frame audio tuntas dialirkan.
            if self._frame_cursor < self._current.num_frames:
                self._visual_complete_signaled = True
                self._awaiting_visual_tail = True
                return
            self._visual_complete_signaled = False
        self._finish_current()

    def is_utterance_active(self) -> bool:
        return self._current is not None

    def is_audio_exhausted(self) -> bool:
        return self._audio_exhausted

    def is_awaiting_visual_tail(self) -> bool:
        return self._awaiting_visual_tail

    def peek_audio_state(self) -> Tuple[bool, Optional[int]]:
        """Non-consuming peek — untuk state machine / lipsync index tanpa mengambil PCM."""
        armed = self.playback_active()
        self._start_next_if_needed(allow_playback=armed)
        if not armed:
            return False, None
        if self._current is None:
            return False, None
        # PCM aktif.
        if self._frame_cursor < self._current.num_frames:
            return True, self._frame_cursor
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

        PCM and Whisper share the same exact frame count and finish together.
        """
        if (
            self._current is not None
            and self._active_deadline > 0
            and time.monotonic() > self._active_deadline
            and self._frame_cursor >= self._current.num_frames
        ):
            print("[SpeechBridge] Active utterance deadline reached; advancing queue")
            self._finish_current()

        armed = self.playback_active()
        allow_new = armed and self._visual_allows_next_start()
        self._start_next_if_needed(allow_playback=allow_new)
        if not armed and not self._ever_started and self._current is None:
            size = bytes_for_frame(self._silence_frame_index)
            self._silence_frame_index += 1
            return b"\x00" * size, False, None

        if self._current is None:
            size = bytes_for_frame(self._silence_frame_index)
            self._silence_frame_index += 1
            return b"\x00" * size, False, None

        # PCM masih ada — kirim audio + whisper index.
        if self._frame_cursor < self._current.num_frames:
            pcm = self._current.pcm_frames[self._frame_cursor]
            idx = self._frame_cursor
            self._frame_cursor += 1
            return pcm, True, idx

        # Audio done. Start N+1 only when the visual is not mid-idle.
        if self.ready_upcoming_count() > 0 and self._visual_allows_next_start():
            self._finish_current()
            self._start_next_if_needed(allow_playback=allow_new)
            if self._current is not None and self._frame_cursor < self._current.num_frames:
                pcm = self._current.pcm_frames[self._frame_cursor]
                idx = self._frame_cursor
                self._frame_cursor += 1
                return pcm, True, idx

        if not self._audio_exhausted:
            self._audio_exhausted = True
            self._awaiting_visual_tail = True
        if self._visual_complete_signaled:
            self._visual_complete_signaled = False
            self._finish_current()
        size = bytes_for_frame(self._silence_frame_index)
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
        """Count utterances whose complete mouth timeline is ready to play."""
        with self._lock:
            n = int(
                self._current is not None
                and self._current.lipsync_ready.is_set()
                and not self._current.error
            )
            for job in self._pending:
                if (
                    job.ready.is_set()
                    and job.lipsync_ready.is_set()
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
                if (
                    job.error
                    or job.num_frames <= 0
                    or job.whisper_chunks is None
                    or not job.lipsync_ready.is_set()
                ):
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
