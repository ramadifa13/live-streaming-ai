"""Real-time AI visual worker — 30 FPS producer/consumer pipeline.

Architecture
------------
Thread 1 (StateMachine + FrameFetcher):
    Decides idle / action / talk state, advances frame index with base-pose
    gating, pushes RawFramePacket to ``raw_queue``.

Thread 2 (LipSyncInference):
    Consumes raw frames + TTS audio chunks, runs MuseTalk UNet/VAE when speech
    is active, applies feathered mask blending, pushes RenderedPacket to
    ``render_queue``.

Thread 3 (Broadcaster):
    Wall-clock 30 FPS pacer. Never blocks on inference — replays the last good
    frame (or idle fallback) when the render queue is empty.

All video assets are decoded once at init into RAM. No disk I/O during stream.
"""

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
    CANVAS_W = int(os.environ.get("FRAME_FEED_WIDTH", "720"))
    CANVAS_H = int(os.environ.get("FRAME_FEED_HEIGHT", "1280"))

    def fit_bgr(frame, width=CANVAS_W, height=CANVAS_H):
        return frame


TARGET_FPS = int(
    os.environ.get("AI_WORKER_FPS", os.environ.get("FRAME_FEED_FPS", "30"))
)
SAMPLE_RATE = 44100
SAMPLES_PER_FRAME = int(round(SAMPLE_RATE / float(TARGET_FPS)))
BYTES_PER_AUDIO_FRAME = SAMPLES_PER_FRAME * 2 * 2
CROSSFADE_FRAMES = int(os.environ.get("AI_WORKER_CROSSFADE", "8"))
OVERLAP_FRAMES = int(os.environ.get("AI_WORKER_OVERLAP_FRAMES", "10"))
BBOX_SMOOTH_WINDOW = int(os.environ.get("AI_WORKER_BBOX_SMOOTH", "7"))
RAW_QUEUE_SIZE = int(os.environ.get("AI_WORKER_RAW_QUEUE", "24"))
RENDER_QUEUE_SIZE = int(os.environ.get("AI_WORKER_RENDER_QUEUE", "48"))
RAW_QUEUE_BLOCK_SEC = float(os.environ.get("AI_WORKER_RAW_BLOCK_SEC", "0.25"))
MASK_FEATHER_PX = int(os.environ.get("AI_WORKER_MASK_FEATHER", "15"))
AMBIENT_MIN_SEC = float(os.environ.get("AI_WORKER_AMBIENT_MIN_SEC", "4"))
AMBIENT_MAX_SEC = float(os.environ.get("AI_WORKER_AMBIENT_MAX_SEC", "6"))

IDLE_BREATH_CHANCE = float(os.environ.get("AI_WORKER_IDLE_BREATH_CHANCE", "0.18"))
IDLE_FALLBACK_AFTER = int(os.environ.get("AI_WORKER_IDLE_FALLBACK_AFTER", "2"))
BROADCAST_MAX_LAG = int(os.environ.get("AI_WORKER_BROADCAST_MAX_LAG", "8"))
BROADCAST_RENDER_WAIT_SEC = float(
    os.environ.get("AI_WORKER_BROADCAST_RENDER_WAIT_SEC", "0.10")
)
MOUTH_STRENGTH = float(os.environ.get("MUSETALK_MOUTH_STRENGTH", "0.62"))
MOUTH_TEMPORAL = float(os.environ.get("MUSETALK_TEMPORAL_SMOOTH", "0.32"))
MOUTH_MAX_DELTA = float(os.environ.get("MUSETALK_MAX_DELTA", "30"))
LIPSYNC_PREROLL_FRAMES = int(os.environ.get("MUSETALK_PREROLL_FRAMES", "6"))
LIPSYNC_WAIT_SEC = float(os.environ.get("MUSETALK_MOUTH_WAIT_SEC", "0.02"))
LIPSYNC_SYNC_SHIFT = int(os.environ.get("MUSETALK_SYNC_SHIFT", "0"))
LIPSYNC_PREROLL_TIMEOUT_SEC = float(
    os.environ.get("MUSETALK_PREROLL_TIMEOUT_SEC", "2.0")
)


ALLOWED_GESTURES: frozenset = frozenset()

TALK_CLIP_DEFAULT = (
    os.environ.get("AI_WORKER_TALK_CLIP") or "idle_1"
).strip().lower() or "idle_1"


def _ambient_gesture_names() -> List[str]:
    """Legacy ambient gestures — default off. Idle variants pakai AI_WORKER_IDLE_VARIANTS."""
    raw = (os.environ.get("AI_WORKER_AMBIENT_GESTURES") or "off").strip()
    if raw.lower() in ("0", "off", "false", "none", "no", ""):
        return []
    names = [n.strip() for n in raw.split(",") if n.strip()]
    return [n for n in names if n.lower().replace("-", "_") in ALLOWED_GESTURES]


def _idle_variant_names() -> List[str]:
    """Variasi saat diam: idle_2/3/4 (gerak). idle_1 = talk + nafas/fallback."""
    raw = (os.environ.get("AI_WORKER_IDLE_VARIANTS") or "idle_2,idle_3,idle_4").strip()
    if raw.lower() in ("0", "off", "false", "none", "no", ""):
        return []
    return [n.strip().lower().replace("-", "_") for n in raw.split(",") if n.strip()]


