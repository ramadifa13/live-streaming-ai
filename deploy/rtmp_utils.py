"""RTMP URL assembly + FFmpeg fatal-error detection for live ingest."""

from __future__ import annotations

import os
import re
from typing import Callable, Optional, Tuple

FATAL_RTMP_MARKERS = (
    "session has been invalidated",
    "error in the push function",
    "av_interleaved_write_frame",
    "error writing trailer",
    "input/output error",
    "connection refused",
    "server error",
    "already publishing",
    "cannot open connection",
    "error opening output file",
    "failed to connect",
    "connection timed out",
    "conversion failed",
    "broken pipe",
)

USER_HINT_INVALIDATED = (
    "Stream key sudah tidak valid. Di Instagram/Facebook, buat siaran baru "
    "lalu tempel Stream Key yang baru — key lama tidak bisa dipakai ulang."
)
USER_HINT_PUBLISHING = (
    "Masih ada proses lama yang memegang Stream Key yang sama. "
    "Hentikan siaran sebelumnya, lalu coba lagi dengan key baru."
)
USER_HINT_REFUSED = (
    "Server RTMP menolak koneksi. Cek RTMP URL, Stream Key, dan jaringan pod."
)
USER_HINT_CONNECTING_SLOW = (
    "RTMP masih handshake — pastikan sudah klik 'Siarkan Langsung' / 'Go Live' "
    "di Instagram/Facebook, lalu tunggu 30–60 detik."
)

RTMP_CONNECTED_MARKERS = (
    "frame=",
    "press [q] to stop",
    "output #0",
    "kb/s:",
    "speed=",
)


def _clean(value: str) -> str:
    return (value or "").strip().replace("\r", "").replace("\n", "").replace(" ", "")


def split_ingest_url(full_url: str) -> Tuple[str, str]:
    """Pisah URL publish penuh menjadi (base, stream_key)."""
    url = _clean(full_url)
    if not url:
        return "", ""
    lower = url.lower()
    idx = lower.find("/rtmp/")
    if idx >= 0:
        return url[: idx + 6], url[idx + 6 :]
    # rtmp://host/app/key  atau rtmp://host/live2/key
    parts = url.split("/")
    if len(parts) >= 5:
        base = "/".join(parts[:-1])
        return base, parts[-1]
    return url, ""


def join_rtmp_url(base_url: str, stream_key: str) -> str:
    """Gabungkan server URL + stream key tanpa dobel, aman untuk query Instagram."""
    base = _clean(base_url)
    key = _clean(stream_key)

    if key.lower().startswith(("rtmp://", "rtmps://")):
        # User menempel URL penuh di kolom Stream Key
        if "?" in key or "/rtmp/" in key.lower():
            return key
        base_from_key, key_from_key = split_ingest_url(key)
        return key if not key_from_key else join_rtmp_url(base_from_key, key_from_key)

    if not base:
        return key
    if not key:
        return base.rstrip("/") if "?" not in base else base

    if base.endswith("/" + key) or base.endswith(key):
        return base

    # URL field sudah berisi publish URL lengkap (termasuk key + query)
    key_id = key.split("?", 1)[0]
    if "?" in base and key_id and key_id in base:
        return base

    return f"{base.rstrip('/')}/{key}"


def classify_ffmpeg_line(line: str) -> Optional[str]:
    low = (line or "").lower()
    if not any(marker in low for marker in FATAL_RTMP_MARKERS):
        return None
    if "session has been invalidated" in low or "error in the push function" in low:
        return USER_HINT_INVALIDATED
    if "already publishing" in low:
        return USER_HINT_PUBLISHING
    if "connection refused" in low or "failed to connect" in low or "timed out" in low:
        return USER_HINT_REFUSED
    if "conversion failed" in low or "input/output error" in low or "writing trailer" in low:
        return USER_HINT_INVALIDATED
    return USER_HINT_REFUSED


def write_rtmp_status(output_folder: str, status: str, error: str = "") -> None:
    os.makedirs(output_folder, exist_ok=True)
    status_path = os.path.join(output_folder, "rtmp_status.txt")
    error_path = os.path.join(output_folder, "rtmp_error.txt")
    try:
        with open(status_path, "w", encoding="utf-8") as fh:
            fh.write(status.strip() or "disconnected")
    except Exception:
        pass
    try:
        with open(error_path, "w", encoding="utf-8") as fh:
            fh.write(error.strip())
    except Exception:
        pass
    flag = os.path.join(output_folder, "rtmp_connected.flag")
    try:
        if status.strip() == "connected":
            with open(flag, "w", encoding="utf-8") as fh:
                fh.write("connected")
        elif os.path.exists(flag):
            os.remove(flag)
    except Exception:
        pass


def read_rtmp_status(output_folder: str) -> Tuple[str, str]:
    status = "disconnected"
    error = ""
    status_path = os.path.join(output_folder, "rtmp_status.txt")
    error_path = os.path.join(output_folder, "rtmp_error.txt")
    try:
        if os.path.isfile(status_path):
            with open(status_path, "r", encoding="utf-8") as fh:
                status = fh.read().strip() or "disconnected"
    except Exception:
        pass
    try:
        if os.path.isfile(error_path):
            with open(error_path, "r", encoding="utf-8") as fh:
                error = fh.read().strip()
    except Exception:
        pass
    return status, error


class FfmpegLogWatcher:
    """Parse stderr FFmpeg yang memakai \\r untuk progress bar."""

    def __init__(
        self,
        on_fatal: Optional[Callable[[str], None]] = None,
        on_progress: Optional[Callable[[], None]] = None,
    ):
        self._buf = ""
        self.on_fatal = on_fatal
        self.on_progress = on_progress
        self.fatal = False
        self.fatal_hint = ""
        self.frames_seen = 0

    def ingest(self, text: str) -> None:
        if not text:
            return
        self._buf += text
        parts = re.split(r"[\r\n]+", self._buf)
        self._buf = parts.pop() if parts else ""
        for part in parts:
            self._handle_line(part)

    def _handle_line(self, line: str) -> None:
        if not line:
            return
        hint = classify_ffmpeg_line(line)
        if hint and not self.fatal:
            self.fatal = True
            self.fatal_hint = hint
            if self.on_fatal:
                self.on_fatal(hint)
        low = line.lower()
        if any(marker in low for marker in RTMP_CONNECTED_MARKERS):
            if "frame=" in low:
                self.frames_seen += 1
            if self.on_progress and not self.fatal:
                self.on_progress()


if __name__ == "__main__":
    ig_base = "rtmps://live-upload.instagram.com:443/rtmp/"
    ig_key = "18091065782441518?s_bl=1&s_fbp=sin11-1&a=Ab6Ug5HWNop-z0AmMfgrYM7G"
    joined = join_rtmp_url(ig_base, ig_key)
    assert joined.endswith(ig_key), joined
    assert join_rtmp_url(joined, ig_key) == joined
    full = f"{ig_base.rstrip('/')}/{ig_key}"
    assert join_rtmp_url(ig_base, full) == full
    assert join_rtmp_url(full, "") == full or join_rtmp_url(full, ig_key) == full
    print("[OK] rtmp_utils", joined[:60], "...")
