from __future__ import annotations

import os
import math
import random
import sys
import time
import threading
import queue
import json
import signal
from collections import deque
from argparse import Namespace
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np
import torch


try:
    from video_canvas import CANVAS_H, CANVAS_W, fit_bgr
except ImportError:
    CANVAS_W = 720
    CANVAS_H = 1280

    def fit_bgr(frame, width=CANVAS_W, height=CANVAS_H):
        return frame

# BROADCAST_MODE=ai_worker / AI_WORKER_FPS lock
TARGET_FPS = 24
SAMPLE_RATE = 16000
SAMPLES_PER_FRAME = int(round(SAMPLE_RATE / float(TARGET_FPS)))
BYTES_PER_AUDIO_FRAME = SAMPLES_PER_FRAME * 2 * 2

# ====== SMOOTHING PARAMETERS (untuk natural gerakan) ======
# CROSSFADE_FRAMES: frame untuk smooth transition antar video clip
# Default 4 = terlalu cepat/patah-patah. Raise ke 8-12 untuk lebih smooth
# Set via env: AI_WORKER_CROSSFADE_FRAMES=12
_cf_frames = int(os.environ.get("AI_WORKER_CROSSFADE_FRAMES", "8"))
CROSSFADE_FRAMES = max(2, _cf_frames)

# OVERLAP_FRAMES: frame untuk body pose blending antar clip
# Default 4 = cepat. Raise ke 6-8 untuk smoother body motion
_ov_frames = int(os.environ.get("AI_WORKER_OVERLAP_FRAMES", "6"))
OVERLAP_FRAMES = max(2, _ov_frames)

OVERLAP_FRAMES_MAX = max(OVERLAP_FRAMES, 6)

# BBOX_SMOOTH_WINDOW: window size untuk smoothing face detection bounding box
# Default 7 = jerky. Raise ke 12-15 untuk smoother face tracking
_bbox_smooth = int(os.environ.get("AI_WORKER_BBOX_SMOOTH_WINDOW", "12"))
BBOX_SMOOTH_WINDOW = max(3, _bbox_smooth)

RAW_QUEUE_SIZE = 120
RENDER_QUEUE_SIZE = 240
RAW_QUEUE_BLOCK_SEC = 0.25
MASK_FEATHER_PX = 5
AMBIENT_MIN_SEC = 4
AMBIENT_MAX_SEC = 6

IDLE_BREATH_CHANCE = 0.18
IDLE_FALLBACK_AFTER = 2
# Hold talk antar-utterance: kalau tidak ada suara baru, segera balik ke idle.
HOLD_TALK_MAX_SEC = 3.5
# Pin talk clip panjang (continuous body timeline) — rotasi tiap 1-2 utterance agar bervariasi.
TALK_STREAK_BEFORE_ROTATE = 1

# 0 = rotasi alami antar talk clips (talk_1, talk_2, talk_3). 1 = kunci ke 1 clip saja.
PIN_TALK_SCENE = False

# Rest-gated begin: tunggu base/end max N ms sebelum soft-cut paksa.
REST_GATE_MAX_MS = 400
REST_GATE_NEAR_FRAMES = 12
# Setelah audio habis, jangan menambah tail silence tambahan karena itu
# memperpanjang durasi visual dan memberi efek audio terpotong/panjangan.
UTTERANCE_TAIL_FRAMES = 0
BROADCAST_MAX_LAG = 8
BROADCAST_RENDER_WAIT_SEC = 0.10
BROADCAST_SPEECH_WAIT_SEC = 10.0
BROADCAST_SPEECH_GAP_WAIT_SEC = 0.25
PENDING_MAX = RENDER_QUEUE_SIZE + BROADCAST_MAX_LAG
SEAMLESS_THRESHOLD = 0.92

# ====== MOUTH/LIP-SYNC PARAMETERS (untuk smooth lip-sync) ======
# Keep the worker deterministic and environment-free for deploy/test invariants.
# Mulut harus natural, tidak terlalu terbuka dan tidak geser ke samping.
# Redam 0.72 menjaga buka bibir tetap wajar pada pengucapan normal.
MOUTH_STRENGTH = 0.72

# MOUTH_TEMPORAL: temporal smoothing agar gerakan bibir halus tanpa lag atau overshoot.
_mouth_temp = float(os.environ.get("AI_WORKER_MOUTH_TEMPORAL", "0.30"))
MOUTH_TEMPORAL = max(0.0, min(1.0, _mouth_temp))

# Batas per-frame dibuat lebih ketat agar mulut tidak membesar / melebar.
MOUTH_MAX_DELTA = 8.0
MOUTH_FRAME_DELTA = 2.5

# Saat MuseTalk pertama kali masuk, bbox face bisa bergetar karena perubahan
# landmark per-frame. Batasi pergeseran bbox agar transisi awal stabil.
FACE_JITTER_MAX_DELTA = 8
LIPSYNC_PREROLL_FRAMES = 2
LIPSYNC_WAIT_SEC = 0
# Sync shift 0 memastikan viseme tepat waktu dengan audio stream
LIPSYNC_SYNC_SHIFT = 0
LIPSYNC_PREROLL_TIMEOUT_SEC = 4.0
# 0 = mulai audio saat mouth 1-2 frame siap (hilangkan delay 400ms/utterance).
LIPSYNC_HARD_PREROLL = False
# 1 = mouth miss → body-only (bukan sticky last mouth).
MOUTH_MISS_BODY_ONLY = True


ALLOWED_GESTURES: frozenset = frozenset()

# Body clips mengikuti nama file langsung dari sample.
TRUE_IDLE_NAMES = frozenset({"idle"})
TALK_CLIP_NAMES = frozenset({"talk_1", "talk_2", "talk_3"})
TALK_CLIP_NAMES = frozenset({"idle", "talk_1", "talk_2", "talk_3"})
BODY_CLIP_NAMES = TRUE_IDLE_NAMES | TALK_CLIP_NAMES


TALK_CLIP_DEFAULT = "talk_1"
if TALK_CLIP_DEFAULT not in TALK_CLIP_NAMES:
    TALK_CLIP_DEFAULT = "talk_1"

CRASH_FALLBACK_CLIP = "idle"
if CRASH_FALLBACK_CLIP not in TRUE_IDLE_NAMES:
    CRASH_FALLBACK_CLIP = "idle"


def _normalize_clip_name(name: Optional[str]) -> str:
    if not name:
        return CRASH_FALLBACK_CLIP
    return name.lower().strip().replace("-", "_")


def _ambient_gesture_names() -> List[str]:
    """Ambient gestures — default off."""
    return []


def _talk_clip_pool_names() -> List[str]:
    """Clip tubuh saat bicara — default talk_1,talk_2,talk_3."""
    return ["talk_1", "talk_2", "talk_3"]


def _idle_variant_names() -> List[str]:
    """True idle saat diam: default hanya idle."""
    return ["idle"] if "idle" in TRUE_IDLE_NAMES else [CRASH_FALLBACK_CLIP]


def _is_true_idle_name(name: Optional[str]) -> bool:
    if not name:
        return False
    return _normalize_clip_name(name) in TRUE_IDLE_NAMES


def _is_talk_clip_name(name: Optional[str]) -> bool:
    if not name:
        return False
    return _normalize_clip_name(name) in TALK_CLIP_NAMES


def _is_idle_clip_name(name: Optional[str]) -> bool:
    """True untuk semua body clip yang diizinkan (idle + talk*)."""
    if not name:
        return False
    key = _normalize_clip_name(name)
    return key in BODY_CLIP_NAMES


def _is_neutral_action(tag: Optional[str]) -> bool:
    """True jika bukan body clip dikenal — diarahkan ke true idle."""
    if not tag:
        return True
    return not _is_idle_clip_name(tag)


def _is_allowed_gesture(tag: Optional[str]) -> bool:
    """Gesture non-body dimatikan — fokus idle/talk saja."""
    return False


try:
    from worker_telemetry import get_telemetry
except ImportError:

    class _NoopTelemetry:
        def measure(self, _name: str):
            from contextlib import nullcontext

            return nullcontext()

        def inc(self, *_a, **_k) -> None:
            pass

        def set_gauge(self, *_a, **_k) -> None:
            pass

        def note_broadcast_frame(self) -> None:
            pass

        def maybe_log_summary(self, **_k) -> None:
            pass

    def get_telemetry():
        return _NoopTelemetry()


try:
    from speech_bridge import SpeechBridge, get_speech_bridge, is_ai_worker_mode
except ImportError:
    SpeechBridge = None

    def get_speech_bridge(output_folder: str = ""):
        return None

    def is_ai_worker_mode() -> bool:
        return False


def get_audio_chunk() -> Tuple[bytes, bool]:
    """Return (pcm_stereo_s16le_chunk, is_speech) for one video frame."""
    bridge = get_speech_bridge()
    if bridge is not None:
        pcm, speech, _idx = bridge.get_audio_chunk()
        return pcm, speech
    return b"\x00" * BYTES_PER_AUDIO_FRAME, False


def get_llm_action() -> Optional[str]:
    """Action LLM — gesture off; body dipilih state machine dari idle/talk*."""
    return None


class PlayState(Enum):
    IDLE = auto()
    ACTION = auto()
    TALK = auto()


@dataclass
class ClipAsset:
    name: str
    path: str
    frames: List[np.ndarray]
    base_pose_frame: int = 0
    end_pose_frame: int = -1
    probed_frame_count: int = 0
    # SSIM base↔end; <0 means unknown (compute after decode).
    seamless_score: float = -1.0

    frame_list_cycle: List[np.ndarray] = field(default_factory=list)
    coord_list_cycle: list = field(default_factory=list)
    latent_list_cycle: list = field(default_factory=list)
    mask_materials_cycle: list = field(default_factory=list)
    loop: bool = True

    @property
    def num_frames(self) -> int:
        return len(self.frames) if self.frames else max(1, self.probed_frame_count)

    @property
    def end_pose(self) -> int:
        if self.end_pose_frame >= 0:
            return min(self.end_pose_frame, max(0, self.num_frames - 1))
        return max(0, self.num_frames - 1)

    @property
    def is_seamless_loop(self) -> bool:
        """True jika skor seamless (SSIM base↔end) ≥ threshold."""
        if self.seamless_score >= 0.0:
            return self.seamless_score >= SEAMLESS_THRESHOLD
        # Tanpa skor: anggap seamless hanya jika span sangat pendek (statis).
        return self.end_pose <= self.base_pose_frame

    def forward_at(self, idx: int) -> Tuple[np.ndarray, int]:
        """Forward-only frame access — no ping-pong during playthrough."""
        n = max(1, self.num_frames)
        fi = max(0, min(idx, n - 1))
        return self.frames[fi], fi

    def material_at(self, idx: int) -> Tuple[np.ndarray, int]:
        """Return (body frame, cycle index for MuseTalk materials)."""
        n = max(1, len(self.frames))
        fi = idx % n
        if self.frame_list_cycle and fi < len(self.frame_list_cycle):
            forward_n = min(
                n, len(self.frame_list_cycle) // 2 or len(self.frame_list_cycle)
            )
            cidx = fi % max(1, forward_n)
            return self.frame_list_cycle[cidx], cidx
        return self.frames[fi], fi


def _frame_ssim(a: np.ndarray, b: np.ndarray) -> float:
    """Fast grayscale SSIM between two BGR frames."""
    if a is None or b is None:
        return 0.0
    if a.shape != b.shape:
        b = cv2.resize(b, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_AREA)
    ga = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY).astype(np.float64)
    gb = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY).astype(np.float64)
    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2
    mu_x = cv2.GaussianBlur(ga, (11, 11), 1.5)
    mu_y = cv2.GaussianBlur(gb, (11, 11), 1.5)
    mu_x2 = mu_x * mu_x
    mu_y2 = mu_y * mu_y
    mu_xy = mu_x * mu_y
    sigma_x2 = cv2.GaussianBlur(ga * ga, (11, 11), 1.5) - mu_x2
    sigma_y2 = cv2.GaussianBlur(gb * gb, (11, 11), 1.5) - mu_y2
    sigma_xy = cv2.GaussianBlur(ga * gb, (11, 11), 1.5) - mu_xy
    num = (2 * mu_xy + c1) * (2 * sigma_xy + c2)
    den = (mu_x2 + mu_y2 + c1) * (sigma_x2 + sigma_y2 + c2)
    return float(np.mean(num / (den + 1e-12)))


def compute_seamless_score(clip: ClipAsset) -> float:
    """SSIM between base_pose and end_pose frames (0..1)."""
    if not clip.frames:
        return -1.0
    bi = max(0, min(clip.base_pose_frame, len(clip.frames) - 1))
    ei = max(0, min(clip.end_pose, len(clip.frames) - 1))
    return _frame_ssim(clip.frames[bi], clip.frames[ei])


@dataclass
class RawFramePacket:
    seq: int
    frame: np.ndarray
    clip_name: str
    frame_idx: int
    cycle_idx: int
    state: PlayState
    needs_lipsync: bool
    audio_pcm: bytes
    is_speech: bool
    whisper_idx: Optional[int] = None
    crossfade_from: Optional[np.ndarray] = None
    crossfade_alpha: float = 1.0


@dataclass
class RenderedPacket:
    seq: int
    frame: np.ndarray
    audio_pcm: bytes
    clip_name: str = ""
    frame_idx: int = 0


def feather_mask(mask_array: np.ndarray, kernel: int = MASK_FEATHER_PX) -> np.ndarray:
    """Extra Gaussian feather on MuseTalk jaw mask edges with lateral corner tapering."""
    if mask_array is None:
        return mask_array
    arr = np.asarray(mask_array, dtype=np.uint8)
    if arr.ndim != 2:
        return mask_array
    k = max(3, kernel | 1)
    blurred = cv2.GaussianBlur(arr, (k, k), 0)
    
    # Redam ujung lateral (15% kiri & 15% kanan) dengan taper halus agar sudut bibir
    # tidak terdistorsi melebar seperti Joker/seram dan pas menyatu dengan video asli.
    h, w = blurred.shape
    if w > 20:
        margin_x = max(4, int(w * 0.15))
        ramp = np.linspace(0.0, 1.0, margin_x, dtype=np.float32)
        # Cosine ramp untuk transisi transparan yang sangat lembut di sudut bibir
        ramp = 0.5 - 0.5 * np.cos(np.pi * ramp)
        weight_x = np.ones(w, dtype=np.float32)
        weight_x[:margin_x] = ramp
        weight_x[-margin_x:] = ramp[::-1]
        blurred = np.clip(blurred.astype(np.float32) * weight_x[None, :], 0, 255).astype(np.uint8)

    return blurred


def blend_weighted(a: np.ndarray, b: np.ndarray, alpha: float) -> np.ndarray:
    """cv2.addWeighted wrapper — alpha=1 → full b."""
    if a is None:
        return b
    if b is None or alpha >= 1.0:
        return b
    if alpha <= 0.0:
        return a
    return cv2.addWeighted(a, 1.0 - alpha, b, alpha, 0)


def blend_crossfade(a: np.ndarray, b: np.ndarray, alpha: float) -> np.ndarray:
    """Linear crossfade between two BGR frames (alpha=1 → full b)."""
    return blend_weighted(a, b, alpha)


def _ease_in_out(t: float) -> float:
    """Cosine ease — transisi clip tanpa lonjakan alpha di awal/akhir."""
    t = max(0.0, min(1.0, float(t)))
    return 0.5 - 0.5 * math.cos(math.pi * t)


def _pcm_rms(pcm: bytes) -> float:
    if not pcm:
        return 0.0
    samples = np.frombuffer(pcm, dtype=np.int16)
    if samples.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(samples.astype(np.float32) ** 2))) / 32768.0


def _mouth_strength_for_pcm(pcm: bytes) -> float:
    """Volume hanya meredam jika STRENGTH < 1. Clamp 0.92 lama = mix idle = bibir buram."""
    if float(MOUTH_STRENGTH) >= 0.999:
        return 1.0
    base = max(0.0, min(1.0, float(MOUTH_STRENGTH)))
    rms = _pcm_rms(pcm)
    t = float(np.clip((rms - 0.010) / 0.11, 0.0, 1.0))
    return base * (0.88 + 0.12 * t)


def _dampen_generated_mouth(
    original: np.ndarray, generated: np.ndarray, strength: float
) -> np.ndarray:
    """Lerp MuseTalk vs crop idle. Clamp delta opsional (0 = matikan, biar mulut benar-benar buka)."""
    if original is None or generated is None:
        return generated if generated is not None else original
    if original.shape != generated.shape:
        generated = cv2.resize(
            generated,
            (original.shape[1], original.shape[0]),
            interpolation=cv2.INTER_CUBIC,
        )
    orig_f = original.astype(np.float32)
    gen_f = generated.astype(np.float32)
    s = float(np.clip(strength, 0.0, 1.0))
    mixed = orig_f * (1.0 - s) + gen_f * s
    cap = float(MOUTH_MAX_DELTA)
    if cap > 0:
        delta = mixed - orig_f
        mixed = orig_f + np.clip(delta, -cap, cap)
    return np.clip(mixed, 0, 255).astype(np.uint8)


