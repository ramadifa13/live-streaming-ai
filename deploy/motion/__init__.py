"""Motion Engine Phase 1 — offline Motion Library + Graph (live path untouched).

Enable later via AI_MOTION_LIBRARY=1. Default is off; this package is offline tooling.
"""

from .schemas import (
    MotionAsset,
    MotionLevel,
    MotionTransition,
    PoseFeature,
    VelocityFeature,
)

__all__ = [
    "MotionAsset",
    "MotionLevel",
    "MotionTransition",
    "PoseFeature",
    "VelocityFeature",
]

__version__ = "0.1.0"
