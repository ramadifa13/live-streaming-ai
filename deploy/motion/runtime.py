"""Live-path adapter for Phase 2 MotionMatcher (gated by env flags).

Import only from call sites that already checked AI_MOTION_MATCH=1.
Default flags OFF → this module is never loaded by the worker.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from typing import Dict, Optional, Set

from .library import MotionLibrary, default_motion_root, flag_enabled
from .matcher import MotionGraphIndex, MotionMatcher, MotionQuery
from .schemas import MotionAsset, states_as_list
from .transition import TransitionPlan, TransitionPlanner


@dataclass
class MatchPick:
    clip_name: str
    asset_id: str
    plan: Optional[TransitionPlan]
    score: float


_LOCK = threading.RLock()
_ENGINE: Optional["MotionRuntime"] = None


class MotionRuntime:
    """Singleton-ish helper: library + matcher + planner + clip name map."""

    def __init__(self, avatar_id: str = "namira"):
        self.avatar_id = avatar_id
        root = default_motion_root()
        self.library = MotionLibrary(root, avatar_id).load()
        self.graph = MotionGraphIndex.from_library(self.library)
        self.matcher = MotionMatcher(self.library, self.graph)
        of_on = flag_enabled("AI_WORKER_OF_TRANSITIONS", "0")
        self.planner = TransitionPlanner(
            self.graph, self.library.thresholds, of_enabled=of_on
        )
        self._clip_to_asset: Dict[str, str] = {}
        self._asset_to_clip: Dict[str, str] = {}
        self._rebuild_maps()

    def _rebuild_maps(self) -> None:
        self._clip_to_asset.clear()
        self._asset_to_clip.clear()
        for a in self.library.all():
            # Prefer explicit material key; else asset id is legacy stem (idle_1, talk, …)
            clip = (a.musetalk_material_key or a.id or "").strip().lower()
            if not clip:
                continue
            self._clip_to_asset[clip] = a.id
            self._asset_to_clip[a.id] = clip

    def asset_for_clip(self, clip_name: str) -> Optional[MotionAsset]:
        key = (clip_name or "").strip().lower().replace("-", "_")
        aid = self._clip_to_asset.get(key) or key
        return self.library.get(aid)

    def clip_for_asset(self, asset_id: str) -> Optional[str]:
        return self._asset_to_clip.get(asset_id) or (
            asset_id if asset_id in self._clip_to_asset else None
        )

    def pick_next_clip(
        self,
        *,
        current_clip: str,
        desired_state: Optional[str],
        bank_clip_names: Set[str],
        exclude_clips: Optional[Set[str]] = None,
    ) -> Optional[MatchPick]:
        """Return a bank clip name chosen by matcher, or None if library unusable."""
        if len(self.library.all()) < 1:
            return None
        current = self.asset_for_clip(current_clip)
        if current is None:
            # Bootstrap: any asset matching desired state
            pool = (
                self.library.query(states_contains=desired_state)
                if desired_state
                else self.library.all()
            )
            if not pool:
                pool = self.library.all()
            current = pool[0]

        exclude_assets = set()
        for c in exclude_clips or ():
            a = self.asset_for_clip(c)
            if a is not None:
                exclude_assets.add(a.id)

        q = MotionQuery(
            avatar_id=self.avatar_id,
            current_asset_id=current.id,
            current_pose=current.exit_pose,
            current_velocity=current.exit_velocity,
            energy=current.energy,
            desired_state=desired_state,
            semantic_tags=list(current.semantic_tags),
            gaze=current.gaze,
            hand=current.hand,
            exclude_asset_ids=list(exclude_assets),
            memory=self.matcher.memory,
        )
        cand = self.matcher.select_next(q)
        plan = self.planner.plan(current, cand)
        if plan.abort:
            clip = self.clip_for_asset(current.id)
            if clip and clip in bank_clip_names:
                return MatchPick(clip_name=clip, asset_id=current.id, plan=plan, score=cand.score)
            return None

        # Prefer mapped clip in bank; if FALLBACK_IDLE, try idle micro bridge
        target_id = cand.asset_id
        if plan.kind == "fallback_idle":
            fb = self.matcher.fallback_idle_micro(self.avatar_id)
            if fb is not None:
                target_id = fb.id
                cand = self.matcher.select_next(
                    MotionQuery(
                        avatar_id=self.avatar_id,
                        current_asset_id=current.id,
                        current_pose=current.exit_pose,
                        current_velocity=current.exit_velocity,
                        energy=current.energy,
                        desired_state="IDLE",
                        exclude_asset_ids=list(exclude_assets),
                        memory=self.matcher.memory,
                    )
                )
                target_id = cand.asset_id
                plan = self.planner.plan(current, cand)

        clip = self.clip_for_asset(target_id)
        if not clip or clip not in bank_clip_names:
            # Scan bank for any clip mapped from desired state
            for a in self.library.query(states_contains=desired_state or "IDLE"):
                c = self.clip_for_asset(a.id)
                if c and c in bank_clip_names and c != current_clip:
                    return MatchPick(
                        clip_name=c, asset_id=a.id, plan=plan, score=cand.score
                    )
            return None
        return MatchPick(
            clip_name=clip, asset_id=target_id, plan=plan, score=cand.score
        )


def motion_match_enabled() -> bool:
    """AI_MOTION_MATCH=1 enables runtime matcher (implies library load)."""
    return flag_enabled("AI_MOTION_MATCH", "0")


def get_motion_runtime(avatar_id: Optional[str] = None) -> Optional[MotionRuntime]:
    """Lazy load; returns None if flags off or library missing."""
    if not motion_match_enabled():
        return None
    global _ENGINE
    with _LOCK:
        aid = (avatar_id or os.environ.get("AI_MOTION_AVATAR") or "namira").strip()
        if _ENGINE is None or _ENGINE.avatar_id != aid:
            try:
                eng = MotionRuntime(aid)
            except Exception as err:
                print(f"[motion.runtime] init failed: {err}")
                return None
            if not eng.library.all():
                print(f"[motion.runtime] empty library for {aid}")
                return None
            _ENGINE = eng
            print(
                f"[motion.runtime] loaded {len(eng.library.all())} assets "
                f"avatar={aid} (AI_MOTION_MATCH=1)"
            )
        return _ENGINE
