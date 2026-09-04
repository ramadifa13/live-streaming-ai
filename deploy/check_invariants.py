"""Gagal cepat di pod/sync — cegah regresi RTMP + lip-sync clip mismatch."""
from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def _fail(msg: str) -> None:
    print(f"[INVARIANT] FAIL: {msg}", file=sys.stderr)
    raise SystemExit(1)


def check_rtmp_utils() -> None:
    sys.path.insert(0, str(ROOT))
    from rtmp_utils import extract_rtmp_hostname, is_deferred_rtmp_ack, validate_publish_url

    url = "rtmps://edgetee-upload-sin11-1.xx.fbcdn.net:443/rtmp/dummykey"
    host = extract_rtmp_hostname(url)
    if "fbcdn.net" not in host:
        _fail(f"extract_rtmp_hostname salah: {host!r}")
    validate_publish_url(url)
    if not is_deferred_rtmp_ack(url):
        _fail("Instagram/FB URL harus deferred ACK")
    print("[INVARIANT] rtmp_utils OK")


def check_lipsync_not_forced_on_any_clip() -> None:
    src = (ROOT / "ai_worker.py").read_text(encoding="utf-8", errors="replace")
    tree = ast.parse(src)
    text = src.replace("\r\n", "\n")
    # Regresi: whisper_idx saja tidak boleh memaksa lipsync tanpa cek clip talk.
    bad = (
        "if whisper_idx is not None:\n            pkt.needs_lipsync = True"
        in text
        or "if whisper_idx is not None:\n        pkt.needs_lipsync = True" in text
    )
    if bad:
        _fail("lipsync dipaksa hanya karena whisper_idx (harus cek clip talk)")
    has_pin = any(
        isinstance(n, ast.FunctionDef) and n.name == "pin_talk_body" for n in ast.walk(tree)
    )
    if not has_pin:
        _fail("pin_talk_body hilang dari VideoStateMachine")
    print("[INVARIANT] ai_worker lipsync/pin OK")


def main() -> None:
    check_rtmp_utils()
    check_lipsync_not_forced_on_any_clip()
    print("[INVARIANT] semua cek lolos")


if __name__ == "__main__":
    main()
