"""Motion asset / graph schemas for Phase 1 (JSON-serializable dataclasses)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence, Union


class MotionLevel(str, Enum):
    MICRO = "micro"
    GESTURE = "gesture"
    BEHAVIOR_SEGMENT = "behavior_segment"


class TransitionKind(str, Enum):
    NATIVE_CLIP = "native_clip"
    OVERLAP = "overlap"
    RETIME = "retime"
    CROSSFADE = "crossfade"
    OPTICAL_FLOW = "optical_flow"
    FALLBACK_IDLE = "fallback_idle"


# Fixed landmark layout for schema stability (MediaPipe Pose subset indices when available).
# Order: nose, L/R shoulder, L/R elbow, L/R wrist, L/R hip (x,y normalized 0..1; -1 if missing).
POSE_LANDMARK_NAMES: Sequence[str] = (
    "nose",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
)
POSE_XY_DIM = len(POSE_LANDMARK_NAMES) * 2  # 18
SILHOUETTE_MOMENTS_DIM = 7


def _zeros(n: int) -> List[float]:
    return [0.0] * n


@dataclass
class PoseFeature:
    """Compact 2D pose descriptor — joints + silhouette + scale/translation."""

    joints_xy: List[float] = field(default_factory=lambda: _zeros(POSE_XY_DIM))
    silhouette_moments: List[float] = field(
        default_factory=lambda: _zeros(SILHOUETTE_MOMENTS_DIM)
    )
    head_yaw: float = 0.0
    head_pitch: float = 0.0
    shoulder_angle: float = 0.0
    # Extended (locked requirements)
    left_elbow_angle: float = 0.0
    right_elbow_angle: float = 0.0
    left_wrist_rel: List[float] = field(default_factory=lambda: [0.0, 0.0])
    right_wrist_rel: List[float] = field(default_factory=lambda: [0.0, 0.0])
    hand_state: str = "neutral"  # neutral|open|point|hold_product|gesture_active|occluded
    person_scale: float = 0.0  # bbox height / frame height
    translation_xy: List[float] = field(default_factory=lambda: [0.0, 0.0])  # bbox center norm
    feature_source: str = "unknown"  # mediapipe|opencv_proxy|manual

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Optional[Dict[str, Any]]) -> "PoseFeature":
        if not d:
            return cls()
        known = {f.name for f in cls.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in d.items() if k in known})


@dataclass
class VelocityFeature:
    joints_xy_delta: List[float] = field(default_factory=lambda: _zeros(POSE_XY_DIM))
    head_yaw_rate: float = 0.0
    head_pitch_rate: float = 0.0
    energy_proxy: float = 0.0
    translation_delta: List[float] = field(default_factory=lambda: [0.0, 0.0])
    scale_delta: float = 0.0
    acceleration_proxy: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Optional[Dict[str, Any]]) -> "VelocityFeature":
        if not d:
            return cls()
        known = {f.name for f in cls.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in d.items() if k in known})


@dataclass
class AvatarThresholds:
    """Per-avatar calibrated transition thresholds — NOT universal constants."""

    pose_native: float = 0.12
    vel_native: float = 0.14
    pose_soft: float = 0.22
    vel_soft: float = 0.24
    energy_max_delta: float = 0.35
    version: int = 1

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Optional[Dict[str, Any]]) -> "AvatarThresholds":
        if not d:
            return cls()
        known = {f.name for f in cls.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in d.items() if k in known})


@dataclass
class MotionAsset:
    id: str
    avatar_id: str
    level: str  # MotionLevel value
    state: Union[str, List[str]]
    gesture: str
    duration_ms: float
    fps: float
    frame_count: int
    media_uri: str
    entry_pose: PoseFeature
    exit_pose: PoseFeature
    entry_velocity: VelocityFeature
    exit_velocity: VelocityFeature
    energy: float
    gaze: str
    hand: str
    emotion: str
    semantic_tags: List[str] = field(default_factory=list)
    transition_candidates: List[str] = field(default_factory=list)
    musetalk_material_key: Optional[str] = None
    face_bbox_stable: Optional[bool] = None
    quality_score: Optional[float] = None
    version: int = 1
    feature_complete: bool = False

    REQUIRED_FIELDS = (
        "id",
        "avatar_id",
        "level",
        "state",
        "gesture",
        "duration_ms",
        "entry_pose",
        "exit_pose",
        "entry_velocity",
        "exit_velocity",
        "energy",
        "gaze",
        "hand",
        "emotion",
        "semantic_tags",
        "transition_candidates",
    )

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "MotionAsset":
        return cls(
            id=str(d["id"]),
            avatar_id=str(d["avatar_id"]),
            level=str(d["level"]),
            state=d.get("state", "IDLE"),
            gesture=str(d.get("gesture", "none")),
            duration_ms=float(d.get("duration_ms", 0)),
            fps=float(d.get("fps", 30)),
            frame_count=int(d.get("frame_count", 0)),
            media_uri=str(d.get("media_uri", "")),
            entry_pose=PoseFeature.from_dict(d.get("entry_pose")),
            exit_pose=PoseFeature.from_dict(d.get("exit_pose")),
            entry_velocity=VelocityFeature.from_dict(d.get("entry_velocity")),
            exit_velocity=VelocityFeature.from_dict(d.get("exit_velocity")),
            energy=float(d.get("energy", 0.3)),
            gaze=str(d.get("gaze", "camera")),
            hand=str(d.get("hand", "neutral")),
            emotion=str(d.get("emotion", "neutral")),
            semantic_tags=list(d.get("semantic_tags") or []),
            transition_candidates=list(d.get("transition_candidates") or []),
            musetalk_material_key=d.get("musetalk_material_key"),
            face_bbox_stable=d.get("face_bbox_stable"),
            quality_score=d.get("quality_score"),
            version=int(d.get("version", 1)),
            feature_complete=bool(d.get("feature_complete", False)),
        )


@dataclass
class MotionTransition:
    id: str
    from_asset_id: str
    to_asset_id: str
    kind: str
    avatar_id: str
    pose_distance: float
    velocity_distance: float
    energy_delta: float
    semantic_ok: bool
    gaze_ok: bool
    hand_ok: bool
    overlap_frames_default: int
    cost: float
    native_clip_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "MotionTransition":
        return cls(
            id=str(d["id"]),
            from_asset_id=str(d["from_asset_id"]),
            to_asset_id=str(d["to_asset_id"]),
            kind=str(d.get("kind", TransitionKind.OVERLAP.value)),
            avatar_id=str(d.get("avatar_id", "")),
            pose_distance=float(d.get("pose_distance", 0)),
            velocity_distance=float(d.get("velocity_distance", 0)),
            energy_delta=float(d.get("energy_delta", 0)),
            semantic_ok=bool(d.get("semantic_ok", True)),
            gaze_ok=bool(d.get("gaze_ok", True)),
            hand_ok=bool(d.get("hand_ok", True)),
            overlap_frames_default=int(d.get("overlap_frames_default", 8)),
            cost=float(d.get("cost", 1.0)),
            native_clip_id=d.get("native_clip_id"),
        )


def states_as_list(state: Union[str, List[str]]) -> List[str]:
    if isinstance(state, list):
        return [str(s) for s in state]
    return [str(state)]
