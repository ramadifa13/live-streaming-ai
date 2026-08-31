"""Raw frame-feed segment (.ffseg) — handoff MuseTalk → broadcaster tanpa H264.

Layout (atomic rename dari *.partial):
  task_xxx.ffseg/
    meta.json     {width, height, fps, frames, sample_rate, channels, bytes_per_frame}
    video.bgr     frames * width * height * 3 (uint8 BGR interleaved)
    audio.s16le   PCM stereo little-endian @ sample_rate
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Iterable, Optional, Tuple

import numpy as np

META_NAME = "meta.json"
VIDEO_NAME = "video.bgr"
AUDIO_NAME = "audio.s16le"
READY_NAME = "ready.flag"


def is_ffseg(path: str) -> bool:
    if not path:
        return False
    if path.endswith(".ffseg") and os.path.isdir(path):
        return os.path.exists(os.path.join(path, META_NAME))
    return False


def ffseg_duration_seconds(path: str) -> float:
    meta = read_meta(path)
    if not meta:
        return 8.0
    frames = int(meta.get("frames") or 0)
    fps = float(meta.get("fps") or 25) or 25.0
    if frames > 0:
        return max(0.4, frames / fps)
    return 8.0


def read_meta(path: str) -> Optional[dict]:
    try:
        with open(os.path.join(path, META_NAME), "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def audio_to_pcm_s16le(audio_path: str, sample_rate: int = 44100, channels: int = 2) -> bytes:
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-i",
        audio_path,
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "-ac",
        str(channels),
        "-ar",
        str(sample_rate),
        "pipe:1",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=120)
        if proc.returncode == 0 and proc.stdout:
            return proc.stdout
    except Exception as err:
        print(f"[ffseg] audio extract notice: {err}")
    return b""


def write_ffseg(
    dest_dir: str,
    frames: Iterable[np.ndarray],
    audio_pcm: bytes,
    *,
    width: int,
    height: int,
    fps: float = 25.0,
    sample_rate: int = 44100,
    channels: int = 2,
) -> str:
    """Tulis segmen raw secara atomik. Return path final .ffseg."""
    writer = FfsegWriter(
        dest_dir,
        width=width,
        height=height,
        fps=fps,
        sample_rate=sample_rate,
        channels=channels,
    )
    for frame in frames:
        writer.write_frame(frame)
    return writer.finalize(audio_pcm)


class FfsegWriter:
    """Streaming writer — frame-per-frame tanpa menahan seluruh clip di RAM."""

    def __init__(
        self,
        dest_dir: str,
        *,
        width: int,
        height: int,
        fps: float = 25.0,
        sample_rate: int = 44100,
        channels: int = 2,
    ):
        dest_dir = dest_dir.rstrip("/\\")
        if not dest_dir.endswith(".ffseg"):
            dest_dir = dest_dir + ".ffseg"
        self.dest_dir = dest_dir
        self.width = int(width)
        self.height = int(height)
        self.fps = float(fps)
        self.sample_rate = int(sample_rate)
        self.channels = int(channels)
        self.bytes_per_frame = self.width * self.height * 3
        self.frame_count = 0
        self._vf = None
        self.partial = dest_dir + ".partial"

        parent = os.path.dirname(dest_dir) or "."
        os.makedirs(parent, exist_ok=True)
        if os.path.exists(self.partial):
            shutil.rmtree(self.partial, ignore_errors=True)
        if os.path.exists(dest_dir):
            shutil.rmtree(dest_dir, ignore_errors=True)
        os.makedirs(self.partial, exist_ok=True)
        self._vf = open(os.path.join(self.partial, VIDEO_NAME), "wb")

    def write_frame(self, frame: np.ndarray) -> None:
        if self._vf is None or frame is None:
            return
        arr = np.asarray(frame)
        if arr.dtype != np.uint8:
            arr = arr.astype(np.uint8)
        if arr.ndim != 3 or arr.shape[2] < 3:
            return
        if arr.shape[0] != self.height or arr.shape[1] != self.width:
            import cv2

            arr = cv2.resize(arr, (self.width, self.height), interpolation=cv2.INTER_AREA)
        if arr.shape[2] > 3:
            arr = arr[:, :, :3]
        raw = arr.tobytes()
        if len(raw) != self.bytes_per_frame:
            return
        self._vf.write(raw)
        self.frame_count += 1

    def finalize(self, audio_pcm: bytes = b"") -> str:
        if self._vf is not None:
            try:
                self._vf.close()
            except Exception:
                pass
            self._vf = None
        if self.frame_count <= 0:
            shutil.rmtree(self.partial, ignore_errors=True)
            raise RuntimeError("ffseg: tidak ada frame yang ditulis")

        with open(os.path.join(self.partial, AUDIO_NAME), "wb") as af:
            af.write(audio_pcm or b"")

        meta = {
            "width": self.width,
            "height": self.height,
            "fps": self.fps,
            "frames": int(self.frame_count),
            "sample_rate": self.sample_rate,
            "channels": self.channels,
            "bytes_per_frame": self.bytes_per_frame,
            "audio_bytes": int(len(audio_pcm or b"")),
        }
        with open(os.path.join(self.partial, META_NAME), "w", encoding="utf-8") as fh:
            json.dump(meta, fh)
        with open(os.path.join(self.partial, READY_NAME), "w", encoding="utf-8") as fh:
            fh.write("1")
        os.replace(self.partial, self.dest_dir)
        return self.dest_dir

    def abort(self) -> None:
        if self._vf is not None:
            try:
                self._vf.close()
            except Exception:
                pass
            self._vf = None
        shutil.rmtree(self.partial, ignore_errors=True)


def iter_ffseg_frames(
    path: str,
) -> Tuple[dict, Iterable[Tuple[np.ndarray, bytes]]]:
    """Yield (frame_bgr, pcm_chunk) untuk setiap frame, pacing di caller."""
    meta = read_meta(path)
    if not meta:
        raise RuntimeError(f"ffseg meta hilang: {path}")
    if not os.path.exists(os.path.join(path, READY_NAME)):
        raise RuntimeError(f"ffseg belum ready: {path}")

    width = int(meta["width"])
    height = int(meta["height"])
    fps = float(meta.get("fps") or 25) or 25.0
    frames = int(meta["frames"])
    sample_rate = int(meta.get("sample_rate") or 44100)
    channels = int(meta.get("channels") or 2)
    bpf = int(meta.get("bytes_per_frame") or (width * height * 3))
    samples_per_frame = int(round(sample_rate / fps))
    audio_bpf = samples_per_frame * channels * 2

    video_path = os.path.join(path, VIDEO_NAME)
    audio_path = os.path.join(path, AUDIO_NAME)
    audio = b""
    if os.path.exists(audio_path):
        with open(audio_path, "rb") as af:
            audio = af.read()

    def _gen():
        with open(video_path, "rb") as vf:
            for i in range(frames):
                raw = vf.read(bpf)
                if len(raw) < bpf:
                    break
                frame = np.frombuffer(raw, dtype=np.uint8).reshape((height, width, 3)).copy()
                a0 = i * audio_bpf
                chunk = audio[a0 : a0 + audio_bpf]
                if len(chunk) < audio_bpf:
                    chunk = chunk + b"\x00" * (audio_bpf - len(chunk))
                yield frame, chunk

    return meta, _gen()
