"""Offline pose/velocity feature extraction (CPU).

Prefer MediaPipe if installed; otherwise OpenCV silhouette/motion proxies.
Never runs on the live critical path unless explicitly invoked offline.
"""

from __future__ import annotations

import math
from dataclasses import replace
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np

from .schemas import (
    POSE_XY_DIM,
    SILHOUETTE_MOMENTS_DIM,
    PoseFeature,
    VelocityFeature,
)

_MP_POSE = None
_MP_TRIED = False


def _try_mediapipe():
    global _MP_POSE, _MP_TRIED
    if _MP_TRIED:
        return _MP_POSE
    _MP_TRIED = True
    try:
        import mediapipe as mp  # type: ignore

        _MP_POSE = mp.solutions.pose.Pose(
            static_image_mode=True,
            model_complexity=1,
            enable_segmentation=True,
            min_detection_confidence=0.5,
        )
    except Exception:
        _MP_POSE = None
    return _MP_POSE


def decode_video_sample(
    path: Path, *, max_frames: int = 0
) -> Tuple[List[np.ndarray], float]:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {path}")
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0) or 30.0
    frames: List[np.ndarray] = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame)
        if max_frames > 0 and len(frames) >= max_frames:
            break
    cap.release()
    if not frames:
        raise RuntimeError(f"Empty video: {path}")
    return frames, fps