def _is_idle_clip_name(name: Optional[str]) -> bool:
    if not name:
        return False
    key = name.lower().strip().replace("-", "_")
    return key == "idle" or key.startswith("idle_")


def _is_neutral_action(tag: Optional[str]) -> bool:
    if not tag:
        return True
    key = tag.lower().strip().replace("-", "_")
    return key in (
        "none",
        "null",
        "idle",
        "talk",
        "talk_expressive",
        "expressive",
    )


def _is_allowed_gesture(tag: Optional[str]) -> bool:
    if not tag or _is_neutral_action(tag) or _is_idle_clip_name(tag):
        return False
    key = tag.lower().strip().replace("-", "_")
    return key in ALLOWED_GESTURES


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
    """Return pending gesture tag, e.g. ``point_up``, or None."""
    bridge = get_speech_bridge()
    if bridge is not None:
        return bridge.get_llm_action()
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
        """First & last frame share the same base pose (user-authored assets)."""
        return self.base_pose_frame == self.end_pose

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
    """Extra Gaussian feather on MuseTalk jaw mask edges."""
    if mask_array is None:
        return mask_array
    arr = np.asarray(mask_array, dtype=np.uint8)
    if arr.ndim != 2:
        return mask_array
    k = max(3, kernel | 1)
    return cv2.GaussianBlur(arr, (k, k), 0)


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
    """Lebih pelan saat audio lemah — mulut tidak melebar di jeda kata."""
    base = max(0.25, min(0.85, MOUTH_STRENGTH))
    rms = _pcm_rms(pcm)
    t = float(np.clip((rms - 0.015) / 0.12, 0.0, 1.0))
    return base * (0.50 + 0.50 * t)


def _dampen_generated_mouth(
    original: np.ndarray, generated: np.ndarray, strength: float
) -> np.ndarray:
    """Campur hasil MuseTalk dengan crop asli + clamp delta agar rahang tidak tertarik."""
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
    delta = gen_f - orig_f
    cap = max(8.0, MOUTH_MAX_DELTA)
    delta = np.clip(delta, -cap, cap)
    mixed = orig_f + delta * float(np.clip(strength, 0.0, 1.0))
    return np.clip(mixed, 0, 255).astype(np.uint8)


def _talk_body_index(clip: "ClipAsset", whisper_idx: int) -> int:
    span = max(1, clip.end_pose - clip.base_pose_frame + 1)
    return clip.base_pose_frame + (int(whisper_idx) % span)


class FaceCoordRegistry:
    """Ambil mask/bbox milik frame yang sedang tampil. Tanpa lock lintas-pose."""

    def __init__(self, window: int = BBOX_SMOOTH_WINDOW):
        self._window = max(1, window)

    def lock_from_clip(self, clip: ClipAsset, frame_idx: int) -> None:
        return

    def release_lock(self) -> None:
        return

    def get_material(self, clip: ClipAsset, cidx: int) -> Optional[Tuple]:
        if not clip.mask_materials_cycle:
            return None
        mat = clip.mask_materials_cycle[cidx % len(clip.mask_materials_cycle)]
        if not mat:
            return None
        mask_array, crop_box, face_box = mat
        return feather_mask(mask_array), crop_box, tuple(int(v) for v in face_box)


@dataclass
class _OverlapTransition:
    """N pasang frame: idle[-N..] blended dengan talk[0..N-1]."""

    pairs: List[Tuple[np.ndarray, np.ndarray]]
    step: int = 0
    resume_frame_idx: int = 0


