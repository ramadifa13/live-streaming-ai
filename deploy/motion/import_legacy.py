"""Import legacy assets/3d/*.mp4 into Motion Library (offline).

Does not modify ai_worker runtime. Example:
  python -m motion.import_legacy --avatar namira --extract-features
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

_DEPLOY = Path(__file__).resolve().parent.parent
if str(_DEPLOY) not in sys.path:
    sys.path.insert(0, str(_DEPLOY))

from motion.features import extract_clip_features  # noqa: E402
from motion.library import MotionLibrary, default_motion_root  # noqa: E402
from motion.schemas import (  # noqa: E402
    MotionAsset,
    PoseFeature,
    VelocityFeature,
)

# Heuristic mapping from legacy clip stem → (level, state, gesture, tags, energy, gaze)
LEGACY_MAP: Dict[str, Tuple[str, str, str, List[str], float, str]] = {
    "idle": ("behavior_segment", "IDLE", "none", ["idle", "generic"], 0.25, "camera"),
    "idle_1": ("behavior_segment", "IDLE", "none", ["idle", "generic"], 0.25, "camera"),
    "idle_2": ("behavior_segment", "IDLE", "none", ["idle", "generic"], 0.28, "camera"),
    "idle_3": ("micro", "IDLE", "none", ["idle", "micro"], 0.22, "camera"),
    "idle_4": ("micro", "IDLE", "none", ["idle", "micro"], 0.22, "camera"),
    "talk": ("behavior_segment", "SPEAKING", "none", ["talk", "speaking", "generic"], 0.55, "camera"),
    "talk_2": ("behavior_segment", "SPEAKING", "none", ["talk", "speaking"], 0.55, "camera"),
    "talk_3": ("behavior_segment", "EXPLAINING", "open_hand", ["talk", "explain"], 0.60, "camera"),
}


def _stem_to_key(stem: str, host: str) -> str:
    s = stem.lower()
    prefix = f"{host}_"
    if s.startswith(prefix):
        s = s[len(prefix) :]
    return s


def _guess(key: str) -> Tuple[str, str, str, List[str], float, str]:
    if key in LEGACY_MAP:
        return LEGACY_MAP[key]
    if key.startswith("idle"):
        return ("behavior_segment", "IDLE", "none", ["idle", "generic"], 0.25, "camera")
    if key.startswith("talk"):
        return ("behavior_segment", "SPEAKING", "none", ["talk", "speaking"], 0.55, "camera")
    return ("gesture", "SPEAKING", key, ["imported"], 0.4, "camera")


def import_one(
    lib: MotionLibrary,
    mp4: Path,
    *,
    host: str,
    extract: bool,
) -> MotionAsset:
    key = _stem_to_key(mp4.stem, host)
    level, state, gesture, tags, energy_hint, gaze = _guess(key)
    asset_id = re.sub(r"[^a-z0-9_]+", "_", key)

    try:
        media_uri = Path(os.path.relpath(mp4.resolve(), lib.avatar_dir.resolve())).as_posix()
    except Exception:
        media_uri = str(mp4.resolve())

    if extract:
        entry_p, exit_p, entry_v, exit_v, energy, n, fps = extract_clip_features(mp4)
        duration_ms = (n / fps) * 1000.0
        feature_complete = entry_p.feature_source == "mediapipe"
        energy = float(0.5 * energy + 0.5 * energy_hint)
    else:
        entry_p = PoseFeature(feature_source="manual")
        exit_p = PoseFeature(feature_source="manual")
        entry_v = VelocityFeature()
        exit_v = VelocityFeature()
        energy = energy_hint
        n, fps = 0, 30.0
        duration_ms = 0.0
        feature_complete = False

    asset = MotionAsset(
        id=asset_id,
        avatar_id=lib.avatar_id,
        level=level,
        state=state,
        gesture=gesture,
        duration_ms=duration_ms,
        fps=fps,
        frame_count=n,
        media_uri=media_uri,
        entry_pose=entry_p,
        exit_pose=exit_p,
        entry_velocity=entry_v,
        exit_velocity=exit_v,
        energy=energy,
        gaze=gaze,
        hand=entry_p.hand_state if extract else "neutral",
        emotion="neutral",
        semantic_tags=tags,
        transition_candidates=[],
        feature_complete=feature_complete,
        version=1,
    )
    lib.upsert(asset, write=True)
    return asset


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--avatar", default="namira")
    ap.add_argument("--host-prefix", default="namira")
    ap.add_argument(
        "--legacy-dir",
        type=Path,
        default=_DEPLOY / "assets" / "3d",
    )
    ap.add_argument("--root", type=Path, default=None)
    ap.add_argument("--extract-features", action="store_true")
    ap.add_argument(
        "--glob",
        default="*.mp4",
        help="Only import matching files under legacy-dir",
    )
    args = ap.parse_args(argv)

    root = args.root or default_motion_root()
    lib = MotionLibrary(root, args.avatar)
    lib.ensure_dirs()

    legacy = Path(args.legacy_dir)
    if not legacy.is_dir():
        print(f"[import] FAIL: legacy dir missing: {legacy}", file=sys.stderr)
        return 2

    mp4s = sorted(legacy.glob(args.glob))
    mp4s = [p for p in mp4s if not p.name.startswith("_")]
    if not mp4s:
        print(f"[import] FAIL: no mp4 in {legacy}", file=sys.stderr)
        return 2

    imported = []
    for p in mp4s:
        print(f"[import] {p.name} extract={args.extract_features}")
        asset = import_one(
            lib, p, host=args.host_prefix, extract=args.extract_features
        )
        imported.append(asset.id)

    lib.write_index()
    print(f"[import] done count={len(imported)} -> {lib.library_json}")
    print("  assets:", ", ".join(imported))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