def _angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Angle at b in radians, normalized roughly to [-pi, pi] contribution."""
    ba = a - b
    bc = c - b
    nba = np.linalg.norm(ba) + 1e-8
    nbc = np.linalg.norm(bc) + 1e-8
    cos = float(np.clip(np.dot(ba, bc) / (nba * nbc), -1.0, 1.0))
    return float(math.acos(cos))


def _silhouette_moments(frame: np.ndarray) -> Tuple[List[float], float, List[float]]:
    """Person-ish blob via simple center-weighted threshold + moments."""
    h, w = frame.shape[:2]
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    # Soft person mask: darker/edge content near vertical center strip
    edges = cv2.Canny(blur, 40, 120)
    ys, xs = np.where(edges > 0)
    if len(xs) < 30:
        moments = [0.0] * SILHOUETTE_MOMENTS_DIM
        return moments, 0.0, [0.5, 0.5]
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    bw = max(1, x1 - x0)
    bh = max(1, y1 - y0)
    scale = bh / float(h)
    cx = ((x0 + x1) * 0.5) / float(w)
    cy = ((y0 + y1) * 0.5) / float(h)
    roi = edges[y0 : y1 + 1, x0 : x1 + 1]
    m = cv2.moments(roi)
    hu = cv2.HuMoments(m).flatten() if m["m00"] > 1e-6 else np.zeros(7)
    # Log-scale Hu for stability
    moments = []
    for v in hu[:SILHOUETTE_MOMENTS_DIM]:
        moments.append(float(-np.sign(v) * np.log10(abs(v) + 1e-12)))
    while len(moments) < SILHOUETTE_MOMENTS_DIM:
        moments.append(0.0)
    return moments[:SILHOUETTE_MOMENTS_DIM], float(scale), [float(cx), float(cy)]


def _frame_energy(prev: np.ndarray, cur: np.ndarray) -> float:
    a = cv2.cvtColor(prev, cv2.COLOR_BGR2GRAY).astype(np.float32)
    b = cv2.cvtColor(cur, cv2.COLOR_BGR2GRAY).astype(np.float32)
    if a.shape != b.shape:
        b = cv2.resize(b, (a.shape[1], a.shape[0]))
    diff = np.abs(a - b)
    return float(np.mean(diff) / 255.0)


def extract_pose_opencv(frame: np.ndarray) -> PoseFeature:
    moments, scale, translation = _silhouette_moments(frame)
    # Proxy joints: place along bbox vertical using silhouette extents
    h, w = frame.shape[:2]
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 40, 120)
    ys, xs = np.where(edges > 0)
    joints = [-1.0] * POSE_XY_DIM
    if len(xs) >= 30:
        x0, x1 = xs.min() / w, xs.max() / w
        y0, y1 = ys.min() / h, ys.max() / h
        mx = (x0 + x1) * 0.5
        # nose, shoulders, elbows, wrists, hips — schematic layout
        layout = [
            (mx, y0 + 0.08 * (y1 - y0)),  # nose
            (mx - 0.12, y0 + 0.22 * (y1 - y0)),  # L shoulder
            (mx + 0.12, y0 + 0.22 * (y1 - y0)),  # R shoulder
            (mx - 0.16, y0 + 0.40 * (y1 - y0)),  # L elbow
            (mx + 0.16, y0 + 0.40 * (y1 - y0)),  # R elbow
            (mx - 0.14, y0 + 0.55 * (y1 - y0)),  # L wrist
            (mx + 0.14, y0 + 0.55 * (y1 - y0)),  # R wrist
            (mx - 0.08, y0 + 0.70 * (y1 - y0)),  # L hip
            (mx + 0.08, y0 + 0.70 * (y1 - y0)),  # R hip
        ]
        for i, (x, y) in enumerate(layout):
            joints[2 * i] = float(np.clip(x, 0, 1))
            joints[2 * i + 1] = float(np.clip(y, 0, 1))
        shoulder_angle = math.atan2(
            layout[2][1] - layout[1][1], layout[2][0] - layout[1][0]
        )
    else:
        shoulder_angle = 0.0

    return PoseFeature(
        joints_xy=joints,
        silhouette_moments=moments,
        head_yaw=0.0,
        head_pitch=0.0,
        shoulder_angle=float(shoulder_angle),
        left_elbow_angle=0.0,
        right_elbow_angle=0.0,
        left_wrist_rel=[0.0, 0.0],
        right_wrist_rel=[0.0, 0.0],
        hand_state="neutral",
        person_scale=scale,
        translation_xy=translation,
        feature_source="opencv_proxy",
    )


def extract_pose_mediapipe(frame: np.ndarray) -> Optional[PoseFeature]:
    pose = _try_mediapipe()
    if pose is None:
        return None
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    res = pose.process(rgb)
    if not res.pose_landmarks:
        return None
    lm = res.pose_landmarks.landmark
    # MediaPipe indices
    idx = {
        "nose": 0,
        "left_shoulder": 11,
        "right_shoulder": 12,
        "left_elbow": 13,
        "right_elbow": 14,
        "left_wrist": 15,
        "right_wrist": 16,
        "left_hip": 23,
        "right_hip": 24,
    }
    names = list(idx.keys())
    joints = []
    pts = {}
    for name in names:
        p = lm[idx[name]]
        joints.extend([float(p.x), float(p.y)])
        pts[name] = np.array([p.x, p.y], dtype=np.float64)
    while len(joints) < POSE_XY_DIM:
        joints.append(-1.0)

    def ang(a, b, c):
        return _angle(pts[a], pts[b], pts[c])

    shoulder_angle = math.atan2(
        pts["right_shoulder"][1] - pts["left_shoulder"][1],
        pts["right_shoulder"][0] - pts["left_shoulder"][0],
    )
    # Head yaw/pitch proxies from nose vs shoulder midpoint
    mid_s = 0.5 * (pts["left_shoulder"] + pts["right_shoulder"])
    head_yaw = float(pts["nose"][0] - mid_s[0])
    head_pitch = float(pts["nose"][1] - mid_s[1])

    l_wrist_rel = (pts["left_wrist"] - pts["left_shoulder"]).tolist()
    r_wrist_rel = (pts["right_wrist"] - pts["right_shoulder"]).tolist()

    # Hand state heuristic: wrist height vs shoulder
    hand = "neutral"
    if pts["right_wrist"][1] < pts["right_shoulder"][1] - 0.05:
        hand = "open"
    if abs(pts["right_wrist"][0] - pts["nose"][0]) < 0.05 and pts["right_wrist"][1] < mid_s[1]:
        hand = "point"

    moments, scale, translation = _silhouette_moments(frame)
    if res.segmentation_mask is not None:
        mask = (res.segmentation_mask > 0.3).astype(np.uint8) * 255
        ys, xs = np.where(mask > 0)
        if len(xs) > 30:
            h, w = frame.shape[:2]
            scale = float((ys.max() - ys.min()) / h)
            translation = [
                float(((xs.min() + xs.max()) * 0.5) / w),
                float(((ys.min() + ys.max()) * 0.5) / h),
            ]

    return PoseFeature(
        joints_xy=joints[:POSE_XY_DIM],
        silhouette_moments=moments,
        head_yaw=head_yaw,
        head_pitch=head_pitch,
        shoulder_angle=float(shoulder_angle),
        left_elbow_angle=float(ang("left_shoulder", "left_elbow", "left_wrist")),
        right_elbow_angle=float(ang("right_shoulder", "right_elbow", "right_wrist")),
        left_wrist_rel=[float(l_wrist_rel[0]), float(l_wrist_rel[1])],
        right_wrist_rel=[float(r_wrist_rel[0]), float(r_wrist_rel[1])],
        hand_state=hand,
        person_scale=scale,
        translation_xy=translation,
        feature_source="mediapipe",
    )


def extract_pose(frame: np.ndarray) -> PoseFeature:
    mp_pose = extract_pose_mediapipe(frame)
    if mp_pose is not None:
        return mp_pose
    return extract_pose_opencv(frame)


def pose_l2(a: PoseFeature, b: PoseFeature) -> float:
    ja = np.asarray(a.joints_xy, dtype=np.float64)
    jb = np.asarray(b.joints_xy, dtype=np.float64)
    # Ignore missing (-1) pairs
    mask = (ja >= 0) & (jb >= 0)
    if not np.any(mask):
        d_j = 0.0
    else:
        d_j = float(np.linalg.norm((ja - jb)[mask])) / max(1, int(mask.sum()))
    sa = np.asarray(a.silhouette_moments, dtype=np.float64)
    sb = np.asarray(b.silhouette_moments, dtype=np.float64)
    d_s = float(np.linalg.norm(sa - sb)) / max(1, len(sa))
    d = (
        1.0 * d_j
        + 0.35 * d_s
        + 0.5 * abs(a.head_yaw - b.head_yaw)
        + 0.35 * abs(a.head_pitch - b.head_pitch)
        + 0.25 * abs(a.shoulder_angle - b.shoulder_angle)
        + 0.4 * abs(a.person_scale - b.person_scale)
        + 0.3 * abs(a.translation_xy[0] - b.translation_xy[0])
        + 0.3 * abs(a.translation_xy[1] - b.translation_xy[1])
    )
    return float(d)


def velocity_l2(a: VelocityFeature, b: VelocityFeature) -> float:
    ja = np.asarray(a.joints_xy_delta, dtype=np.float64)
    jb = np.asarray(b.joints_xy_delta, dtype=np.float64)
    d = float(np.linalg.norm(ja - jb)) / max(1, len(ja))
    d += 0.3 * abs(a.head_yaw_rate - b.head_yaw_rate)
    d += 0.25 * abs(a.energy_proxy - b.energy_proxy)
    d += 0.2 * abs(a.acceleration_proxy - b.acceleration_proxy)
    return float(d)


def _delta_pose(a: PoseFeature, b: PoseFeature, dt: float) -> VelocityFeature:
    dt = max(dt, 1e-3)
    ja = np.asarray(a.joints_xy, dtype=np.float64)
    jb = np.asarray(b.joints_xy, dtype=np.float64)
    delta = ((jb - ja) / dt).tolist()
    while len(delta) < POSE_XY_DIM:
        delta.append(0.0)
    energy = float(np.mean(np.abs(jb - ja)))
    return VelocityFeature(
        joints_xy_delta=delta[:POSE_XY_DIM],
        head_yaw_rate=(b.head_yaw - a.head_yaw) / dt,
        head_pitch_rate=(b.head_pitch - a.head_pitch) / dt,
        energy_proxy=energy / dt,
        translation_delta=[
            (b.translation_xy[0] - a.translation_xy[0]) / dt,
            (b.translation_xy[1] - a.translation_xy[1]) / dt,
        ],
        scale_delta=(b.person_scale - a.person_scale) / dt,
        acceleration_proxy=0.0,
    )


def extract_clip_features(
    path: Path, *, window: int = 5
) -> Tuple[PoseFeature, PoseFeature, VelocityFeature, VelocityFeature, float, int, float]:
    """Return entry/exit pose+vel, mean energy, frame_count, fps."""
    frames, fps = decode_video_sample(path)
    n = len(frames)
    w = max(1, min(window, max(1, n // 4)))
    entry_i = 0
    exit_i = n - 1
    entry_pose = extract_pose(frames[entry_i])
    exit_pose = extract_pose(frames[exit_i])

    # Velocity near entry/exit using adjacent frames
    e1 = min(n - 1, entry_i + w)
    x0 = max(0, exit_i - w)
    p_e1 = extract_pose(frames[e1])
    p_x0 = extract_pose(frames[x0])
    dt = w / fps
    entry_vel = _delta_pose(entry_pose, p_e1, dt)
    exit_vel = _delta_pose(p_x0, exit_pose, dt)

    # Acceleration proxy at exit: compare mid-exit deltas
    if exit_i - 2 * w >= 0:
        p_xm = extract_pose(frames[exit_i - 2 * w])
        v1 = _delta_pose(p_xm, p_x0, dt)
        exit_vel = replace(
            exit_vel,
            acceleration_proxy=abs(exit_vel.energy_proxy - v1.energy_proxy),
        )

    energies = []
    step = max(1, n // 24)
    for i in range(0, n - 1, step):
        energies.append(_frame_energy(frames[i], frames[i + 1]))
    mean_energy = float(np.clip(np.mean(energies) * 4.0, 0.0, 1.0)) if energies else 0.2

    # Mark complete only for mediapipe; opencv_proxy still usable for graph MVP
    if entry_pose.feature_source == "mediapipe" and exit_pose.feature_source == "mediapipe":
        pass
    return entry_pose, exit_pose, entry_vel, exit_vel, mean_energy, n, fps
