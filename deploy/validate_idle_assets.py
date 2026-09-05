#!/usr/bin/env python3
"""Validate idle/talk clip rest-pose continuity and emit *_meta.json sidecars.

Usage:
  python validate_idle_assets.py [--assets-dir PATH] [--write-meta] [--threshold 0.92]

Checks SSIM (and MSE) between candidate base/end frames near clip ends.
Fails with exit code 1 if any clip scores below --threshold when --strict.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np


def _ssim_gray(a: np.ndarray, b: np.ndarray) -> float:
    """Lightweight SSIM on grayscale uint8 images (same size)."""
    if a.shape != b.shape:
        b = cv2.resize(b, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_AREA)
    x = a.astype(np.float64)
    y = b.astype(np.float64)
    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2
    mu_x = cv2.GaussianBlur(x, (11, 11), 1.5)
    mu_y = cv2.GaussianBlur(y, (11, 11), 1.5)
    mu_x2 = mu_x * mu_x
    mu_y2 = mu_y * mu_y
    mu_xy = mu_x * mu_y
    sigma_x2 = cv2.GaussianBlur(x * x, (11, 11), 1.5) - mu_x2
    sigma_y2 = cv2.GaussianBlur(y * y, (11, 11), 1.5) - mu_y2
    sigma_xy = cv2.GaussianBlur(x * y, (11, 11), 1.5) - mu_xy
    num = (2 * mu_xy + c1) * (2 * sigma_xy + c2)
    den = (mu_x2 + mu_y2 + c1) * (sigma_x2 + sigma_y2 + c2)
    ssim_map = num / (den + 1e-12)
    return float(np.mean(ssim_map))


def _mse(a: np.ndarray, b: np.ndarray) -> float:
    if a.shape != b.shape:
        b = cv2.resize(b, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_AREA)
    d = a.astype(np.float64) - b.astype(np.float64)
    return float(np.mean(d * d))


def _to_gray(frame: np.ndarray) -> np.ndarray:
    if frame.ndim == 2:
        return frame
    return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)


def _decode_frames(path: str, max_frames: int = 0) -> List[np.ndarray]:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open {path}")
    frames: List[np.ndarray] = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame)
        if max_frames > 0 and len(frames) >= max_frames:
            break
    cap.release()
    if not frames:
        raise RuntimeError(f"Empty video: {path}")
    return frames


def _best_pose_pair(
    frames: List[np.ndarray], window: int = 8
) -> Tuple[int, int, float, float]:
    """Pick base near start and end near finish with best SSIM."""
    n = len(frames)
    w = max(1, min(window, n // 2 or 1))
    best = (0, n - 1, -1.0, float("inf"))
    for bi in range(0, w):
        for ei in range(max(0, n - w), n):
            if ei <= bi:
                continue
            ga = _to_gray(frames[bi])
            gb = _to_gray(frames[ei])
            score = _ssim_gray(ga, gb)
            err = _mse(ga, gb)
            if score > best[2]:
                best = (bi, ei, score, err)
    return best


def _clip_stem(path: Path, host: str) -> str:
    stem = path.stem.lower()
    prefix = f"{host}_"
    if stem.startswith(prefix):
        stem = stem[len(prefix) :]
    return stem


def validate_dir(
    assets_dir: Path,
    *,
    host: str = "namira",
    threshold: float = 0.92,
    window: int = 8,
    write_meta: bool = False,
    clips: Optional[List[str]] = None,
) -> int:
    if not assets_dir.is_dir():
        print(f"[validate] FAIL: assets dir missing: {assets_dir}", file=sys.stderr)
        return 2

    want = set(clips) if clips else {"idle", "talk", "talk_2", "talk_3"}
    mp4s = sorted(assets_dir.glob("*.mp4"))
    targets = []
    for p in mp4s:
        if p.name.startswith("temp_"):
            continue
        stem = _clip_stem(p, host)
            if stem in want or not clips:
                if stem in want or stem.startswith("idle") or stem.startswith("talk"):
                    targets.append((stem, p))

    if not targets:
        # Fallback: all mp4s that look like idle_* / talk_*
        for p in mp4s:
            stem = _clip_stem(p, host)
            if stem.startswith("idle") or stem.startswith("talk"):
                targets.append((stem, p))

    if not targets:
        print(f"[validate] FAIL: no idle_*.mp4 in {assets_dir}", file=sys.stderr)
        return 2

    failures = 0
    print(f"[validate] assets={assets_dir} threshold={threshold:.3f} window={window}")
    for name, path in targets:
        try:
            frames = _decode_frames(str(path))
        except Exception as err:
            print(f"[validate] FAIL {name}: {err}", file=sys.stderr)
            failures += 1
            continue
        base, end, ssim, mse = _best_pose_pair(frames, window=window)
        # Also report naive first/last
        g0 = _to_gray(frames[0])
        gN = _to_gray(frames[-1])
        naive_ssim = _ssim_gray(g0, gN)
        ok = ssim >= threshold
        status = "OK" if ok else "LOW"
        if not ok:
            failures += 1
        print(
            f"[validate] {status} {name}: frames={len(frames)} "
            f"best_base={base} best_end={end} ssim={ssim:.4f} mse={mse:.1f} "
            f"naive_0_vs_N={naive_ssim:.4f}"
        )
        if write_meta:
            meta = {
                "base_pose_frame": int(base),
                "end_pose_frame": int(end),
                "seamless_score": round(float(ssim), 6),
                "naive_first_last_ssim": round(float(naive_ssim), 6),
                "mse": round(float(mse), 3),
                "num_frames": len(frames),
                "threshold": threshold,
                "seamless": bool(ok),
            }
            out = assets_dir / f"{name}_meta.json"
            out.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
            # Also write host-prefixed if source file uses host prefix
            if path.stem.lower().startswith(f"{host}_"):
                host_out = assets_dir / f"{host}_{name}_meta.json"
                if host_out.resolve() != out.resolve():
                    host_out.write_text(
                        json.dumps(meta, indent=2) + "\n", encoding="utf-8"
                    )
            print(f"[validate] wrote {out.name}")

    if failures:
        print(f"[validate] {failures} clip(s) below threshold or failed", file=sys.stderr)
        return 1
    print("[validate] all clips OK")
    return 0


def main() -> None:
    default_assets = os.environ.get(
        "AI_WORKER_ASSETS_DIR",
        str(Path(__file__).resolve().parent / "assets" / "3d"),
    )
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--assets-dir", default=default_assets)
    ap.add_argument("--host", default=os.environ.get("HOST_NAME", "namira"))
    ap.add_argument(
        "--threshold",
        type=float,
        default=float(os.environ.get("AI_WORKER_SEAMLESS_THRESHOLD", "0.92")),
    )
    ap.add_argument("--window", type=int, default=8)
    ap.add_argument("--write-meta", action="store_true")
    ap.add_argument(
        "--clips",
        default="idle,talk,talk_2,talk_3",
        help="Comma-separated clip stems to check",
    )
    ap.add_argument(
        "--strict",
        action="store_true",
        help="Exit 1 if any clip below threshold (default when not writing)",
    )
    args = ap.parse_args()
    clips = [c.strip() for c in args.clips.split(",") if c.strip()]
    code = validate_dir(
        Path(args.assets_dir),
        host=args.host,
        threshold=args.threshold,
        window=args.window,
        write_meta=args.write_meta,
        clips=clips,
    )
    # Non-strict write-meta runs still report but exit 0 unless decode failed hard
    if args.write_meta and not args.strict and code == 1:
        sys.exit(0)
    sys.exit(code)


if __name__ == "__main__":
    main()
