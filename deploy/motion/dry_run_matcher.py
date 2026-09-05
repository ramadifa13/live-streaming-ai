"""CPU dry-run MotionMatcher microbench (offline; not wired to live path).

  python -m motion.dry_run_matcher --avatar namira --queries 1000
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path
from typing import List, Optional

_DEPLOY = Path(__file__).resolve().parent.parent
if str(_DEPLOY) not in sys.path:
    sys.path.insert(0, str(_DEPLOY))

from motion.features import pose_l2, velocity_l2  # noqa: E402
from motion.library import MotionLibrary, default_motion_root  # noqa: E402
from motion.schemas import MotionAsset, states_as_list  # noqa: E402


def score_pair(current: MotionAsset, cand: MotionAsset, *, thr_pose: float) -> float:
    pose_d = pose_l2(current.exit_pose, cand.entry_pose)
    vel_d = velocity_l2(current.exit_velocity, cand.entry_velocity)
    energy_d = abs(current.energy - cand.energy)
    state_d = 0.0
    # Prefer staying in-family unless querying different state
    cost = pose_d + 0.75 * vel_d + 0.5 * energy_d + state_d
    if pose_d > thr_pose * 2.5:
        cost += 1.0
    return cost


def select_next(
    library: MotionLibrary,
    current: MotionAsset,
    *,
    desired_state: Optional[str],
    exclude: List[str],
    rng: random.Random,
) -> MotionAsset:
    thr = library.thresholds.pose_native
    pool = library.all()
    scored = []
    for a in pool:
        if a.id == current.id or a.id in exclude:
            continue
        if desired_state and desired_state not in states_as_list(a.state):
            # soft filter — still allow with penalty
            penalty = 1.2
        else:
            penalty = 0.0
        scored.append((score_pair(current, a, thr_pose=thr) + penalty, a))
    if not scored:
        # Fallback hierarchy: any idle
        idles = library.query(states_contains="IDLE")
        return idles[0] if idles else current
    scored.sort(key=lambda x: x[0])
    best, second = scored[0], scored[1] if len(scored) > 1 else None
    if second and second[0] <= best[0] * 1.15 and rng.random() < 0.10:
        return second[1]
    return best[1]


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--avatar", default="namira")
    ap.add_argument("--root", type=Path, default=None)
    ap.add_argument("--queries", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args(argv)

    root = args.root or default_motion_root()
    lib = MotionLibrary(root, args.avatar).load()
    assets = lib.all()
    if len(assets) < 2:
        print("[matcher] FAIL: need >=2 assets", file=sys.stderr)
        return 2

    rng = random.Random(args.seed)
    current = assets[0]
    exclude: List[str] = []
    times: List[float] = []
    fallbacks = 0

    for i in range(args.queries):
        desired = rng.choice(["IDLE", "SPEAKING", "EXPLAINING", None])
        t0 = time.perf_counter()
        nxt = select_next(
            lib, current, desired_state=desired, exclude=exclude[-8:], rng=rng
        )
        dt = (time.perf_counter() - t0) * 1000.0
        times.append(dt)
        if nxt.id == current.id:
            fallbacks += 1
        exclude.append(nxt.id)
        current = nxt

    times_sorted = sorted(times)
    p50 = times_sorted[len(times_sorted) // 2]
    p95 = times_sorted[int(len(times_sorted) * 0.95)]
    report = {
        "queries": args.queries,
        "asset_count": len(assets),
        "p50_ms": p50,
        "p95_ms": p95,
        "max_ms": max(times),
        "mean_ms": sum(times) / len(times),
        "fallback_same_asset_rate": fallbacks / args.queries,
        "engineering_target_p95_ms": 10.0,
        "meets_target": p95 < 10.0,
        "label": "ENGINEERING TARGET",
    }
    out = lib.avatar_dir / "matcher_bench.json"
    lib.ensure_dirs()
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
