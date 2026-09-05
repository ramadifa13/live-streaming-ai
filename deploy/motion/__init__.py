"""Motion Engine — Phase 1 offline library + Phase 2 matcher (flag-gated).

**Default:** live path uses legacy VSM. Enable matcher only with `AI_MOTION_MATCH=1`.
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

__version__ = "0.2.0"