def _talk_body_index(
    clip: "ClipAsset", whisper_idx: int, start_frame_idx: int = 0
) -> int:
    """Pose tubuh untuk UNet = pose visual saat audio frame 0, lalu +whisper_idx."""
    span = max(1, clip.end_pose - clip.base_pose_frame + 1)
    origin = int(start_frame_idx) - clip.base_pose_frame
    offset = (origin + int(whisper_idx)) % span
    return clip.base_pose_frame + offset


class FaceCoordRegistry:
    """Ambil mask/bbox milik frame yang sedang tampil dan stabilkan transisi awal."""

    def __init__(self, window: int = BBOX_SMOOTH_WINDOW):
        self._window = max(1, window)
        self._history: Dict[str, deque] = {}
        self._locked: Dict[str, tuple] = {}

    def _smooth_face_box(self, key: str, face_box: Tuple[int, int, int, int]) -> Tuple[int, int, int, int]:
        if face_box is None:
            return face_box
        box = tuple(int(v) for v in face_box)
        hist = self._history.setdefault(key, deque(maxlen=max(2, self._window)))
        hist.append(box)
        if len(hist) == 1:
            self._locked[key] = box
            return box

        recent = np.asarray(list(hist), dtype=np.float32)
        smoothed = tuple(np.round(np.mean(recent, axis=0)).astype(int))
        prev = self._locked.get(key)
        if prev is not None:
            drift = max(
                abs(smoothed[0] - prev[0]),
                abs(smoothed[1] - prev[1]),
                abs(smoothed[2] - prev[2]),
                abs(smoothed[3] - prev[3]),
            )
            if drift > FACE_JITTER_MAX_DELTA:
                smoothed = (
                    prev[0] + int(np.clip(smoothed[0] - prev[0], -FACE_JITTER_MAX_DELTA, FACE_JITTER_MAX_DELTA)),
                    prev[1] + int(np.clip(smoothed[1] - prev[1], -FACE_JITTER_MAX_DELTA, FACE_JITTER_MAX_DELTA)),
                    prev[2] + int(np.clip(smoothed[2] - prev[2], -FACE_JITTER_MAX_DELTA, FACE_JITTER_MAX_DELTA)),
                    prev[3] + int(np.clip(smoothed[3] - prev[3], -FACE_JITTER_MAX_DELTA, FACE_JITTER_MAX_DELTA)),
                )
        self._locked[key] = smoothed
        return smoothed

    def lock_from_clip(self, clip: ClipAsset, frame_idx: int) -> None:
        if clip is None or not clip.mask_materials_cycle:
            return
        key = clip.name
        idx = max(0, min(int(frame_idx), len(clip.mask_materials_cycle) - 1))
        mat = clip.mask_materials_cycle[idx]
        if not mat:
            return
        _, _, face_box = mat
        self._locked[key] = tuple(int(v) for v in face_box)
        self._history.setdefault(key, deque(maxlen=max(2, self._window))).clear()
        self._history[key].append(self._locked[key])

    def release_lock(self) -> None:
        self._locked.clear()
        self._history.clear()

    def get_material(self, clip: ClipAsset, cidx: int) -> Optional[Tuple]:
        if not clip.mask_materials_cycle:
            return None
        mat = clip.mask_materials_cycle[cidx % len(clip.mask_materials_cycle)]
        if not mat:
            return None
        mask_array, crop_box, face_box = mat
        stabilized = self._smooth_face_box(clip.name, tuple(int(v) for v in face_box))
        return feather_mask(mask_array), crop_box, stabilized


@dataclass
class _OverlapTransition:
    """N pasang frame: from[-N..] blended dengan target[0..N-1]."""

    pairs: List[Tuple[np.ndarray, np.ndarray]]
    step: int = 0
    resume_frame_idx: int = 0
    # Index material MuseTalk di sisi target (bukan step blend).
    target_cycle_indices: List[int] = field(default_factory=list)


class AssetBank:
    """Decode all host clips into RAM and precompute MuseTalk materials."""

    def crash_fallback_name(self) -> str:
        if CRASH_FALLBACK_CLIP in self.clips:
            return CRASH_FALLBACK_CLIP
        return self._idle_name

    def clip_has_musetalk(self, name: Optional[str]) -> bool:
        if not name:
            return False
        clip = self.clips.get(name)
        if clip is None:
            return False
        # Detailed logging for missing MuseTalk materials
        if not clip.latent_list_cycle:
            print(f"[AssetBank] clip_has_musetalk FALSE: latents missing for {name}")
        if not clip.mask_materials_cycle:
            print(f"[AssetBank] clip_has_musetalk FALSE: masks missing for {name}")
        return bool(clip.latent_list_cycle and clip.mask_materials_cycle)

    def talk_clip_pool(self) -> List[str]:
        out: List[str] = []
        for name in _talk_clip_pool_names():
            resolved = self.resolve_action(name) if name not in self.clips else name
            if resolved in self.clips and resolved not in out:
                out.append(resolved)
        return out

    def talk_clips_ready(self) -> List[str]:
        # Cache the ready talk clips to avoid recomputation and recursion
        if self._ready_talk_clips is not None:
            return self._ready_talk_clips
        ready = [n for n in self.talk_clip_pool() if self.clip_has_musetalk(n)]
        if ready:
            self._ready_talk_clips = ready
            return ready
        fb = self.crash_fallback_name()
        if self.clip_has_musetalk(fb):
            self._ready_talk_clips = [fb]
            return [fb]
        self._ready_talk_clips = []
        return []

    def pick_talk_clip(
        self,
        prefer: Optional[str] = None,
        *,
        exclude: Optional[str] = None,
        avoid_repeat: Optional[str] = None,
    ) -> str:
        """Pilih clip bicara dari pool. avoid_repeat = clip yang sudah 2x beruntun."""
        """Pilih clip bicara dari pool secara random tanpa berulang sama dengan clip sebelumnya."""
        ready = self.talk_clips_ready()
        if not ready:
            return self.crash_fallback_name()
        pool = list(ready)
        if avoid_repeat and len(pool) > 1:
            pool = [c for c in pool if c != avoid_repeat] or list(ready)
        if exclude and len(pool) > 1:
            narrowed = [c for c in pool if c != exclude]
            if narrowed:
                pool = narrowed

        disallowed = set()
        if avoid_repeat:
            disallowed.add(avoid_repeat)
        if exclude:
            disallowed.add(exclude)

        candidates = [c for c in pool if c not in disallowed]
        if not candidates and disallowed:
            candidates = [c for c in pool if c != avoid_repeat] or pool
        if not candidates:
            return pool[0]
        if prefer and prefer in candidates and prefer not in disallowed:
            return prefer
        return random.choice(candidates)

    def talk_clip_name(self) -> str:
        """Return the default talk clip without triggering recursion.
        Prioritize the explicitly configured default (TALK_CLIP_DEFAULT) if it exists
        and has MuseTalk materials. Otherwise, fall back to the first ready talk
        clip or the crash fallback.
        """
        # Preferred default clip
        if TALK_CLIP_DEFAULT in self.clips and self.clip_has_musetalk(
            TALK_CLIP_DEFAULT
        ):
            return TALK_CLIP_DEFAULT
        # Use cached ready list if available
        if self._ready_talk_clips:
            return self._ready_talk_clips[0]
        # Compute a safe fallback without calling talk_clips_ready (which would recurse)
        for name in self.clips:
            if name in TALK_CLIP_NAMES and self.clip_has_musetalk(name):
                return name
        return self.crash_fallback_name()

    def idle_variant_clips(self) -> List[str]:
        """Varian ambient saat diam — default hanya idle."""
        out: List[str] = []
        for name in _idle_variant_names():
            resolved = self.resolve_action(name)
            if resolved in self.clips and resolved not in out:
                out.append(resolved)
        return out

    def __init__(self, assets_dir: str, host: str = "namira", models_bundle=None):
        self.assets_dir = assets_dir
        self.host = host.lower()
        self.models = models_bundle
        self.clips: Dict[str, ClipAsset] = {}
        self._idle_name = "idle"
        self._ready_talk_clips: Optional[List[str]] = None

    def discover_and_load(self) -> None:
        if not os.path.isdir(self.assets_dir):
            raise FileNotFoundError(f"Assets dir missing: {self.assets_dir}")

        mp4s = sorted(
            f
            for f in os.listdir(self.assets_dir)
            if f.endswith(".mp4") and not f.startswith("temp_")
        )
        if not mp4s:
            raise FileNotFoundError(f"No .mp4 assets in {self.assets_dir}")

        eager_names = set(self._eager_clip_names())
        decode_all = False

        for fname in mp4s:
            path = os.path.join(self.assets_dir, fname)
            name = self._clip_name_from_file(fname)
            if name not in BODY_CLIP_NAMES:
                print(f"[AssetBank] skip unknown clip {fname} → {name}")
                continue
            if name in self.clips:
                print(f"[AssetBank] skip duplicate {fname} (already have {name})")
                continue
            num_frames = self._probe_frame_count(path)
            base_pose, end_pose, meta_score = self._load_pose_meta(name, num_frames)
            decode_now = (
                decode_all
                or name in eager_names
                or _is_true_idle_name(name)
                or _is_talk_clip_name(name)
            )
            frames = self._decode_video(path) if decode_now else []
            clip = ClipAsset(
                name=name,
                path=path,
                frames=frames,
                base_pose_frame=base_pose,
                end_pose_frame=end_pose,
                probed_frame_count=num_frames,
                seamless_score=meta_score,
                loop=_is_talk_clip_name(name)
                or _is_true_idle_name(name)
                or name == TALK_CLIP_DEFAULT,
            )
            if frames and clip.seamless_score < 0:
                clip.seamless_score = compute_seamless_score(clip)
            self.clips[name] = clip
            status = f"{len(frames)} frames" if frames else f"lazy ({num_frames}f)"
            seam = (
                f"seamless={clip.seamless_score:.3f}"
                if clip.seamless_score >= 0
                else "seamless=?"
            )
            flag = ""
            if clip.seamless_score >= 0 and not clip.is_seamless_loop:
                flag = " ⚠ LOW seamless — will ping-pong (no end→base morph)"
            print(
                f"[AssetBank] {name}: {status}, "
                f"base_pose={base_pose}, end_pose={clip.end_pose}, {seam}{flag}"
            )

        self._ready_talk_clips = None
        self._idle_name = self._pick_primary_idle()
        print(
            f"[AssetBank] Primary idle={self._idle_name} talk={self.talk_clip_name()}, "
            f"variants={self.idle_variant_clips()}"
        )

        if self.models:
            self._warm_musetalk_materials()

    def _pick_primary_idle(self) -> str:
        """Diam = idle (static)."""
        for key in (CRASH_FALLBACK_CLIP, "idle"):
            if key in self.clips:
                return key
        for k in sorted(self.clips):
            if _is_true_idle_name(k):
                return k
        # Fallback terakhir: talk clip (jangan freeze kosong).
        for k in sorted(self.clips):
            if _is_talk_clip_name(k):
                return k
        return next(iter(self.clips), CRASH_FALLBACK_CLIP)

    def _eager_clip_names(self) -> List[str]:
        """Decode ke RAM: idle + semua talk*."""
        names = ["idle", "talk_1", "talk_2", "talk_3"]
        names = [n for n in names if n in BODY_CLIP_NAMES]
        for must in ("idle", TALK_CLIP_DEFAULT):
            if must and must not in names:
                names.append(must)
        return names

    def _probe_frame_count(self, path: str) -> int:
        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            return 1
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        cap.release()
        return max(1, n)

    def ensure_frames(self, clip: ClipAsset) -> None:
        if clip.frames:
            if clip.seamless_score < 0:
                clip.seamless_score = compute_seamless_score(clip)
            return
        print(f"[AssetBank] Decoding {clip.name} ...", flush=True)
        clip.frames = self._decode_video(clip.path)
        if clip.seamless_score < 0:
            clip.seamless_score = compute_seamless_score(clip)

    def get_clip(self, name: str) -> Optional[ClipAsset]:
        clip = self.clips.get(name)
        if clip is None:
            return None
        self.ensure_frames(clip)
        return clip

    def _precache_clip_names(self) -> List[str]:
        """MuseTalk untuk semua talk* + idle cadangan."""
        default = ",".join(self.talk_clip_pool() or [TALK_CLIP_DEFAULT])
        fb = self.crash_fallback_name()
        names = [*self.talk_clip_pool(), fb]
        return [n for n in names if n in self.clips]

    def ensure_musetalk_materials(self, name: str) -> bool:
        """Lazy precache satu clip saat dibutuhkan (mis. gesture jarang dipakai)."""
        clip = self.clips.get(name)
        if clip is None or not self.models:
            return False
        if clip.latent_list_cycle and clip.mask_materials_cycle:
            return True
        try:
            self._warm_one_clip(clip)
            return bool(clip.latent_list_cycle)
        except Exception as err:
            print(f"[AssetBank] Lazy warmup gagal ({name}): {err}")
            return False

    def _warm_one_clip(self, clip: "ClipAsset") -> None:
        from inference import _get_avatar_materials, musetalk_visual_params

        vis = musetalk_visual_params()
        vae = self.models["vae"]
        fp = self.models["fp"]
        print(
            f"[AssetBank] Preparing MuseTalk materials for {clip.name} ({clip.num_frames} frames)..."
        )
        mats = _get_avatar_materials(
            video_path=clip.path,
            bbox_shift=vis["bbox_shift"],
            extra_margin=vis["extra_margin"],
            version="v15",
            parsing_mode=vis["parsing_mode"],
            vae=vae,
            fp=fp,
            default_fps=TARGET_FPS,
            upper_boundary_ratio=vis["upper_boundary_ratio"],
            square_pad=vis["square_pad"],
            bbox_shift_x=vis.get("bbox_shift_x", -5),
        )

        # Validate materials
        if not mats.get("input_latent_list_cycle"):
            raise RuntimeError(f"No latents generated for {clip.name}")
        if not mats.get("mask_materials_cycle"):
            raise RuntimeError(f"No mask materials generated for {clip.name}")

        clip.frame_list_cycle = mats["frame_list_cycle"]
        clip.coord_list_cycle = mats["coord_list_cycle"]
        clip.latent_list_cycle = mats["input_latent_list_cycle"]
        clip.mask_materials_cycle = mats["mask_materials_cycle"]

        # Check for None values in critical arrays
        none_latents = sum(1 for l in clip.latent_list_cycle if l is None)
        none_masks = sum(1 for m in clip.mask_materials_cycle if m is None)
        if none_latents > 0:
            print(
                f"[AssetBank] WARNING: {none_latents}/{len(clip.latent_list_cycle)} latents are None for {clip.name}"
            )
        if none_masks > 0:
            print(
                f"[AssetBank] WARNING: {none_masks}/{len(clip.mask_materials_cycle)} masks are None for {clip.name}"
            )

        print(
            f"[AssetBank] ✅ MuseTalk materials ready: {clip.name} "
            f"(latents={len(clip.latent_list_cycle)}, masks={len(clip.mask_materials_cycle)}, "
            f"bbox_shift={vis['bbox_shift']}, extra_margin={vis['extra_margin']}, "
            f"upper={vis['upper_boundary_ratio']}, square_pad={vis['square_pad']})"
        )

    def _warm_musetalk_materials(self) -> None:
        targets = self._precache_clip_names()
        print(
            f"[AssetBank] MuseTalk precache ({len(targets)}/{len(self.clips)} clips): "
            f"{targets}"
        )
        for name in targets:
            clip = self.clips.get(name)
            if clip is None:
                continue
            try:
                self._warm_one_clip(clip)
            except Exception as err:
                import traceback

                print(f"[AssetBank] ERROR: MuseTalk warmup failed for {name}: {err}")
                traceback.print_exc()
                # Don't silently continue - re-raise to fail fast
                raise
        self._ready_talk_clips = None
        print(
            f"[AssetBank] ✅ Post-warmup talk pool ready: {self.talk_clips_ready()}, "
            f"default talk={self.talk_clip_name()}"
        )

    def _clip_name_from_file(self, fname: str) -> str:
        stem = os.path.splitext(fname)[0].lower()
        host_prefix = f"{self.host}_"
        if stem.startswith(host_prefix):
            stem = stem[len(host_prefix) :]
        return _normalize_clip_name(stem or "clip")

    def _load_pose_meta(self, name: str, num_frames: int) -> Tuple[int, int, float]:
        """Load base/end pose + seamless_score from sidecar JSON.

        Returns (base, end, seamless_score). seamless_score < 0 if unknown.
        """
        base, end = 0, -1
        score = -1.0
        candidates = [
            os.path.join(self.assets_dir, f"{name}_meta.json"),
            os.path.join(self.assets_dir, f"{self.host}_{name}_meta.json"),
            os.path.join(self.assets_dir, f"namira_{name}_meta.json"),
        ]
        for sidecar in candidates:
            if not os.path.exists(sidecar):
                continue
            try:
                with open(sidecar, "r", encoding="utf-8") as fh:
                    meta = json.load(fh)
                base = int(meta.get("base_pose_frame", base))
                end = int(meta.get("end_pose_frame", end))
                if "seamless_score" in meta:
                    score = float(meta["seamless_score"])
                elif "seamless" in meta and bool(meta["seamless"]):
                    score = max(SEAMLESS_THRESHOLD, 0.99)
                print(f"[AssetBank] meta {name} ← {os.path.basename(sidecar)}")
                break
            except Exception:
                continue
        if end < 0:
            end = max(0, num_frames - 1)
        base = max(0, min(base, max(0, num_frames - 1)))
        end = max(base, min(end, max(0, num_frames - 1)))
        return base, end, score

    def _decode_video(self, path: str) -> List[np.ndarray]:
        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open {path}")
        frames = []
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(fit_bgr(frame, CANVAS_W, CANVAS_H))
        cap.release()
        if not frames:
            raise RuntimeError(f"Empty video: {path}")
        return frames

    def resolve_action(self, tag: Optional[str]) -> str:
        """Resolve body hint: talk_1|idle|talk_2|talk_3. Tag lain → idle."""
        if not tag:
            return self._idle_name
        raw = _normalize_clip_name(tag)
        if raw in ("talk", "speak", "speaking"):
            return self.talk_clip_name()
        if raw in ("idle", "rest", "neutral"):
            return self._idle_name
        if raw in TALK_CLIP_NAMES:
            return raw if raw in self.clips else self.talk_clip_name()
        if raw in TRUE_IDLE_NAMES:
            return raw if raw in self.clips else self._idle_name
        return self._idle_name

    @property
    def idle_clip(self) -> ClipAsset:
        clip = self.get_clip(self._idle_name)
        if clip is None:
            raise KeyError(f"Idle clip missing: {self._idle_name}")
        return clip


