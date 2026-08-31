#!/usr/bin/env python3
"""Smoke test frame-feed raw pack (.ffseg) + env defaults."""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from ffseg import FfsegWriter, ffseg_duration_seconds, is_ffseg, iter_ffseg_frames, write_ffseg
from load_env import load_env_files


def main() -> int:
    td = tempfile.mkdtemp(prefix="ffseg_verify_")
    try:
        frames = [np.full((32, 24, 3), i % 255, dtype=np.uint8) for i in range(10)]
        pcm = b"\x00\x00" * (44100 // 25 * 2 * 10)
        path = write_ffseg(
            str(Path(td) / "task_1710000000_aa.ffseg"),
            frames,
            pcm,
            width=24,
            height=32,
            fps=25,
        )
        assert is_ffseg(path), "is_ffseg failed"
        assert abs(ffseg_duration_seconds(path) - 0.4) < 0.05

        writer = FfsegWriter(
            str(Path(td) / "task_1710000001_bb.ffseg"),
            width=24,
            height=32,
            fps=25,
        )
        for fr in frames:
            writer.write_frame(fr)
        path2 = writer.finalize(pcm)
        meta, it = iter_ffseg_frames(path2)
        assert meta["frames"] == 10
        assert len(list(it)) == 10

        # Env loader does not override existing keys
        os.environ["BROADCAST_MODE"] = "segment"
        env_file = Path(td) / "sample.env"
        env_file.write_text("BROADCAST_MODE=frame_feed\nMUSETALK_RAW_FEED=1\n", encoding="utf-8")
        load_env_files([str(env_file)], override=False)
        assert os.environ["BROADCAST_MODE"] == "segment"
        load_env_files([str(env_file)], override=True)
        assert os.environ["BROADCAST_MODE"] == "frame_feed"
        assert os.environ.get("MUSETALK_RAW_FEED") == "1"

        print("[OK] verify_frame_feed passed")
        return 0
    finally:
        shutil.rmtree(td, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
