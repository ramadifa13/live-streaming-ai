#!/usr/bin/env python3
"""Compile talk clips into one validated forward-only seamless body timeline."""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import os
from pathlib import Path
from typing import Iterable

import cv2
import numpy as np

DEFAULT_CLIPS = ("talk_1", "talk_2", "talk_3")


def _fingerprint(paths: Iterable[Path]) -> str:
    digest = hashlib.sha256(b"continuous-timeline-v3-baked-matte")
    for path in paths:
        digest.update(path.name.encode())
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def _read_video(path: Path) -> tuple[list[np.ndarray], float, tuple[int, int]]:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {path}")
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
    frames: list[np.ndarray] = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame)
    cap.release()
    if not frames:
        raise RuntimeError(f"empty video: {path}")
    height, width = frames[0].shape[:2]
    if any(frame.shape[:2] != (height, width) for frame in frames):
        raise RuntimeError(f"inconsistent resolution in {path}")
    return frames, fps, (width, height)


def _small_gray(frame: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return cv2.resize(gray, (90, 160), interpolation=cv2.INTER_AREA)


def _similarity(a: np.ndarray, b: np.ndarray) -> float:
    aa = _small_gray(a).astype(np.float32)
    bb = _small_gray(b).astype(np.float32)
    mse = float(np.mean((aa - bb) ** 2))
    return max(0.0, 1.0 - mse / (255.0 * 255.0))


def _motion(frame_a: np.ndarray, frame_b: np.ndarray) -> float:
    aa = _small_gray(frame_a).astype(np.float32)
    bb = _small_gray(frame_b).astype(np.float32)
    return float(np.mean(np.abs(aa - bb)))


def compute_body_matte(frame: np.ndarray) -> np.ndarray:
    """Full-resolution white-studio key with a thin inward edge.

    Runtime must not recompute this. Bake once at compile, then blend only.
    """
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    is_bg = (hsv[:, :, 1] < 38) & (hsv[:, :, 2] > 210)
    matte = np.where(is_bg, 0, 255).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    matte = cv2.morphologyEx(matte, cv2.MORPH_CLOSE, kernel)
    matte = cv2.erode(matte, kernel, iterations=1)
    return cv2.GaussianBlur(matte, (3, 3), 0.6)


def write_body_mattes(frames: list[np.ndarray], path: Path) -> Path:
    if not frames:
        raise RuntimeError("cannot bake empty body mattes")
    stacked = np.stack([compute_body_matte(frame) for frame in frames], axis=0)
    temp = path.with_suffix(".tmp.npy")
    np.save(temp, stacked)
    os.replace(temp, path)
    print(f"[ContinuousCompiler] wrote {path.name}: {stacked.shape[0]} mattes")
    return path


def _load_trim(assets: Path, host: str, name: str, count: int) -> tuple[int, int]:
    candidates = (assets / f"{host}_{name}_meta.json", assets / f"{name}_meta.json")
    for path in candidates:
        if not path.is_file():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        start = max(0, min(int(data.get("base_pose_frame", 0)), count - 1))
        end = max(start + 1, min(int(data.get("end_pose_frame", count - 1)), count - 1))
        return start, end
    return 0, count - 1


def compile_timeline(
    assets: Path,
    *,
    host: str = "namira",
    names: tuple[str, ...] = DEFAULT_CLIPS,
    output_name: str = "continuous",
    min_seam: float = 0.94,
    force: bool = False,
) -> Path:
    sources = [assets / f"{host}_{name}.mp4" for name in names]
    missing = [str(path) for path in sources if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"missing talk clips: {missing}")

    output = assets / f"{host}_{output_name}.mp4"
    meta_path = assets / f"{host}_{output_name}_meta.json"
    matte_path = assets / f"{host}_{output_name}_matte.npy"
    signature = _fingerprint(sources)

    def _matte_ready() -> bool:
        if not matte_path.is_file() or not meta_path.is_file():
            return False
        try:
            cached_meta = json.loads(meta_path.read_text(encoding="utf-8"))
            mattes = np.load(matte_path, mmap_mode="r")
            return int(mattes.shape[0]) == int(cached_meta.get("num_frames") or 0)
        except Exception:
            return False

    if not force and output.is_file() and meta_path.is_file():
        cached = json.loads(meta_path.read_text(encoding="utf-8"))
        if cached.get("source_signature") == signature and cached.get("validated"):
            if _matte_ready():
                print(f"[ContinuousCompiler] cache hit: {output.name}")
                return output
            print("[ContinuousCompiler] video cache hit — baking body mattes")
            frames, _, _ = _read_video(output)
            write_body_mattes(frames, matte_path)
            cached["baked_matte"] = True
            cached["matte_frames"] = len(frames)
            meta_path.write_text(json.dumps(cached, indent=2) + "\n", encoding="utf-8")
            return output

    decoded: dict[str, list[np.ndarray]] = {}
    trims: dict[str, tuple[int, int]] = {}
    expected_fps: float | None = None
    expected_size: tuple[int, int] | None = None
    for name, source in zip(names, sources):
        frames, fps, size = _read_video(source)
        if expected_fps is None:
            expected_fps, expected_size = fps, size
        if abs(fps - expected_fps) > 0.05 or size != expected_size:
            raise RuntimeError(f"{source.name} FPS/resolution does not match other clips")
        start, end = _load_trim(assets, host, name, len(frames))
        decoded[name] = frames[start : end + 1]
        trims[name] = (start, end)

    def join_score(left: str, right: str) -> float:
        return _similarity(decoded[left][-1], decoded[right][0])

    candidates = list(itertools.permutations(names))
    order = max(
        candidates,
        key=lambda item: sum(
            join_score(item[i], item[(i + 1) % len(item)]) for i in range(len(item))
        ),
    )
    joins = [
        {
            "from": order[i],
            "to": order[(i + 1) % len(order)],
            "similarity": round(join_score(order[i], order[(i + 1) % len(order)]), 6),
        }
        for i in range(len(order))
    ]
    worst_seam = min(item["similarity"] for item in joins)
    if worst_seam < min_seam:
        raise RuntimeError(
            f"compiled timeline rejected: worst seam={worst_seam:.4f} < {min_seam:.4f}"
        )

    compiled: list[np.ndarray] = []
    segments = []
    for name in order:
        start_out = len(compiled)
        clip_frames = decoded[name]
        if compiled and _similarity(compiled[-1], clip_frames[0]) >= min_seam:
            clip_frames = clip_frames[1:]
        compiled.extend(clip_frames)
        segments.append({"clip": name, "start": start_out, "end": len(compiled) - 1})

    if len(compiled) < 2:
        raise RuntimeError("compiled timeline is empty")
    loop_motion = _motion(compiled[-1], compiled[0])
    source_motion = float(
        np.median([_motion(a, b) for a, b in zip(compiled[:-1], compiled[1:])])
    )
    if loop_motion > max(12.0, source_motion * 4.0):
        raise RuntimeError(
            f"compiled timeline rejected: loop motion {loop_motion:.2f} is discontinuous"
        )

    temp = output.with_suffix(".tmp.mp4")
    writer = cv2.VideoWriter(
        str(temp),
        cv2.VideoWriter_fourcc(*"mp4v"),
        float(expected_fps),
        expected_size,
    )
    if not writer.isOpened():
        raise RuntimeError(f"cannot create {temp}")
    try:
        for frame in compiled:
            writer.write(frame)
    finally:
        writer.release()
    os.replace(temp, output)
    write_body_mattes(compiled, matte_path)

    metadata = {
        "format": 3,
        "compiled": True,
        "validated": True,
        "baked_matte": True,
        "matte_frames": len(compiled),
        "source_signature": signature,
        "source_clips": list(names),
        "order": list(order),
        "source_trims": trims,
        "segments": segments,
        "fps": expected_fps,
        "width": expected_size[0],
        "height": expected_size[1],
        "num_frames": len(compiled),
        "base_pose_frame": 0,
        "end_pose_frame": len(compiled) - 1,
        "seamless": True,
        "seamless_score": round(worst_seam, 6),
        "loop_motion": round(loop_motion, 6),
        "median_motion": round(source_motion, 6),
        "joins": joins,
    }
    meta_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(
        f"[ContinuousCompiler] wrote {output.name}: {len(compiled)} frames, "
        f"order={order}, worst_seam={worst_seam:.4f}"
    )
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets-dir", required=True)
    parser.add_argument("--host", default="namira")
    parser.add_argument("--clips", default=",".join(DEFAULT_CLIPS))
    parser.add_argument("--output-name", default="continuous")
    parser.add_argument("--min-seam", type=float, default=0.94)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    names = tuple(name.strip() for name in args.clips.split(",") if name.strip())
    compile_timeline(
        Path(args.assets_dir),
        host=args.host,
        names=names,
        output_name=args.output_name,
        min_seam=args.min_seam,
        force=args.force,
    )


if __name__ == "__main__":
    main()