class VideoStateMachine:
    """Forward-only playback; transitions only at base/end pose boundaries."""

    def __init__(
        self,
        bank: AssetBank,
        crossfade_frames: int = CROSSFADE_FRAMES,
        face_registry: Optional[FaceCoordRegistry] = None,
        overlap_frames: int = OVERLAP_FRAMES,
    ):
        self.bank = bank
        self.crossfade_frames = max(1, crossfade_frames)
        self.overlap_frames = max(4, min(int(overlap_frames), OVERLAP_FRAMES_MAX))
        self._face_registry = face_registry
        self.state = PlayState.IDLE
        self.current_name = bank._idle_name
        self.frame_idx = bank.idle_clip.base_pose_frame
        self.pending_action: Optional[str] = None
        self._action_queue: deque = deque()
        self._overlap: Optional[_OverlapTransition] = None
        self._seq = 0
        self._lock = threading.RLock()
        self._playthrough_lock = False
        self._utterance_active = False
        self._utterance_audio_done = False
        self._utterance_audio_done_at: Optional[float] = None
        self._talk_loop_count = 0
        self._scheduled_gesture: Optional[str] = None
        self._post_speech_gesture_active = False
        self._ambient_names = _ambient_gesture_names()
        self._idle_variants = list(bank.idle_variant_clips())
        self._next_ambient_at = 0.0
        self._talk_pinned = False
        self._hold_pose_for_infer = False
        self._talk_target: Optional[str] = None
        self._hold_talk_since: Optional[float] = None
        self._talk_streak_name: Optional[str] = None
        self._talk_streak_count = 0
        self._last_talk_clip: Optional[str] = None
        self._pinned_task_id: Optional[str] = None
        self._pending_begin_utterance = False
        self._begin_wait_since: Optional[float] = None
        self._talk_direction = 1  # +1 forward / -1 ping-pong reverse
        self._transition_guard = 0
        self._schedule_next_ambient()

    def _schedule_next_ambient(self) -> None:

        if not self._idle_variants and not self._ambient_names:
            self._next_ambient_at = 0.0
            return
        # Jangan rotasi idle → talk saat diam (ambient off by default).
        if not self._ambient_names:
            self._next_ambient_at = 0.0
            return
        self._next_ambient_at = time.monotonic() + random.uniform(
            AMBIENT_MIN_SEC, AMBIENT_MAX_SEC
        )

    def _choose_next_idle_variant(self, exclude: Optional[str] = None) -> Optional[str]:
        """Pilih idle berikutnya — tidak boleh sama dengan clip sekarang."""
        cur = exclude or self.current_name
        variants = [c for c in self._idle_variants if c in self.bank.clips and c != cur]
        if variants:
            return random.choice(variants)
        return None

    def _pick_next_talk_clip(self) -> str:
        """Pin talk clip (continuous body) — rotasi sangat jarang."""
    def _pick_next_talk_clip(self, avoid: Optional[str] = None) -> str:
        """Pilih clip bicara berikutnya: RANDOM dari pool, dan TIDAK SAMA dengan clip sebelumnya."""
        metrics = get_telemetry()
        # Single body timeline: selalu AI_WORKER_TALK_CLIP jika ready.
        if PIN_TALK_SCENE:
            pinned = self.bank.talk_clip_name()
            if self.bank.clip_has_musetalk(pinned):
                if self._talk_streak_name != pinned:
                    self._talk_streak_name = pinned
                    self._talk_streak_count = 1
                else:
                    self._talk_streak_count += 1
                return pinned
        ready = self.bank.talk_clips_ready()
        if not ready:
            return self.bank.crash_fallback_name()

        # Sudah di talk clip yang valid: reuse (hold antar kalimat).
        if (
            self.state == PlayState.TALK
            and self.current_name
            and self.bank.clip_has_musetalk(self.current_name)
        ):
            if self._talk_streak_name == self.current_name:
                self._talk_streak_count += 1
            else:
                self._talk_streak_name = self.current_name
                self._talk_streak_count = 1
            if self._talk_streak_count < max(2, TALK_STREAK_BEFORE_ROTATE):
                return self.current_name
        # Hindari clip yang baru saja dipakai agar tidak berulang / berurutan sama
        avoid_clip = (
            avoid
            or self._last_talk_clip
            or (self.current_name if self.state == PlayState.TALK else None)
        )
        choice = self.bank.pick_talk_clip(avoid_repeat=avoid_clip)

        avoid = None
        if (
            self._talk_streak_name
            and self._talk_streak_count >= max(2, TALK_STREAK_BEFORE_ROTATE)
            and self._talk_streak_name in self.bank.talk_clips_ready()
        ):
            avoid = self._talk_streak_name
        choice = self.bank.pick_talk_clip(avoid_repeat=avoid)
        if choice == self._talk_streak_name:
            self._talk_streak_count += 1
        else:
            self._talk_streak_name = choice
            self._talk_streak_count = 1
            metrics.inc("talk_clip_rotate")
        self._last_talk_clip = choice
        self._talk_streak_name = choice
        self._talk_streak_count = 1
        metrics.inc("talk_clip_rotate")
        print(
            f"[StateMachine] Random talk clip selected: {choice} (avoided: {avoid_clip})"
        )
        return choice

    def _maybe_queue_ambient_gesture(self) -> None:
        """Ambient gestures saja — idle diam tetap clip idle."""
        if self._utterance_active or self._playthrough_lock or self._talk_pinned:
            return
        if self.state != PlayState.IDLE or self._overlap is not None:
            return
        if self._next_ambient_at <= 0 or time.monotonic() < self._next_ambient_at:
            return
        self._schedule_next_ambient()
        if self.pending_action or self._action_queue:
            return
        if not self._ambient_names:
            return
        allowed = set(self._idle_variants) | {
            self.bank._idle_name,
        }
        if self.current_name not in allowed:
            return
        tag = random.choice(self._ambient_names)
        if not tag:
            return
        self.pending_action = tag
        print(f"[StateMachine] Ambient gesture → {tag}")

    def reset_after_stop(self) -> None:
        """Reset state setelah pause/stop — hindari utterance stuck di Go Live berikutnya."""
        with self._lock:
            self._utterance_active = False
            self._utterance_audio_done = False
            self._utterance_audio_done_at = None
            self._post_speech_gesture_active = False
            self._scheduled_gesture = None
            self._playthrough_lock = False
            self._talk_pinned = False
            self._hold_pose_for_infer = False
            self._talk_target = None
            self._overlap = None
            self._talk_loop_count = 0
            self.pending_action = None
            self._action_queue.clear()
            self.state = PlayState.IDLE
            self.current_name = self.bank._idle_name
            try:
                self.frame_idx = self.bank.idle_clip.base_pose_frame
            except Exception:
                self.frame_idx = 0
            if self._face_registry:
                self._face_registry.release_lock()
            self._pending_begin_utterance = False
            self._begin_wait_since = None
            self._talk_direction = 1
            self._schedule_next_ambient()

    def set_utterance_gesture(self, tag: Optional[str]) -> None:
        """Gesture diputar segera setelah audio habis (CTA point saja)."""
        with self._lock:
            if not _is_allowed_gesture(tag):
                return
            self._scheduled_gesture = tag

            try:
                resolved = self.bank.resolve_action(tag)
                clip = self.bank.get_clip(resolved)
                if clip is not None:
                    self.bank.ensure_frames(clip)
            except Exception as err:
                print(f"[StateMachine] Preload gesture notice: {err}")

    def request_action(self, tag: Optional[str]) -> None:
        with self._lock:
            if not tag:
                return
            key = tag.lower().strip().replace("-", "_")
            # Hanya idle/talk*; selain itu → idle.
            target = self.bank.resolve_action(key)
            if self._playthrough_lock or self._utterance_active:
                self._action_queue.append(target)
            else:
                self.pending_action = target

    def pin_talk_body(self, task_id: Optional[str] = None) -> int:
        """Siapkan clip bicara untuk infer — tubuh tetap bergerak (tanpa freeze).

        Infer memakai base pose clip target; audio + cut ke talk di begin_utterance.
        """
        with self._lock:
            self._talk_pinned = True
            self._hold_pose_for_infer = False
            self.pending_action = None
            if self._utterance_active:
                self._talk_target = self.current_name
            if (
                self._utterance_active
                and self._talk_target
                and self.bank.clip_has_musetalk(self._talk_target)
            ):
                return int(self.frame_idx)

            if (
                task_id is not None
                and getattr(self, "_pinned_task_id", None) == task_id
                and self._talk_target
                and self.bank.clip_has_musetalk(self._talk_target)
            ):
                target = self._talk_target
            else:
                target = self._pick_next_talk_clip()
                if not self.bank.clip_has_musetalk(target):
                    target = self.bank.crash_fallback_name()
                self._talk_target = target
                if task_id is not None:
                    self._pinned_task_id = task_id

            talk_clip = self.bank.get_clip(target)
            if talk_clip is None:
                return int(self.frame_idx)
            if self.current_name == target and self.state == PlayState.TALK:
                return int(self.frame_idx)
            print(f"[StateMachine] Pin talk → {target} (playthrough, no freeze)")
            return int(talk_clip.base_pose_frame)

    def begin_utterance(self) -> None:
        """Mulai talk segera (audio sudah play). Soft-cut dinamis; prefer rest bila dekat."""
        metrics = get_telemetry()
        with self._lock:
            if self._utterance_active:
                self._pending_begin_utterance = False
                self._begin_wait_since = None
                return
            target = self._talk_target or self._pick_next_talk_clip()
            if not self.bank.clip_has_musetalk(target):
                target = self.bank.crash_fallback_name()
            self._talk_target = target

            was_hold_talk = (
                self.state == PlayState.TALK
                and self._talk_pinned
                and self._talk_target == self.current_name
            )
            # Hold talk di clip yang sama: lanjut tanpa cut.
            if was_hold_talk and self.current_name == target:
                self._pending_begin_utterance = False
                self._begin_wait_since = None
                self._utterance_active = True
                self._utterance_audio_done = False
                self._utterance_audio_done_at = None
                self._playthrough_lock = True
                self._talk_loop_count = 0
                self._talk_pinned = True
                self._hold_talk_since = None
                self._hold_pose_for_infer = False
                self.state = PlayState.TALK
                return

            cur = self.bank.get_clip(self.current_name)
            at_rest = False
            if cur is not None:
                at_rest = (
                    self.frame_idx == cur.base_pose_frame
                    or self.frame_idx >= cur.end_pose
                )
                if (
                    self.frame_idx < cur.base_pose_frame
                    or self.frame_idx > cur.end_pose
                ):
                    self.frame_idx = max(
                        cur.base_pose_frame,
                        min(self.frame_idx, cur.end_pose),
                    )
                    at_rest = True
                    metrics.inc("rest_gate_recovery")

            self._pending_begin_utterance = False
            self._begin_wait_since = None
            self._utterance_active = True
            self._utterance_audio_done = False
            self._utterance_audio_done_at = None
            self._playthrough_lock = True
            self._talk_loop_count = 0
            self._talk_pinned = True
            self._hold_talk_since = None
            self._hold_pose_for_infer = False
            self._talk_direction = 1

            if self.current_name != target:
                if not at_rest:
                    metrics.inc("soft_cut_mid_pose")
                self._cut_to_clip(target, PlayState.TALK, lock_face=True, soft=True)
            else:
                self.state = PlayState.TALK
                talk_clip = self.bank.get_clip(target)
                if talk_clip is not None:
                    if abs(self.frame_idx - talk_clip.base_pose_frame) > 3:
                        metrics.inc("soft_cut_mid_pose")
                        self._cut_to_clip(
                            target, PlayState.TALK, lock_face=True, soft=True
                        )
                    else:
                        self.frame_idx = talk_clip.base_pose_frame
                        if self._face_registry:
                            self._face_registry.lock_from_clip(
                                talk_clip,
                                min(talk_clip.base_pose_frame, talk_clip.end_pose),
                            )

    def mark_utterance_audio_done(self) -> None:
        with self._lock:
            if self._utterance_active:
                self._utterance_audio_done = True
                if self._utterance_audio_done_at is None:
                    self._utterance_audio_done_at = time.perf_counter()
                self._try_start_post_speech_gesture()

    def try_start_cta_gesture_early(self) -> None:
        """Mulai POINT saat audio CTA masih jalan (~70%) — jangan set audio_done."""
        with self._lock:
            if not self._utterance_active or self._utterance_audio_done:
                return
            if self._post_speech_gesture_active or not self._scheduled_gesture:
                return
            if not _is_allowed_gesture(self._scheduled_gesture):
                return
            self._try_start_post_speech_gesture()

    def _try_start_post_speech_gesture(self) -> None:
        if not self._scheduled_gesture or self._post_speech_gesture_active:
            return
        if not _is_allowed_gesture(self._scheduled_gesture):
            self._scheduled_gesture = None
            return
        talk = self.bank.talk_clip_name()
        target = self.bank.resolve_action(self._scheduled_gesture)
        if target in (talk, self.bank._idle_name):
            self._scheduled_gesture = None
            return
        clip = self.bank.get_clip(self.current_name)
        if clip is None or target not in self.bank.clips:
            self._scheduled_gesture = None
            return
        self._cut_to_clip(target, PlayState.ACTION, lock_face=False)
        self._post_speech_gesture_active = True
        self._playthrough_lock = True
        self._scheduled_gesture = None
        print(f"[StateMachine] Post-speech CTA gesture → {target}")

    def at_end_pose(self) -> bool:
        clip = self.bank.get_clip(self.current_name)
        if clip is None:
            return True
        return self.frame_idx >= clip.end_pose

    def utterance_visual_complete(self) -> bool:
        """True saat audio selesai (+ short grace) — jangan tunggu full end_pose.

        Menunggu end_pose membuat mute talking-body dan menunda utterance berikutnya
        (SpeechBridge tidak start job baru sampai signal_visual_complete).
        """
        if not self._utterance_active:
            return False
        if not self._utterance_audio_done:
            return False
        if self._post_speech_gesture_active:
            clip = self.bank.get_clip(self.current_name)
            if clip is None:
                return True
            return self.frame_idx >= clip.end_pose
        if self._scheduled_gesture:
            return False
        # Short grace (~3 frame @30fps) supaya mouth settle, lalu unblock next utterance.
        done_at = self._utterance_audio_done_at
        if done_at is None:
            return True
        grace = max(0, UTTERANCE_TAIL_FRAMES) / float(max(1, TARGET_FPS))
        return (time.perf_counter() - float(done_at)) >= grace

    def end_utterance(self, *, another_utterance_ready: bool = False) -> None:
        with self._lock:
            self._utterance_active = False
            self._utterance_audio_done = False
            self._utterance_audio_done_at = None
            self._playthrough_lock = False
            self._talk_loop_count = 0
            self._scheduled_gesture = None
            self._post_speech_gesture_active = False
            self._pending_begin_utterance = False
            self._begin_wait_since = None
            # Keep _talk_target saat hold supaya pin/lipsync tidak loncat clip.
            if not (self.bank.clip_has_musetalk(self.current_name)):
                self._talk_target = None
            else:
                self._talk_target = self.current_name
            # Reset _talk_target dan _pinned_task_id agar utterance berikutnya bebas memilih random clip baru!
            self._talk_target = None
            self._pinned_task_id = None
            if self._face_registry:
                self._face_registry.release_lock()
            self._drain_action_queue()
            # Pertahankan mode TALK (continuous host presentation) saat utterance selesai.
            # StateMachine akan transisi ke IDLE melalui release_stale_hold_talk()
            # hanya bila tidak ada utterance berikutnya setelah HOLD_TALK_MAX_SEC detik.
            if self.bank.clip_has_musetalk(self.current_name):
                self.pending_action = None
                self.state = PlayState.TALK
                self._talk_pinned = True
                self._hold_pose_for_infer = False
                self._hold_talk_since = time.perf_counter()
                print(
                    "[StateMachine] Utterance selesai → hold talk (menunggu utterance berikutnya tanpa potong video)"
                )
            else:
                self._talk_pinned = False
                self._hold_talk_since = None
                self._talk_target = None
                self.state = PlayState.IDLE
                self.pending_action = self.bank._idle_name
                print(
                    f"[StateMachine] Utterance selesai → kembali ke idle ({self.bank._idle_name})"
                )

    def release_stale_hold_talk(
        self, *, queue_has_ready: bool, max_sec: float = HOLD_TALK_MAX_SEC
    ) -> bool:
        """Lepas hold talk → idle jika antrian kosong terlalu lama (BE diam/reload)."""
        with self._lock:
            if self._utterance_active or not self._talk_pinned:
                self._hold_talk_since = None
                return False
            if queue_has_ready:
                # Masih ada utterance siap — reset timer, tunggu begin_utterance.
                self._hold_talk_since = time.perf_counter()
                return False
            now = time.perf_counter()
            if self._hold_talk_since is None:
                self._hold_talk_since = now
                return False
            if (now - self._hold_talk_since) < max(0.5, float(max_sec)):
                return False
            self._talk_pinned = False
            self._talk_target = None
            self._hold_talk_since = None
            self._talk_direction = 1
            if not self.pending_action:
                self.pending_action = self.bank._idle_name
            self.state = PlayState.IDLE
            get_telemetry().inc("hold_talk_to_idle")
            print(
                f"[StateMachine] Hold talk timeout ({max_sec:.1f}s) → idle "
                "(tidak ada utterance berikutnya)"
            )
            return True

    def _clip_span(self, clip: ClipAsset) -> int:
        return max(1, clip.end_pose - clip.base_pose_frame + 1)

    def _wrapped_index(self, clip: ClipAsset, idx: int) -> int:
        span = self._clip_span(clip)
        if clip.loop:
            return clip.base_pose_frame + (int(idx) - clip.base_pose_frame) % span
        return max(clip.base_pose_frame, min(int(idx), clip.end_pose))

    def _dynamic_overlap_n(
        self, from_clip: Optional[ClipAsset], from_idx: int, to_clip: ClipAsset
    ) -> int:
        """Overlap cepat dan rapi (4-6 frame) agar tidak ghosting/goyang."""
        base_n = max(3, min(self.overlap_frames, self.crossfade_frames))
        if from_clip is None:
            return base_n
        dist = abs(int(from_idx) - int(to_clip.base_pose_frame))
        span = max(1, from_clip.end_pose - from_clip.base_pose_frame)
        extra = int(round(2.0 * min(1.0, dist / float(span))))
        return max(3, min(base_n + extra, OVERLAP_FRAMES_MAX))

    def _build_overlap_pairs(
        self,
        from_clip: ClipAsset,
        from_idx: int,
        to_clip: ClipAsset,
        n: int,
    ) -> Tuple[List[Tuple[np.ndarray, np.ndarray]], List[int]]:
        """Pasangan frame untuk blend tubuh (bergerak maju mulus tanpa lompat mundur)."""
        self.bank.ensure_frames(from_clip)
        self.bank.ensure_frames(to_clip)
        n = max(3, min(int(n), OVERLAP_FRAMES_MAX))
        pairs: List[Tuple[np.ndarray, np.ndarray]] = []
        target_cycles: List[int] = []
        span_from = max(1, from_clip.end_pose - from_clip.base_pose_frame)
        span_to = max(1, to_clip.end_pose - to_clip.base_pose_frame)
        for i in range(n):
            if from_clip.loop:
                src_offset = (int(from_idx) - from_clip.base_pose_frame + i) % span_from
                src_i = from_clip.base_pose_frame + src_offset
            else:
                src_i = min(int(from_idx) + i, from_clip.end_pose)
            dst_offset = i % span_to
            dst_i = to_clip.base_pose_frame + dst_offset
            fa, _ = from_clip.forward_at(src_i)
            fb, _ = to_clip.forward_at(dst_i)
            pairs.append((fa.copy(), fb.copy()))
            target_cycles.append(int(dst_i))
        return pairs, target_cycles

    def _start_talk_loop_wrap(self, clip: ClipAsset) -> None:
        """Loop mid-speech: soft wrap bila seamless; else ping-pong (no morph)."""
        metrics = get_telemetry()
        if not clip.is_seamless_loop:
            # Non-seamless: reverse direction instead of end→base morph.
            self._talk_direction = -1
            self.frame_idx = max(clip.base_pose_frame, clip.end_pose - 1)
            self._talk_loop_count += 1
            metrics.inc("talk_ping_pong")
            print(
                f"[StateMachine] Ping-pong reverse {clip.name} "
                f"(seamless={clip.seamless_score:.3f})"
            )
            return

        n = max(3, min(int(self.overlap_frames), OVERLAP_FRAMES_MAX))
        try:
            pairs, target_cycles = self._build_overlap_pairs(
                clip, clip.end_pose, clip, n
            )
        except Exception as err:
            print(f"[StateMachine] Loop wrap notice: {err}")
            return
        if not pairs:
            return
        resume = clip.base_pose_frame + len(pairs)
        if resume > clip.end_pose:
            resume = clip.base_pose_frame
        self._overlap = _OverlapTransition(
            pairs=pairs,
            step=0,
            resume_frame_idx=resume,
            target_cycle_indices=target_cycles,
        )
        self._talk_loop_count += 1
        metrics.inc("soft_loop_wrap")
        print(
            f"[StateMachine] Soft loop wrap {self.current_name} "
            f"end→base ({len(pairs)}f)"
        )

    def _transition_guard(self, from_clip: Optional[ClipAsset], to_clip: ClipAsset, from_idx: int, to_idx: int) -> bool:
        """Blokir transisi hard-cut raksasa yang memicu jump jarak besar."""
        if from_clip is None:
            return False
        span = max(1, from_clip.end_pose - from_clip.base_pose_frame + 1)
        jump = abs(int(to_idx) - int(from_idx))
        return jump > max(8, span // 4)

    def _cut_to_clip(
        self,
        to_name: str,
        new_state: PlayState,
        lock_face: bool = False,
        soft: bool = True,
    ) -> None:
        """Ganti clip — soft overlap tubuh bila memungkinkan (hindari patah mid-pose)."""
        to_clip = self.bank.get_clip(to_name)
        if to_clip is None:
            return
        from_name = self.current_name
        from_idx = int(self.frame_idx)
        from_clip = self.bank.get_clip(from_name)
        metrics = get_telemetry()

        # Soft blend jika ganti clip (atau loncat jauh di clip yang sama).
        jump_same = (
            from_name == to_name
            and abs(from_idx - to_clip.base_pose_frame) > 3
            and not (
                from_idx == to_clip.base_pose_frame or from_idx >= to_clip.end_pose
            )
        )
        want_soft = (
            soft and from_clip is not None and (from_name != to_name or jump_same)
        )
        target_idx = to_clip.base_pose_frame
        if self._transition_guard(from_clip, to_clip, from_idx, target_idx):
            soft = True
            want_soft = True
        if want_soft:
            n = self._dynamic_overlap_n(from_clip, from_idx, to_clip)
            try:
                pairs, target_cycles = self._build_overlap_pairs(
                    from_clip, from_idx, to_clip, n
                )
            except Exception as err:
                print(f"[StateMachine] Soft transition notice: {err}")
                pairs, target_cycles = [], []
            if pairs:
                resume = to_clip.base_pose_frame + len(pairs)
                if resume > to_clip.end_pose:
                    resume = to_clip.base_pose_frame
                self._overlap = _OverlapTransition(
                    pairs=pairs,
                    step=0,
                    resume_frame_idx=resume,
                    target_cycle_indices=target_cycles,
                )
                self.current_name = to_name
                self.frame_idx = resume
                self.state = new_state
                self._talk_direction = 1
                if lock_face and self._face_registry:
                    lock_idx = min(to_clip.base_pose_frame, to_clip.end_pose)
                    self._face_registry.lock_from_clip(to_clip, lock_idx)
                metrics.inc("soft_cut")
                print(
                    f"[StateMachine] Soft {from_name}@{from_idx} → {to_name}@{resume} "
                    f"({len(pairs)}f, state={new_state.name})"
                )
                return

        self._overlap = None
        self.current_name = to_name
        self.frame_idx = to_clip.base_pose_frame
        self.state = new_state
        self._talk_direction = 1
        if lock_face and self._face_registry:
            lock_idx = min(to_clip.base_pose_frame, to_clip.end_pose)
            self._face_registry.lock_from_clip(to_clip, lock_idx)
        if from_name != to_name or from_idx != self.frame_idx:
            metrics.inc("hard_cut")
            print(
                f"[StateMachine] Cut {from_name}@{from_idx} → {to_name}@{self.frame_idx} "
                f"(state={new_state.name})"
            )

    def _clip_in_progress(self, clip: ClipAsset) -> bool:
        """True while a non-looping clip has not reached its last frame."""
        if clip.loop and self.state != PlayState.TALK:
            return False
        if self.state == PlayState.TALK and self._utterance_active:
            if self._post_speech_gesture_active:
                return self.frame_idx < clip.end_pose
            if not self._utterance_audio_done:
                return True
            if self._scheduled_gesture:
                return True
            return self.frame_idx < clip.end_pose
        if self.state == PlayState.ACTION and not clip.loop:
            return self.frame_idx < clip.end_pose
        return False

    def _try_consume_pending(self, clip: ClipAsset) -> bool:
        if self._playthrough_lock or self._utterance_active:
            return False
        if self._clip_in_progress(clip):
            return False
        if not self.pending_action:
            if self._action_queue:
                self.pending_action = self._action_queue.popleft()
            else:
                return False
        raw = self.pending_action
        target = self.bank.resolve_action(raw)
        self.pending_action = None
        if target == self.current_name:
            return False

        at_base = self.frame_idx == clip.base_pose_frame
        at_end = self.frame_idx >= clip.end_pose

        if not (at_base or at_end):
            self.pending_action = raw
            return False

        idle_name = self.bank._idle_name
        talk_name = self.bank.talk_clip_name()
        if _is_true_idle_name(target) or target in (idle_name, "idle"):
            new_state = PlayState.IDLE
        elif _is_talk_clip_name(target) or target == talk_name:
            # Talk body: TALK state saat utterance/hold; selain itu tetap putar sebagai body.
            new_state = (
                PlayState.TALK
                if (self._utterance_active or self._talk_pinned)
                else PlayState.IDLE
            )
        else:
            new_state = PlayState.ACTION
        lock_face = _is_talk_clip_name(target) and self._utterance_active
        self._cut_to_clip(target, new_state, lock_face=lock_face)
        if new_state == PlayState.ACTION:
            self._playthrough_lock = True
        else:
            self._playthrough_lock = False
        return True

    def _advance_frame_index(self, clip: ClipAsset, is_speech: bool) -> None:
        """Advance index; soft-loop / ping-pong saat bicara; hold setelah audio."""
        direction = int(self._talk_direction) if self.state == PlayState.TALK else 1
        self.frame_idx += direction
        end_pf = clip.end_pose
        base_pf = clip.base_pose_frame

        if self.state == PlayState.TALK and (
            self._utterance_active or self._talk_pinned
        ):
            if direction < 0:
                # Ping-pong reverse: bounce back to forward at base.
                if self.frame_idx < base_pf:
                    self._talk_direction = 1
                    self.frame_idx = min(end_pf, base_pf + 1)
                    self._talk_loop_count += 1
                    get_telemetry().inc("talk_ping_pong")
                return
            if self.frame_idx > end_pf:
                # Soft wrap end→base (seamless) atau ping-pong (non-seamless).
                if self._overlap is None:
                    self.frame_idx = end_pf
                    self._start_talk_loop_wrap(clip)
                    if self._overlap is not None:
                        return
                    # Ping-pong path already set frame_idx + direction.
                    if self._talk_direction < 0:
                        return
                self.frame_idx = base_pf
                self._talk_loop_count += 1
            return

        if self.frame_idx > end_pf:
            if clip.loop and not self._playthrough_lock:
                if (
                    self.state == PlayState.IDLE
                    and not self._utterance_active
                    and not self._talk_pinned
                    and not self.pending_action
                    and len(self._idle_variants) > 1
                    and self.current_name in self._idle_variants
                ):
                    nxt = self._choose_next_idle_variant(exclude=self.current_name)
                    if nxt:
                        self.frame_idx = end_pf
                        self.pending_action = nxt
                        self._schedule_next_ambient()
                        return
                if clip.is_seamless_loop:
                    self.frame_idx = base_pf
                else:
                    # Idle non-seamless: hard wrap ke base (soft morph di talk path saja).
                    self.frame_idx = base_pf
                return

            self.frame_idx = end_pf
            self._playthrough_lock = False
            if not self._utterance_active:
                if not self.pending_action:
                    # Kembali ke idle setelah action non-loop.
                    self.pending_action = self.bank._idle_name
                self._drain_action_queue()
        elif self.frame_idx < base_pf and direction < 0:
            self._talk_direction = 1
            self.frame_idx = base_pf

    def _drain_action_queue(self) -> None:
        if self._action_queue and not self.pending_action:
            self.pending_action = self._action_queue.popleft()

    def next_packet(
        self,
        audio_pcm: bytes,
        is_speech: bool,
        llm_action: Optional[str] = None,
        whisper_idx: Optional[int] = None,
    ) -> RawFramePacket:
        with self._lock:
            if self._pending_begin_utterance and not self._utterance_active:
                # Coba lagi setelah frame maju ke rest pose.
                self.begin_utterance()
            self._maybe_queue_ambient_gesture()

            clip = self.bank.get_clip(self.current_name)
            if clip is None:
                raise RuntimeError(f"Clip missing: {self.current_name}")
            cycle_idx = 0
            frame: np.ndarray

            if self._hold_pose_for_infer and not self._utterance_active:
                # Legacy path — sebaiknya tidak dipakai; tubuh harus tetap maju.
                body, cycle_idx = clip.forward_at(self.frame_idx)
                self._advance_frame_index(clip, is_speech)
                frame = body.copy()
            elif self._overlap is not None and self._overlap.step < len(
                self._overlap.pairs
            ):
                from_f, to_f = self._overlap.pairs[self._overlap.step]
                n = len(self._overlap.pairs)
                t = (self._overlap.step + 1) / float(n)
                alpha = _ease_in_out(t)
                frame = blend_weighted(from_f, to_f, alpha)
                if self._overlap.target_cycle_indices and self._overlap.step < len(
                    self._overlap.target_cycle_indices
                ):
                    cycle_idx = int(
                        self._overlap.target_cycle_indices[self._overlap.step]
                    )
                else:
                    cycle_idx = int(self.frame_idx)
                self._overlap.step += 1
                if self._overlap.step >= n:
                    self.frame_idx = self._overlap.resume_frame_idx
                    self._overlap = None
            else:
                self._try_consume_pending(clip)
                clip = self.bank.get_clip(self.current_name)
                if clip is None:
                    raise RuntimeError(f"Clip missing: {self.current_name}")

                if self.state == PlayState.IDLE:
                    body, cycle_idx = clip.forward_at(self.frame_idx)
                    self._advance_frame_index(clip, is_speech)
                elif self._utterance_active and self.state == PlayState.TALK:
                    body, cycle_idx = clip.forward_at(self.frame_idx)
                    self._advance_frame_index(clip, is_speech)
                else:
                    body, cycle_idx = clip.material_at(self.frame_idx)
                    self._advance_frame_index(clip, is_speech)
                frame = body.copy()

            talk_target = self._talk_target or self.bank.talk_clip_name()
            # Lipsync tetap ON saat soft overlap jika sudah bicara — cegah mulut tertutup.
            needs_lipsync = (
                is_speech
                and self.state == PlayState.TALK
                and (self._utterance_active or self._talk_pinned)
                and (
                    self.current_name == talk_target
                    or self.bank.clip_has_musetalk(self.current_name)
                    or self._overlap is not None
                )
            )

            pkt = RawFramePacket(
                seq=self._seq,
                frame=frame,
                clip_name=self.current_name,
                frame_idx=self.frame_idx,
                cycle_idx=cycle_idx,
                state=self.state,
                needs_lipsync=needs_lipsync,
                audio_pcm=audio_pcm,
                is_speech=is_speech,
                whisper_idx=None,
            )
            self._seq += 1
            return pkt


class LipSyncEngine:
    """Generate mouth crops ahead of audio, then composite onto the live body frame."""

    def __init__(
        self,
        models_bundle,
        bank: "AssetBank",
        batch_size: int = 8,
        face_registry: Optional[FaceCoordRegistry] = None,
    ):
        self.models = models_bundle
        self.bank = bank
        self.batch_size = max(1, batch_size)
        self.device = models_bundle["device"]
        self.weight_dtype = models_bundle["weight_dtype"]
        self._face_registry = face_registry
        self._lock = threading.Lock()
        self._utterance_id: Optional[str] = None
        self._whisper_chunks: Optional[torch.Tensor] = None
        self._mouths: Dict[int, np.ndarray] = {}
        self._infer_cursor = 0
        self._infer_stop = threading.Event()
        self._infer_thread: Optional[threading.Thread] = None
        self._talk_clip_name = "talk_1"
        self._start_frame_idx = 0
        self._last_mouth_256: Optional[np.ndarray] = None
        self._last_mouth_frame = None
        self._prev_composed: Optional[np.ndarray] = None
        self._feather_cache: dict = {}
        self._square_pad = True
        try:
            from inference import musetalk_visual_params

            self._square_pad = bool(musetalk_visual_params().get("square_pad", True))
        except Exception:
            pass

    def set_utterance(
        self, job, start_frame_idx: int = 0, body_clip: Optional[str] = None
    ) -> None:
        """Mulai batch-ahead inference untuk satu utterance."""
        if job is not None and self._utterance_id == getattr(job, "task_id", None):
            return
        self.clear_utterance()
        if job is None or job.whisper_chunks is None:
            print(
                f"[LipSync] Skip infer {getattr(job, 'task_id', '?')}: "
                "whisper_chunks kosong — mulut tidak akan bergerak"
            )
            return
        talk = body_clip or self.bank.pick_talk_clip()
        if not self.bank.clip_has_musetalk(talk):
            talk = self.bank.crash_fallback_name()
        if talk in self.bank.clips:
            self._talk_clip_name = talk
        start_idx = int(start_frame_idx)
        with self._lock:
            self._utterance_id = job.task_id
            self._whisper_chunks = job.whisper_chunks
            self._start_frame_idx = start_idx
            self._mouths = {}
            self._infer_cursor = 0
            self._last_mouth_256 = None
            self._prev_composed = None
        self._infer_stop.clear()
        self._infer_thread = threading.Thread(
            target=self._batch_inference_loop,
            name=f"LipSync-{job.task_id[:20]}",
            daemon=True,
        )
        self._infer_thread.start()
        print(
            f"[LipSync] Infer {job.task_id}: {int(job.whisper_chunks.shape[0])} frames, "
            f"batch={self.batch_size}, body={self._talk_clip_name}, "
            f"start_frame={start_idx}"
        )

    def wait_preroll(
        self, n: int = LIPSYNC_PREROLL_FRAMES, timeout: float = 2.0
    ) -> bool:
        """Tunggu mouth crop awal siap sebelum audio mulai.

        Hard preroll (default): wajib ready >= need; timeout = False (delay start).
        Soft (legacy): ready >= 1–2 masih dianggap cukup.
        """
        metrics = get_telemetry()
        with self._lock:
            chunks = self._whisper_chunks
        if chunks is None:
            return False
        need = min(max(1, int(n)), int(chunks.shape[0]))
        deadline = time.monotonic() + max(0.05, timeout)
        while time.monotonic() < deadline:
            with self._lock:
                ready = sum(1 for i in range(need) if i in self._mouths)
            if ready >= need:
                return True
            if self._infer_stop.is_set():
                return False
            time.sleep(0.008)
        with self._lock:
            ready = sum(1 for i in range(need) if i in self._mouths)
        print(f"[LipSync] Preroll {ready}/{need} (timeout)")
        metrics.inc("preroll_timeout")
        if LIPSYNC_HARD_PREROLL:
            return ready >= need
        # Legacy soft: jangan anggap siap jika belum ada mouth sama sekali.
        return ready >= max(1, min(2, need))

    def clear_utterance(self) -> None:
        self._infer_stop.set()
        if self._infer_thread and self._infer_thread.is_alive():
            self._infer_thread.join(timeout=1.0)
        with self._lock:
            self._utterance_id = None
            self._whisper_chunks = None
            self._mouths = {}
            self._infer_cursor = 0
            self._start_frame_idx = 0
            self._last_mouth_256 = None
            self._prev_composed = None
        self._infer_thread = None

    def _latent_index(self, clip: ClipAsset, body_idx: int) -> int:
        """Hitung latent index dari body pose index.

        Sebelumnya: nlat // 2 (half-cycle) → latent tidak match body pose → desync.
        Sekarang: full-cycle modulo, konsisten dengan material_at() di ClipAsset.
        """
        nlat = max(1, len(clip.latent_list_cycle))
        # Span aktual clip (base→end) — modulo dalam span yang sama.
        span = max(1, clip.end_pose - clip.base_pose_frame + 1)
        forward_n = min(nlat, span)
        offset = max(0, int(body_idx) - clip.base_pose_frame)
        return offset % max(1, forward_n)

    def _batch_inference_loop(self) -> None:
        vae = self.models["vae"]
        unet = self.models["unet"]
        pe = self.models["pe"]
        timesteps = self.models["timesteps"]
        clip = self.bank.get_clip(self._talk_clip_name) or self.bank.idle_clip
        if not clip.latent_list_cycle:
            print(f"[LipSync] ERROR: No latents for {clip.name} — lip-sync disabled")
            return

        print(
            f"[LipSync] Starting batch inference for {clip.name}, {len(clip.latent_list_cycle)} latents"
        )
        batch_count = 0
        while not self._infer_stop.is_set():
            with self._lock:
                chunks = self._whisper_chunks
                cursor = self._infer_cursor
            if chunks is None or cursor >= chunks.shape[0]:
                break

            with self._lock:
                start_idx = int(self._start_frame_idx)
            end = min(cursor + self.batch_size, chunks.shape[0])
            whisper_batch = chunks[cursor:end].to(
                device=self.device, dtype=self.weight_dtype
            )
            latent_list = []
            for i in range(cursor, end):
                body_idx = _talk_body_index(clip, i, start_idx)
                lat_idx = self._latent_index(clip, body_idx)
                lat = clip.latent_list_cycle[lat_idx]
                if lat is None:
                    lat = clip.latent_list_cycle[0]
                latent_list.append(lat.unsqueeze(0) if lat.dim() == 3 else lat)

            if not latent_list:
                print(f"[LipSync] ERROR: Empty latent list at cursor {cursor}")
                break

            latent_batch = torch.cat(latent_list, dim=0).to(
                device=self.device, dtype=self.weight_dtype
            )
            metrics = get_telemetry()
            try:
                with metrics.measure("musetalk_batch_ms"):
                    audio_feature_batch = pe(whisper_batch)
                    pred = unet.model(
                        latent_batch,
                        timesteps,
                        encoder_hidden_states=audio_feature_batch,
                    ).sample
                    recon = vae.decode_latents(pred)
            except Exception as err:
                import traceback

                print(f"[LipSync] ERROR batch infer cursor={cursor}-{end}: {err}")
                traceback.print_exc()
                with self._lock:
                    self._infer_cursor = end
                continue

            for local_i, res_frame in enumerate(recon):
                frame_idx = cursor + local_i
                mouth_256 = np.ascontiguousarray(res_frame.astype(np.uint8))
                with self._lock:
                    self._mouths[frame_idx] = mouth_256
                    self._last_mouth_256 = mouth_256

            with self._lock:
                self._infer_cursor = end
            batch_count += 1
            if batch_count % 10 == 0:
                print(
                    f"[LipSync] Processed {self._infer_cursor}/{chunks.shape[0]} frames"
                )

        print(
            f"[LipSync] Batch inference complete: {batch_count} batches, {self._infer_cursor} frames"
        )

    def _wait_mouth(
        self, idx: int, timeout: float = LIPSYNC_WAIT_SEC
    ) -> Optional[np.ndarray]:
        """Tunggu mouth crop. Default: jangan sticky last-mouth (body-only lebih baik)."""
        deadline = time.perf_counter() + max(0.0, timeout)
        attempt = 0
        metrics = get_telemetry()
        while True:
            with self._lock:
                cached = self._mouths.get(idx)
                last = self._last_mouth_256
                cursor = self._infer_cursor
            if cached is not None:
                return cached
                result = cached
                if result is not None:
                    self._last_mouth_frame = result
                return result
            if not MOUTH_MISS_BODY_ONLY and cursor > idx and last is not None:
                if attempt == 0:
                    print(
                        f"[LipSync] WARNING: Using last mouth for idx={idx} "
                        f"(cursor={cursor})"
                    )
                    metrics.inc("mouth_fallback_last")
                return last
                result = last
                if result is not None:
                    self._last_mouth_frame = result
                return result
            if time.perf_counter() >= deadline:
                if MOUTH_MISS_BODY_ONLY:
                    return None
                return last
                mouth = self._last_mouth_frame
                if mouth is not None:
                    return mouth
                return None
            time.sleep(0.004)
            attempt += 1

    def _material_for(self, clip: ClipAsset, cidx: int) -> Optional[Tuple]:
        n = len(clip.mask_materials_cycle) if clip.mask_materials_cycle else 0
        cache_idx = cidx % n if n else cidx
        key = (clip.name, cache_idx)
        cached = self._feather_cache.get(key)
        if cached is not None:
            return cached
        mat = None
        if self._face_registry is not None:
            mat = self._face_registry.get_material(clip, cidx)
        if mat is None and clip.mask_materials_cycle:
            raw = clip.mask_materials_cycle[cidx % len(clip.mask_materials_cycle)]
            if raw:
                mask_array, crop_box, face_box = raw
                mat = (
                    feather_mask(mask_array),
                    crop_box,
                    tuple(int(v) for v in face_box),
                )
        if mat is not None:
            self._feather_cache[key] = mat
        return mat

    def _compose_mouth(
        self,
        body: np.ndarray,
        mouth_256: np.ndarray,
        clip: ClipAsset,
        cidx: int,
        pcm: bytes,
        whisper_idx: Optional[int] = None,
    ) -> np.ndarray:
        from musetalk.utils.blending import get_image_blending
        from inference import resize_generated_to_bbox

        mat = self._material_for(clip, cidx)
        if mat is None:
            print(f"[LipSync] ERROR: No material for clip={clip.name} cidx={cidx}")
            return body
        mask_array, crop_box, face_box = mat
        x1, y1, x2, y2 = [int(v) for v in face_box]
        if x2 <= x1 or y2 <= y1:
            print(f"[LipSync] ERROR: Invalid face_box {face_box}")
            return body
        x1 = max(0, min(x1, body.shape[1] - 2))
        x2 = max(x1 + 1, min(x2, body.shape[1]))
        y1 = max(0, min(y1, body.shape[0] - 2))
        y2 = max(y1 + 1, min(y2, body.shape[0]))
        face_box = (x1, y1, x2, y2)
        try:
            mouth = resize_generated_to_bbox(
                mouth_256, face_box, square_pad=self._square_pad
            )
            orig = body[y1:y2, x1:x2]
            if orig.size == 0:
                print(f"[LipSync] ERROR: Empty orig crop for face_box={face_box}")
                return body
            # Jangan mix/unsharp: VAE 256 + lerp idle = bibir buram.
            strength = _mouth_strength_for_pcm(pcm)
            if strength >= 0.999 and float(MOUTH_MAX_DELTA) <= 0:
                damped = mouth
            else:
                damped = _dampen_generated_mouth(orig, mouth, strength)
            if (
                self._prev_composed is not None
                and self._prev_composed.shape == damped.shape
                and 0.0 < MOUTH_TEMPORAL < 0.95
            ):
                damped = cv2.addWeighted(
                    self._prev_composed,
                    float(MOUTH_TEMPORAL),
                    damped,
                    1.0 - float(MOUTH_TEMPORAL),
                    0,
                )
            jump = float(MOUTH_FRAME_DELTA)
            if (
                jump > 0
                and self._prev_composed is not None
                and self._prev_composed.shape == damped.shape
            ):
                prev_f = self._prev_composed.astype(np.float32)
                now_f = damped.astype(np.float32)
                damped = np.clip(
                    prev_f + np.clip(now_f - prev_f, -jump, jump),
                    0,
                    255,
                ).astype(np.uint8)
            self._prev_composed = damped
            blended = get_image_blending(
                body, damped, list(face_box), mask_array, crop_box
            )
            return blended
        except Exception as err:
            import traceback

            print(f"[LipSync] ERROR composing mouth: {err}")
            traceback.print_exc()
            return body

    @torch.no_grad()
    def process(self, pkt: RawFramePacket, clip: ClipAsset) -> np.ndarray:
        metrics = get_telemetry()
        if pkt.whisper_idx is None or not pkt.needs_lipsync:
            if pkt.whisper_idx is None:
                metrics.inc("lipsync_skipped_no_whisper_idx")
            else:
                metrics.inc("lipsync_skipped_no_needs_lipsync")
            self._prev_composed = None
            return pkt.frame

        if not pkt.clip_name:
            metrics.inc("lipsync_skipped_wrong_clip")
            self._prev_composed = None
            return pkt.frame

        # Prefer talk clip; jangan skip lipsync jika body juga punya MuseTalk materials
        # (soft-cut / hold) — mulut tertutup jauh lebih jelek daripada mask mismatch.
        if (
            self._talk_clip_name
            and pkt.clip_name != self._talk_clip_name
            and not self.bank.clip_has_musetalk(pkt.clip_name)
        ):
            metrics.inc("lipsync_skipped_wrong_clip")
            self._prev_composed = None
            return pkt.frame

        mouth_idx = int(pkt.whisper_idx) + LIPSYNC_SYNC_SHIFT
        with self._lock:
            total = (
                0
                if self._whisper_chunks is None
                else int(self._whisper_chunks.shape[0])
            )
        if total > 0:
            mouth_idx = max(0, min(mouth_idx, total - 1))

        mouth = self._wait_mouth(mouth_idx)
        if mouth is None:
            if MOUTH_MISS_BODY_ONLY:
                metrics.inc("mouth_miss_body_only")
                self._prev_composed = None
                return pkt.frame
            with self._lock:
                mouth = self._last_mouth_256
            if mouth is not None:
                metrics.inc("mouth_fallback_last")
        if mouth is None:
            metrics.inc("lipsync_cache_miss")
            return pkt.frame
        metrics.inc("lipsync_cache_hit")

        return self._compose_mouth(
            pkt.frame,
            mouth,
            clip,
            int(pkt.cycle_idx),
            pkt.audio_pcm,
            whisper_idx=pkt.whisper_idx,
        )


def lipsync_worker_loop(
    bank: AssetBank,
    engine: LipSyncEngine,
    raw_q: queue.Queue,
    render_q: queue.Queue,
    stop_event: threading.Event,
) -> None:
    metrics = get_telemetry()
    frame_count = 0
    while not stop_event.is_set():
        try:
            pkt: RawFramePacket = raw_q.get(timeout=0.05)
        except queue.Empty:
            continue
        try:
            clip = bank.clips.get(pkt.clip_name) or bank.idle_clip
            with metrics.measure("lipsync_process_ms"):
                if pkt.whisper_idx is not None or pkt.needs_lipsync:
                    frame = engine.process(pkt, clip)
                else:
                    frame = pkt.frame
                frame = fit_bgr(frame, CANVAS_W, CANVAS_H)
            out = RenderedPacket(
                seq=pkt.seq,
                frame=frame,
                audio_pcm=pkt.audio_pcm,
                clip_name=pkt.clip_name,
                frame_idx=pkt.frame_idx,
            )
            metrics.set_gauge("render_queue_depth", float(render_q.qsize()))
            speaking = bool(pkt.is_speech or pkt.needs_lipsync)
            try:
                render_q.put(out, block=False)
            except queue.Full:
                metrics.inc("render_queue_backpressure")
                try:
                    render_q.get_nowait()
                    render_q.task_done()
                except queue.Empty:
                    pass
                try:
                    render_q.put_nowait(out)
                except queue.Full:
                    metrics.inc("render_queue_dropped")
            frame_count += 1
            if frame_count % 300 == 0:
                print(
                    f"[LipSync] Processed {frame_count} frames, queue depth: {render_q.qsize()}"
                )
        except Exception as err:
            import traceback

            print(f"[LipSync] ERROR frame {pkt.seq}: {err}")
            traceback.print_exc()
            fallback = RenderedPacket(
                seq=pkt.seq,
                frame=pkt.frame,
                audio_pcm=pkt.audio_pcm,
                clip_name=pkt.clip_name,
                frame_idx=pkt.frame_idx,
            )
            try:
                render_q.put_nowait(fallback)
            except queue.Full:
                try:
                    render_q.get_nowait()
                    render_q.task_done()
                    render_q.put_nowait(fallback)
                except queue.Empty:
                    pass
                except queue.Full:
                    metrics.inc("render_queue_dropped")
        finally:
            raw_q.task_done()


def _put_raw_frame(
    raw_q: queue.Queue,
    pkt: RawFramePacket,
    metrics,
    stop_event: threading.Event,
    block_sec: float = RAW_QUEUE_BLOCK_SEC,
    *,
    must_keep: bool = False,
) -> None:
    """Bounded enqueue: drop oldest packet rather than blocking the frame clock."""
    try:
        raw_q.put_nowait(pkt)
        return
    except queue.Full:
        metrics.inc("raw_queue_backpressure")
    try:
        raw_q.get_nowait()
        raw_q.task_done()
        metrics.inc("raw_queue_dropped")
    except queue.Empty:
        return
    try:
        raw_q.put_nowait(pkt)
    except queue.Full:
        metrics.inc("raw_queue_dropped")


def frame_fetcher_loop(
    sm: VideoStateMachine,
    raw_q: queue.Queue,
    stop_event: threading.Event,
    audio_fn: Callable[[], Tuple[bytes, bool]] = get_audio_chunk,
    action_fn: Callable[[], Optional[str]] = get_llm_action,
    audio_fn_ext: Optional[Callable[[], Tuple[bytes, bool, Optional[int]]]] = None,
    bridge: Optional["SpeechBridge"] = None,
) -> None:
    period = 1.0 / float(TARGET_FPS)
    deadline = time.perf_counter()
    was_speaking = False
    metrics = get_telemetry()

    while not stop_event.is_set():
        tick_start = time.perf_counter()
        whisper_idx = None
        if audio_fn_ext is not None:
            pcm, is_speech, whisper_idx = audio_fn_ext()
        else:
            pcm, is_speech = audio_fn()

        if bridge is not None and bridge.is_utterance_active():
            if is_speech and not was_speaking:
                sm.begin_utterance()

            elif not is_speech and was_speaking and bridge.is_audio_exhausted():
                sm.mark_utterance_audio_done()
            if sm.utterance_visual_complete():
                another_ready = (
                    bridge.has_upcoming_work()
                    if hasattr(bridge, "has_upcoming_work")
                    else False
                )
                sm.end_utterance(another_utterance_ready=another_ready)
                bridge.signal_visual_complete()

        # BE reload / diam: jangan stuck hold-talk di talk clip.
        if bridge is not None and not bridge.is_utterance_active():
            queue_ready = (
                bridge.has_upcoming_work()
                if hasattr(bridge, "has_upcoming_work")
                else False
            )
            sm.release_stale_hold_talk(queue_has_ready=queue_ready)

        was_speaking = is_speech or (
            bridge is not None
            and bridge.is_utterance_active()
            and not bridge.is_audio_exhausted()
        )

        action = action_fn()
        pkt = sm.next_packet(pcm, is_speech, llm_action=action, whisper_idx=whisper_idx)
        pkt.whisper_idx = whisper_idx
        if (
            whisper_idx is not None
            and pkt.clip_name
            and sm.bank.clip_has_musetalk(pkt.clip_name)
        ):
            pkt.needs_lipsync = True
        elif not sm.bank.clip_has_musetalk(pkt.clip_name):
            pkt.needs_lipsync = False
        metrics.set_gauge("raw_queue_depth", float(raw_q.qsize()))
        if bridge is not None:
            metrics.set_gauge("utterance_queue_depth", float(bridge.pending_count()))
        _put_raw_frame(
            raw_q,
            pkt,
            metrics,
            stop_event,
            must_keep=bool(
                pkt.is_speech
                or pkt.needs_lipsync
                or (bridge is not None and bridge.is_utterance_active())
            ),
        )
        metrics.record_latency(
            "frame_fetch_tick_ms", (time.perf_counter() - tick_start) * 1000.0
        )
        deadline += period
        sleep_for = deadline - time.perf_counter()
        if sleep_for > 0:
            time.sleep(sleep_for)
        elif sleep_for < -period:
            deadline = time.perf_counter()


class _IdleFallbackPlayer:
    """Lanjutkan clip yang sama saat render queue kosong — jangan loncat ke pose lain."""

    def __init__(self, bank: AssetBank):
        self._bank = bank
        self._clip: Optional[ClipAsset] = None
        self._idx = 0
        self._direction = 1
        self._reload()

    def _reload(self) -> None:
        try:
            self._clip = self._bank.idle_clip
            self._idx = self._clip.base_pose_frame
            self._direction = 1
        except Exception:
            self._clip = None

    def sync(self, clip_name: str, frame_idx: int) -> None:
        clip = self._bank.get_clip(clip_name) if clip_name else None
        if clip is None:
            self._reload()
            return
        self._clip = clip
        self._idx = max(clip.base_pose_frame, min(int(frame_idx), clip.end_pose))
        self._direction = 1

    def next_frame(self) -> np.ndarray:
        if self._clip is None or not self._clip.frames:
            self._reload()
        if self._clip is None or not self._clip.frames:
            return np.zeros((CANVAS_H, CANVAS_W, 3), dtype=np.uint8)
        idx = max(0, min(self._idx, len(self._clip.frames) - 1))
        frame = self._clip.frames[idx].copy()
        self._idx += self._direction
        if self._idx > self._clip.end_pose:
            if self._clip.loop and self._clip.is_seamless_loop:
                self._idx = self._clip.base_pose_frame
            elif self._clip.loop:
                self._direction = -1
                self._idx = max(self._clip.base_pose_frame, self._clip.end_pose - 1)
            else:
                self._idx = self._clip.end_pose
        elif self._idx < self._clip.base_pose_frame:
            self._direction = 1
            self._idx = min(self._clip.end_pose, self._clip.base_pose_frame + 1)
        return frame


class StreamBroadcaster:
    """Push BGR + PCM to FFmpeg RTMP encoder (same pattern as frame_feed.py)."""

    _ffmpeg_ipv4_supported: Optional[bool] = None

    def __init__(
        self,
        rtmp_url: str,
        width: int = CANVAS_W,
        height: int = CANVAS_H,
        fps: int = TARGET_FPS,
    ):
        self.rtmp_url = (rtmp_url or "").strip()
        self.width = width
        self.height = height
        self.fps = fps
        self.bytes_per_audio = int(round(SAMPLE_RATE / float(fps))) * 2 * 2
        self._v_fh = None
        self._a_fh = None
        self._proc = None
        self._stderr_log = None
        self._closed = False
        self._lock = threading.Lock()
        self._progress_seen = False
        self._video_codec = "libx264"
        if not self.rtmp_url.lower().startswith(("rtmp://", "rtmps://")):
            raise ValueError(
                f"RTMP URL tidak valid (harus rtmp:// atau rtmps://): {self.rtmp_url[:80]}"
            )
        self._start_encoder()

    @classmethod
    def _want_force_ipv4(cls) -> bool:
        return True

    @classmethod
    def _ffmpeg_ipv4_flag_supported(cls) -> bool:
        if cls._ffmpeg_ipv4_supported is not None:
            return cls._ffmpeg_ipv4_supported
        import subprocess

        try:
            proc = subprocess.run(
                ["ffmpeg", "-hide_banner", "-4", "-version"],
                capture_output=True,
                timeout=8,
            )
            err = (
                (proc.stderr or proc.stdout or b"")
                .decode("utf-8", errors="ignore")
                .lower()
            )
            cls._ffmpeg_ipv4_supported = (
                proc.returncode == 0 and "unrecognized" not in err
            )
        except Exception:
            cls._ffmpeg_ipv4_supported = False
        return cls._ffmpeg_ipv4_supported

    def _build_ffmpeg_cmd(
        self,
        v_in: str,
        a_in: str,
        *,
        force_ipv4: bool,
    ) -> list:
        gop = self.fps * 2
        # Selalu libx264 — jangan NVENC (banyak pod: OpenEncodeSessionEx unsupported device).
        video_codec = "libx264"
        if "nvenc" in video_codec:
            print(
                f"[Broadcaster] Abaikan {video_codec} — paksa libx264 "
                "(set RTMP_VIDEO_CODEC=libx264)."
            )
            video_codec = "libx264"
        x264_preset = "veryfast"
        self._video_codec = video_codec
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "info",
            "-y",
        ]
        if force_ipv4:
            cmd.append("-4")
        cmd.extend(
            [
                "-fflags",
                "+nobuffer+genpts",
                "-thread_queue_size",
                "1024",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "bgr24",
                "-s",
                f"{self.width}x{self.height}",
                "-r",
                str(self.fps),
                "-probesize",
                "32",
                "-analyzeduration",
                "0",
                "-i",
                v_in,
                "-thread_queue_size",
                "1024",
                "-f",
                "s16le",
                "-ar",
                str(SAMPLE_RATE),
                "-ac",
                "2",
                "-probesize",
                "32",
                "-analyzeduration",
                "0",
                "-i",
                a_in,
                "-map",
                "0:v",
                "-map",
                "1:a",
                "-c:v",
                video_codec,
                "-preset",
                x264_preset,
                "-tune",
                "zerolatency",
                "-pix_fmt",
                "yuv420p",
                "-profile:v",
                "main",
                "-level",
                "4.0",
                "-g",
                str(gop),
                "-keyint_min",
                str(gop),
                "-sc_threshold",
                "0",
                "-b:v",
                "2500k",
                "-maxrate",
                "3000k",
                "-bufsize",
                "6000k",
                "-vsync",
                "cfr",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-af",
                "aresample=async=1000:min_hard_comp=0.100000:first_pts=0",
                "-flvflags",
                "no_duration_filesize",
                "-f",
                "flv",
                "-rtmp_live",
                "live",
                "-stimeout",
                "30000000",
                "-rw_timeout",
                "30000000",
            ]
        )
        if self.rtmp_url.lower().startswith("rtmps://"):
            cmd.extend(["-tls_verify", "0"])
        cmd.append(self.rtmp_url)
        return cmd

    @staticmethod
    def _tail_stderr(proc, max_bytes: int = 8192) -> str:
        if proc is None or proc.stderr is None:
            return ""
        try:
            import select

            text_parts = []
            fd = proc.stderr.fileno()
            deadline = time.monotonic() + 1.5
            while time.monotonic() < deadline:
                if proc.poll() is not None:
                    rest = proc.stderr.read(max_bytes)
                    if rest:
                        text_parts.append(rest.decode("utf-8", errors="ignore"))
                    break
                ready, _, _ = select.select([proc.stderr], [], [], 0.15)
                if ready:
                    chunk = proc.stderr.read(4096)
                    if chunk:
                        text_parts.append(chunk.decode("utf-8", errors="ignore"))
            body = "".join(text_parts)
            return body[-2000:] if len(body) > 2000 else body
        except Exception:
            return ""

    def _fail_start(self, out_dir: str, hint: str, stderr_tail: str = "") -> None:
        try:
            from rtmp_utils import summarize_ffmpeg_stderr, write_rtmp_status

            hint = summarize_ffmpeg_stderr(stderr_tail, hint)
            write_rtmp_status(out_dir, "failed", hint)
        except Exception:
            if out_dir:
                try:
                    from rtmp_utils import write_rtmp_status

                    write_rtmp_status(out_dir, "failed", hint)
                except Exception:
                    pass
        raise RuntimeError(hint)

    def _start_encoder(self) -> None:
        import subprocess
        import threading

        video_r, video_w = os.pipe()
        audio_r, audio_w = os.pipe()
        os.set_inheritable(video_r, True)
        os.set_inheritable(audio_r, True)
        os.set_inheritable(video_w, False)
        os.set_inheritable(audio_w, False)

        v_in = f"/proc/self/fd/{video_r}"
        a_in = f"/proc/self/fd/{audio_r}"
        out_dir = ""
        self._output_dir = out_dir
        log_fh = None
        if out_dir:
            try:
                os.makedirs(out_dir, exist_ok=True)
                log_path = os.path.join(out_dir, "ai_worker_rtmp.log")
                log_fh = open(log_path, "a", encoding="utf-8", buffering=1)
                self._stderr_log = log_fh
            except Exception:
                pass

        want_ipv4 = self._want_force_ipv4() and self._ffmpeg_ipv4_flag_supported()
        attempts = [want_ipv4, False] if want_ipv4 else [False]
        last_stderr = ""
        proc = None

        for idx, use_ipv4 in enumerate(attempts):
            cmd = self._build_ffmpeg_cmd(v_in, a_in, force_ipv4=use_ipv4)
            if idx > 0:
                print("[Broadcaster] Retry FFmpeg tanpa flag -4 (IPv4)...")
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    pass_fds=(video_r, audio_r),
                )
            except Exception as exc:
                last_stderr = str(exc)
                continue

            time.sleep(0.35)
            if proc.poll() is None:
                self._proc = proc
                break
            last_stderr = self._tail_stderr(proc)
            try:
                proc.kill()
            except Exception:
                pass
            proc = None
        else:
            os.close(video_r)
            os.close(audio_r)
            try:
                os.close(video_w)
                os.close(audio_w)
            except Exception:
                pass
            self._fail_start(
                out_dir,
                "FFmpeg RTMP gagal start — cek ai_worker_rtmp.log",
                last_stderr,
            )

        if self._proc is None or self._proc.stderr is None:
            os.close(video_r)
            os.close(audio_r)
            self._fail_start(
                out_dir, "FFmpeg RTMP gagal start (proses tidak hidup)", last_stderr
            )

        if out_dir:
            try:
                from rtmp_utils import FfmpegLogWatcher, write_rtmp_status

                def _on_progress() -> None:
                    self._progress_seen = True
                    write_rtmp_status(out_dir, "connected")

                watcher = FfmpegLogWatcher(
                    on_fatal=lambda hint: write_rtmp_status(out_dir, "failed", hint),
                    on_progress=_on_progress,
                )

                def _drain_stderr() -> None:
                    p = self._proc
                    if p is None or p.stderr is None:
                        return
                    try:
                        while True:
                            chunk = p.stderr.read(4096)
                            if not chunk:
                                break
                            text = chunk.decode("utf-8", errors="ignore")
                            if log_fh:
                                log_fh.write(text)
                                log_fh.flush()
                            watcher.ingest(text)
                    except Exception:
                        pass

                threading.Thread(target=_drain_stderr, daemon=True).start()
            except Exception as exc:
                print(f"[Broadcaster] RTMP stderr watcher notice: {exc}")

        os.close(video_r)
        os.close(audio_r)
        self._v_fh = os.fdopen(video_w, "wb", buffering=0)
        self._a_fh = os.fdopen(audio_w, "wb", buffering=0)
        print(
            f"[Broadcaster] RTMP encoder={getattr(self, '_video_codec', 'libx264')} "
            f"@ {self.fps}fps → {self.rtmp_url.split('?')[0]}?**"
        )

    def is_alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def has_progress(self) -> bool:
        """True setelah FFmpeg menulis frame=/bitrate (publish nyata, bukan soft-connect)."""
        return bool(self._progress_seen)

    @staticmethod
    def _write_all(fh, data: bytes) -> None:
        """Tulis seluruh buffer ke pipe blocking (rawvideo harus exact bytes).

        Jangan pakai O_NONBLOCK / select-timeout — partial write merusak frame,
        sedangkan blocking write di thread Broadcaster aman saat FFmpeg handshake RTMP.
        """
        view = memoryview(data)
        offset = 0
        while offset < len(view):
            n = fh.write(view[offset:])
            if n is None or n <= 0:
                raise BrokenPipeError("pipe write returned 0")
            offset += n

    def _silence_pcm(self) -> bytes:
        return b"\x00" * self.bytes_per_audio

    def write(self, frame: np.ndarray, pcm: bytes) -> bool:
        with self._lock:
            if self._closed or self._v_fh is None or self._a_fh is None:
                return False
            if getattr(self._v_fh, "closed", False) or getattr(
                self._a_fh, "closed", False
            ):
                return False
            if not self.is_alive():
                return False

            if pcm is None:
                pcm = self._silence_pcm()
            if frame is None or frame.size == 0:
                return False
            h, w = frame.shape[:2]
            if w != self.width or h != self.height:
                frame = fit_bgr(frame, self.width, self.height)
            if frame.shape[2] != 3:
                return False
            if len(pcm) < self.bytes_per_audio:
                pcm = pcm + b"\x00" * (self.bytes_per_audio - len(pcm))
            elif len(pcm) > self.bytes_per_audio:
                pcm = pcm[: self.bytes_per_audio]
            expected = self.width * self.height * 3
            buf = np.ascontiguousarray(frame, dtype=np.uint8).tobytes()
            if len(buf) != expected:
                print(
                    f"[Broadcaster] Frame size mismatch: got {len(buf)}, expected {expected}",
                    flush=True,
                )
                return False
            try:
                self._write_all(self._v_fh, buf)
                self._write_all(self._a_fh, pcm)
                return True
            except (BrokenPipeError, OSError, ValueError) as err:
                print(f"[Broadcaster] RTMP pipe error: {err}", flush=True)
                out_dir = ""
                if out_dir:
                    try:
                        from rtmp_utils import write_rtmp_status

                        write_rtmp_status(
                            out_dir,
                            "failed",
                            "FFmpeg RTMP pipe putus — cek ai_worker_rtmp.log",
                        )
                    except Exception:
                        pass
                return False

    def shutdown(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            for fh in (self._v_fh, self._a_fh):
                if fh:
                    try:
                        fh.close()
                    except Exception:
                        pass
            self._v_fh = None
            self._a_fh = None
            proc = self._proc
            self._proc = None
        if proc and proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=3)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass


