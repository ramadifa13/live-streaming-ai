"""Single source of truth for the worker audio/video clock."""

from __future__ import annotations

import os

FPS = int(os.environ.get("AI_WORKER_FPS", "24"))
SAMPLE_RATE = 16_000
CHANNELS = 2
BYTES_PER_SAMPLE = 2

if FPS <= 0:
    raise ValueError("AI_WORKER_FPS must be positive")


def samples_for_frame(frame_index: int) -> int:
    """Exact sample count for one video tick without cumulative rounding drift."""
    index = max(0, int(frame_index))
    start = index * SAMPLE_RATE // FPS
    end = (index + 1) * SAMPLE_RATE // FPS
    return max(1, end - start)


def bytes_for_frame(frame_index: int) -> int:
    return samples_for_frame(frame_index) * CHANNELS * BYTES_PER_SAMPLE


def silence_for_frame(frame_index: int) -> bytes:
    return b"\x00" * bytes_for_frame(frame_index)
