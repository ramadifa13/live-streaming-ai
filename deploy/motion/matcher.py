"""CPU MotionMatcher (Phase 2) — score candidates; does not blend frames.

Lightweight search over hundreds of assets. No vector DB / neural retrieval.
"""

from __future__ import annotations

import random
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, List, Optional, Sequence, Set, Tuple

from .features import pose_l2, velocity_l2
from .library import MotionLibrary
from .schemas import (
    MotionAsset,
    MotionTransition,
    PoseFeature,
    TransitionKind,
    VelocityFeature,
    states_as_list,
)

WEIGHTS = dict(
    pose=1.0,
    velocity=0.75,
    energy=0.5,
    semantic=0.8,
    gaze=0.4,
    hand=0.4,
    state=1.0,
    level=0.3,
    repetition=1.2,
    graph=0.9,
)


@dataclass
class RepetitionMemory:
    recent_asset_ids: Deque[str] = field(default_factory=lambda: deque(maxlen=24))
    recent_gestures: Deque[str] = field(default_factory=lambda: deque(maxlen=24))
    recent_gaze: Deque[str] = field(default_factory=lambda: deque(maxlen=32))

    def remember(self, asset: MotionAsset) -> None:
        self.recent_asset_ids.append(asset.id)
        self.recent_gestures.append(asset.gesture)
        self.recent_gaze.append(asset.gaze)


@dataclass
class MotionQuery:
    avatar_id: str
    current_asset_id: str
    current_pose: PoseFeature
    current_velocity: VelocityFeature
    energy: float
    desired_state: Optional[str] = None
    desired_gesture: Optional[str] = None
    semantic_tags: Sequence[str] = ()
    gaze: str = "camera"
    hand: str = "neutral"
    exclude_asset_ids: Sequence[str] = ()
    memory: Optional[RepetitionMemory] = None


@dataclass
class MotionCandidate:
    asset_id: str
    score: float
    breakdown: Dict[str, float]
    entry_frame: int = 0
    suggested_transition: str = TransitionKind.OVERLAP.value
    edge: Optional[MotionTransition] = None

    @property
    def assetId(self) -> str:  # noqa: N802 — spec alias
        return self.asset_id


class MotionGraphIndex:
    """Adjacency from graph.json edges."""

    def __init__(self) -> None:
        self._out: Dict[str, List[MotionTransition]] = {}
        self._pair: Dict[Tuple[str, str], MotionTransition] = {}

    @classmethod
    def from_library(cls, library: MotionLibrary) -> "MotionGraphIndex":
        idx = cls()
        path = library.graph_json
        if not path.is_file():
            return idx
        import json

        raw = json.loads(path.read_text(encoding="utf-8"))
        edges = raw.get("edges") or raw.get("transitions") or []
        for e in edges:
            t = MotionTransition.from_dict(e) if isinstance(e, dict) else e
            idx._out.setdefault(t.from_asset_id, []).append(t)
            idx._pair[(t.from_asset_id, t.to_asset_id)] = t
        return idx

    def neighbors(self, asset_id: str) -> List[MotionTransition]:
        return list(self._out.get(asset_id, []))

    def get(self, from_id: str, to_id: str) -> Optional[MotionTransition]:
        return self._pair.get((from_id, to_id))


def repetition_penalty(
    asset_id: str, gesture: str, gaze: str, memory: Optional[RepetitionMemory]
) -> float:
    if memory is None:
        return 0.0
    p = 0.0
    ids = list(memory.recent_asset_ids)
    if asset_id in ids:
        rank = list(reversed(ids)).index(asset_id)
        p += 2.0 * (0.85**rank)
    p += 0.4 * list(memory.recent_gestures)[-20:].count(gesture)
    p += 0.25 * list(memory.recent_gaze)[-30:].count(gaze)
    return p


def suggest_kind(
    pose_d: float,
    vel_d: float,
    edge: Optional[MotionTransition],
    thr: Any,
) -> str:
    if edge and edge.kind == TransitionKind.NATIVE_CLIP.value and edge.native_clip_id:
        return TransitionKind.NATIVE_CLIP.value
    if pose_d < thr.pose_native and vel_d < thr.vel_native:
        return TransitionKind.OVERLAP.value
    if pose_d < thr.pose_soft:
        return (
            TransitionKind.RETIME.value
            if vel_d > thr.vel_soft
            else TransitionKind.CROSSFADE.value
        )
    return TransitionKind.FALLBACK_IDLE.value


