"""Offline Motion Graph builder + coverage report.

Does not touch the live worker. Run:
  python -m motion.build_graph --avatar namira
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Sequence, Set, Tuple

# Allow `python -m motion.build_graph` from deploy/
_DEPLOY = Path(__file__).resolve().parent.parent
if str(_DEPLOY) not in sys.path:
    sys.path.insert(0, str(_DEPLOY))

from motion.features import pose_l2, velocity_l2  # noqa: E402
from motion.library import MotionLibrary, default_motion_root  # noqa: E402
from motion.schemas import (  # noqa: E402
    MotionAsset,
    MotionTransition,
    TransitionKind,
    states_as_list,
)

# Critical state pairs for coverage (from → to)
CRITICAL_PAIRS: Sequence[Tuple[str, str]] = (
    ("IDLE", "SPEAKING"),
    ("SPEAKING", "IDLE"),
    ("SPEAKING", "EXPLAINING"),
    ("EXPLAINING", "SPEAKING"),
    ("EXPLAINING", "POINTING"),
    ("POINTING", "EXPLAINING"),
    ("IDLE", "WAITING"),
    ("WAITING", "IDLE"),
    ("THINKING", "SPEAKING"),
    ("SPEAKING", "REACTING"),
    ("REACTING", "SPEAKING"),
)


def _semantic_ok(a: MotionAsset, b: MotionAsset) -> bool:
    if not a.semantic_tags or not b.semantic_tags:
        return True
    return bool(set(a.semantic_tags) & set(b.semantic_tags)) or "generic" in b.semantic_tags


def _gaze_ok(a: MotionAsset, b: MotionAsset) -> bool:
    if a.gaze == b.gaze:
        return True
    # camera <-> product is allowed with cost bump
    allowed = {("camera", "product"), ("product", "camera"), ("camera", "away"), ("away", "camera")}
    return (a.gaze, b.gaze) in allowed


def _hand_ok(a: MotionAsset, b: MotionAsset) -> bool:
    if a.hand == b.hand or b.hand == "neutral" or a.hand == "neutral":
        return True
    return False


def edge_cost(
    a: MotionAsset,
    b: MotionAsset,
    pose_d: float,
    vel_d: float,
    thr_pose: float,
    thr_vel: float,
) -> Tuple[float, str, int]:
    energy_d = abs(a.energy - b.energy)
    kind = TransitionKind.OVERLAP.value
    overlap = 8
    cost = pose_d + 0.75 * vel_d + 0.5 * energy_d
    if not _semantic_ok(a, b):
        cost += 0.8
    if not _gaze_ok(a, b):
        cost += 0.4
    if not _hand_ok(a, b):
        cost += 0.4
    if pose_d <= thr_pose and vel_d <= thr_vel:
        kind = TransitionKind.OVERLAP.value
        overlap = 6
    elif pose_d <= thr_pose * 1.4:
        kind = TransitionKind.RETIME.value
        overlap = 10
        cost += 0.15
    elif pose_d <= thr_pose * 2.0:
        kind = TransitionKind.CROSSFADE.value
        overlap = 10
        cost += 0.35
    else:
        kind = TransitionKind.FALLBACK_IDLE.value
        overlap = 12
        cost += 1.0
    # Native transition clips tagged as level gesture + semantic transition
    if "transition" in b.semantic_tags and b.level == "gesture":
        kind = TransitionKind.NATIVE_CLIP.value
        cost *= 0.7
    return cost, kind, overlap


def build_transitions(
    assets: List[MotionAsset],
    *,
    avatar_id: str,
    pose_native: float,
    vel_native: float,
    max_out_degree: int = 12,
) -> List[MotionTransition]:
    edges: List[MotionTransition] = []
    for a in assets:
        scored: List[Tuple[float, MotionTransition]] = []
        for b in assets:
            if a.id == b.id:
                continue
            pose_d = pose_l2(a.exit_pose, b.entry_pose)
            vel_d = velocity_l2(a.exit_velocity, b.entry_velocity)
            cost, kind, overlap = edge_cost(
                a, b, pose_d, vel_d, pose_native, vel_native
            )
            tr = MotionTransition(
                id=f"{a.id}__{b.id}",
                from_asset_id=a.id,
                to_asset_id=b.id,
                kind=kind,
                avatar_id=avatar_id,
                pose_distance=pose_d,
                velocity_distance=vel_d,
                energy_delta=abs(a.energy - b.energy),
                semantic_ok=_semantic_ok(a, b),
                gaze_ok=_gaze_ok(a, b),
                hand_ok=_hand_ok(a, b),
                overlap_frames_default=overlap,
                cost=cost,
                native_clip_id=b.id if kind == TransitionKind.NATIVE_CLIP.value else None,
            )
            scored.append((cost, tr))
        scored.sort(key=lambda x: x[0])
        for _, tr in scored[:max_out_degree]:
            # Keep only reasonably compatible edges in the stored graph
            if tr.kind == TransitionKind.FALLBACK_IDLE.value and tr.cost > 3.0:
                continue
            edges.append(tr)
    return edges


def _assets_by_state(assets: List[MotionAsset]) -> Dict[str, List[MotionAsset]]:
    by: Dict[str, List[MotionAsset]] = {}
    for a in assets:
        for s in states_as_list(a.state):
            by.setdefault(s, []).append(a)
    return by


def coverage_report(
    assets: List[MotionAsset], edges: List[MotionTransition]
) -> Dict:
    by_state = _assets_by_state(assets)
    edge_set = {(e.from_asset_id, e.to_asset_id) for e in edges}
    # Also allow path via any idle bridge for critical check
    idle_ids = {a.id for a in by_state.get("IDLE", [])}

    adj: Dict[str, Set[str]] = {}
    for e in edges:
        adj.setdefault(e.from_asset_id, set()).add(e.to_asset_id)

    critical_ok = 0
    critical_total = 0
    critical_gaps: List[str] = []
    for s_from, s_to in CRITICAL_PAIRS:
        srcs = by_state.get(s_from) or []
        dsts = by_state.get(s_to) or []
        if not srcs or not dsts:
            # Pair not representable in MVP library yet — skip from denominator
            continue
        critical_total += 1
        found = False
        for a in srcs:
            for b in dsts:
                if (a.id, b.id) in edge_set:
                    found = True
                    break
                # one-hop via idle
                for mid in idle_ids:
                    if (a.id, mid) in edge_set and (mid, b.id) in edge_set:
                        found = True
                        break
                if found:
                    break
            if found:
                break
        if found:
            critical_ok += 1
        else:
            critical_gaps.append(f"{s_from}->{s_to}")

    # Dead-end critical: assets in critical states with zero outgoing edges
    critical_states = {s for pair in CRITICAL_PAIRS for s in pair}
    dead_ends = []
    for a in assets:
        states = set(states_as_list(a.state))
        if not (states & critical_states):
            continue
        if not adj.get(a.id):
            dead_ends.append(a.id)

    # Offline fallback-rate estimate: fraction of top edges that are FALLBACK_IDLE
    fallback_n = sum(1 for e in edges if e.kind == TransitionKind.FALLBACK_IDLE.value)
    fallback_rate = (fallback_n / len(edges)) if edges else 1.0

    # Reachable from idle
    start = idle_ids or ({assets[0].id} if assets else set())
    seen: Set[str] = set()
    stack = list(start)
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(adj.get(cur, ()))
    reachable = len(seen) / max(1, len(assets))

    coverage = (critical_ok / critical_total) if critical_total else None
    return {
        "asset_count": len(assets),
        "edge_count": len(edges),
        "critical_total": critical_total,
        "critical_ok": critical_ok,
        "critical_coverage": coverage,
        "critical_gaps": critical_gaps,
        "dead_end_critical_nodes": dead_ends,
        "fallback_edge_rate": fallback_rate,
        "reachable_from_idle": reachable,
        "pass": bool(
            coverage is not None
            and coverage >= 0.95
            and len(dead_ends) == 0
            and fallback_rate < 0.01
        )
        if coverage is not None
        else False,
        "note": (
            "pass=false is expected on tiny MVP seeds; "
            "targets are ENGINEERING TARGETS to calibrate as library grows."
        ),
    }


def main(argv: List[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build motion graph (offline)")
    ap.add_argument("--avatar", default="namira")
    ap.add_argument("--root", type=Path, default=None)
    ap.add_argument("--max-out-degree", type=int, default=12)
    ap.add_argument("--report-only", action="store_true")
    args = ap.parse_args(argv)

    root = args.root or default_motion_root()
    lib = MotionLibrary(root, args.avatar).load()
    assets = lib.all()
    if not assets:
        print(f"[graph] FAIL: no assets in {lib.avatar_dir}", file=sys.stderr)
        return 2

    thr = lib.thresholds
    if args.report_only and lib.graph_json.is_file():
        raw = json.loads(lib.graph_json.read_text(encoding="utf-8"))
        edges = [MotionTransition.from_dict(e) for e in raw.get("transitions", [])]
    else:
        edges = build_transitions(
            assets,
            avatar_id=args.avatar,
            pose_native=thr.pose_native,
            vel_native=thr.vel_native,
            max_out_degree=args.max_out_degree,
        )
        # Write transition_candidates hints back onto assets (top 5)
        by_from: Dict[str, List[MotionTransition]] = {}
        for e in edges:
            by_from.setdefault(e.from_asset_id, []).append(e)
        for a in assets:
            tops = sorted(by_from.get(a.id, []), key=lambda e: e.cost)[:5]
            a.transition_candidates = [e.to_asset_id for e in tops]
            lib.upsert(a, write=True)
        lib.write_index()
        payload = {
            "avatar_id": args.avatar,
            "version": 1,
            "thresholds": thr.to_dict(),
            "transitions": [e.to_dict() for e in edges],
        }
        lib.graph_json.write_text(
            json.dumps(payload, indent=2) + "\n", encoding="utf-8"
        )
        print(f"[graph] wrote {lib.graph_json} ({len(edges)} edges)")

    report = coverage_report(assets, edges)
    report_path = lib.avatar_dir / "graph_coverage.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    # Phase 1: do not fail CI on coverage for tiny seeds — warn only
    if not report.get("pass"):
        print(
            "[graph] WARN: coverage targets not yet met (expected for MVP seed).",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
