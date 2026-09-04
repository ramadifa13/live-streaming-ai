"""Bridge MuseTalk api_server → VoxCPM2 worker (venv terpisah, localhost:8091).

Men-spawn worker saat startup, keep-alive, serialize lewat HTTP lokal.
Tidak meng-import voxcpm ke dalam MuseTalk venv (torch conflict).
"""

from __future__ import annotations

import atexit
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import requests

_HERE = Path(__file__).resolve().parent
VOXCPM2_DIR = _HERE / "voxcpm2_tts"
DEFAULT_HOST = os.environ.get("VOXCPM2_BIND_HOST") or "127.0.0.1"
DEFAULT_PORT = int(os.environ.get("VOXCPM2_BIND_PORT") or "8091")
BASE_URL = os.environ.get("VOXCPM2_URL") or f"http://{DEFAULT_HOST}:{DEFAULT_PORT}"

_proc: Optional[subprocess.Popen] = None
_lock = threading.Lock()
_started = False


def _resolve_python() -> str:
    if os.environ.get("VOXCPM2_PYTHON"):
        return os.environ["VOXCPM2_PYTHON"]
    # Prefer dedicated venv on network volume / workspace
    candidates = [
        Path(os.environ.get("VOXCPM2_VENV") or "/workspace/voxcpm2_env") / "bin" / "python",
        VOXCPM2_DIR / "env" / "bin" / "python",
        _HERE / "voxcpm2_env" / "bin" / "python",
    ]
    for c in candidates:
        if c.is_file():
            return str(c)
    # Dev fallback — may fail due to torch mismatch; setup.sh creates proper venv
    return os.environ.get("PYTHON", "python3")


def _worker_script() -> Path:
    return VOXCPM2_DIR / "worker.py"


def is_enabled() -> bool:
    return (os.environ.get("TTS_ENABLED") or "true").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def health(timeout: float = 3.0) -> Dict[str, Any]:
    try:
        r = requests.get(f"{BASE_URL}/health", timeout=timeout)
        if r.ok:
            return r.json()
        return {"status": "error", "http": r.status_code, "body": r.text[:200]}
    except Exception as exc:
        return {"status": "down", "error": str(exc)}


def ensure_started(wait_ready_sec: float = 600.0) -> None:
    """Spawn VoxCPM2 worker if not already listening. Blocks until /health ready or timeout."""
    global _proc, _started
    if not is_enabled():
        print("[VoxCPM2-bridge] TTS_ENABLED=false — skip start", flush=True)
        return

    with _lock:
        h = health(timeout=2.0)
        if h.get("ready"):
            _started = True
            return
        if h.get("status") == "ok" or h.get("status") == "degraded":
            # Server up but still loading
            pass
        elif _proc is not None and _proc.poll() is None:
            pass
        else:
            py = _resolve_python()
            script = _worker_script()
            if not script.is_file():
                raise FileNotFoundError(f"VoxCPM2 worker tidak ada: {script}")
            env = os.environ.copy()
            env.setdefault("VOXCPM2_BIND_HOST", DEFAULT_HOST)
            env.setdefault("VOXCPM2_BIND_PORT", str(DEFAULT_PORT))
            print(f"[VoxCPM2-bridge] spawning {py} {script}", flush=True)
            _proc = subprocess.Popen(
                [py, str(script)],
                cwd=str(VOXCPM2_DIR),
                env=env,
                stdout=None,
                stderr=None,
            )
            atexit.register(stop)

        deadline = time.time() + wait_ready_sec
        while time.time() < deadline:
            h = health(timeout=3.0)
            if h.get("ready"):
                _started = True
                print(f"[VoxCPM2-bridge] ready: {h}", flush=True)
                return
            if _proc is not None and _proc.poll() is not None:
                raise RuntimeError(
                    f"VoxCPM2 worker exit code={_proc.returncode} health={h}"
                )
            time.sleep(2.0)
        raise TimeoutError(f"VoxCPM2 worker tidak ready dalam {wait_ready_sec}s: {h}")


def stop() -> None:
    global _proc, _started
    with _lock:
        if _proc is not None and _proc.poll() is None:
            try:
                _proc.terminate()
                _proc.wait(timeout=10)
            except Exception:
                try:
                    _proc.kill()
                except Exception:
                    pass
        _proc = None
        _started = False


def synthesize(
    text: str,
    voice_id: str = "default_host",
    language: str = "id",
    style: Optional[str] = None,
    emotion: Optional[str] = None,
    request_id: Optional[str] = None,
    live_session_id: Optional[str] = None,
    timeout: float = 120.0,
) -> Tuple[bytes, Dict[str, str]]:
    """Return (wav_bytes, metrics_headers). Raises on failure — no fallback engine."""
    if not is_enabled():
        raise RuntimeError("TTS_ENABLED=false")

    ensure_started(wait_ready_sec=float(os.environ.get("VOXCPM2_READY_TIMEOUT") or "600"))

    payload: Dict[str, Any] = {
        "text": text,
        "voice_id": voice_id or "default_host",
        "language": language or "id",
        "native_sr": False,
    }
    if style:
        payload["style"] = style
    if emotion:
        payload["emotion"] = emotion
    if request_id:
        payload["request_id"] = request_id
    if live_session_id:
        payload["live_session_id"] = live_session_id

    t0 = time.perf_counter()
    r = requests.post(f"{BASE_URL}/synthesize", json=payload, timeout=timeout)
    if r.status_code != 200:
        detail = r.text[:500]
        try:
            detail = r.json().get("detail") or detail
        except Exception:
            pass
        raise RuntimeError(f"VoxCPM2 synthesize HTTP {r.status_code}: {detail}")

    headers = {k: v for k, v in r.headers.items() if k.lower().startswith("x-tts-")}
    headers["X-TTS-Bridge-Ms"] = f"{(time.perf_counter() - t0) * 1000:.1f}"
    body = r.content
    if len(body) < 44 or body[:4] != b"RIFF":
        raise RuntimeError("VoxCPM2 mengembalikan audio tidak valid")
    return body, headers


def invalidate_voice(voice_id: Optional[str] = None) -> None:
    try:
        requests.post(
            f"{BASE_URL}/invalidate-voice",
            json={"voice_id": voice_id},
            timeout=10,
        )
    except Exception as exc:
        print(f"[VoxCPM2-bridge] invalidate failed: {exc}", flush=True)