def score_candidate(
    q: MotionQuery,
    asset: MotionAsset,
    edge: Optional[MotionTransition],
    thr: Any,
) -> MotionCandidate:
    pose_d = pose_l2(q.current_pose, asset.entry_pose)
    vel_d = velocity_l2(q.current_velocity, asset.entry_velocity)
    energy_d = abs(q.energy - asset.energy)
    semantic = (
        0.0
        if (set(q.semantic_tags) & set(asset.semantic_tags)) or not q.semantic_tags
        else 1.0
    )
    gaze_d = 0.0 if q.gaze == asset.gaze else 0.6
    hand_d = 0.0 if q.hand == asset.hand or asset.hand == "neutral" else 0.7
    state_d = 0.0 if (not q.desired_state or q.desired_state in states_as_list(asset.state)) else 1.5
    level_bonus = {"micro": 0.1, "gesture": 0.0, "behavior_segment": -0.05}.get(
        asset.level, 0.0
    )
    graph_d = edge.cost if edge is not None else 1.0
    rep = repetition_penalty(asset.id, asset.gesture, asset.gaze, q.memory)

    cost = (
        WEIGHTS["pose"] * pose_d
        + WEIGHTS["velocity"] * vel_d
        + WEIGHTS["energy"] * energy_d
        + WEIGHTS["semantic"] * semantic
        + WEIGHTS["gaze"] * gaze_d
        + WEIGHTS["hand"] * hand_d
        + WEIGHTS["state"] * state_d
        + WEIGHTS["graph"] * graph_d
        + WEIGHTS["repetition"] * rep
        + level_bonus
    )
    if q.desired_gesture and asset.gesture == q.desired_gesture:
        cost -= 1.5

    kind = suggest_kind(pose_d, vel_d, edge, thr)
    return MotionCandidate(
        asset_id=asset.id,
        score=cost,
        breakdown={
            "pose": pose_d,
            "velocity": vel_d,
            "energy": energy_d,
            "semantic": semantic,
            "gaze": gaze_d,
            "hand": hand_d,
            "state": state_d,
            "graph": graph_d,
            "repetition": rep,
        },
        suggested_transition=kind,
        edge=edge,
    )


class MotionMatcher:
    def __init__(
        self,
        library: MotionLibrary,
        graph: Optional[MotionGraphIndex] = None,
        *,
        rng: Optional[random.Random] = None,
    ):
        self.library = library
        self.graph = graph or MotionGraphIndex.from_library(library)
        self.rng = rng or random.Random()
        self.memory = RepetitionMemory()

    def fallback_idle_micro(self, avatar_id: str) -> Optional[MotionAsset]:
        idles = self.library.query(states_contains="IDLE")
        if not idles:
            all_a = self.library.all()
            return all_a[0] if all_a else None
        micros = [a for a in idles if a.level == "micro"]
        return (micros or idles)[0]

    def retrieve_candidates(
        self, q: MotionQuery, *, limit: int = 32
    ) -> List[Tuple[MotionAsset, Optional[MotionTransition]]]:
        thr = self.library.thresholds
        lo = max(0.0, q.energy - thr.energy_max_delta)
        hi = min(1.0, q.energy + thr.energy_max_delta)
        exclude: Set[str] = set(q.exclude_asset_ids)
        exclude.add(q.current_asset_id)

        pool = self.library.query(
            states_contains=q.desired_state,
            energy_range=(lo, hi),
            exclude=exclude,
        )
        if len(pool) < 4:
            # Soften energy / state filters
            pool = self.library.query(exclude=exclude)

        neighbors = {e.to_asset_id: e for e in self.graph.neighbors(q.current_asset_id)}
        ranked: List[Tuple[MotionAsset, Optional[MotionTransition]]] = []
        seen: Set[str] = set()
        for asset in pool:
            if asset.id in seen:
                continue
            ranked.append((asset, neighbors.get(asset.id)))
            seen.add(asset.id)

        if len(ranked) < 8 and q.semantic_tags:
            for a in self.library.query(tags=list(q.semantic_tags), exclude=exclude)[:24]:
                if a.id in seen:
                    continue
                ranked.append((a, neighbors.get(a.id)))
                seen.add(a.id)

        return ranked[:limit]

    def select_next(self, q: MotionQuery) -> MotionCandidate:
        if q.memory is None:
            q.memory = self.memory
        thr = self.library.thresholds
        pairs = self.retrieve_candidates(q)
        cands = [score_candidate(q, a, e, thr) for a, e in pairs]
        if not cands:
            fb = self.fallback_idle_micro(q.avatar_id)
            if fb is None:
                raise RuntimeError("MotionMatcher: empty library")
            return MotionCandidate(
                asset_id=fb.id,
                score=99.0,
                breakdown={"fallback": 1.0},
                suggested_transition=TransitionKind.FALLBACK_IDLE.value,
            )
        cands.sort(key=lambda c: c.score)
        best, second = cands[0], cands[1] if len(cands) > 1 else None
        chosen = best
        if second and second.score <= best.score * 1.15 and self.rng.random() < 0.10:
            chosen = second
        asset = self.library.get(chosen.asset_id)
        if asset is not None:
            self.memory.remember(asset)
        return chosen
