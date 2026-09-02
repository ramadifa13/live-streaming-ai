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

# ---------------------------------------------------------------------------
# Canvas / env
# ---------------------------------------------------------------------------
try:
    from video_canvas import CANVAS_H, CANVAS_W, fit_bgr
except ImportError:
    CANVAS_W = int(os.environ.get("FRAME_FEED_WIDTH", "720"))
    CANVAS_H = int(os.environ.get("FRAME_FEED_HEIGHT", "1280"))

    def fit_bgr(frame, width=CANVAS_W, height=CANVAS_H):
        return frame


TARGET_FPS = int(os.environ.get("AI_WORKER_FPS", os.environ.get("FRAME_FEED_FPS", "30")))
SAMPLE_RATE = 44100
SAMPLES_PER_FRAME = int(round(SAMPLE_RATE / float(TARGET_FPS)))
BYTES_PER_AUDIO_FRAME = SAMPLES_PER_FRAME * 2 * 2  # stereo s16le
CROSSFADE_FRAMES = int(os.environ.get("AI_WORKER_CROSSFADE", "4"))
OVERLAP_FRAMES = int(os.environ.get("AI_WORKER_OVERLAP_FRAMES", "5"))
BBOX_SMOOTH_WINDOW = int(os.environ.get("AI_WORKER_BBOX_SMOOTH", "7"))
RAW_QUEUE_SIZE = int(os.environ.get("AI_WORKER_RAW_QUEUE", "12"))
RENDER_QUEUE_SIZE = int(os.environ.get("AI_WORKER_RENDER_QUEUE", "24"))
RAW_QUEUE_BLOCK_SEC = float(os.environ.get("AI_WORKER_RAW_BLOCK_SEC", "0.1"))
MASK_FEATHER_PX = int(os.environ.get("AI_WORKER_MASK_FEATHER", "9"))

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

    def get_telemetry():  # type: ignore
        return _NoopTelemetry()


# ---------------------------------------------------------------------------
# Speech bridge hooks (wired by api_server in ai_worker broadcast mode)
# ---------------------------------------------------------------------------
try:
    from speech_bridge import SpeechBridge, get_speech_bridge, is_ai_worker_mode