def broadcaster_loop(
    bank: AssetBank,
    render_q: queue.Queue,
    stop_event: threading.Event,
    output_folder: str = "",
    bc: Optional["StreamBroadcaster"] = None,
    bridge: Optional["SpeechBridge"] = None,
) -> None:
    period = 1.0 / float(TARGET_FPS)
    deadline = time.perf_counter()
    silence = b"\x00" * BYTES_PER_AUDIO_FRAME

    fallback = bank.idle_clip.frames[bank.idle_clip.base_pose_frame].copy()
    last_good = fallback.copy()
    idle_player = _IdleFallbackPlayer(bank)
    stale_misses = 0
    pending: Dict[int, RenderedPacket] = {}
    next_seq = 0
    overlay_rgb = None
    overlay_alpha = None

    out_dir = output_folder or ""
    bridge_ref = bridge
    if bridge_ref is None:
        try:
            bridge_ref = get_speech_bridge(out_dir)
        except Exception:
            bridge_ref = None
    if out_dir:
        try:
            from rtmp_utils import write_rtmp_status
        except ImportError:
            write_rtmp_status = None
        for candidate in (
            os.path.join(out_dir, "overlay_live.png"),
            os.path.join(out_dir, "tmp_assets", "live_overlay.png"),
        ):
            if os.path.exists(candidate):
                ov = cv2.imread(candidate, cv2.IMREAD_UNCHANGED)
                if ov is not None:
                    if ov.shape[0] != CANVAS_H or ov.shape[1] != CANVAS_W:
                        ov = cv2.resize(ov, (CANVAS_W, CANVAS_H))
                    if ov.shape[2] == 4:
                        overlay_alpha = ov[:, :, 3:4].astype(np.float32) / 255.0
                        overlay_rgb = ov[:, :, :3].astype(np.float32)
                    break

    def _apply_overlay(frame: np.ndarray) -> np.ndarray:
        if overlay_alpha is None or overlay_rgb is None:
            return frame
        base = frame.astype(np.float32)
        out = base * (1.0 - overlay_alpha) + overlay_rgb * overlay_alpha
        return out.astype(np.uint8)

    if bc is None and out_dir:
        try:
            from rtmp_utils import read_rtmp_status as _read_st

            state, err = _read_st(out_dir)
            if state == "failed" and err:
                print(f"[Broadcaster] RTMP tidak aktif: {err}")
        except Exception:
            pass

    frames_written = 0
    write_fail_streak = 0
    metrics = get_telemetry()
    metrics.set_gauge("target_fps", float(TARGET_FPS))
    while not stop_event.is_set():
        tick_start = time.perf_counter()

        if out_dir:
            update_file = os.path.join(out_dir, "update_overlay.json")
            if os.path.exists(update_file):
                try:
                    # Baca payload dulu — render ulang jika API belum sempat prepare
                    # (http / data:image base64).
                    try:
                        with open(update_file, "r", encoding="utf-8") as uf:
                            upd = json.load(uf)
                        from overlay_generator import prepare_overlay_files

                        prepare_overlay_files(
                            out_dir,
                            product_name=upd.get("product_name", ""),
                            product_price=upd.get("product_price", ""),
                            product_image_url=upd.get("product_image_url", ""),
                            banner_image_url=upd.get("banner_image_url", ""),
                        )
                    except Exception as prep_err:
                        print(f"[Broadcaster] Overlay prepare notice: {prep_err}")
                    os.remove(update_file)
                    for candidate in (
                        os.path.join(out_dir, "overlay_live.png"),
                        os.path.join(out_dir, "tmp_assets", "live_overlay.png"),
                    ):
                        if os.path.exists(candidate):
                            ov = cv2.imread(candidate, cv2.IMREAD_UNCHANGED)
                            if ov is not None:
                                if ov.shape[0] != CANVAS_H or ov.shape[1] != CANVAS_W:
                                    ov = cv2.resize(ov, (CANVAS_W, CANVAS_H))
                                if ov.shape[2] == 4:
                                    overlay_alpha = (
                                        ov[:, :, 3:4].astype(np.float32) / 255.0
                                    )
                                    overlay_rgb = ov[:, :, :3].astype(np.float32)
                            break
                except Exception:
                    pass

        # Periodic check jika overlay belum sempat siap di awal (race condition)
        if out_dir and overlay_rgb is None and (frames_written % 30 == 0):
            for candidate in (
                os.path.join(out_dir, "overlay_live.png"),
                os.path.join(out_dir, "tmp_assets", "live_overlay.png"),
            ):
                if os.path.exists(candidate):
                    try:
                        ov = cv2.imread(candidate, cv2.IMREAD_UNCHANGED)
                        if ov is not None:
                            if ov.shape[0] != CANVAS_H or ov.shape[1] != CANVAS_W:
                                ov = cv2.resize(ov, (CANVAS_W, CANVAS_H))
                            if ov.shape[2] == 4:
                                overlay_alpha = (
                                    ov[:, :, 3:4].astype(np.float32) / 255.0
                                )
                                overlay_rgb = ov[:, :, :3].astype(np.float32)
                                print(f"[Broadcaster] Overlay loaded asynchronously: {candidate}")
                        break
                    except Exception:
                        pass

        while True:
            try:
                pkt = render_q.get_nowait()
                if pkt.seq < next_seq:
                    metrics.inc("broadcast_stale_packet_dropped")
                    continue
                pending[pkt.seq] = pkt
            except queue.Empty:
                break

        if len(pending) > max(1, PENDING_MAX):
            cutoff = max(next_seq, max(pending) - max(1, BROADCAST_MAX_LAG))
            for stale in [s for s in list(pending) if s < cutoff]:
                pending.pop(stale, None)
                metrics.inc("broadcast_pending_overflow")
            if cutoff > next_seq:
                next_seq = cutoff
                metrics.inc("broadcast_seq_fast_forward")

        metrics.set_gauge("render_queue_depth", float(render_q.qsize()))
        utterance_active = bridge_ref is not None and bridge_ref.is_utterance_active()

        if pending and not utterance_active:
            newest = max(pending.keys())
            if newest - next_seq > BROADCAST_MAX_LAG:
                target = max(next_seq, newest - 2)
                for stale in [s for s in list(pending.keys()) if s < target]:
                    pending.pop(stale, None)
                    metrics.inc("broadcast_lag_catchup")
                next_seq = target

        pkt = pending.pop(next_seq, None)
        if pkt is None and utterance_active:
            # Jangan menulis last_pcm berulang: audio dan MuseTalk harus maju
            # dari RenderedPacket sequence yang sama.
            wait_deadline = time.perf_counter() + max(
                BROADCAST_RENDER_WAIT_SEC, BROADCAST_SPEECH_GAP_WAIT_SEC
            )
            while pkt is None and not stop_event.is_set():
                pkt = pending.pop(next_seq, None)
                if pkt is not None:
                    break
                remaining = wait_deadline - time.perf_counter()
                if remaining <= 0:
                    metrics.inc("broadcast_speech_packet_timeout")
                    print(
                        f"[Broadcaster] Timeout menunggu speech packet seq={next_seq}; "
                        "menghentikan broadcaster agar audio tidak diulang.",
                        flush=True,
                    )
                    stop_event.set()
                    break
                try:
                    fresh: RenderedPacket = render_q.get(timeout=min(0.25, remaining))
                    if fresh.seq < next_seq:
                        metrics.inc("broadcast_stale_packet_dropped")
                    else:
                        pending[fresh.seq] = fresh
                except queue.Empty:
                    continue
            if pkt is None and not stop_event.is_set():
                metrics.inc("broadcast_seq_gap_committed")

        if pkt is None and pending:
            if utterance_active:
                future = min((seq for seq in pending if seq > next_seq), default=None)
                if future is not None:
                    metrics.inc("broadcast_seq_gap_committed")
            else:
                pick = min(pending.keys())
                for stale in [s for s in list(pending.keys()) if s < pick]:
                    pending.pop(stale, None)
                pkt = pending.pop(pick, None)
                if pkt is not None and pick != next_seq:
                    metrics.inc("broadcast_seq_resync")
                next_seq = pick

        if pkt is not None:
            last_good = pkt.frame
            pcm = pkt.audio_pcm
            stale_misses = 0
            if pkt.clip_name:
                idle_player.sync(pkt.clip_name, pkt.frame_idx)
            consumed_seq = True
        else:
            consumed_seq = False
            stale_misses += 1
            metrics.inc("broadcast_fallback_frames")
            # Micro-advance body instead of freezing last_good (lebih natural).
            if stale_misses >= 1:
                last_good = idle_player.next_frame()
                if utterance_active:
                    metrics.inc("broadcast_micro_advance")
                elif stale_misses >= IDLE_FALLBACK_AFTER:
                    metrics.inc("idle_fallback_frames")
            pcm = silence

        frame_out = _apply_overlay(last_good)
        if bc and not stop_event.is_set():
            if not bc.is_alive():
                write_fail_streak += 1
                if write_fail_streak >= 25 and out_dir:
                    try:
                        from rtmp_utils import write_rtmp_status as _wrs

                        _wrs(
                            out_dir,
                            "failed",
                            "FFmpeg RTMP berhenti — cek ai_worker_rtmp.log",
                        )
                    except Exception:
                        pass
            else:
                write_start = time.perf_counter()
                try:
                    wrote = bc.write(frame_out, pcm)
                except Exception as write_err:
                    print(f"[Broadcaster] write error: {write_err}", flush=True)
                    wrote = False
                metrics.record_latency(
                    "ffmpeg_write_ms", (time.perf_counter() - write_start) * 1000.0
                )
                if wrote:
                    frames_written += 1
                    write_fail_streak = 0
                    metrics.inc("frames_written")
                    metrics.note_broadcast_frame()
                    if frames_written == 2 and out_dir:
                        try:
                            from rtmp_utils import write_rtmp_status as _wrs

                            _wrs(out_dir, "connected")
                        except Exception:
                            pass
                else:
                    write_fail_streak += 1
                    if write_fail_streak >= 50 and out_dir:
                        try:
                            from rtmp_utils import write_rtmp_status as _wrs

                            _wrs(
                                out_dir,
                                "failed",
                                "FFmpeg tidak menerima frame — cek ai_worker_rtmp.log",
                            )
                        except Exception:
                            pass
        # Commit every output tick so a missing speech packet cannot stall the timeline.
        if consumed_seq or pkt is None:
            next_seq += 1

        metrics.record_latency(
            "broadcast_tick_ms", (time.perf_counter() - tick_start) * 1000.0
        )
        metrics.maybe_log_summary(target_fps=TARGET_FPS)
        deadline += period
        sleep_for = deadline - time.perf_counter()
        if sleep_for > 0:
            time.sleep(sleep_for)
        elif sleep_for < -period * 2:
            deadline = time.perf_counter()
            metrics.inc("broadcast_pacer_reset")

    if out_dir:
        try:
            from rtmp_utils import write_rtmp_status as _wrs

            _wrs(out_dir, "disconnected")
        except Exception:
            pass


