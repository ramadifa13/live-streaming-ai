#!/usr/bin/env python3
"""Self-test RTMP DNS + FFmpeg di pod RunPod."""
from __future__ import annotations

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from rtmp_utils import preflight_rtmp_publish, validate_publish_url  # noqa: E402


def main() -> int:
    host = os.environ.get("RTMP_TEST_HOST", "live-upload.instagram.com")
    url = os.environ.get(
        "RTMP_TEST_URL",
        f"rtmps://{host}:443/rtmp/TEST_KEY?s_vt=ig",
    )
    print("[verify_rtmp] DNS + URL validation...")
    try:
        url = validate_publish_url(url)
        preflight_rtmp_publish(url)
        print(f"  OK preflight: {url.split('?')[0]}?**")
    except Exception as exc:
        print(f"  FAIL preflight: {exc}")
        return 1

    print("[verify_rtmp] FFmpeg -4 support...")
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-4", "-version"],
        capture_output=True,
        text=True,
        timeout=10,
    )
    err = (proc.stderr or proc.stdout or "").lower()
    if proc.returncode != 0 or "unrecognized" in err:
        print("  WARN: ffmpeg -4 tidak didukung — set RTMP_FORCE_IPV4=0")
    else:
        print("  OK ffmpeg -4")

    print("[verify_rtmp] Passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
