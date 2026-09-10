"""Single source of truth for the worker audio/video clock."""

from __future__ import annotations

import os

FPS = int(os.environ.get("AI_WORKER_FPS", "24"))
# Whisper / MuseTalk features only. Never feed this to the RTMP AAC encoder.
WHISPER_SAMPLE_RATE = 16_000
# Broadcast PCM clock. FFmpeg reads this rate; do not chain 24k→16k→48k.
BROADCAST_SAMPLE_RATE = 48_000
SAMPLE_RATE = BROADCAST_SAMPLE_RATE
CHANNELS = 2
BYTES_PER_SAMPLE = 2

if FPS <= 0:
    raise ValueError("AI_WORKER_FPS must be positive")


def samples_for_frame(frame_index: int, sample_rate: int = SAMPLE_RATE) -> int:
    """Exact sample count for one video tick without cumulative rounding drift."""
    index = max(0, int(frame_index))
    rate = int(sample_rate)
    start = index * rate // FPS
    end = (index + 1) * rate // FPS
    return max(1, end - start)


def bytes_for_frame(frame_index: int, sample_rate: int = SAMPLE_RATE) -> int:
    return samples_for_frame(frame_index, sample_rate=sample_rate) * CHANNELS * BYTES_PER_SAMPLE


def silence_for_frame(frame_index: int, sample_rate: int = SAMPLE_RATE) -> bytes:
    return b"\x00" * bytes_for_frame(frame_index, sample_rate=sample_rate)