except ImportError:
    SpeechBridge = None  # type: ignore

    def get_speech_bridge(output_folder: str = ""):  # type: ignore
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


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------
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
    # MuseTalk materials (populated after warmup)
    frame_list_cycle: List[np.ndarray] = field(default_factory=list)
    coord_list_cycle: list = field(default_factory=list)
    latent_list_cycle: list = field(default_factory=list)
    mask_materials_cycle: list = field(default_factory=list)
    loop: bool = True

    @property
    def num_frames(self) -> int:
        return len(self.frames)

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
            # MuseTalk cache is forward+reverse; use forward half only
            forward_n = min(n, len(self.frame_list_cycle) // 2 or len(self.frame_list_cycle))
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


# ---------------------------------------------------------------------------
# Mask feathering
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Face bbox lock + moving average (stabilkan mulut antar clip)
# ---------------------------------------------------------------------------
class FaceCoordRegistry:
    """Lock mask/bbox dari frame sumber; smooth dengan moving average."""

    def __init__(self, window: int = BBOX_SMOOTH_WINDOW):
        self._window = max(3, window)
        self._history: deque = deque(maxlen=self._window)
        self._locked_mat: Optional[Tuple] = None

    def lock_from_clip(self, clip: ClipAsset, frame_idx: int) -> None:
        if not clip.mask_materials_cycle:
            return
        n = max(1, len(clip.frames))
        forward_n = min(n, len(clip.mask_materials_cycle) // 2 or len(clip.mask_materials_cycle))
        cidx = max(0, min(frame_idx, forward_n - 1))
        mat = clip.mask_materials_cycle[cidx % len(clip.mask_materials_cycle)]
        if not mat:
            return
        self._locked_mat = mat
        self._history.clear()
        self._history.append(tuple(int(v) for v in mat[2]))
        print(f"[FaceCoord] Bbox locked ← {clip.name} @ frame {frame_idx}")

    def release_lock(self) -> None:
        self._locked_mat = None
        self._history.clear()

    def _smooth_bbox(self, bbox) -> Tuple[int, int, int, int]:
        box = tuple(int(v) for v in bbox)
        self._history.append(box)
        if len(self._history) < 2:
            return box
        smoothed = np.mean(list(self._history), axis=0)
        return tuple(int(round(v)) for v in smoothed)

    def get_material(self, clip: ClipAsset, cidx: int) -> Optional[Tuple]:
        if self._locked_mat is not None:
            mask_array, crop_box, face_box = self._locked_mat
            smooth = self._smooth_bbox(face_box)
            return feather_mask(mask_array), crop_box, smooth
        if clip.mask_materials_cycle:
            mat = clip.mask_materials_cycle[cidx % len(clip.mask_materials_cycle)]
            if mat:
                mask_array, crop_box, face_box = mat
                smooth = self._smooth_bbox(face_box)
                return feather_mask(mask_array), crop_box, smooth
        return None


@dataclass
class _OverlapTransition:
    """N pasang frame: idle[-N..] blended dengan talk[0..N-1]."""

    pairs: List[Tuple[np.ndarray, np.ndarray]]
    step: int = 0
    resume_frame_idx: int = 0


# ---------------------------------------------------------------------------
# Asset bank — zero disk I/O after init
# ---------------------------------------------------------------------------
class AssetBank:
    """Decode all host clips into RAM and precompute MuseTalk materials."""

    ACTION_ALIASES = {
        "talk": "talk_expressive",
        "talk_expressive": "talk_expressive",
        "expressive": "talk_expressive",
        "idle": "idle",
        "wave": "wave",
        "raise_hand": "wave",
        "nod": "nod",
        "laugh": "laugh",
        "point_up": "point_up",
        "point_down": "point_down",
        "think": "think",
    }

    def __init__(self, assets_dir: str, host: str = "namira", models_bundle=None):
        self.assets_dir = assets_dir
        self.host = host.lower()
        self.models = models_bundle
        self.clips: Dict[str, ClipAsset] = {}
        self._idle_name = "idle"

    def discover_and_load(self) -> None:
        if not os.path.isdir(self.assets_dir):
            raise FileNotFoundError(f"Assets dir missing: {self.assets_dir}")

        mp4s = sorted(
            f for f in os.listdir(self.assets_dir)
            if f.endswith(".mp4") and not f.startswith("temp_")
        )
        if not mp4s:
            raise FileNotFoundError(f"No .mp4 assets in {self.assets_dir}")

        for fname in mp4s:
            path = os.path.join(self.assets_dir, fname)
            name = self._clip_name_from_file(fname)
            frames = self._decode_video(path)
            base_pose, end_pose = self._load_pose_meta(name, len(frames))
            self.clips[name] = ClipAsset(
                name=name,
                path=path,
                frames=frames,
                base_pose_frame=base_pose,
                end_pose_frame=end_pose,
                loop=name in ("idle", "talk_expressive"),
            )
            print(
                f"[AssetBank] {name}: {len(frames)} frames, "
                f"base_pose={base_pose}, end_pose={self.clips[name].end_pose}"
            )

        if "idle" not in self.clips:
            # fallback: first clip containing 'idle'
            for k in self.clips:
                if "idle" in k:
                    self._idle_name = k
                    break
            else:
                self._idle_name = next(iter(self.clips))
        else:
            self._idle_name = "idle"

        if self.models:
            self._warm_musetalk_materials()

    def _clip_name_from_file(self, fname: str) -> str:
        stem = os.path.splitext(fname)[0].lower()
        host_prefix = f"{self.host}_"
        if stem.startswith(host_prefix):
            stem = stem[len(host_prefix):]
        return stem or "clip"

    def _load_pose_meta(self, name: str, num_frames: int) -> Tuple[int, int]:
        """Load base/end pose from sidecar JSON. Default: frame 0 == last frame."""
        base, end = 0, -1
        sidecar = os.path.join(self.assets_dir, f"{name}_meta.json")
        if os.path.exists(sidecar):
            try:
                with open(sidecar, "r", encoding="utf-8") as fh:
                    meta = json.load(fh)
                base = int(meta.get("base_pose_frame", base))
                end = int(meta.get("end_pose_frame", end))
            except Exception:
                pass
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

    def _warm_musetalk_materials(self) -> None:
        from inference import _get_avatar_materials

        vae = self.models["vae"]
        fp = self.models["fp"]
        for name, clip in self.clips.items():
            try:
                mats = _get_avatar_materials(
                    video_path=clip.path,
                    bbox_shift=0,
                    extra_margin=10,
                    version="v15",
                    parsing_mode="jaw",
                    vae=vae,
                    fp=fp,
                    default_fps=TARGET_FPS,
                )
                clip.frame_list_cycle = mats["frame_list_cycle"]
                clip.coord_list_cycle = mats["coord_list_cycle"]
                clip.latent_list_cycle = mats["input_latent_list_cycle"]
                clip.mask_materials_cycle = mats["mask_materials_cycle"]
                print(f"[AssetBank] MuseTalk materials ready: {name}")
            except Exception as err:
                print(f"[AssetBank] MuseTalk warmup notice ({name}): {err}")

    def resolve_action(self, tag: Optional[str]) -> str:
        if not tag:
            return self._idle_name
        key = self.ACTION_ALIASES.get(tag.lower().strip().replace("-", "_"), tag.lower())
        if key in self.clips:
            return key
        for candidate in (f"{self.host}_{key}", key, f"namira_{key}"):
            if candidate in self.clips:
                return candidate
        return "talk_expressive" if "talk_expressive" in self.clips else self._idle_name

    @property
    def idle_clip(self) -> ClipAsset:
        return self.clips[self._idle_name]


# ---------------------------------------------------------------------------
# State machine — playthrough lock (no mid-clip interruption)
# ---------------------------------------------------------------------------
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
        self.overlap_frames = max(3, min(int(overlap_frames), 8))
        self._face_registry = face_registry
        self.state = PlayState.IDLE
        self.current_name = bank._idle_name
        self.frame_idx = bank.idle_clip.base_pose_frame
        self.pending_action: Optional[str] = None
        self._action_queue: deque = deque()
        self._overlap: Optional[_OverlapTransition] = None
        self._seq = 0
        self._lock = threading.Lock()
        self._playthrough_lock = False
        self._utterance_active = False
        self._utterance_audio_done = False
        self._talk_loop_count = 0
        self._scheduled_gesture: Optional[str] = None
        self._post_speech_gesture_active = False

    def set_utterance_gesture(self, tag: Optional[str]) -> None:
        """Gesture diputar segera setelah audio habis (bukan setelah talk loop end_pose)."""
        with self._lock:
            if not tag:
                return
            key = tag.lower().strip()
            if key in ("none", "null", "idle", "talk", "talk_expressive"):
                return
            self._scheduled_gesture = tag

    def request_action(self, tag: Optional[str]) -> None:
        with self._lock:
            if not tag or tag.lower() in ("none", "null", "idle", "talk_expressive"):
                if tag and tag.lower() == "idle":
                    self._action_queue.append("idle")
                return
            if self._playthrough_lock or self._utterance_active:
                self._action_queue.append(tag)
                print(f"[StateMachine] Action queued (playthrough): {tag}")
                return
            self.pending_action = tag

    def begin_utterance(self) -> None:
        """Lock playthrough; overlap blend idle[-N:] → talk[0:N]."""
        with self._lock:
            if self._utterance_active:
                return
            self._utterance_active = True
            self._utterance_audio_done = False
            self._playthrough_lock = True
            self._talk_loop_count = 0
            talk = self.bank.resolve_action("talk_expressive")
            if talk not in self.bank.clips:
                return
            if self.current_name != talk:
                from_clip = self.bank.clips[self.current_name]
                self._begin_overlap_transition(
                    from_clip, self.frame_idx, talk, PlayState.TALK, lock_face=True
                )
            else:
                self.state = PlayState.TALK
                if self._face_registry:
                    talk_clip = self.bank.clips[talk]
                    self._face_registry.lock_from_clip(
                        talk_clip, talk_clip.base_pose_frame
                    )

    def mark_utterance_audio_done(self) -> None:
        with self._lock:
            if self._utterance_active:
                self._utterance_audio_done = True
                self._try_start_post_speech_gesture()

    def _try_start_post_speech_gesture(self) -> None:
        if not self._scheduled_gesture or self._post_speech_gesture_active:
            return
        talk = self.bank.resolve_action("talk_expressive")
        target = self.bank.resolve_action(self._scheduled_gesture)
        if target in (talk, self.bank._idle_name):
            self._scheduled_gesture = None
            return
        clip = self.bank.clips.get(self.current_name)
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
        print(f"[StateMachine] Post-speech gesture → {target}")

    def at_end_pose(self) -> bool:
        clip = self.bank.clips.get(self.current_name)
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
            clip = self.bank.clips.get(self.current_name)
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
            talk = self.bank.resolve_action("talk_expressive")
            if another_utterance_ready and self.current_name == talk:
                self.pending_action = None
                self.state = PlayState.TALK
                print("[StateMachine] Utterance selesai → hold talk (utterance berikutnya siap)")
            else:
                if not self.pending_action:
                    self.pending_action = self.bank._idle_name
                self.state = PlayState.IDLE
                print("[StateMachine] Utterance selesai → transisi (end pose tercapai)")

    def _begin_overlap_transition(
        self,
        from_clip: ClipAsset,
        from_idx: int,
        to_name: str,
        new_state: PlayState,
        lock_face: bool = False,
    ) -> None:
        """Blend N frame terakhir sumber dengan N frame pertama target (addWeighted)."""
        to_clip = self.bank.clips[to_name]
        n = self.overlap_frames
        from_idx = max(from_clip.base_pose_frame, min(from_idx, from_clip.end_pose))
        pairs: List[Tuple[np.ndarray, np.ndarray]] = []
        for i in range(n):
            fi = max(from_clip.base_pose_frame, from_idx - (n - 1 - i))
            fi = min(fi, from_clip.end_pose)
            ti = min(to_clip.base_pose_frame + i, to_clip.end_pose)
            pairs.append((from_clip.frames[fi].copy(), to_clip.frames[ti].copy()))
        resume = min(to_clip.base_pose_frame + n, to_clip.end_pose + 1)
        self._overlap = _OverlapTransition(pairs=pairs, step=0, resume_frame_idx=resume)
        self.current_name = to_name
        self.state = new_state
        if lock_face and self._face_registry:
            lock_idx = min(to_clip.base_pose_frame, to_clip.end_pose)
            self._face_registry.lock_from_clip(to_clip, lock_idx)
        print(
            f"[StateMachine] Overlap {n}f: {from_clip.name} → {to_name} "
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
        target = self.bank.resolve_action(self.pending_action)
        self.pending_action = None
        if target == self.current_name:
            return False

        at_base = self.frame_idx == clip.base_pose_frame
        at_end = self.frame_idx >= clip.end_pose
        if self.state == PlayState.IDLE and not (at_base or at_end):
            self.pending_action = target
            return False

        prev_idx = min(self.frame_idx, clip.end_pose)
        new_state = PlayState.ACTION if target not in ("idle", "talk_expressive") else (
            PlayState.TALK if target == "talk_expressive" else PlayState.IDLE
        )
        lock_face = target == self.bank.resolve_action("talk_expressive")
        self._begin_overlap_transition(
            clip, prev_idx, target, new_state, lock_face=lock_face
        )
        if target not in ("idle",):
            self._playthrough_lock = self.state in (PlayState.ACTION, PlayState.TALK)
        print(f"[StateMachine] → {target} (overlap={self.overlap_frames}f)")
        return True

    def _advance_frame_index(self, clip: ClipAsset, is_speech: bool) -> None:
        """Advance index; seamless loop at base pose; never stop before end_pose."""
        self.frame_idx += 1
        end_pf = clip.end_pose
        base_pf = clip.base_pose_frame

        if self.state == PlayState.TALK and self._utterance_active:
            if is_speech and self.frame_idx > end_pf:
                # Audio masih jalan — loop seamless (first pose == end pose)
                self.frame_idx = base_pf
                self._talk_loop_count += 1
            elif self._utterance_audio_done and self.frame_idx > end_pf:
                self.frame_idx = end_pf
            return

        if self.frame_idx > end_pf:
            if clip.loop and not self._playthrough_lock:
                self.frame_idx = base_pf
            elif not clip.loop:
                print(f"[StateMachine] {clip.name} selesai → idle")
                self.current_name = self.bank._idle_name
                self.state = PlayState.IDLE
                self.frame_idx = self.bank.idle_clip.base_pose_frame
                self._playthrough_lock = False
                self._drain_action_queue()

    def _drain_action_queue(self) -> None:
        if self._action_queue and not self.pending_action:
            self.pending_action = self._action_queue.popleft()

    def next_packet(
        self,
        audio_pcm: bytes,
        is_speech: bool,
        llm_action: Optional[str] = None,
    ) -> RawFramePacket:
        with self._lock:
            if llm_action and not self._playthrough_lock and not self._utterance_active:
                self.request_action(llm_action)

            clip = self.bank.clips[self.current_name]
            cycle_idx = 0
            frame: np.ndarray

            # --- Overlap blend: idle[-N:] + talk[0:N] via cv2.addWeighted ---
            if self._overlap is not None and self._overlap.step < len(self._overlap.pairs):
                from_f, to_f = self._overlap.pairs[self._overlap.step]
                n = len(self._overlap.pairs)
                alpha = (self._overlap.step + 1) / float(n)
                frame = blend_weighted(from_f, to_f, alpha)
                cycle_idx = self._overlap.step
                self._overlap.step += 1
                if self._overlap.step >= n:
                    self.frame_idx = self._overlap.resume_frame_idx
                    self._overlap = None
            else:
                self._try_consume_pending(clip)
                clip = self.bank.clips[self.current_name]

                if self.state == PlayState.IDLE:
                    body, cycle_idx = clip.forward_at(self.frame_idx)
                elif self._utterance_active and self.state == PlayState.TALK:
                    body, cycle_idx = clip.forward_at(self.frame_idx)
                else:
                    body, cycle_idx = clip.material_at(self.frame_idx)
                frame = body.copy()
                self._advance_frame_index(clip, is_speech)

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


# ---------------------------------------------------------------------------
# MuseTalk streaming inference (Thread 2) — batch-ahead lip-sync
# ---------------------------------------------------------------------------
class LipSyncEngine:
    """Pre-render mouth frames ahead of playback using real Whisper chunks."""

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
        self._rendered: Dict[int, np.ndarray] = {}
        self._infer_cursor = 0
        self._infer_stop = threading.Event()
        self._infer_thread: Optional[threading.Thread] = None
        self._talk_clip_name = "talk_expressive"

    def set_utterance(self, job) -> None:
        """Mulai batch-ahead inference untuk satu utterance."""
        self.clear_utterance()
        if job is None or job.whisper_chunks is None:
            return
        with self._lock:
            self._utterance_id = job.task_id
            self._whisper_chunks = job.whisper_chunks
            self._rendered = {}
            self._infer_cursor = 0
        self._infer_stop.clear()
        self._infer_thread = threading.Thread(
            target=self._batch_inference_loop,
            name=f"LipSync-{job.task_id[:20]}",
            daemon=True,
        )
        self._infer_thread.start()
        # Switch state machine ke talk clip
        talk = self.bank.resolve_action("talk_expressive")
        if talk in self.bank.clips:
            self._talk_clip_name = talk

    def clear_utterance(self) -> None:
        self._infer_stop.set()
        if self._infer_thread and self._infer_thread.is_alive():
            self._infer_thread.join(timeout=1.0)
        with self._lock:
            self._utterance_id = None
            self._whisper_chunks = None
            self._rendered = {}
            self._infer_cursor = 0
        self._infer_thread = None

    def _batch_inference_loop(self) -> None:
        from musetalk.utils.blending import get_image_blending, get_image
        from musetalk.utils.preprocessing import coord_placeholder

        vae = self.models["vae"]
        unet = self.models["unet"]
        pe = self.models["pe"]
        fp = self.models["fp"]
        timesteps = self.models["timesteps"]
        clip = self.bank.clips.get(self._talk_clip_name) or self.bank.idle_clip

        while not self._infer_stop.is_set():
            with self._lock:
                chunks = self._whisper_chunks
                cursor = self._infer_cursor
            if chunks is None or cursor >= chunks.shape[0]:
                break

            end = min(cursor + self.batch_size, chunks.shape[0])
            whisper_batch = chunks[cursor:end].to(device=self.device, dtype=self.weight_dtype)
            latent_list = []
            cycle_indices = []
            for i in range(cursor, end):
                cidx = i % max(1, len(clip.frames))
                cycle_indices.append(cidx)
                lat = clip.latent_list_cycle[cidx]
                latent_list.append(lat.unsqueeze(0) if lat.dim() == 3 else lat)

            if not latent_list:
                break

            latent_batch = torch.cat(latent_list, dim=0).to(device=self.device, dtype=self.weight_dtype)
            metrics = get_telemetry()
            try:
                with metrics.measure("musetalk_batch_ms"):
                    audio_feature_batch = pe(whisper_batch)
                    pred = unet.model(
                        latent_batch, timesteps, encoder_hidden_states=audio_feature_batch
                    ).sample
                    recon = vae.decode_latents(pred)
            except Exception as err:
                print(f"[LipSync] batch infer notice: {err}")
                with self._lock:
                    self._infer_cursor = end
                continue

            for local_i, res_frame in enumerate(recon):
                frame_idx = cursor + local_i
                cidx = cycle_indices[local_i]
                ori, _ = clip.material_at(cidx)
                blended = self._blend_mouth(ori, res_frame, clip, cidx, fp, coord_placeholder)
                with self._lock:
                    self._rendered[frame_idx] = blended

            with self._lock:
                self._infer_cursor = end

    def _blend_mouth(
        self, ori, res_frame, clip, cidx, fp, coord_placeholder
    ) -> np.ndarray:
        from musetalk.utils.blending import get_image_blending, get_image

        mat = None
        if self._face_registry:
            mat = self._face_registry.get_material(clip, cidx)
        if mat is None and clip.mask_materials_cycle:
            raw = clip.mask_materials_cycle[cidx % len(clip.mask_materials_cycle)]
            if raw:
                mask_array, crop_box, face_box = raw
                mat = (feather_mask(mask_array), crop_box, face_box)
        if mat is not None:
            mask_array, crop_box, face_box = mat
            x1, y1, x2, y2 = face_box
            try:
                mouth = cv2.resize(res_frame.astype(np.uint8), (x2 - x1, y2 - y1))
                return get_image_blending(ori, mouth, face_box, mask_array, crop_box)
            except Exception:
                pass
        if cidx < len(clip.coord_list_cycle):
            bbox = clip.coord_list_cycle[cidx]
            if bbox != coord_placeholder:
                if self._face_registry:
                    bbox = self._face_registry._smooth_bbox(bbox)
                x1, y1, x2, y2 = bbox
                y2 = min(y2 + 10, ori.shape[0])
                try:
                    mouth = cv2.resize(res_frame.astype(np.uint8), (x2 - x1, y2 - y1))
                    return get_image(ori, mouth, [x1, y1, x2, y2], mode="jaw", fp=fp)
                except Exception:
                    pass
        return ori

    @torch.no_grad()
    def process(self, pkt: RawFramePacket, clip: ClipAsset) -> np.ndarray:
        metrics = get_telemetry()
        if pkt.whisper_idx is not None:
            with self._lock:
                cached = self._rendered.get(pkt.whisper_idx)
            if cached is not None:
                metrics.inc("lipsync_cache_hit")
                return cached
            metrics.inc("lipsync_cache_miss")
            # Belum siap — pakai body frame sambil menunggu batch-ahead
            talk = self.bank.clips.get(self._talk_clip_name)
            if talk:
                body, cidx = talk.material_at(pkt.whisper_idx)
                return body
        if not pkt.needs_lipsync:
            return pkt.frame
        return pkt.frame


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
            out = RenderedPacket(seq=pkt.seq, frame=frame, audio_pcm=pkt.audio_pcm)
            metrics.set_gauge("render_queue_depth", float(render_q.qsize()))
            try:
                render_q.put(out, timeout=0.15)
            except queue.Full:
                # Drop oldest — broadcaster must never stall
                metrics.inc("render_queue_dropped")
                try:
                    render_q.get_nowait()
                except queue.Empty:
                    pass
                render_q.put(out, block=False)
        except Exception as err:
            print(f"[LipSync] frame {pkt.seq} notice: {err}")
            render_q.put(
                RenderedPacket(seq=pkt.seq, frame=pkt.frame, audio_pcm=pkt.audio_pcm),
                block=False,
            )
        finally:
            raw_q.task_done()


# ---------------------------------------------------------------------------
# Frame fetcher (Thread 1)
# ---------------------------------------------------------------------------
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

        # Utterance lifecycle — jangan potong sebelum end_pose
        if bridge is not None and bridge.is_utterance_active():
            if is_speech and not was_speaking:
                sm.begin_utterance()
            elif not is_speech and was_speaking and bridge.is_audio_exhausted():
                sm.mark_utterance_audio_done()
            if sm.utterance_visual_complete():
                another_ready = (
                    bridge.has_ready_pending() if hasattr(bridge, "has_ready_pending") else False
                )
                sm.end_utterance(another_utterance_ready=another_ready)
                bridge.signal_visual_complete()

        was_speaking = is_speech or (
            bridge is not None
            and bridge.is_utterance_active()
            and not bridge.is_audio_exhausted()
        )

        action = action_fn()
        pkt = sm.next_packet(pcm, is_speech, llm_action=action)
        pkt.whisper_idx = whisper_idx
        if whisper_idx is not None:
            pkt.needs_lipsync = True
        metrics.set_gauge("raw_queue_depth", float(raw_q.qsize()))
        if bridge is not None:
            metrics.set_gauge("utterance_queue_depth", float(bridge.pending_count()))
        _put_raw_frame(raw_q, pkt, metrics, stop_event)
        metrics.record_latency("frame_fetch_tick_ms", (time.perf_counter() - tick_start) * 1000.0)
        deadline += period
        sleep_for = deadline - time.perf_counter()
        if sleep_for > 0:
            time.sleep(sleep_for)
        elif sleep_for < -period:
            deadline = time.perf_counter()


# ---------------------------------------------------------------------------
# Broadcaster (Thread 3) — strict 30 FPS, never freeze
# ---------------------------------------------------------------------------
class StreamBroadcaster:
    """Push BGR + PCM to FFmpeg RTMP encoder (same pattern as frame_feed.py)."""

    def __init__(self, rtmp_url: str, width: int = CANVAS_W, height: int = CANVAS_H, fps: int = TARGET_FPS):
        self.rtmp_url = rtmp_url
        self.width = width
        self.height = height
        self.fps = fps
        self.bytes_per_audio = int(round(SAMPLE_RATE / float(fps))) * 2 * 2
        self._v_fh = None
        self._a_fh = None
        self._proc = None
        self._stderr_log = None
        self._start_encoder()

    def _start_encoder(self) -> None:
        import subprocess
        import threading

        gop = self.fps * 2
        video_r, video_w = os.pipe()
        audio_r, audio_w = os.pipe()
        os.set_inheritable(video_r, True)
        os.set_inheritable(audio_r, True)
        os.set_inheritable(video_w, False)
        os.set_inheritable(audio_w, False)

        v_in = f"/proc/self/fd/{video_r}"
        a_in = f"/proc/self/fd/{audio_r}"
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
            "-fflags", "+nobuffer+genpts",
            "-thread_queue_size", "512",
            "-f", "rawvideo", "-pix_fmt", "bgr24",
            "-s", f"{self.width}x{self.height}", "-r", str(self.fps),
            "-i", v_in,
            "-thread_queue_size", "512",
            "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "2",
            "-i", a_in,
            "-map", "0:v", "-map", "1:a",
            "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
            "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
            "-g", str(gop), "-keyint_min", str(gop), "-sc_threshold", "0",
            "-b:v", "2500k", "-maxrate", "3000k", "-bufsize", "6000k",
            "-c:a", "aac", "-b:a", "128k",
            "-flvflags", "no_duration_filesize",
            "-f", "flv", "-rtmp_live", "live",
            self.rtmp_url,
        ]
        out_dir = os.environ.get("OUTPUT_FOLDER", "")
        log_fh = None
        if out_dir:
            try:
                os.makedirs(out_dir, exist_ok=True)
                log_path = os.path.join(out_dir, "ai_worker_rtmp.log")
                log_fh = open(log_path, "a", encoding="utf-8", buffering=1)
                self._stderr_log = log_fh
            except Exception:
                pass
        self._proc = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            pass_fds=(video_r, audio_r),
        )
        if self._proc.stderr is not None:
            try:
                from rtmp_utils import FfmpegLogWatcher, write_rtmp_status

                watcher = FfmpegLogWatcher(
                    on_fatal=lambda hint: write_rtmp_status(
                        out_dir, "failed", hint
                    )
                    if out_dir
                    else None,
                )

                def _drain_stderr() -> None:
                    proc = self._proc
                    if proc is None or proc.stderr is None:
                        return
                    try:
                        for chunk in iter(lambda: proc.stderr.read(4096), b""):
                            text = chunk.decode("utf-8", errors="ignore")
                            if log_fh:
                                log_fh.write(text)
                                log_fh.flush()
                            watcher.ingest(text)
                    except Exception:
                        pass

                threading.Thread(target=_drain_stderr, daemon=True).start()
            except Exception:
                pass
        os.close(video_r)
        os.close(audio_r)
        self._v_fh = os.fdopen(video_w, "wb", buffering=0)
        self._a_fh = os.fdopen(audio_w, "wb", buffering=0)
        print(f"[Broadcaster] RTMP encoder @ {self.fps}fps → {self.rtmp_url.split('?')[0]}?**")

    def write(self, frame: np.ndarray, pcm: bytes) -> bool:
        if self._v_fh is None:
            return False
        if len(pcm) < self.bytes_per_audio:
            pcm = pcm + b"\x00" * (self.bytes_per_audio - len(pcm))
        elif len(pcm) > self.bytes_per_audio:
            pcm = pcm[: self.bytes_per_audio]
        try:
            self._v_fh.write(np.ascontiguousarray(frame, dtype=np.uint8).tobytes())
            self._a_fh.write(pcm)
            return True
        except (BrokenPipeError, OSError):
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
        for fh in (self._v_fh, self._a_fh):
            if fh:
                try:
                    fh.close()
                except Exception:
                    pass
        if self._proc and self._proc.poll() is None:
            try:
                self._proc.terminate()
            except Exception:
                pass


def broadcaster_loop(
    bank: AssetBank,
    render_q: queue.Queue,
    stop_event: threading.Event,
    rtmp_url: Optional[str] = None,
    output_folder: str = "",
) -> None:
    period = 1.0 / float(TARGET_FPS)
    deadline = time.perf_counter()
    silence = b"\x00" * BYTES_PER_AUDIO_FRAME

    fallback = bank.idle_clip.frames[bank.idle_clip.base_pose_frame].copy()
    last_good = fallback.copy()
    pending: Dict[int, RenderedPacket] = {}
    next_seq = 0
    bc: Optional[StreamBroadcaster] = None
    overlay_rgb = None
    overlay_alpha = None

    out_dir = output_folder or os.environ.get("OUTPUT_FOLDER", "")
    if out_dir:
        try:
            from rtmp_utils import write_rtmp_status
        except ImportError:
            write_rtmp_status = None  # type: ignore
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

    if rtmp_url:
        try:
            if out_dir:
                os.environ["OUTPUT_FOLDER"] = out_dir
            bc = StreamBroadcaster(rtmp_url)
            if out_dir:
                try:
                    from rtmp_utils import write_rtmp_status as _wrs
                    _wrs(out_dir, "connecting")
                except Exception:
                    pass
        except Exception as err:
            print(f"[Broadcaster] RTMP init notice: {err} — dry-run mode")

    frames_written = 0
    write_fail_streak = 0
    metrics = get_telemetry()
    metrics.set_gauge("target_fps", float(TARGET_FPS))
    while not stop_event.is_set():
        tick_start = time.perf_counter()
        # Hot-swap overlay
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
                                    overlay_alpha = ov[:, :, 3:4].astype(np.float32) / 255.0
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
        if next_seq in pending:
            pkt = pending.pop(next_seq)
            last_good = pkt.frame
            pcm = pkt.audio_pcm
        else:
            pcm = silence
            metrics.inc("frames_duplicated")

        frame_out = _apply_overlay(last_good)
        if bc:
            write_start = time.perf_counter()
            wrote = bc.write(frame_out, pcm)
            metrics.record_latency("ffmpeg_write_ms", (time.perf_counter() - write_start) * 1000.0)
            if wrote:
                frames_written += 1
                write_fail_streak = 0
                metrics.inc("frames_written")
                metrics.note_broadcast_frame()
                if frames_written == 10 and out_dir:
                    try:
                        from rtmp_utils import write_rtmp_status as _wrs
                        _wrs(out_dir, "connected")
                    except Exception:
                        pass
            else:
                write_fail_streak += 1
                if write_fail_streak >= 25 and out_dir:
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

        metrics.record_latency("broadcast_tick_ms", (time.perf_counter() - tick_start) * 1000.0)
        metrics.maybe_log_summary(target_fps=TARGET_FPS)
        deadline += period
        sleep_for = deadline - time.perf_counter()
        if sleep_for > 0:
            time.sleep(sleep_for)
        elif sleep_for < -period * 2:
            deadline = time.perf_counter()
            metrics.inc("broadcast_pacer_reset")

    if bc:
        bc.shutdown()
    if out_dir:
        try:
            from rtmp_utils import write_rtmp_status as _wrs
            _wrs(out_dir, "disconnected")
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------
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
        self._bridge = get_speech_bridge(self.output_folder) if get_speech_bridge else None
        self._raw_q: queue.Queue = queue.Queue(maxsize=RAW_QUEUE_SIZE)
        self._render_q: queue.Queue = queue.Queue(maxsize=RENDER_QUEUE_SIZE)
        self._stop = threading.Event()
        self._threads: List[threading.Thread] = []
        self._running = False

    def _on_utterance_start(self, job) -> None:
        if self._engine:
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
        from inference import _load_models_cached

        log_gpu_status(0)
        use_fp16 = resolve_use_float16(True, 0)
        models_root = os.path.join(musetalk_dir, "models")
        args = Namespace(
            gpu_id=0,
            use_float16=use_fp16,
            version="v15",
            left_cheek_width=90,
            right_cheek_width=90,
            unet_model_path=os.path.join(models_root, "musetalkV15", "unet.pth"),
            unet_config=os.path.join(models_root, "musetalkV15", "musetalk.json"),
            whisper_dir=os.path.join(models_root, "whisper"),
            vae_type="sd-vae-ft-mse",
            batch_size=int(os.environ.get("MUSETALK_BATCH_SIZE", "8")),
        )

        original_cwd = os.getcwd()
        os.chdir(musetalk_dir)
        try:
            self._models = _load_models_cached(args)
        finally:
            os.chdir(original_cwd)
        return self._models

    def initialize(self) -> None:
        print(f"[AIVisualWorker] Loading models + assets ({self.fps} FPS target)...")
        models = self._load_models()
        self._bank = AssetBank(self.assets_dir, host=self.host, models_bundle=models)
        self._bank.discover_and_load()
        self._face_registry = FaceCoordRegistry(BBOX_SMOOTH_WINDOW)
        self._sm = VideoStateMachine(
            self._bank,
            face_registry=self._face_registry,
            overlap_frames=OVERLAP_FRAMES,
        )
        self._engine = LipSyncEngine(
            models,
            self._bank,
            batch_size=int(os.environ.get("MUSETALK_BATCH_SIZE", "8")),
            face_registry=self._face_registry,
        )
        if self._bridge is not None:
            self._bridge.set_models(models)
            self._bridge.set_callbacks(
                on_start=self._on_utterance_start,
                on_end=self._on_utterance_end,
            )
        print(f"[AIVisualWorker] Ready — clips: {list(self._bank.clips.keys())}")

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
        if not self._running:
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

    def start(
        self,
        audio_fn: Callable[[], Tuple[bytes, bool]] = get_audio_chunk,
        action_fn: Callable[[], Optional[str]] = get_llm_action,
        audio_fn_ext: Optional[Callable[[], Tuple[bytes, bool, Optional[int]]]] = None,
    ) -> None:
        if not self._bank or not self._sm or not self._engine:
            self.initialize()

        if self._running:
            return

        if audio_fn_ext is None and self._bridge is not None:
            audio_fn_ext = self._bridge.get_audio_chunk
            action_fn = self._bridge.make_action_hook()

        bridge_ref = self._bridge
        self._stop.clear()
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
                args=(self._bank, self._engine, self._raw_q, self._render_q, self._stop),
                name="LipSync",
                daemon=True,
            ),
            threading.Thread(
                target=broadcaster_loop,
                args=(self._bank, self._render_q, self._stop, self.rtmp_url, self.output_folder),
                name="Broadcaster",
                daemon=True,
            ),
        ]
        for t in self._threads:
            t.start()
        self._running = True
        print("[AIVisualWorker] Pipeline running (3 threads)")

    def stop(self) -> None:
        self._stop.set()
        if self._engine:
            self._engine.clear_utterance()
        for t in self._threads:
            t.join(timeout=2.0)
        self._threads.clear()
        self._running = False
        print("[AIVisualWorker] Stopped")

    @property
    def is_running(self) -> bool:
        return self._running

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
            _visual_worker_singleton = AIVisualWorker(output_folder=output_folder or None)
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
    assets_dir = os.path.dirname(idle_video) if idle_video and os.path.exists(idle_video) else None
    vw = get_visual_worker(output_folder)
    vw.rtmp_url = rtmp_url
    if assets_dir:
        vw.assets_dir = assets_dir
    vw.host = host
    if output_folder:
        vw.output_folder = output_folder
    vw.initialize()
    vw.start()
    return vw


def stop_visual_broadcast() -> None:
    global _visual_worker_singleton
    with _visual_lock:
        if _visual_worker_singleton is not None:
            _visual_worker_singleton.stop()
            _visual_worker_singleton = None


# ---------------------------------------------------------------------------
# CLI / dry-run
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="AI Visual Worker — 30 FPS pipeline")
    parser.add_argument("--assets", default=None, help="Path to host video assets (3d/)")
    parser.add_argument("--host", default="namira")
    parser.add_argument("--rtmp", default=os.environ.get("RTMP_URL", ""), help="RTMP publish URL (optional)")
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