class AIVisualWorker:
    """Top-level visual engine — start/stop the 3-thread pipeline."""

    def __init__(
        self,
        assets_dir: Optional[str] = None,
        host: str = "namira",
        rtmp_url: Optional[str] = None,
        output_folder: Optional[str] = None,
    ):
        default_base = (
            "/workspace/ai_live_worker"
            if os.path.exists("/workspace/ai_live_worker")
            else os.path.dirname(os.path.abspath(__file__))
        )
        self.base_dir = default_base
        self.assets_dir = assets_dir or os.path.join(self.base_dir, "assets", "3d")
        self.host = host
        self.rtmp_url = rtmp_url
        self.output_folder = output_folder or os.path.join(self.base_dir, "output")
        self.fps = TARGET_FPS

        self._models = None
        self._bank: Optional[AssetBank] = None
        self._sm: Optional[VideoStateMachine] = None
        self._engine: Optional[LipSyncEngine] = None
        self._bridge = (
            get_speech_bridge(self.output_folder) if get_speech_bridge else None
        )
        self._raw_q: queue.Queue = queue.Queue(maxsize=RAW_QUEUE_SIZE)
        self._render_q: queue.Queue = queue.Queue(maxsize=RENDER_QUEUE_SIZE)
        self._stop = threading.Event()
        self._threads: List[threading.Thread] = []
        self._running = False
        self._pipeline_active = False
        self._broadcaster: Optional[StreamBroadcaster] = None
        self._rtmp_connected = False

    def _on_utterance_ready(self, job) -> None:
        """Mulai inferensi mulut — tubuh tetap bergerak (tanpa freeze)."""
        start_idx = 0
        body = None
        if self._sm:
            task_id = getattr(job, "task_id", None)
            start_idx = self._sm.pin_talk_body(task_id)
            body = self._sm._talk_target or self._sm.current_name
        if self._engine:
            self._engine.set_utterance(job, start_frame_idx=start_idx, body_clip=body)

        def _mark_ready() -> None:
            ok = False
            try:
                if self._engine:
                    # Hard preroll: retry until mouths penuh (jangan play parsial).
                    attempts = 0
                    deadline = time.monotonic() + max(
                        8.0, LIPSYNC_PREROLL_TIMEOUT_SEC * 8.0
                    )
                    while not self._stop.is_set():
                        ok = self._engine.wait_preroll(
                            LIPSYNC_PREROLL_FRAMES,
                            timeout=LIPSYNC_PREROLL_TIMEOUT_SEC,
                        )
                        if ok:
                            break
                        attempts += 1
                        if not LIPSYNC_HARD_PREROLL:
                            break
                        if time.monotonic() >= deadline:
                            print(
                                f"[AIVisualWorker] Preroll deadline — "
                                f"start with available mouths (attempts={attempts})"
                            )
                            get_telemetry().inc("preroll_deadline_force")
                            ok = True  # unblock queue; mouths may be partial
                            break
                        time.sleep(0.05)
                else:
                    ok = True
            except Exception as err:
                print(f"[AIVisualWorker] Preroll notice: {err}")
                # Audio must keep flowing even when MuseTalk preroll fails.
                # The state machine will render body-only frames until recovery.
                ok = True
            finally:
                ready = getattr(job, "lipsync_ready", None)
                if ready is not None:
                    ready.set()

        threading.Thread(
            target=_mark_ready,
            name=f"Preroll-{getattr(job, 'task_id', '')[:16]}",
            daemon=True,
        ).start()

    def _on_utterance_start(self, job) -> None:
        if self._engine and getattr(self._engine, "_utterance_id", None) != getattr(
            job, "task_id", None
        ):
            task_id = getattr(job, "task_id", None)
            start_idx = self._sm.pin_talk_body(task_id) if self._sm else 0
            body = (
                (self._sm._talk_target or self._sm.current_name) if self._sm else None
            )
            self._engine.set_utterance(job, start_frame_idx=start_idx, body_clip=body)
        if self._sm:
            # Body hint talk_1|idle|talk_N — resolve ke clip.
            action = (
                (getattr(job, "action", None) or "").strip().lower().replace("-", "_")
            )
            if action in BODY_CLIP_NAMES or action in (
                "talk_1",
                "speak",
                "speaking",
                "idle",
                "rest",
                "neutral",
            ):
                resolved = self._sm.bank.resolve_action(action)
                if self._sm.bank.clip_has_musetalk(resolved):
                    explicit_talk = action in TALK_CLIP_NAMES
                    if explicit_talk and not PIN_TALK_SCENE:
                        self._sm._talk_target = resolved
                    elif explicit_talk and resolved == self._sm.bank.talk_clip_name():
                        self._sm._talk_target = resolved
                    elif not self._sm._talk_target:
                        self._sm._talk_target = resolved
            self._sm.begin_utterance()
            if job.action:
                self._sm.set_utterance_gesture(job.action)

    def _on_utterance_end(self, _job) -> None:
        if self._engine:
            self._engine.clear_utterance()
        if self._face_registry:
            self._face_registry.release_lock()

    def _load_models(self):
        if self._models is not None:
            return self._models

        musetalk_dir = os.path.join(self.base_dir, "MuseTalk")
        if self.base_dir not in sys.path:
            sys.path.insert(0, self.base_dir)
        if musetalk_dir not in sys.path:
            sys.path.insert(0, musetalk_dir)

        from gpu_compat import log_gpu_status, resolve_use_float16
        from inference import _load_models_cached, musetalk_visual_params

        log_gpu_status(0)
        use_fp16 = resolve_use_float16(True, 0)
        vis = musetalk_visual_params()
        models_root = os.path.join(musetalk_dir, "models")

        # Verify model files exist before loading
        required_files = [
            (os.path.join(models_root, "musetalkV15", "unet.pth"), "UNet weights"),
            (os.path.join(models_root, "musetalkV15", "musetalk.json"), "UNet config"),
            (os.path.join(models_root, "whisper", "config.json"), "Whisper config"),
            (os.path.join(models_root, "sd-vae-ft-mse", "config.json"), "VAE config"),
            (
                os.path.join(models_root, "face-parse-bisent", "79999_iter.pth"),
                "Face parsing model",
            ),
            (
                os.path.join(models_root, "dwpose", "dw-ll_ucoco_384.pth"),
                "DWPose model",
            ),
        ]
        for path, name in required_files:
            if not os.path.exists(path):
                raise FileNotFoundError(
                    f"Required model file missing: {name} at {path}"
                )

        print(f"[AIVisualWorker] All model files verified, loading models...")

        args = Namespace(
            gpu_id=0,
            use_float16=use_fp16,
            version="v15",
            left_cheek_width=vis["left_cheek_width"],
            right_cheek_width=vis["right_cheek_width"],
            unet_model_path=os.path.join(models_root, "musetalkV15", "unet.pth"),
            unet_config=os.path.join(models_root, "musetalkV15", "musetalk.json"),
            whisper_dir=os.path.join(models_root, "whisper"),
            vae_type="sd-vae-ft-mse",
            batch_size=8,
        )

        original_cwd = os.getcwd()
        os.chdir(musetalk_dir)
        try:
            self._models = _load_models_cached(args)
            print(
                f"[AIVisualWorker] Models loaded successfully: {list(self._models.keys())}"
            )
        except Exception as e:
            import traceback

            print(f"[AIVisualWorker] ERROR loading models: {e}")
            traceback.print_exc()
            raise
        finally:
            os.chdir(original_cwd)
        return self._models

    def initialize(self, *, force: bool = False) -> None:
        """Load models + assets. Skip jika sudah siap (Go Live kedua tanpa delay panjang)."""
        bank_stale = (
            self._bank is None
            or getattr(self._bank, "assets_dir", None) != self.assets_dir
            or getattr(self._bank, "host", None) != self.host
        )
        if (
            not force
            and not bank_stale
            and self._models is not None
            and self._sm is not None
            and self._engine is not None
        ):
            print(
                f"[AIVisualWorker] Already initialized — skip reload "
                f"(clips={list(self._bank.clips.keys())})"
            )
            if self._bridge is not None:
                self._bridge.set_models(self._models)
                self._bridge.set_callbacks(
                    on_start=self._on_utterance_start,
                    on_end=self._on_utterance_end,
                    on_ready=self._on_utterance_ready,
                )
            return

        print(f"[AIVisualWorker] Loading models + assets ({self.fps} FPS target)...")
        models = self._load_models()
        self._bank = AssetBank(self.assets_dir, host=self.host, models_bundle=models)
        self._bank.discover_and_load()

        ready = self._bank.talk_clips_ready()
        if not ready:
            raise RuntimeError(
                "Tidak ada clip bicara dengan MuseTalk (talk_1/talk_2/talk_3)"
            )
        for talk_clip_name in ready:
            talk_clip = self._bank.clips.get(talk_clip_name)
            print(
                f"[AIVisualWorker] Talk clip ready: {talk_clip_name} "
                f"(latents={len(talk_clip.latent_list_cycle)}, "
                f"masks={len(talk_clip.mask_materials_cycle)})"
            )
        print(
            f"[AIVisualWorker] Crash fallback: {self._bank.crash_fallback_name()} "
            f"(hanya jika pool bicara gagal)"
        )

        self._face_registry = FaceCoordRegistry(BBOX_SMOOTH_WINDOW)
        self._sm = VideoStateMachine(
            self._bank,
            face_registry=self._face_registry,
            overlap_frames=max(OVERLAP_FRAMES, CROSSFADE_FRAMES),
        )
        self._engine = LipSyncEngine(
            models,
            self._bank,
            batch_size=8,
            face_registry=self._face_registry,
        )
        if self._bridge is not None:
            self._bridge.set_models(models)
            self._bridge.set_callbacks(
                on_start=self._on_utterance_start,
                on_end=self._on_utterance_end,
                on_ready=self._on_utterance_ready,
            )
        print(f"[AIVisualWorker] Ready — clips: {list(self._bank.clips.keys())}")
        try:
            from inference import musetalk_visual_params

            vis = musetalk_visual_params()
            print(
                f"[AIVisualWorker] Lip-sync: fps={self.fps}, "
                f"bbox_shift={vis['bbox_shift']}, bbox_shift_x={vis.get('bbox_shift_x', 0)}, "
                f"cheek_width={vis.get('left_cheek_width', 45)}, extra_margin={vis['extra_margin']}, "
                f"upper={vis['upper_boundary_ratio']}, strength={MOUTH_STRENGTH}, "
                f"temporal={MOUTH_TEMPORAL}, max_delta={MOUTH_MAX_DELTA}, "
                f"frame_delta={MOUTH_FRAME_DELTA}, preroll={LIPSYNC_PREROLL_FRAMES}"
            )
        except Exception:
            pass

    def enqueue_utterance(
        self,
        audio_path: str,
        *,
        task_id: str,
        action: Optional[str] = None,
        priority: bool = False,
    ):
        """API entry — antri audio TTS untuk diputar live."""
        if self._bridge is None:
            raise RuntimeError("SpeechBridge tidak tersedia")
        if not self._bank:
            self.initialize()
        return self._bridge.enqueue(
            audio_path,
            task_id=task_id,
            action=action,
            priority=priority,
        )

    def request_action(self, tag: str) -> None:
        if self._sm:
            self._sm.request_action(tag)

    def _rtmp_connect_timeout_sec(self) -> float:
        raw = "90"
        try:
            return max(15.0, float(raw))
        except ValueError:
            return 90.0

    def _wait_rtmp_connected(self) -> None:
        if not self.rtmp_url or not self.output_folder:
            return
        try:
            from rtmp_utils import (
                is_deferred_rtmp_ack,
                read_rtmp_status,
                write_rtmp_status,
                USER_HINT_CONNECTING_SLOW,
            )
        except ImportError:
            return

        deferred = is_deferred_rtmp_ack(self.rtmp_url)
        started = time.monotonic()
        deadline = started + self._rtmp_connect_timeout_sec()
        print(
            f"[AIVisualWorker] Menunggu RTMP publish (frame=) "
            f"(max {int(self._rtmp_connect_timeout_sec())}s"
            f"{', Instagram/FB: butuh frame sebelum connected' if deferred else ''})..."
        )
        while time.monotonic() < deadline:
            if self._stop.is_set():
                break
            state, err = read_rtmp_status(self.output_folder)
            progress = bool(
                self._broadcaster is not None and self._broadcaster.has_progress()
            )
            # Hard connected = status connected DAN (non-IG ATAU sudah ada frame=).
            if state == "connected" and (progress or not deferred):
                self._rtmp_connected = True
                print("[AIVisualWorker] RTMP connected (publish aktif).")
                return
            if progress:
                try:
                    write_rtmp_status(self.output_folder, "connected")
                except Exception:
                    pass
                self._rtmp_connected = True
                print(
                    "[AIVisualWorker] RTMP connected — FFmpeg sudah kirim frame ke ingest."
                    + (
                        " Preview IG harus muncul; klik Siarkan di app bila siap."
                        if deferred
                        else ""
                    )
                )
                return
            if state == "failed":
                raise RuntimeError(err or "RTMP gagal — cek ai_worker_rtmp.log")
            if self._broadcaster is not None and not self._broadcaster.is_alive():
                state, err = read_rtmp_status(self.output_folder)
                raise RuntimeError(
                    err
                    or "FFmpeg RTMP berhenti saat handshake — gunakan Stream Key baru."
                )
            time.sleep(0.5)

        state, err = read_rtmp_status(self.output_folder)
        progress = bool(
            self._broadcaster is not None and self._broadcaster.has_progress()
        )
        if progress or (state == "connected" and not deferred):
            try:
                write_rtmp_status(self.output_folder, "connected")
            except Exception:
                pass
            self._rtmp_connected = True
            return
        # FFmpeg masih hidup: jangan anggap gagal fatal (terutama IG/FB deferred ACK).
        # Pipeline lanjut; status "connecting" + hint lembut — FE/BE menunggu sampai connected.
        if self._broadcaster is not None and self._broadcaster.is_alive():
            try:
                write_rtmp_status(self.output_folder, "connecting", "")
            except Exception:
                pass
            print(
                "[AIVisualWorker] RTMP masih handshake setelah timeout — "
                "lanjut pipeline, status tetap connecting (bukan gagal)."
            )
            self._rtmp_connected = False
            return
        raise RuntimeError(err or USER_HINT_CONNECTING_SLOW)

    def start(
        self,
        audio_fn: Callable[[], Tuple[bytes, bool]] = get_audio_chunk,
        action_fn: Callable[[], Optional[str]] = get_llm_action,
        audio_fn_ext: Optional[Callable[[], Tuple[bytes, bool, Optional[int]]]] = None,
        *,
        wait_rtmp: bool = True,
    ) -> None:
        if not self._bank or not self._sm or not self._engine:
            self.initialize()

        if self._running:
            return

        if any(t.is_alive() for t in self._threads):
            raise RuntimeError(
                "Pipeline lama masih berhenti — tunggu lalu coba lagi, atau restart api_server."
            )

        self._stop = threading.Event()

        if self._broadcaster is not None:
            try:
                self._broadcaster.shutdown()
            except Exception:
                pass
        self._broadcaster = None
        self._rtmp_connected = False
        if self.rtmp_url:
            try:
                from rtmp_utils import (
                    preflight_rtmp_publish,
                    validate_publish_url,
                    write_rtmp_status,
                )

                self.rtmp_url = validate_publish_url(self.rtmp_url)
                preflight_rtmp_publish(self.rtmp_url)
                os.makedirs(self.output_folder, exist_ok=True)
                pass
                write_rtmp_status(self.output_folder, "connecting")
                self._broadcaster = StreamBroadcaster(self.rtmp_url)
            except Exception as exc:
                if self.output_folder:
                    try:
                        from rtmp_utils import write_rtmp_status

                        write_rtmp_status(self.output_folder, "failed", str(exc)[:240])
                    except Exception:
                        pass
                raise

        if audio_fn_ext is None and self._bridge is not None:
            audio_fn_ext = self._bridge.get_audio_chunk
            action_fn = self._bridge.make_action_hook()

        bridge_ref = self._bridge
        broadcaster_ref = self._broadcaster
        self._threads = [
            threading.Thread(
                target=frame_fetcher_loop,
                args=(
                    self._sm,
                    self._raw_q,
                    self._stop,
                    audio_fn,
                    action_fn,
                    audio_fn_ext,
                    bridge_ref,
                ),
                name="FrameFetcher",
                daemon=True,
            ),
            threading.Thread(
                target=lipsync_worker_loop,
                args=(
                    self._bank,
                    self._engine,
                    self._raw_q,
                    self._render_q,
                    self._stop,
                ),
                name="LipSync",
                daemon=True,
            ),
            threading.Thread(
                target=broadcaster_loop,
                args=(
                    self._bank,
                    self._render_q,
                    self._stop,
                    self.output_folder,
                    broadcaster_ref,
                    bridge_ref,
                ),
                name="Broadcaster",
                daemon=True,
            ),
        ]
        for t in self._threads:
            t.start()

        self._pipeline_active = True
        print("[AIVisualWorker] Pipeline threads started — idle animation aktif")

        try:
            if wait_rtmp and self.rtmp_url:
                self._wait_rtmp_connected()
        except Exception:
            self.stop()
            raise

        self._running = True
        print("[AIVisualWorker] Pipeline running (3 threads, RTMP ready)")

    def stop(self, *, clear_queue: bool = True) -> None:
        self._stop.set()
        if self._engine:
            self._engine.clear_utterance()
        for t in self._threads:
            t.join(timeout=5.0)
        alive = [t.name for t in self._threads if t.is_alive()]
        if alive:
            print(f"[AIVisualWorker] WARNING thread masih hidup: {alive}")
        self._threads = [t for t in self._threads if t.is_alive()]
        if self._broadcaster is not None:
            try:
                self._broadcaster.shutdown()
            except Exception:
                pass
            self._broadcaster = None

        for q in (self._raw_q, self._render_q):
            while True:
                try:
                    q.get_nowait()
                except queue.Empty:
                    break

        if self._sm is not None:
            self._sm.reset_after_stop()
        if clear_queue and self._bridge is not None:
            self._bridge.clear_pending()

        self._running = False
        self._pipeline_active = False
        self._rtmp_connected = False
        print("[AIVisualWorker] Stopped")

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def is_pipeline_active(self) -> bool:
        """True saat thread pipeline hidup (termasuk saat menunggu RTMP handshake)."""
        return self._pipeline_active

    @property
    def is_accepting_utterances(self) -> bool:
        return self._pipeline_active and self._bridge is not None

    @property
    def is_rtmp_connected(self) -> bool:
        return self._rtmp_connected

    def run_forever(self, **kwargs) -> None:
        self.start(**kwargs)
        try:
            while not self._stop.is_set():
                time.sleep(0.5)
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()


