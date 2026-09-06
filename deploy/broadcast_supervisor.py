"""Broadcast Supervisor: Process management, watchdog helpers, and queue cleanup."""

from __future__ import annotations

import glob
import json
import os
import shutil
import signal
import subprocess
import time
from typing import Any, Dict, List, Optional

IDLE_CLIP_BASENAMES = {
    "namira_idle.mp4",
    "namira_talk.mp4",
    "namira_talk_2.mp4",
    "namira_talk_3.mp4",
}

MAX_JOBS_STORE = 200
JOB_TTL_SECONDS = 3600
MAX_BROADCASTER_RESTARTS = 8

_duration_cache: Dict[tuple, float] = {}


def probe_duration_seconds(path: str) -> float:
    """Durasi file/segmen (detik) untuk perhitungan buffer playable."""
    if path.endswith(".ffseg") and os.path.isdir(path):
        try:
            from ffseg import ffseg_duration_seconds
            return ffseg_duration_seconds(path)
        except Exception:
            try:
                with open(os.path.join(path, "meta.json"), "r", encoding="utf-8") as fh:
                    meta = json.load(fh)
                frames = int(meta.get("frames") or 0)
                fps = float(meta.get("fps") or 25) or 25.0
                if frames > 0:
                    return max(0.4, frames / fps)
            except Exception:
                return 8.0
    try:
        stat = os.stat(path)
        cache_key = (os.path.abspath(path), stat.st_mtime_ns, stat.st_size)
    except OSError:
        return 12.0
    cached = _duration_cache.get(cache_key)
    if cached is not None:
        return cached
    value = _probe_duration_uncached(path)
    if len(_duration_cache) > 512:
        _duration_cache.clear()
    _duration_cache[cache_key] = value
    return value


def _probe_duration_uncached(path: str) -> float:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=3,
        )
        if result.returncode == 0 and result.stdout.strip():
            return max(0.5, float(result.stdout.strip()))
    except Exception:
        pass
    try:
        size = os.path.getsize(path)
        return max(4.0, min(22.0, size / 160_000.0))
    except Exception:
        return 12.0


def collect_playable_videos(output_folder: str, idle_abs: str = "") -> List[str]:
    playable = []

    for path in glob.glob(os.path.join(output_folder, "**", "*.ffseg"), recursive=True):
        if not os.path.isdir(path):
            continue
        base = os.path.basename(path)
        if base.startswith("temp_") or base.endswith(".partial"):
            continue
        if not os.path.exists(os.path.join(path, "ready.flag")):
            continue
        playable.append(path)

    for path in glob.glob(os.path.join(output_folder, "**", "*.mp4"), recursive=True):
        base = os.path.basename(path)
        if base.startswith("temp_") or base.endswith(".tmp"):
            continue
        if idle_abs and os.path.abspath(path) == idle_abs:
            continue
        if base in IDLE_CLIP_BASENAMES:
            continue
        try:
            if os.path.getsize(path) < 1024:
                continue
        except Exception:
            continue
        playable.append(path)
    return playable


def cleanup_playable_outputs(folder: str, idle_abs: str = "") -> None:
    """Hapus sisa MP4 + .ffseg dari sesi sebelumnya (kecuali idle asset)."""
    scan_roots = [folder]
    live_sub = os.path.join(folder, "live_videos")
    if os.path.isdir(live_sub):
        scan_roots.append(live_sub)

    for root in scan_roots:
        try:
            names = os.listdir(root)
        except OSError:
            continue
        for name in names:
            path = os.path.join(root, name)
            if name.endswith(".mp4"):
                if idle_abs and os.path.abspath(path) == idle_abs:
                    continue
                if name in IDLE_CLIP_BASENAMES or any(
                    name.endswith(f"idle_{n}.mp4") for n in ("1", "2", "3", "4")
                ):
                    continue
                try:
                    os.remove(path)
                except Exception:
                    pass
            elif name.endswith(".ffseg") or name.endswith(".ffseg.partial"):
                if os.path.isdir(path):
                    try:
                        shutil.rmtree(path, ignore_errors=True)
                    except Exception:
                        pass

    try:
        remaining_mp4 = glob.glob(
            os.path.join(folder, "**", "task_*.mp4"), recursive=True
        )
        remaining_mp4 += glob.glob(
            os.path.join(folder, "**", "prio_*.mp4"), recursive=True
        )
        for f in remaining_mp4[:200]:
            if idle_abs and os.path.abspath(f) == idle_abs:
                continue
            try:
                os.remove(f)
            except Exception:
                pass
    except Exception:
        pass


