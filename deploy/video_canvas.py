"""Canvas siaran tetap: 720x1280. Jangan crop/stretch antar action."""

from __future__ import annotations

import os
from typing import Tuple

import numpy as np

CANVAS_W = int(os.environ.get("FRAME_FEED_WIDTH", os.environ.get("LIVE_CANVAS_WIDTH", "720")))
CANVAS_H = int(os.environ.get("FRAME_FEED_HEIGHT", os.environ.get("LIVE_CANVAS_HEIGHT", "1280")))


def canvas_size() -> Tuple[int, int]:
    return CANVAS_W, CANVAS_H


def ffmpeg_fit_filter(width: int = CANVAS_W, height: int = CANVAS_H) -> str:
    """Fit ke canvas tanpa zoom.

    `increase+crop` membuat klip 592x1024 ter-zoom beda dengan 720x1280 —
    wajah terlihat ganti resolusi. `decrease+pad` menjaga skala; sumber yang
    sudah pas 720x1280 tidak berubah.
    """
    return (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,"
        f"setsar=1"
    )


def fit_bgr(frame, width: int = CANVAS_W, height: int = CANVAS_H):
    """Letterbox ke canvas. Identity jika sudah pas."""
    if frame is None:
        return frame
    h, w = frame.shape[:2]
    if w == width and h == height:
        return frame
    import cv2

    scale = min(width / float(w), height / float(h))
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    interp = cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR
    resized = cv2.resize(frame, (nw, nh), interpolation=interp)
    if nw == width and nh == height:
        return resized
    canvas = np.zeros((height, width, frame.shape[2]), dtype=frame.dtype)
    x = (width - nw) // 2
    y = (height - nh) // 2
    canvas[y : y + nh, x : x + nw] = resized
    return canvas


def _host_from_idle_path(idle_path: str) -> str:
    stem = os.path.splitext(os.path.basename(idle_path))[0].lower()
    for suffix in ("_talk_2", "_talk_3", "_talk", "_idle"):
        if stem.endswith(suffix):
            host = stem[: -len(suffix)]
            return host or "namira"
    return stem or "namira"


def prefer_idle_clip(idle_path: str) -> str:
    """Pilih visual idle (static) — namira_idle.mp4."""
    if not idle_path:
        return idle_path
    directory = os.path.dirname(idle_path) or "."
    host = _host_from_idle_path(idle_path)
    for name in (
        f"{host}_idle.mp4",
        "namira_idle.mp4",
        f"{host}_talk.mp4",
        "namira_talk.mp4",
    ):
        candidate = os.path.join(directory, name)
        if os.path.exists(candidate):
            if os.path.abspath(candidate) != os.path.abspath(idle_path):
                print(f"[CANVAS] Idle visual → {name}")
            return candidate
    return idle_path


def prefer_talk_clip(idle_path: str) -> str:
    """Talk body — namira_talk.mp4."""
    if not idle_path:
        return idle_path
    directory = os.path.dirname(idle_path) or "."
    host = _host_from_idle_path(idle_path)
    for name in (
        f"{host}_talk.mp4",
        "namira_talk.mp4",
        f"{host}_talk_2.mp4",
        "namira_talk_2.mp4",
        f"{host}_talk_3.mp4",
        "namira_talk_3.mp4",
    ):
        candidate = os.path.join(directory, name)
        if os.path.exists(candidate):
            return candidate
    return prefer_idle_clip(idle_path)