_visual_worker_singleton: Optional[AIVisualWorker] = None
_visual_lock = threading.Lock()


def get_visual_worker(output_folder: str = "") -> AIVisualWorker:
    global _visual_worker_singleton
    with _visual_lock:
        if _visual_worker_singleton is None:
            _visual_worker_singleton = AIVisualWorker(
                output_folder=output_folder or None
            )
        elif output_folder:
            _visual_worker_singleton.output_folder = output_folder
        return _visual_worker_singleton


def start_visual_broadcast(
    rtmp_url: str,
    *,
    idle_video: str = "",
    output_folder: str = "",
    host: str = "namira",
) -> AIVisualWorker:
    """Mulai pipeline visual in-process (menggantikan subprocess frame_feed)."""
    assets_dir = (
        os.path.dirname(idle_video)
        if idle_video and os.path.exists(idle_video)
        else None
    )
    vw = get_visual_worker(output_folder)
    vw.rtmp_url = rtmp_url
    if assets_dir:
        vw.assets_dir = assets_dir
    vw.host = host
    if output_folder:
        vw.output_folder = output_folder
    vw.initialize()
    vw.start(wait_rtmp=True)
    return vw


def stop_visual_broadcast(*, destroy: bool = True) -> None:
    """Stop pipeline/RTMP. destroy=False menjaga model di memori (Go Live ulang cepat)."""
    global _visual_worker_singleton
    out = ""
    with _visual_lock:
        if _visual_worker_singleton is not None:
            out = getattr(_visual_worker_singleton, "output_folder", "") or ""
            _visual_worker_singleton.stop(clear_queue=destroy)
            if destroy:
                _visual_worker_singleton = None
    folder = out or ""
    if folder:
        try:
            from rtmp_utils import write_rtmp_status

            write_rtmp_status(folder, "disconnected")
        except Exception:
            pass


