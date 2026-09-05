"""Validate motion library schemas + feature presence (offline)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List

_DEPLOY = Path(__file__).resolve().parent.parent
if str(_DEPLOY) not in sys.path:
    sys.path.insert(0, str(_DEPLOY))

from motion.library import MotionLibrary, default_motion_root  # noqa: E402
from motion.schemas import MotionAsset, POSE_XY_DIM, SILHOUETTE_MOMENTS_DIM  # noqa: E402


def validate_asset(asset: MotionAsset, *, require_media: bool = False, root: Path) -> List[str]:
    errs: List[str] = []
    for field in MotionAsset.REQUIRED_FIELDS:
        if getattr(asset, field, None) is None:
            errs.append(f"{asset.id}: missing {field}")
    if asset.level not in ("micro", "gesture", "behavior_segment"):
        errs.append(f"{asset.id}: invalid level {asset.level}")
    if not (0.0 <= asset.energy <= 1.0):
        errs.append(f"{asset.id}: energy out of range")
    if len(asset.entry_pose.joints_xy) != POSE_XY_DIM:
        errs.append(f"{asset.id}: entry joints_xy dim != {POSE_XY_DIM}")
    if len(asset.exit_pose.joints_xy) != POSE_XY_DIM:
        errs.append(f"{asset.id}: exit joints_xy dim != {POSE_XY_DIM}")
    if len(asset.entry_pose.silhouette_moments) != SILHOUETTE_MOMENTS_DIM:
        errs.append(f"{asset.id}: silhouette_moments dim mismatch")
    # Extended fields present
    for name in (
        "person_scale",
        "translation_xy",
        "left_elbow_angle",
        "right_elbow_angle",
        "hand_state",
        "feature_source",
    ):
        if not hasattr(asset.entry_pose, name):
            errs.append(f"{asset.id}: entry_pose missing {name}")
    if require_media:
        lib = MotionLibrary(root, asset.avatar_id)
        path = lib.resolve_media_path(asset)
        if not path.is_file():
            errs.append(f"{asset.id}: media missing: {asset.media_uri}")
    return errs


def main(argv: List[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--avatar", default="namira")
    ap.add_argument("--root", type=Path, default=None)
    ap.add_argument("--require-media", action="store_true")
    ap.add_argument("--strict-features", action="store_true",
                    help="Require mediapipe feature_source")
    args = ap.parse_args(argv)

    root = args.root or default_motion_root()
    lib = MotionLibrary(root, args.avatar).load()
    assets = lib.all()
    if not assets:
        print(f"[validate] FAIL: empty library at {lib.avatar_dir}", file=sys.stderr)
        return 2

    errs: List[str] = []
    warnings: List[str] = []
    for a in assets:
        errs.extend(validate_asset(a, require_media=args.require_media, root=root))
        if a.entry_pose.feature_source == "opencv_proxy":
            warnings.append(f"{a.id}: opencv_proxy features (install mediapipe for richer joints)")
        if args.strict_features and a.entry_pose.feature_source != "mediapipe":
            errs.append(f"{a.id}: strict-features requires mediapipe")

    print(f"[validate] assets={len(assets)} errors={len(errs)} warnings={len(warnings)}")
    for w in warnings[:20]:
        print(f"  WARN {w}")
    for e in errs:
        print(f"  ERR  {e}", file=sys.stderr)

    report = {
        "avatar_id": args.avatar,
        "count": len(assets),
        "errors": errs,
        "warnings": warnings,
        "ok": len(errs) == 0,
    }
    out = lib.avatar_dir / "validate_report.json"
    lib.ensure_dirs()
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return 0 if not errs else 1


if __name__ == "__main__":
    raise SystemExit(main())
