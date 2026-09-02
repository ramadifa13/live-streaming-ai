"""RTMP URL assembly + FFmpeg fatal-error detection for live ingest."""

from __future__ import annotations

import os
import re
import socket
from typing import Callable, Optional, Tuple
from urllib.parse import urlparse

FATAL_RTMP_MARKERS = (
    "failed to resolve hostname",
    "temporary failure in name resolution",
    "name resolution",
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

DNS_FAILURE_MARKERS = (
    "failed to resolve hostname",
    "temporary failure in name resolution",
    "name or service not known",
    "could not resolve host",
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
USER_HINT_DNS = (
    "Pod GPU tidak bisa resolve hostname Instagram (DNS gagal). "
    "Di terminal pod: perbaiki /etc/resolv.conf (8.8.8.8, 1.1.1.1), "
    "lalu redeploy-worker.sh dan gunakan Stream Key baru."
)
USER_HINT_FFMPEG = (
    "FFmpeg tidak bisa start encoder RTMP — cek ai_worker_rtmp.log di pod."
)


def extract_rtmp_hostname(publish_url: str) -> str:
    try:
        parsed = urlparse((publish_url or "").strip())
        return (parsed.hostname or "").strip()
    except Exception:
        return ""


def validate_publish_url(publish_url: str) -> str:
    """Validasi URL publish RTMP/RTMPS; return URL trimmed."""
    url = (publish_url or "").strip()
    if not url.lower().startswith(("rtmp://", "rtmps://")):
        raise ValueError(
            "URL publish RTMP tidak valid — pastikan RTMP URL + Stream Key benar "
            f"(got: {url[:80]})"
        )
    host = extract_rtmp_hostname(url)
    if not host:
        raise ValueError("Hostname RTMP kosong — cek kolom RTMP URL dan Stream Key.")
    if "/rtmp/" in url.lower() and url.rstrip("/").endswith("/rtmp"):
        raise ValueError("Stream Key kosong — tempel Stream Key dari Instagram.")
    return url


def preflight_rtmp_publish(publish_url: str) -> None:
    """Cek DNS untuk hostname RTMP sebelum FFmpeg start (fail-fast)."""
    url = validate_publish_url(publish_url)
    host = extract_rtmp_hostname(url)
    port = 443 if url.lower().startswith("rtmps://") else 1935
    force_v4 = os.environ.get("RTMP_FORCE_IPV4", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )
    v4_ok = False
    try:
        socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
        v4_ok = True
    except OSError:
        pass
    if v4_ok:
        return
    try:
        socket.getaddrinfo(host, port, socket.AF_UNSPEC, socket.SOCK_STREAM)
        if force_v4:
            print(
                f"[RTMP preflight] WARN: {host} tidak punya A record IPv4 — "
                "coba RTMP_FORCE_IPV4=0 jika connect gagal."
            )
        return
    except OSError as exc:
        raise ValueError(f"{USER_HINT_DNS} (host={host}, err={exc})") from exc


def summarize_ffmpeg_stderr(stderr_tail: str, fallback: str = USER_HINT_FFMPEG) -> str:
    detail = (stderr_tail or "").strip().replace("\r", "\n")
    if not detail:
        return fallback
    lines = [ln.strip() for ln in detail.split("\n") if ln.strip()]
    for ln in reversed(lines):
        hint = classify_ffmpeg_line(ln)
        if hint:
            return hint
        low = ln.lower()
        if any(
            k in low
            for k in (
                "error",
                "invalid",
                "unrecognized",
                "failed",
                "cannot",
                "not found",
            )
        ):
            return ln[:240]
    return fallback

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


def is_dns_failure_line(line: str) -> bool:
    low = (line or "").lower()
    return any(marker in low for marker in DNS_FAILURE_MARKERS)


def classify_ffmpeg_line(line: str) -> Optional[str]:
    low = (line or "").lower()
    if is_dns_failure_line(line):
        return USER_HINT_DNS
    if not any(marker in low for marker in FATAL_RTMP_MARKERS):
        return None
    if "session has been invalidated" in low or "error in the push function" in low:
        return USER_HINT_INVALIDATED
    if "already publishing" in low:
        return USER_HINT_PUBLISHING
    if "connection refused" in low or "failed to connect" in low or "timed out" in low:
        return USER_HINT_REFUSED
    if "conversion failed" in low or "input/output error" in low or "writing trailer" in low:
        # I/O error bisa DNS atau stream key — utamakan DNS jika ada jejak resolusi.
        if is_dns_failure_line(line):
            return USER_HINT_DNS
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
