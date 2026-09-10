"""Compatibility adapter for the single continuous AI worker pipeline.

The duplicate FIFO broadcaster previously implemented here had an independent
audio clock and fallback timeline. Production now imports the only worker and
seq-ordered broadcaster from :mod:`ai_worker`.
"""

from ai_worker import (  # noqa: F401
    AIVisualWorker,
    TARGET_FPS,
    get_visual_worker,
    pause_visual_broadcast,
    resume_visual_broadcast,
    start_visual_broadcast,
    stop_visual_broadcast,
)

NewAIVisualWorker = AIVisualWorker

__all__ = [
    "AIVisualWorker",
    "NewAIVisualWorker",
    "TARGET_FPS",
    "get_visual_worker",
    "start_visual_broadcast",
    "stop_visual_broadcast",
    "pause_visual_broadcast",
    "resume_visual_broadcast",
]