def pause_visual_broadcast(output_folder: str = "") -> dict:
    """Soft pause: hold speech (hapus playback_active), RTMP + idle tetap jalan."""
    out = output_folder or (
        _visual_worker_singleton.output_folder if _visual_worker_singleton else ""
    )
    if not out:
        out = ""
    os.makedirs(out, exist_ok=True) if out else None
    playback = os.path.join(out, "playback_active.flag") if out else ""
    paused_flag = os.path.join(out, "stream_paused.flag") if out else ""
    was_armed = False
    if playback and os.path.exists(playback):
        was_armed = True
        try:
            os.remove(playback)
        except OSError:
            pass
    if paused_flag:
        try:
            with open(paused_flag, "w", encoding="utf-8") as fh:
                fh.write("1" if was_armed else "0")
        except OSError:
            pass
    print("[AIVisualWorker] Soft pause — speech hold, RTMP/idle tetap")
    return {"success": True, "paused": True, "was_armed": was_armed}


def resume_visual_broadcast(output_folder: str = "") -> dict:
    """Resume soft pause: restore playback_active jika sebelumnya armed."""
    out = output_folder or (
        _visual_worker_singleton.output_folder if _visual_worker_singleton else ""
    )
    if not out:
        out = ""
    if not out:
        return {"success": False, "error": "output_folder unknown"}
    os.makedirs(out, exist_ok=True)
    playback = os.path.join(out, "playback_active.flag")
    paused_flag = os.path.join(out, "stream_paused.flag")
    restore_arm = True
    if os.path.exists(paused_flag):
        try:
            with open(paused_flag, "r", encoding="utf-8") as fh:
                restore_arm = fh.read().strip() != "0"
        except OSError:
            restore_arm = True
        try:
            os.remove(paused_flag)
        except OSError:
            pass
    if restore_arm:
        try:
            with open(playback, "w", encoding="utf-8") as fh:
                fh.write("1")
        except OSError as err:
            return {"success": False, "error": str(err)}
    print("[AIVisualWorker] Soft resume — speech playback armed kembali")
    return {"success": True, "paused": False, "playback_armed": restore_arm}


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="AI Visual Worker — 30 FPS pipeline")
    parser.add_argument(
        "--assets", default=None, help="Path to host video assets (3d/)"
    )
    parser.add_argument("--host", default="namira")
    parser.add_argument(
        "--rtmp",
        default="",
        help="RTMP publish URL (optional)",
    )
    parser.add_argument("--dry-run", action="store_true", help="No RTMP — log only")
    args = parser.parse_args()

    rtmp = None if args.dry_run or not args.rtmp else args.rtmp
    worker = AIVisualWorker(assets_dir=args.assets, host=args.host, rtmp_url=rtmp)
    worker.initialize()

    def _handle_sig(signum, _frame):
        print(f"\n[AIVisualWorker] signal {signum}")
        worker.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, _handle_sig)
    signal.signal(signal.SIGTERM, _handle_sig)
    worker.run_forever()
