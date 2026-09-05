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

from motion.library import MotionLibrary, default_motion_root  # noqa: E402
from motion.matcher import MotionGraphIndex, MotionMatcher, MotionQuery  # noqa: E402


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
    matcher = MotionMatcher(lib, MotionGraphIndex.from_library(lib), rng=rng)
    current = assets[0]
    exclude: List[str] = []
    times: List[float] = []
    fallbacks = 0

    for _i in range(args.queries):
        desired = rng.choice(["IDLE", "SPEAKING", "EXPLAINING", None])
        q = MotionQuery(
            avatar_id=args.avatar,
            current_asset_id=current.id,
            current_pose=current.exit_pose,
            current_velocity=current.exit_velocity,
            energy=current.energy,
            desired_state=desired,
            semantic_tags=list(current.semantic_tags),
            gaze=current.gaze,
            hand=current.hand,
            exclude_asset_ids=exclude[-8:],
            memory=matcher.memory,
        )
        t0 = time.perf_counter()
        cand = matcher.select_next(q)
        dt = (time.perf_counter() - t0) * 1000.0
        times.append(dt)
        nxt = lib.get(cand.asset_id) or current
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
        "phase": 2,
    }
    out = lib.avatar_dir / "matcher_bench.json"
    lib.ensure_dirs()
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