def prune_old_jobs(jobs: Dict[str, Dict[str, Any]]) -> None:
    """Prune expired jobs to prevent memory leaks during 24/7 streaming."""
    now = time.time()
    if len(jobs) > MAX_JOBS_STORE:
        expired_keys = [
            jid
            for jid, data in jobs.items()
            if now - data.get("created_at", now) > JOB_TTL_SECONDS
        ]
        for key in expired_keys:
            jobs.pop(key, None)
        if len(jobs) > MAX_JOBS_STORE:
            sorted_keys = sorted(
                jobs.keys(), key=lambda k: jobs[k].get("created_at", 0)
            )
            for key in sorted_keys[: len(jobs) - MAX_JOBS_STORE]:
                jobs.pop(key, None)


def broadcaster_script_path(mode: Optional[str] = None) -> str:
    resolved = (mode or os.environ.get("BROADCAST_MODE") or "segment").strip().lower()
    if resolved in ("ai_worker", "ai-worker", "realtime", "visual_worker"):
        return ""
    name = (
        "frame_feed.py"
        if resolved in ("frame_feed", "frame-feed", "continuous")
        else "broadcaster.py"
    )
    candidate = os.path.join(os.path.dirname(__file__), name)
    if os.path.exists(candidate):
        return candidate
    fallback = f"/workspace/ai_live_worker/{name}"
    if os.path.exists(fallback):
        return fallback
    legacy = os.path.join(os.path.dirname(__file__), "broadcaster.py")
    if os.path.exists(legacy):
        return legacy
    return "/workspace/ai_live_worker/broadcaster.py"


def spawn_broadcaster(env: Dict[str, str], output_dir: str) -> Tuple[subprocess.Popen, Any]:
    """Start broadcaster in its own process group, returning (process, log_handle)."""
    mode = (
        (env.get("BROADCAST_MODE") or os.environ.get("BROADCAST_MODE") or "segment")
        .strip()
        .lower()
    )
    script = broadcaster_script_path(mode)
    log_name = (
        "frame_feed.log"
        if "frame_feed" in os.path.basename(script)
        else "broadcaster.log"
    )
    log_path = os.path.join(output_dir, log_name)
    print(f"[AI-Worker] Spawn broadcast mode={mode} script={os.path.basename(script)}")

    log_handle = open(log_path, "a", encoding="utf-8")
    popen_kwargs: Dict[str, Any] = {
        "cwd": os.path.dirname(script),
        "env": env,
        "stdout": log_handle,
        "stderr": subprocess.STDOUT,
    }
    if os.name == "posix":
        popen_kwargs["start_new_session"] = True

    proc = subprocess.Popen(["python", script], **popen_kwargs)
    return proc, log_handle


def terminate_broadcaster(proc: Optional[subprocess.Popen], log_handle: Optional[Any] = None, timeout: float = 8.0) -> None:
    """Stop the broadcaster process and close its log handle."""
    if proc is not None and proc.poll() is None:
        signalled_group = False
        if os.name == "posix":
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                signalled_group = True
            except Exception:
                pass
        if not signalled_group:
            try:
                proc.terminate()
            except Exception:
                pass
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            print("[AI-Worker] Broadcaster tidak berhenti — mengirim SIGKILL.")
            if os.name == "posix":
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except Exception:
                    pass
            try:
                proc.kill()
            except Exception:
                pass

    if log_handle is not None:
        try:
            log_handle.close()
        except Exception:
            pass
