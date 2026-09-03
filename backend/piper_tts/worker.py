#!/usr/bin/env python3
"""Piper worker — stdin JSON, stdout binary. Tidak bind port."""

from __future__ import annotations

import json
import sys

from synth_lib import DEFAULT_HOST, synthesize


def _write_ok(wav: bytes) -> None:
    sys.stdout.buffer.write(f"OK {len(wav)}\n".encode("ascii"))
    sys.stdout.buffer.write(wav)
    sys.stdout.buffer.flush()


def _write_err(message: str) -> None:
    payload = json.dumps({"error": message}, ensure_ascii=False)
    sys.stdout.buffer.write(f"ERR {payload}\n".encode("utf-8"))
    sys.stdout.buffer.flush()


def main() -> None:
    sys.stdout.buffer.write(b"READY\n")
    sys.stdout.buffer.flush()
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as err:
            _write_err(f"JSON invalid: {err}")
            continue
        text = str(req.get("text") or "").strip()
        if not text:
            _write_err("text kosong")
            continue
        try:
            wav = synthesize(
                text,
                host=str(req.get("host") or req.get("avatar") or req.get("voice") or DEFAULT_HOST),
                length_scale=req.get("length_scale"),
                sample_rate=int(req.get("sample_rate") or 16000),
            )
            _write_ok(wav)
        except Exception as err:
            _write_err(str(err))


if __name__ == "__main__":
    main()
