"""MotionLibrary — load/index MotionAsset metadata (CPU/disk; no VRAM)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set

from .schemas import AvatarThresholds, MotionAsset, states_as_list


class MotionLibrary:
    """On-disk library under assets/motion/{avatar_id}/."""

    def __init__(self, root: Path, avatar_id: str):
        self.root = Path(root)
        self.avatar_id = avatar_id
        self.avatar_dir = self.root / avatar_id
        self.meta_dir = self.avatar_dir / "meta"
        self.features_dir = self.avatar_dir / "features"
        self.media_dir = self.avatar_dir / "media"
        self._assets: Dict[str, MotionAsset] = {}
        self.thresholds = AvatarThresholds()

    @property
    def library_json(self) -> Path:
        return self.avatar_dir / "library.json"

    @property
    def graph_json(self) -> Path:
        return self.avatar_dir / "graph.json"

    @property
    def thresholds_json(self) -> Path:
        return self.avatar_dir / "thresholds.json"

    def ensure_dirs(self) -> None:
        for d in (self.avatar_dir, self.meta_dir, self.features_dir, self.media_dir):
            d.mkdir(parents=True, exist_ok=True)

    def load(self) -> "MotionLibrary":
        self._assets.clear()
        if self.thresholds_json.is_file():
            self.thresholds = AvatarThresholds.from_dict(
                json.loads(self.thresholds_json.read_text(encoding="utf-8"))
            )
        if self.library_json.is_file():
            idx = json.loads(self.library_json.read_text(encoding="utf-8"))
            ids = idx.get("asset_ids") or []
            for aid in ids:
                meta = self.meta_dir / f"{aid}.json"
                if meta.is_file():
                    self._assets[aid] = MotionAsset.from_dict(
                        json.loads(meta.read_text(encoding="utf-8"))
                    )
            return self
        # Fallback: scan meta/
        if self.meta_dir.is_dir():
            for meta in sorted(self.meta_dir.glob("*.json")):
                asset = MotionAsset.from_dict(
                    json.loads(meta.read_text(encoding="utf-8"))
                )
                self._assets[asset.id] = asset
        return self

    def get(self, asset_id: str) -> Optional[MotionAsset]:
        return self._assets.get(asset_id)

    def all(self) -> List[MotionAsset]:
        return list(self._assets.values())

    def ids(self) -> List[str]:
        return list(self._assets.keys())

    def query(
        self,
        *,
        states_contains: Optional[str] = None,
        tags: Optional[Sequence[str]] = None,
        level: Optional[str] = None,
        energy_range: Optional[tuple] = None,
        exclude: Optional[Set[str]] = None,
    ) -> List[MotionAsset]:
        out: List[MotionAsset] = []
        exclude = exclude or set()
        tagset = set(tags or [])
        for a in self._assets.values():
            if a.id in exclude:
                continue
            if level and a.level != level:
                continue
            if states_contains and states_contains not in states_as_list(a.state):
                continue
            if tagset and not (tagset & set(a.semantic_tags)):
                continue
            if energy_range is not None:
                lo, hi = energy_range
                if not (lo <= a.energy <= hi):
                    continue
            out.append(a)
        return out

    def upsert(self, asset: MotionAsset, *, write: bool = True) -> None:
        self._assets[asset.id] = asset
        if write:
            self.ensure_dirs()
            path = self.meta_dir / f"{asset.id}.json"
            path.write_text(
                json.dumps(asset.to_dict(), indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )

    def write_index(self) -> None:
        self.ensure_dirs()
        payload = {
            "avatar_id": self.avatar_id,
            "version": 1,
            "asset_ids": sorted(self._assets.keys()),
            "count": len(self._assets),
        }
        self.library_json.write_text(
            json.dumps(payload, indent=2) + "\n", encoding="utf-8"
        )
        self.thresholds_json.write_text(
            json.dumps(self.thresholds.to_dict(), indent=2) + "\n", encoding="utf-8"
        )

    def resolve_media_path(self, asset: MotionAsset) -> Path:
        uri = asset.media_uri
        p = Path(uri)
        if p.is_file():
            return p
        cand = (self.avatar_dir / uri).resolve()
        if cand.is_file():
            return cand
        # Common: relative from deploy/
        deploy_root = self.root.parent.parent if self.root.name == "motion" else self.root.parent
        cand2 = (deploy_root / uri).resolve()
        if cand2.is_file():
            return cand2
        return p


def default_motion_root() -> Path:
    env = os.environ.get("AI_MOTION_LIBRARY_ROOT", "").strip()
    if env:
        return Path(env)
    # deploy/assets/motion
    return Path(__file__).resolve().parent.parent / "assets" / "motion"


def flag_enabled(name: str, default: str = "0") -> bool:
    return (os.environ.get(name) or default).strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