class AssetBank:
    """Decode all host clips into RAM and precompute MuseTalk materials."""

    ACTION_ALIASES = {
        "talk": "idle_1",
        "talk_expressive": "idle_1",
        "expressive": "idle_1",
        "idle": "idle_1",
        "idle_1": "idle_1",
        "idle_2": "idle_2",
        "idle_3": "idle_3",
        "idle_4": "idle_4",
        "wave": "idle_1",
        "raise_hand": "idle_1",
        "nod": "idle_1",
        "laugh": "idle_1",
        "think": "idle_1",
        "point_up": "idle_1",
        "point_down": "idle_1",
    }

    def talk_clip_name(self) -> str:
        """Body saat bicara: idle_1 (rest diam), fallback idle / idle_*."""
        for key in (TALK_CLIP_DEFAULT, "idle_1", "idle", self._idle_name):
            if key and key in self.clips:
                return key
            if key:
                resolved = self.ACTION_ALIASES.get(key, key)
                if resolved in self.clips:
                    return resolved
        return self._idle_name

    def idle_variant_clips(self) -> List[str]:
        """Idle non-talk untuk rotasi saat diam."""
        out: List[str] = []
        talk = self.talk_clip_name()
        for name in _idle_variant_names():
            resolved = self.resolve_action(name)
            if resolved in self.clips and resolved != talk and resolved not in out:
                out.append(resolved)
        return out

    def __init__(self, assets_dir: str, host: str = "namira", models_bundle=None):
        self.assets_dir = assets_dir
        self.host = host.lower()
        self.models = models_bundle
        self.clips: Dict[str, ClipAsset] = {}
        self._idle_name = "idle_1"

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
        decode_all = (
            os.environ.get("AI_WORKER_EAGER_CLIPS") or ""
        ).strip().lower() in (
            "all",
            "*",
        )

        for fname in mp4s:
            path = os.path.join(self.assets_dir, fname)
            name = self._clip_name_from_file(fname)
            num_frames = self._probe_frame_count(path)
            base_pose, end_pose = self._load_pose_meta(name, num_frames)
            decode_now = decode_all or name in eager_names or _is_idle_clip_name(name)
            frames = self._decode_video(path) if decode_now else []
            self.clips[name] = ClipAsset(
                name=name,
                path=path,
                frames=frames,
                base_pose_frame=base_pose,
                end_pose_frame=end_pose,
                probed_frame_count=num_frames,
                loop=_is_idle_clip_name(name) or name == TALK_CLIP_DEFAULT,
            )
            status = f"{len(frames)} frames" if frames else f"lazy ({num_frames}f)"
            print(
                f"[AssetBank] {name}: {status}, "
                f"base_pose={base_pose}, end_pose={self.clips[name].end_pose}"
            )

        self._idle_name = self._pick_primary_idle()
        if "idle" not in self.clips and self._idle_name in self.clips:
            self.clips["idle"] = self.clips[self._idle_name]
            print(f"[AssetBank] Alias idle → {self._idle_name}")
        print(
            f"[AssetBank] Primary idle/talk={self.talk_clip_name()}, "
            f"variants={self.idle_variant_clips()}"
        )

        if self.models:
            self._warm_musetalk_materials()

    def _pick_primary_idle(self) -> str:
        for key in ("idle_1", "idle", TALK_CLIP_DEFAULT):
            if key in self.clips:
                return key
        for k in sorted(self.clips):
            if _is_idle_clip_name(k):
                return k
        return next(iter(self.clips))

    def _eager_clip_names(self) -> List[str]:
        """Decode ke RAM: semua idle_* (+ point jika ada di env)."""
        raw = (
            os.environ.get("AI_WORKER_EAGER_CLIPS")
            or "idle_1,idle_2,idle_3,idle_4,idle"
        ).strip()
        if raw.lower() in ("all", "*"):
            return list(self.clips.keys()) if self.clips else ["idle_1"]
        names = [n.strip() for n in raw.split(",") if n.strip()]
        for must in ("idle_1", "idle", TALK_CLIP_DEFAULT):
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
            return
        print(f"[AssetBank] Decoding {clip.name} ...", flush=True)
        clip.frames = self._decode_video(clip.path)

    def get_clip(self, name: str) -> Optional[ClipAsset]:
        clip = self.clips.get(name)
        if clip is None:
            return None
        self.ensure_frames(clip)
        return clip

    def _precache_clip_names(self) -> List[str]:
        """MuseTalk latent+mask — hanya body bicara (idle_1). Variants tidak di-warmup."""
        talk = self.talk_clip_name() if self.clips else (TALK_CLIP_DEFAULT or "idle_1")
        raw = (os.environ.get("AI_WORKER_PRECACHE_CLIPS") or talk).strip()
        if raw.lower() in ("all", "*", "1", "true", "yes", "on"):
            return [n for n in (talk, self._idle_name) if n in self.clips]
        names = [n.strip() for n in raw.split(",") if n.strip()]
        if talk not in names:
            names.insert(0, talk)
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
        )
        clip.frame_list_cycle = mats["frame_list_cycle"]
        clip.coord_list_cycle = mats["coord_list_cycle"]
        clip.latent_list_cycle = mats["input_latent_list_cycle"]
        clip.mask_materials_cycle = mats["mask_materials_cycle"]
        print(
            f"[AssetBank] MuseTalk materials ready: {clip.name} "
            f"(bbox_shift={vis['bbox_shift']}, extra_margin={vis['extra_margin']}, "
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
                print(f"[AssetBank] MuseTalk warmup notice ({name}): {err}")

    def _clip_name_from_file(self, fname: str) -> str:
        stem = os.path.splitext(fname)[0].lower()
        host_prefix = f"{self.host}_"
        if stem.startswith(host_prefix):
            stem = stem[len(host_prefix) :]
        return stem or "clip"

    def _load_pose_meta(self, name: str, num_frames: int) -> Tuple[int, int]:
        """Load base/end pose from sidecar JSON. Default: frame 0 == last frame."""
        base, end = 0, -1
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
                break
            except Exception:
                continue
        if end < 0:
            end = max(0, num_frames - 1)
        return base, end

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
        if not tag:
            return self._idle_name
        raw = tag.lower().strip().replace("-", "_")
        if (
            raw not in ALLOWED_GESTURES
            and not _is_idle_clip_name(raw)
            and raw not in self.ACTION_ALIASES
        ):
            if raw not in self.clips:
                return self._idle_name
        key = self.ACTION_ALIASES.get(raw, raw)
        if key in self.clips:
            return key
        for candidate in (f"{self.host}_{key}", key, f"namira_{key}"):
            if candidate in self.clips:
                return candidate
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
        self.overlap_frames = max(4, min(int(overlap_frames), 12))
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
        self._talk_loop_count = 0
        self._scheduled_gesture: Optional[str] = None
        self._post_speech_gesture_active = False
        self._ambient_names = _ambient_gesture_names()
        self._idle_variants = list(bank.idle_variant_clips())
        self._next_ambient_at = 0.0
        self._schedule_next_ambient()

    def _schedule_next_ambient(self) -> None:

        if not self._idle_variants and not self._ambient_names:
            self._next_ambient_at = 0.0
            return
        self._next_ambient_at = time.monotonic() + random.uniform(
            AMBIENT_MIN_SEC, AMBIENT_MAX_SEC
        )

    def _choose_next_idle_variant(self, exclude: Optional[str] = None) -> Optional[str]:
        """Pilih idle berikutnya — tidak boleh sama dengan clip sekarang (hindari 2→2)."""
        talk = self.bank.talk_clip_name()
        primary = self.bank._idle_name
        cur = exclude or self.current_name
        variants = [
            c
            for c in self._idle_variants
            if c in self.bank.clips and c not in (talk, cur)
        ]

        if (
            primary in self.bank.clips
            and primary != cur
            and random.random() < max(0.0, min(1.0, IDLE_BREATH_CHANCE))
        ):
            return primary
        if variants:
            return random.choice(variants)

        if primary in self.bank.clips and primary != cur:
            return primary
        return None

    def _maybe_queue_ambient_gesture(self) -> None:
        """Saat diam di idle_1 terlalu lama: mulai rotasi idle_2/3/4 (tanpa ulang clip sama)."""
        if self._utterance_active or self._playthrough_lock:
            return
        if self.state != PlayState.IDLE or self._overlap is not None:
            return
        if self._next_ambient_at <= 0 or time.monotonic() < self._next_ambient_at:
            return
        self._schedule_next_ambient()
        if self.pending_action or self._action_queue:
            return

        if self.current_name not in (
            self.bank._idle_name,
            "idle",
            self.bank.talk_clip_name(),
        ):
            return
        tag = self._choose_next_idle_variant()
        if not tag:
            return
        self.pending_action = tag
        print(f"[StateMachine] Ambient idle → {tag}")

    def reset_after_stop(self) -> None:
        """Reset state setelah pause/stop — hindari utterance stuck di Go Live berikutnya."""
        with self._lock:
            self._utterance_active = False
            self._utterance_audio_done = False
            self._post_speech_gesture_active = False
            self._scheduled_gesture = None
            self._playthrough_lock = False
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
            if _is_neutral_action(tag):
                self._action_queue.append(self.bank._idle_name)
                return

            if _is_idle_clip_name(key):
                target = self.bank.resolve_action(key)
                if self._playthrough_lock or self._utterance_active:
                    self._action_queue.append(target)
                else:
                    self.pending_action = target
                return
            if not _is_allowed_gesture(tag):
                print(f"[StateMachine] Gesture diabaikan (bukan CTA point): {tag}")
                return
            if self._playthrough_lock or self._utterance_active:
                self._action_queue.append(tag)
                print(f"[StateMachine] Action queued (playthrough): {tag}")
                return
            self.pending_action = tag

    def begin_utterance(self) -> None:
        """Lock playthrough; stay on idle talk body (no idle↔talk_expressive cut)."""
        with self._lock:
            if self._utterance_active:
                return
            self._utterance_active = True
            self._utterance_audio_done = False
            self._playthrough_lock = True
            self._talk_loop_count = 0
            talk = self.bank.talk_clip_name()
            if talk not in self.bank.clips:
                return
            if self.current_name != talk:
                from_clip = self.bank.get_clip(self.current_name)
                if from_clip is None:
                    return
                self._begin_overlap_transition(
                    from_clip, self.frame_idx, talk, PlayState.TALK, lock_face=True
                )
            else:
                self.state = PlayState.TALK
                if self._face_registry:
                    talk_clip = self.bank.get_clip(talk)
                    if talk_clip is not None:
                        self._face_registry.lock_from_clip(
                            talk_clip, talk_clip.base_pose_frame
                        )

    def mark_utterance_audio_done(self) -> None:
        with self._lock:
            if self._utterance_active:
                self._utterance_audio_done = True
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
        prev_idx = min(self.frame_idx, clip.end_pose)
        self._begin_overlap_transition(
            clip, prev_idx, target, PlayState.ACTION, lock_face=False
        )
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
        """True when audio+visual selesai (termasuk post-speech gesture jika ada)."""
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
        return self.at_end_pose()

    def end_utterance(self, *, another_utterance_ready: bool = False) -> None:
        with self._lock:
            self._utterance_active = False
            self._utterance_audio_done = False
            self._playthrough_lock = False
            self._talk_loop_count = 0
            self._scheduled_gesture = None
            self._post_speech_gesture_active = False
            if self._face_registry:
                self._face_registry.release_lock()
            self._drain_action_queue()
            talk = self.bank.talk_clip_name()
            if another_utterance_ready and self.current_name == talk:
                self.pending_action = None
                self.state = PlayState.TALK
                print(
                    "[StateMachine] Utterance selesai → hold talk (utterance berikutnya siap)"
                )
            else:
                if not self.pending_action:
                    self.pending_action = self.bank._idle_name
                self.state = PlayState.IDLE
                print("[StateMachine] Utterance selesai → transisi (end pose tercapai)")

    def _clip_span(self, clip: ClipAsset) -> int:
        return max(1, clip.end_pose - clip.base_pose_frame + 1)

    def _wrapped_index(self, clip: ClipAsset, idx: int) -> int:
        span = self._clip_span(clip)
        if clip.loop:
            return clip.base_pose_frame + (int(idx) - clip.base_pose_frame) % span
        return max(clip.base_pose_frame, min(int(idx), clip.end_pose))

    def _begin_overlap_transition(
        self,
        from_clip: ClipAsset,
        from_idx: int,
        to_name: str,
        new_state: PlayState,
        lock_face: bool = False,
    ) -> None:
        """Blend N frame sumber (wrap jika loop) dengan N frame pertama target."""
        to_clip = self.bank.get_clip(to_name)
        if to_clip is None:
            return
        n = self.overlap_frames
        from_idx = self._wrapped_index(from_clip, from_idx)
        pairs: List[Tuple[np.ndarray, np.ndarray]] = []
        for i in range(n):
            src_idx = self._wrapped_index(from_clip, from_idx + i)
            ti = min(to_clip.base_pose_frame + i, to_clip.end_pose)
            pairs.append((from_clip.frames[src_idx].copy(), to_clip.frames[ti].copy()))
        resume = min(to_clip.base_pose_frame + n, to_clip.end_pose + 1)
        self._overlap = _OverlapTransition(pairs=pairs, step=0, resume_frame_idx=resume)
        self.current_name = to_name
        self.state = new_state
        if lock_face and self._face_registry:
            lock_idx = min(to_clip.base_pose_frame, to_clip.end_pose)
            self._face_registry.lock_from_clip(to_clip, lock_idx)
        print(
            f"[StateMachine] Overlap {n}f: {from_clip.name}@{from_idx} → {to_name} "
            f"(resume@{resume})"
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

        prev_idx = self._wrapped_index(clip, min(self.frame_idx, clip.end_pose))
        idle_name = self.bank._idle_name
        talk_name = self.bank.talk_clip_name()
        if target == talk_name and self._utterance_active:
            new_state = PlayState.TALK
        elif _is_idle_clip_name(target) or target in (idle_name, "idle"):
            new_state = PlayState.IDLE
        else:
            new_state = PlayState.ACTION
        lock_face = target == talk_name and self._utterance_active
        self._begin_overlap_transition(
            clip, prev_idx, target, new_state, lock_face=lock_face
        )
        if new_state == PlayState.ACTION:
            self._playthrough_lock = True
        else:
            self._playthrough_lock = False
        print(
            f"[StateMachine] → {target} (overlap={self.overlap_frames}f, state={new_state.name})"
        )
        return True

    def _advance_frame_index(self, clip: ClipAsset, is_speech: bool) -> None:
        """Advance index; seamless loop at base pose; hold end pose then overlap ke idle."""
        self.frame_idx += 1
        end_pf = clip.end_pose
        base_pf = clip.base_pose_frame

        if self.state == PlayState.TALK and self._utterance_active:
            if is_speech and self.frame_idx > end_pf:
                self.frame_idx = base_pf
                self._talk_loop_count += 1
            elif self._utterance_audio_done and self.frame_idx > end_pf:
                self.frame_idx = end_pf
            return

        if self.frame_idx > end_pf:
            if clip.loop and not self._playthrough_lock:
                if (
                    self.state == PlayState.IDLE
                    and not self._utterance_active
                    and not self.pending_action
                    and self.current_name in self._idle_variants
                ):
                    nxt = self._choose_next_idle_variant(exclude=self.current_name)
                    if nxt:
                        self.frame_idx = end_pf
                        self.pending_action = nxt
                        self._schedule_next_ambient()
                        return
                self.frame_idx = base_pf
                return

            self.frame_idx = end_pf
            self._playthrough_lock = False
            if not self._utterance_active:
                if not self.pending_action:
                    nxt = self._choose_next_idle_variant(exclude=self.current_name)
                    self.pending_action = nxt or self.bank._idle_name
                self._drain_action_queue()

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
            self._maybe_queue_ambient_gesture()

            clip = self.bank.get_clip(self.current_name)
            if clip is None:
                raise RuntimeError(f"Clip missing: {self.current_name}")
            cycle_idx = 0
            frame: np.ndarray

            if self._overlap is not None and self._overlap.step < len(
                self._overlap.pairs
            ):
                from_f, to_f = self._overlap.pairs[self._overlap.step]
                n = len(self._overlap.pairs)
                t = (self._overlap.step + 1) / float(n)
                alpha = _ease_in_out(t)
                frame = blend_weighted(from_f, to_f, alpha)
                cycle_idx = self._overlap.step
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

            needs_lipsync = is_speech and (
                self._utterance_active or self.state == PlayState.TALK
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
        self._talk_clip_name = "idle_1"
        self._last_mouth_256: Optional[np.ndarray] = None
        self._prev_composed: Optional[np.ndarray] = None
        self._square_pad = True
        try:
            from inference import musetalk_visual_params

            self._square_pad = bool(musetalk_visual_params().get("square_pad", True))
        except Exception:
            pass

    def set_utterance(self, job) -> None:
        """Mulai batch-ahead inference untuk satu utterance."""
        if job is not None and self._utterance_id == getattr(job, "task_id", None):
            return
        self.clear_utterance()
        if job is None or job.whisper_chunks is None:
            return
        talk = self.bank.talk_clip_name()
        if talk in self.bank.clips:
            self._talk_clip_name = talk
        with self._lock:
            self._utterance_id = job.task_id
            self._whisper_chunks = job.whisper_chunks
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
            f"batch={self.batch_size}, body={self._talk_clip_name}"
        )

    def wait_preroll(
        self, n: int = LIPSYNC_PREROLL_FRAMES, timeout: float = 2.0
    ) -> bool:
        """Tunggu mouth crop awal siap sebelum audio mulai — cegah mulut tertutup saat suara jalan."""
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
        return ready > 0

    def clear_utterance(self) -> None:
        self._infer_stop.set()
        if self._infer_thread and self._infer_thread.is_alive():
            self._infer_thread.join(timeout=1.0)
        with self._lock:
            self._utterance_id = None
            self._whisper_chunks = None
            self._mouths = {}
            self._infer_cursor = 0
            self._last_mouth_256 = None
            self._prev_composed = None
        self._infer_thread = None

    def _latent_index(self, clip: ClipAsset, body_idx: int) -> int:
        nlat = max(1, len(clip.latent_list_cycle))
        nframes = max(1, len(clip.frames) or clip.num_frames)
        forward_n = min(nframes, nlat // 2 or nlat)
        return int(body_idx) % max(1, forward_n)

    def _batch_inference_loop(self) -> None:
        vae = self.models["vae"]
        unet = self.models["unet"]
        pe = self.models["pe"]
        timesteps = self.models["timesteps"]
        clip = self.bank.get_clip(self._talk_clip_name) or self.bank.idle_clip
        if not clip.latent_list_cycle:
            print(f"[LipSync] No latents for {clip.name} — skip inference")
            return

        while not self._infer_stop.is_set():
            with self._lock:
                chunks = self._whisper_chunks
                cursor = self._infer_cursor
            if chunks is None or cursor >= chunks.shape[0]:
                break

            end = min(cursor + self.batch_size, chunks.shape[0])
            whisper_batch = chunks[cursor:end].to(
                device=self.device, dtype=self.weight_dtype
            )
            latent_list = []
            for i in range(cursor, end):
                body_idx = _talk_body_index(clip, i)
                lat_idx = self._latent_index(clip, body_idx)
                lat = clip.latent_list_cycle[lat_idx]
                if lat is None:
                    lat = clip.latent_list_cycle[0]
                latent_list.append(lat.unsqueeze(0) if lat.dim() == 3 else lat)

            if not latent_list:
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
                print(f"[LipSync] batch infer notice: {err}")
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

    def _wait_mouth(
        self, idx: int, timeout: float = LIPSYNC_WAIT_SEC
    ) -> Optional[np.ndarray]:
        deadline = time.perf_counter() + max(0.0, timeout)
        while True:
            with self._lock:
                cached = self._mouths.get(idx)
                last = self._last_mouth_256
                cursor = self._infer_cursor
            if cached is not None:
                return cached
            if cursor > idx and last is not None:
                return last
            if time.perf_counter() >= deadline:
                return last
            time.sleep(0.004)

    def _material_for(self, clip: ClipAsset, cidx: int) -> Optional[Tuple]:
        if self._face_registry is not None:
            mat = self._face_registry.get_material(clip, cidx)
            if mat is not None:
                return mat
        if clip.mask_materials_cycle:
            raw = clip.mask_materials_cycle[cidx % len(clip.mask_materials_cycle)]
            if raw:
                mask_array, crop_box, face_box = raw
                return (
                    feather_mask(mask_array),
                    crop_box,
                    tuple(int(v) for v in face_box),
                )
        return None

    def _compose_mouth(
        self,
        body: np.ndarray,
        mouth_256: np.ndarray,
        clip: ClipAsset,
        cidx: int,
        pcm: bytes,
    ) -> np.ndarray:
        from musetalk.utils.blending import get_image_blending
        from inference import resize_generated_to_bbox

        mat = self._material_for(clip, cidx)
        if mat is None:
            return body
        mask_array, crop_box, face_box = mat
        x1, y1, x2, y2 = [int(v) for v in face_box]
        if x2 <= x1 or y2 <= y1:
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
                return body
            strength = _mouth_strength_for_pcm(pcm)
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
            self._prev_composed = damped
            return get_image_blending(
                body, damped, list(face_box), mask_array, crop_box
            )
        except Exception:
            return body

    @torch.no_grad()
    def process(self, pkt: RawFramePacket, clip: ClipAsset) -> np.ndarray:
        metrics = get_telemetry()
        if pkt.whisper_idx is None or not pkt.needs_lipsync:
            self._prev_composed = None
            return pkt.frame

        if (
            pkt.clip_name
            and pkt.clip_name != self._talk_clip_name
            and not _is_idle_clip_name(pkt.clip_name)
        ):
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
            metrics.inc("lipsync_cache_miss")
            return pkt.frame
        metrics.inc("lipsync_cache_hit")

        talk = self.bank.get_clip(self._talk_clip_name) or clip

        body_clip = clip if pkt.clip_name == talk.name else talk
        return self._compose_mouth(
            pkt.frame, mouth, body_clip, int(pkt.cycle_idx), pkt.audio_pcm
        )


def lipsync_worker_loop(
    bank: AssetBank,
    engine: LipSyncEngine,
    raw_q: queue.Queue,
    render_q: queue.Queue,
    stop_event: threading.Event,
) -> None:
    metrics = get_telemetry()
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
            try:
                render_q.put(out, timeout=0.15)
            except queue.Full:
                metrics.inc("render_queue_dropped")
                try:
                    render_q.get_nowait()
                except queue.Empty:
                    pass
                render_q.put(out, block=False)
        except Exception as err:
            print(f"[LipSync] frame {pkt.seq} notice: {err}")
            render_q.put(
                RenderedPacket(
                    seq=pkt.seq,
                    frame=pkt.frame,
                    audio_pcm=pkt.audio_pcm,
                    clip_name=pkt.clip_name,
                    frame_idx=pkt.frame_idx,
                ),
                block=False,
            )
        finally:
            raw_q.task_done()


def _put_raw_frame(
    raw_q: queue.Queue,
    pkt: RawFramePacket,
    metrics,
    stop_event: threading.Event,
    block_sec: float = RAW_QUEUE_BLOCK_SEC,
) -> None:
    """Backpressure: tunggu slot queue sebelum drop (hindari gap sequence)."""
    deadline = time.perf_counter() + max(0.01, block_sec)
    while not stop_event.is_set():
        try:
            raw_q.put(pkt, timeout=0.01)
            return
        except queue.Full:
            if time.perf_counter() >= deadline:
                metrics.inc("raw_queue_dropped")
                return


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
                    bridge.has_ready_pending()
                    if hasattr(bridge, "has_ready_pending")
                    else False
                )
                sm.end_utterance(another_utterance_ready=another_ready)
                bridge.signal_visual_complete()

        was_speaking = is_speech or (
            bridge is not None
            and bridge.is_utterance_active()
            and not bridge.is_audio_exhausted()
        )

        action = action_fn()
        pkt = sm.next_packet(pcm, is_speech, llm_action=action, whisper_idx=whisper_idx)
        pkt.whisper_idx = whisper_idx
        if whisper_idx is not None:
            pkt.needs_lipsync = True
        metrics.set_gauge("raw_queue_depth", float(raw_q.qsize()))
        if bridge is not None:
            metrics.set_gauge("utterance_queue_depth", float(bridge.pending_count()))
        _put_raw_frame(raw_q, pkt, metrics, stop_event)
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
        self._reload()

    def _reload(self) -> None:
        try:
            self._clip = self._bank.idle_clip
            self._idx = self._clip.base_pose_frame
        except Exception:
            self._clip = None

    def sync(self, clip_name: str, frame_idx: int) -> None:
        clip = self._bank.get_clip(clip_name) if clip_name else None
        if clip is None:
            self._reload()
            return
        self._clip = clip
        self._idx = max(clip.base_pose_frame, min(int(frame_idx), clip.end_pose))

    def next_frame(self) -> np.ndarray:
        if self._clip is None or not self._clip.frames:
            self._reload()
        if self._clip is None or not self._clip.frames:
            return np.zeros((CANVAS_H, CANVAS_W, 3), dtype=np.uint8)
        idx = max(0, min(self._idx, len(self._clip.frames) - 1))
        frame = self._clip.frames[idx].copy()
        self._idx += 1
        if self._idx > self._clip.end_pose:
            if self._clip.loop:
                self._idx = self._clip.base_pose_frame
            else:
                self._idx = self._clip.end_pose
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
        if not self.rtmp_url.lower().startswith(("rtmp://", "rtmps://")):
            raise ValueError(
                f"RTMP URL tidak valid (harus rtmp:// atau rtmps://): {self.rtmp_url[:80]}"
            )
        self._start_encoder()

    @classmethod
    def _want_force_ipv4(cls) -> bool:
        raw = os.environ.get("RTMP_FORCE_IPV4", "1").strip().lower()
        return raw not in ("0", "false", "no", "off")

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
                "libx264",
                "-preset",
                "veryfast",
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
                "-flvflags",
                "no_duration_filesize",
                "-f",
                "flv",
                "-rtmp_live",
                "live",
                "-stimeout",
                "15000000",
                "-rw_timeout",
                "15000000",
                self.rtmp_url,
            ]
        )
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
        out_dir = os.environ.get("OUTPUT_FOLDER", "")
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

                watcher = FfmpegLogWatcher(
                    on_fatal=lambda hint: write_rtmp_status(out_dir, "failed", hint),
                    on_progress=lambda: write_rtmp_status(out_dir, "connected"),
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
            f"[Broadcaster] RTMP encoder @ {self.fps}fps → "
            f"{self.rtmp_url.split('?')[0]}?**"
        )

    def is_alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

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
                out_dir = os.environ.get("OUTPUT_FOLDER", "")
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
    last_pcm = silence
    idle_player = _IdleFallbackPlayer(bank)
    stale_misses = 0
    pending: Dict[int, RenderedPacket] = {}
    next_seq = 0
    overlay_rgb = None
    overlay_alpha = None

    out_dir = output_folder or os.environ.get("OUTPUT_FOLDER", "")
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

        while True:
            try:
                pkt = render_q.get_nowait()
                pending[pkt.seq] = pkt
            except queue.Empty:
                break

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
        if pkt is None and not pending and utterance_active:
            try:
                fresh: RenderedPacket = render_q.get(timeout=BROADCAST_RENDER_WAIT_SEC)
                pending[fresh.seq] = fresh
            except queue.Empty:
                pass

        if pkt is None and pending:
            pick = min(pending.keys())
            for stale in [s for s in list(pending.keys()) if s < pick]:
                pending.pop(stale, None)
            pkt = pending.pop(pick, None)
            if pkt is not None and pick != next_seq:
                metrics.inc("broadcast_seq_resync")
            next_seq = pick

        if pkt is not None:
            last_good = pkt.frame
            last_pcm = pkt.audio_pcm
            pcm = pkt.audio_pcm
            stale_misses = 0
            if pkt.clip_name:
                idle_player.sync(pkt.clip_name, pkt.frame_idx)
        else:
            stale_misses += 1
            metrics.inc("frames_duplicated")
            if stale_misses >= IDLE_FALLBACK_AFTER and not utterance_active:
                last_good = idle_player.next_frame()
                metrics.inc("idle_fallback_frames")
            pcm = last_pcm if utterance_active else silence

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
        self.base_dir = os.environ.get("WORKER_ROOT", default_base)
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
        """Mulai inferensi mulut di background — idle tetap jalan, tanpa freeze."""
        if self._engine:
            self._engine.set_utterance(job)

        def _mark_ready() -> None:
            try:
                if self._engine:
                    self._engine.wait_preroll(
                        LIPSYNC_PREROLL_FRAMES,
                        timeout=LIPSYNC_PREROLL_TIMEOUT_SEC,
                    )
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
            self._engine.set_utterance(job)
        if self._sm:
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
            batch_size=int(os.environ.get("MUSETALK_BATCH_SIZE", "2")),
        )

        original_cwd = os.getcwd()
        os.chdir(musetalk_dir)
        try:
            self._models = _load_models_cached(args)
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
        self._face_registry = FaceCoordRegistry(BBOX_SMOOTH_WINDOW)
        self._sm = VideoStateMachine(
            self._bank,
            face_registry=self._face_registry,
            overlap_frames=max(OVERLAP_FRAMES, CROSSFADE_FRAMES),
        )
        self._engine = LipSyncEngine(
            models,
            self._bank,
            batch_size=int(os.environ.get("MUSETALK_BATCH_SIZE", "2")),
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
                f"bbox_shift={vis['bbox_shift']}, extra_margin={vis['extra_margin']}, "
                f"upper={vis['upper_boundary_ratio']}, strength={MOUTH_STRENGTH}, "
                f"temporal={MOUTH_TEMPORAL}, max_delta={MOUTH_MAX_DELTA}, "
                f"preroll={LIPSYNC_PREROLL_FRAMES}"
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
        if not self._pipeline_active and not self._running:
            raise RuntimeError("Pipeline belum aktif — panggil start() dulu")
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
        raw = os.environ.get("RTMP_CONNECT_TIMEOUT_SEC", "90")
        try:
            return max(15.0, float(raw))
        except ValueError:
            return 90.0

    def _wait_rtmp_connected(self) -> None:
        if not self.rtmp_url or not self.output_folder:
            return
        try:
            from rtmp_utils import read_rtmp_status, USER_HINT_CONNECTING_SLOW
        except ImportError:
            return

        deadline = time.monotonic() + self._rtmp_connect_timeout_sec()
        print(
            f"[AIVisualWorker] Menunggu RTMP connected "
            f"(max {int(self._rtmp_connect_timeout_sec())}s)..."
        )
        while time.monotonic() < deadline:
            if self._stop.is_set():
                break
            state, err = read_rtmp_status(self.output_folder)
            if state == "connected":
                self._rtmp_connected = True
                print("[AIVisualWorker] RTMP connected.")
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
        if state == "connected":
            self._rtmp_connected = True
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
                os.environ["OUTPUT_FOLDER"] = self.output_folder
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

    def stop(self) -> None:
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
        if self._bridge is not None:
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
    with _visual_lock:
        if _visual_worker_singleton is not None:
            _visual_worker_singleton.stop()
            if destroy:
                _visual_worker_singleton = None


def pause_visual_broadcast(output_folder: str = "") -> dict:
    """Soft pause: hold speech (hapus playback_active), RTMP + idle tetap jalan."""
    out = output_folder or (
        _visual_worker_singleton.output_folder if _visual_worker_singleton else ""
    )
    if not out:
        out = os.environ.get("OUTPUT_FOLDER", "")
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
        out = os.environ.get("OUTPUT_FOLDER", "")
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
        default=os.environ.get("RTMP_URL", ""),
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
