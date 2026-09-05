"""TransitionPlanner (Phase 2) — choose transition kind / overlap length.

Does not decode or blend frames; BodyClock / VSM applies the plan.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .matcher import MotionCandidate, MotionGraphIndex
from .schemas import AvatarThresholds, MotionAsset, TransitionKind


@dataclass
class TransitionPlan:
    from_asset_id: str
    to_asset_id: str
    kind: str
    overlap_frames: int
    cost: float
    abort: bool = False
    reason: str = ""


# If planned cost exceeds this, stay on current (no teleport).
TRANSITION_ABORT_COST = 4.5


class TransitionPlanner:
    def __init__(
        self,
        graph: MotionGraphIndex,
        thresholds: Optional[AvatarThresholds] = None,
        *,
        of_enabled: bool = False,
        max_crossfade_frames: int = 12,
    ):
        self.graph = graph
        self.thresholds = thresholds or AvatarThresholds()
        self.of_enabled = of_enabled
        self.max_crossfade_frames = max(4, int(max_crossfade_frames))

    def plan(
        self,
        from_asset: MotionAsset,
        to_candidate: MotionCandidate,
        *,
        to_asset: Optional[MotionAsset] = None,
    ) -> TransitionPlan:
        edge = to_candidate.edge or self.graph.get(
            from_asset.id, to_candidate.asset_id
        )
        kind = to_candidate.suggested_transition
        overlap = 8
        cost = float(to_candidate.score)

        if edge is not None:
            cost = min(cost, float(edge.cost) + 0.15 * cost)
            overlap = int(edge.overlap_frames_default or overlap)
            if edge.native_clip_id and edge.kind == TransitionKind.NATIVE_CLIP.value:
                kind = TransitionKind.NATIVE_CLIP.value

        thr = self.thresholds
        pose_d = to_candidate.breakdown.get("pose", 0.0)
        vel_d = to_candidate.breakdown.get("velocity", 0.0)

        if kind == TransitionKind.NATIVE_CLIP.value:
            overlap = max(overlap, 4)
        elif pose_d < thr.pose_native and vel_d < thr.vel_native:
            kind = TransitionKind.OVERLAP.value
            overlap = max(6, min(overlap, 12))
        elif pose_d < thr.pose_soft and vel_d > thr.vel_soft:
            kind = TransitionKind.RETIME.value
            overlap = max(8, min(overlap, 16))
        elif pose_d < thr.pose_soft:
            kind = TransitionKind.CROSSFADE.value
            overlap = max(8, min(overlap, self.max_crossfade_frames))
        else:
            kind = TransitionKind.FALLBACK_IDLE.value
            overlap = max(10, min(overlap, 20))

        # Optical flow never default — only if explicitly enabled and mid-range pose.
        if (
            self.of_enabled
            and thr.pose_native < pose_d < thr.pose_soft * 1.2
            and kind in (TransitionKind.CROSSFADE.value, TransitionKind.RETIME.value)
        ):
            kind = TransitionKind.OPTICAL_FLOW.value
            overlap = min(overlap, 8)

        abort = cost > TRANSITION_ABORT_COST
        return TransitionPlan(
            from_asset_id=from_asset.id,
            to_asset_id=to_candidate.asset_id,
            kind=kind,
            overlap_frames=overlap,
            cost=cost,
            abort=abort,
            reason="cost_abort" if abort else kind,
        )
