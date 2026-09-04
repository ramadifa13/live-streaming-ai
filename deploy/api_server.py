import os
import json
import glob
import traceback
import asyncio
import uuid
import subprocess
import base64
import signal
import tempfile
import time
import threading
from contextlib import asynccontextmanager
from typing import Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn

try:
    from load_env import load_env_files
except ImportError:
    load_env_files = None

try:
    from rtmp_utils import read_rtmp_status, write_rtmp_status
except ImportError:
    read_rtmp_status = None
    write_rtmp_status = None

try:
    from video_canvas import prefer_idle_clip
except ImportError:
    prefer_idle_clip = None

if load_env_files is not None:
    _here = os.path.dirname(os.path.abspath(__file__))
    _loaded = load_env_files(
        [
            os.path.join(_here, ".env"),
            "/workspace/ai_live_worker/.env",
            os.path.join(_here, "env.local"),
        ]
    )
    if _loaded:
        print(f"[AI-Worker] Env loaded: {', '.join(_loaded)}")

from live_worker import AILiveWorker

try:
    from ai_worker import (
        get_visual_worker,
        start_visual_broadcast,
        stop_visual_broadcast,
        is_ai_worker_mode,
        TARGET_FPS as AI_WORKER_TARGET_FPS,
    )
    from speech_bridge import get_speech_bridge
except ImportError:
    get_visual_worker = None
    start_visual_broadcast = None
    stop_visual_broadcast = None
    AI_WORKER_TARGET_FPS = 30

    def is_ai_worker_mode() -> bool:
        return False

    def get_speech_bridge(output_folder: str = ""):
        return None


try:
    from worker_telemetry import get_telemetry
except ImportError:

    def get_telemetry():
        return None


worker = AILiveWorker()
os.environ.setdefault("WORKER_TEMP", worker.temp_dir)

visual_worker = None
jobs: Dict[str, Dict[str, Any]] = {}
total_videos_rendered = 0
MAX_JOBS_STORE = 200
JOB_TTL_SECONDS = 3600
AVG_RENDER_SECONDS = 10.0
IDLE_CLIP_BASENAMES = {
    "namira_idle_1.mp4",
    "namira_idle_2.mp4",
    "namira_idle_3.mp4",
    "namira_idle_4.mp4",
}

_duration_cache: Dict[tuple, float] = {}


def _probe_duration_seconds(path: str) -> float:
    """Durasi file/segmen (detik) untuk perhitungan buffer playable.

    Dicache per (path, mtime, size). Tanpa cache, endpoint queue-status
    memanggil ffprobe untuk setiap file pada setiap polling — sekitar dua kali
    per detik dari orchestrator plus frontend — dan merebut CPU dari encoder.
    """
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
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
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


def _collect_playable_videos(output_folder: str, idle_abs: str = ""):
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


def _cleanup_playable_outputs(folder: str, idle_abs: str = "") -> None:
    """Hapus sisa MP4 + .ffseg dari sesi sebelumnya (kecuali idle asset)."""
    import shutil

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


def prune_old_jobs():
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


broadcaster_process: Optional[subprocess.Popen] = None
current_broadcast_env: Optional[Dict[str, str]] = None
watchdog_task: Optional[asyncio.Task] = None
broadcaster_log_handle = None
broadcaster_restarts = 0
broadcaster_next_restart_at = 0.0
MAX_BROADCASTER_RESTARTS = 8
_broadcast_boot_task: Optional[asyncio.Task] = None
_broadcast_boot_state = "idle"
_broadcast_boot_error = ""
_broadcast_started_at: float = 0.0


def _visual_worker_pipeline_active() -> bool:
    """Pipeline thread hidup (termasuk saat menunggu RTMP handshake)."""
    return visual_worker is not None and getattr(
        visual_worker, "is_pipeline_active", visual_worker.is_running
    )


def _visual_worker_ready() -> bool:
    """Siap menerima utterance (pipeline aktif atau masih boot)."""
    if visual_worker is None:
        return False
    if _visual_worker_pipeline_active() or visual_worker.is_running:
        return True
    return _broadcast_boot_state == "starting"


def _clear_speech_bridge_queue() -> None:
    bridge = get_speech_bridge(output_dir) if get_speech_bridge is not None else None
    if bridge is not None and hasattr(bridge, "clear_pending"):
        bridge.clear_pending()


def _broadcaster_script_path(mode: Optional[str] = None) -> str:
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


def _spawn_broadcaster(env: Dict[str, str]) -> subprocess.Popen:
    """Start broadcaster (segment atau frame_feed) in its own process group.

    Process group is required so that terminating the broadcaster also reaps its
    child FFmpeg processes. Otherwise the master FFmpeg survives as an orphan,
    keeps holding the RTMP publish slot, and every later broadcast is rejected by
    the platform as a duplicate publish.
    """
    global broadcaster_log_handle

    mode = (
        (env.get("BROADCAST_MODE") or os.environ.get("BROADCAST_MODE") or "segment")
        .strip()
        .lower()
    )
    script = _broadcaster_script_path(mode)
    log_name = (
        "frame_feed.log"
        if "frame_feed" in os.path.basename(script)
        else "broadcaster.log"
    )
    log_path = os.path.join(worker.output_dir, log_name)
    print(f"[AI-Worker] Spawn broadcast mode={mode} script={os.path.basename(script)}")

    if broadcaster_log_handle is not None:
        try:
            broadcaster_log_handle.close()
        except Exception:
            pass

    broadcaster_log_handle = open(log_path, "a", encoding="utf-8")
    popen_kwargs: Dict[str, Any] = {
        "cwd": os.path.dirname(script),
        "env": env,
        "stdout": broadcaster_log_handle,
        "stderr": subprocess.STDOUT,
    }
    if os.name == "posix":
        popen_kwargs["start_new_session"] = True

    return subprocess.Popen(["python", script], **popen_kwargs)


def _terminate_broadcaster(timeout: float = 8.0) -> None:
    """Stop the broadcaster and every FFmpeg it owns."""
    global broadcaster_process, broadcaster_log_handle

    proc = broadcaster_process
    broadcaster_process = None

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

    if broadcaster_log_handle is not None:
        try:
            broadcaster_log_handle.close()
        except Exception:
            pass
        broadcaster_log_handle = None


async def periodic_cleanup_and_watchdog():
    """Background supervisor: auto-restarts crashed broadcaster and cleans up temp files."""
    global broadcaster_process, current_broadcast_env, visual_worker
    global broadcaster_restarts, broadcaster_next_restart_at
    while True:
        try:
            await asyncio.sleep(5)
            if current_broadcast_env and broadcaster_process is not None:
                rtmp_state, rtmp_err = ("disconnected", "")
                if read_rtmp_status is not None:
                    rtmp_state, rtmp_err = read_rtmp_status(output_dir)
                if rtmp_state == "failed":
                    print(
                        "[WATCHDOG STOP] RTMP fatal — tidak me-restart dengan "
                        f"stream key yang sama. {rtmp_err}"
                    )
                    current_broadcast_env = None
                    _terminate_broadcaster()
                    continue
                ret = broadcaster_process.poll()
                if ret is not None:
                    if ret == 2:
                        print(
                            "[WATCHDOG STOP] Broadcaster exit 2 — RTMP fatal, "
                            "stream key tidak di-retry."
                        )
                        current_broadcast_env = None
                        _terminate_broadcaster()
                        continue
                    now = time.time()
                    if broadcaster_restarts >= MAX_BROADCASTER_RESTARTS:
                        print(
                            f"[WATCHDOG STOP] Broadcaster gagal {broadcaster_restarts}x "
                            "berturut-turut. Restart otomatis dihentikan — "
                            "periksa RTMP URL / stream key."
                        )
                        current_broadcast_env = None
                        _terminate_broadcaster()
                    elif now >= broadcaster_next_restart_at:
                        backoff = min(60.0, 5.0 * (2**broadcaster_restarts))
                        broadcaster_restarts += 1
                        broadcaster_next_restart_at = now + backoff
                        print(
                            f"[WATCHDOG ALERT] Broadcaster berhenti (exit code: {ret}). "
                            f"Restart ke-{broadcaster_restarts}, backoff berikutnya {backoff:.0f}s..."
                        )
                        _terminate_broadcaster(timeout=2.0)
                        try:
                            broadcaster_process = _spawn_broadcaster(
                                current_broadcast_env
                            )
                            print(
                                f"[WATCHDOG SUCCESS] Broadcaster di-restart (PID: {broadcaster_process.pid})"
                            )
                        except Exception as restart_err:
                            print(
                                f"[WATCHDOG ERROR] Gagal me-restart broadcaster: {restart_err}"
                            )
            elif current_broadcast_env and is_ai_worker_mode():
                rtmp_state, rtmp_err = ("disconnected", "")
                if read_rtmp_status is not None:
                    rtmp_state, rtmp_err = read_rtmp_status(output_dir)
                if rtmp_state == "failed":
                    print(
                        "[WATCHDOG STOP] RTMP fatal (ai_worker) — "
                        f"hentikan siaran manual. {rtmp_err}"
                    )
                    current_broadcast_env = None
                    if stop_visual_broadcast is not None:
                        stop_visual_broadcast()
                    visual_worker = None
                elif (
                    visual_worker is not None
                    and not _visual_worker_pipeline_active()
                    and not visual_worker.is_running
                    and _broadcast_boot_state != "starting"
                ):
                    print(
                        "[WATCHDOG ALERT] AIVisualWorker berhenti — siaran perlu di-start ulang."
                    )
                    current_broadcast_env = None
            elif broadcaster_process is not None and broadcaster_process.poll() is None:
                _terminate_broadcaster()

            now = time.time()
            if os.path.exists(worker.temp_dir):
                for fname in os.listdir(worker.temp_dir):
                    fpath = os.path.join(worker.temp_dir, fname)
                    try:
                        if os.path.isfile(fpath) and (
                            now - os.path.getmtime(fpath) > 1800
                        ):
                            os.remove(fpath)
                    except Exception:
                        pass
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[WATCHDOG NOTICE] Background supervisor error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[AI-Worker] FastAPI Server starting up. Initializing directories...")
    os.makedirs(worker.output_dir, exist_ok=True)
    os.makedirs(worker.temp_dir, exist_ok=True)

    global watchdog_task
    watchdog_task = asyncio.create_task(periodic_cleanup_and_watchdog())
    yield
    # Shutdown
    global broadcaster_process, current_broadcast_env, visual_worker
    print("[AI-Worker] FastAPI Server shutting down. Cleaning up processes...")
    if watchdog_task:
        watchdog_task.cancel()
    current_broadcast_env = None
    _terminate_broadcaster()
    if stop_visual_broadcast is not None:
        stop_visual_broadcast()
    visual_worker = None


app = FastAPI(title="LiveStreamer AI Worker", lifespan=lifespan)


class GenerateVideoRequest(BaseModel):
    text: str
    avatar_name: Optional[str] = None
    avatarName: Optional[str] = None
    avatar_image_path: Optional[str] = None
    avatarImagePath: Optional[str] = None
    host_name: Optional[str] = None
    hostName: Optional[str] = None
    host_type: Optional[str] = None
    hostType: Optional[str] = None
    voice: Optional[str] = None
    speed: float = 1.0
    tone: str = "Persuasif"
    audio_base64: Optional[str] = None
    audioBase64: Optional[str] = None
    audio_url: Optional[str] = None
    audioUrl: Optional[str] = None
    wait: Optional[bool] = False
    action: Optional[str] = None
    priority: Optional[bool] = False


output_dir = worker.output_dir
os.makedirs(output_dir, exist_ok=True)
app.mount("/output", StaticFiles(directory=output_dir), name="output")


@app.get("/")
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "message": "AI Live Worker API is running",
        "warmed_up": getattr(worker, "_warmed_up", False),
        "batch_size": worker.batch_size,
        "active_jobs": len(jobs),
        "broadcast_mode": os.environ.get("BROADCAST_MODE", "segment"),
        "visual_worker_running": _visual_worker_pipeline_active()
        or (visual_worker is not None and visual_worker.is_running),
        "visual_worker_pipeline_active": _visual_worker_pipeline_active(),
    }


@app.get("/logs")
async def get_logs():
    logs_output = []
    log_files = [
        os.path.join(os.path.dirname(__file__), "api_server.log"),
        os.path.join(output_dir, "broadcaster.log"),
    ]
    for log_f in log_files:
        if os.path.exists(log_f):
            try:
                with open(log_f, "r", encoding="utf-8", errors="ignore") as f:
                    lines = f.readlines()
                    logs_output.extend(lines[-30:])
            except Exception:
                pass
    return {"status": "ok", "lines": logs_output[-50:]}


@app.get("/stream/worker-metrics")
async def worker_metrics():
    """Runtime telemetry snapshot (P50/P95/P99 latencies, queue depths, counters)."""
    tel = get_telemetry() if get_telemetry is not None else None
    if tel is None:
        return {"success": False, "error": "telemetry_unavailable"}
    snap = tel.snapshot(target_fps=float(AI_WORKER_TARGET_FPS))
    snap["success"] = True
    snap["visual_worker_running"] = _visual_worker_pipeline_active() or (
        visual_worker is not None and visual_worker.is_running
    )
    snap["visual_worker_pipeline_active"] = _visual_worker_pipeline_active()
    snap["broadcast_mode"] = os.environ.get("BROADCAST_MODE", "segment")
    if is_ai_worker_mode():
        bridge = get_speech_bridge(output_dir)
        if bridge is not None:
            snap["utterance_queue_count"] = bridge.pending_count()
    return snap


async def process_video_task(req: GenerateVideoRequest, task_id: str):
    global total_videos_rendered, visual_worker
    audio_path = None
    try:
        raw_name = (
            req.host_name or req.hostName or req.avatar_name or req.avatarName or ""
        )
        if not raw_name and (req.avatar_image_path or req.avatarImagePath):
            img_p = req.avatar_image_path or req.avatarImagePath or ""
            raw_name = os.path.splitext(os.path.basename(img_p))[0]

        host_name = raw_name.strip().lower() if raw_name else "namira"
        host_type = (req.host_type or req.hostType or "3d").strip().lower()

        audio_b64 = req.audio_base64 or req.audioBase64
        if audio_b64:
            try:
                raw_audio = base64.b64decode(audio_b64)
                suffix = (
                    ".wav"
                    if len(raw_audio) >= 4 and raw_audio[:4] == b"RIFF"
                    else ".mp3"
                )
                audio_path = os.path.join(worker.temp_dir, f"audio_{task_id}{suffix}")
                with open(audio_path, "wb") as audio_file:
                    audio_file.write(raw_audio)
            except Exception as audio_err:
                jobs[task_id] = {
                    "status": "error",
                    "error": f"Audio backend invalid: {str(audio_err)}",
                    "created_at": time.time(),
                }
                return
        elif req.audio_url or req.audioUrl:
            audio_path = req.audio_url or req.audioUrl
        if is_ai_worker_mode() and get_visual_worker is not None:
            if not audio_path or not os.path.exists(audio_path):
                jobs[task_id] = {
                    "status": "error",
                    "error": "Audio tidak tersedia untuk mode ai_worker",
                    "created_at": time.time(),
                }
                return
            if not _visual_worker_ready():
                if _broadcast_boot_state == "starting":
                    bridge = get_speech_bridge(output_dir)
                    if bridge is not None:
                        action_tag = (req.action or "idle_1").strip().lower().replace("-", "_")
                        if action_tag not in ("idle_1", "idle_2", "idle_3", "idle_4"):
                            action_tag = "idle_1"
                        bridge.enqueue(
                            audio_path,
                            task_id=task_id,
                            action=action_tag,
                            priority=bool(req.priority),
                        )
                        total_videos_rendered += 1
                        jobs[task_id] = {
                            "status": "done",
                            "engine": "AIVisualWorker boot-queue",
                            "lip_sync_active": False,
                            "queued_utterances": bridge.pending_count(),
                            "created_at": time.time(),
                        }
                        print(f"[API SUCCESS] Utterance queued (boot) {task_id}")
                        return
                jobs[task_id] = {
                    "status": "error",
                    "error": "Siaran belum dimulai — panggil /stream/start-broadcast dulu",
                    "created_at": time.time(),
                }
                return
            action_tag = (req.action or "idle_1").strip().lower().replace("-", "_")
            if action_tag not in ("idle_1", "idle_2", "idle_3", "idle_4"):
                action_tag = "idle_1"
            visual_worker.enqueue_utterance(
                audio_path,
                task_id=task_id,
                action=action_tag,
                priority=bool(req.priority),
            )
            total_videos_rendered += 1
            jobs[task_id] = {
                "status": "done",
                "engine": "AIVisualWorker realtime",
                "lip_sync_active": True,
                "queued_utterances": get_speech_bridge(output_dir).pending_count()
                if get_speech_bridge(output_dir)
                else 1,
                "created_at": time.time(),
            }
            print(f"[API SUCCESS] Utterance queued {task_id} action={action_tag}")
            return

        final_video_path = await asyncio.wait_for(
            worker.run_pipeline(
                host_type=host_type,
                host_name=host_name,
                text_answer=req.text,
                task_id=task_id,
                audio_path=audio_path,
                tone=req.tone,
                action=req.action,
            ),
            timeout=300.0,
        )

        if not final_video_path or not os.path.exists(final_video_path):
            jobs[task_id] = {
                "status": "error",
                "error": "Gagal me-render video lipsync (file tidak ditemukan)",
                "created_at": time.time(),
            }
            return

        rel_path = os.path.relpath(final_video_path, os.path.abspath(output_dir))
        video_url = f"/output/{rel_path}".replace("\\", "/")

        total_videos_rendered += 1

        jobs[task_id] = {
            "status": "done",
            "video_url": video_url,
            "engine": "Backend TTS + MuseTalk",
            "lip_sync_active": True,
            "created_at": time.time(),
        }
        print(
            f"[API SUCCESS] Video berhasil dibuat untuk {task_id}: {video_url} (total_rendered={total_videos_rendered})"
        )
    except asyncio.TimeoutError:
        print(f"[API TIMEOUT] Video generation timed out for {task_id}")
        jobs[task_id] = {
            "status": "error",
            "error": "Render video timeout (300s limit exceeded)",
            "created_at": time.time(),
        }
    except Exception as e:
        print(f"[API FATAL ERROR] Terjadi kesalahan sistem: {str(e)}")
        jobs[task_id] = {
            "status": "error",
            "error": str(e),
            "created_at": time.time(),
        }
    finally:
        if (
            audio_path
            and os.path.exists(audio_path)
            and audio_path.startswith(worker.temp_dir)
            and not is_ai_worker_mode()
        ):
            try:
                os.remove(audio_path)
            except Exception:
                pass


@app.post("/stream/generate-neural-video")
@app.post("/stream/live-utterance")
async def generate_neural_video(req: GenerateVideoRequest, wait: bool = False):
    prune_old_jobs()
    prefix = "prio_" if req.priority else ""
    task_id = f"{prefix}task_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
    jobs[task_id] = {
        "status": "processing",
        "created_at": time.time(),
    }

    should_wait = req.wait or wait
    if should_wait:
        await process_video_task(req, task_id)
        job_result = jobs.get(task_id, {})
        if job_result.get("status") == "error":
            raise HTTPException(
                status_code=500, detail=job_result.get("error", "Video render failed")
            )
        return {
            "success": True,
            "job_id": task_id,
            "status": "done",
            "video_url": job_result.get("video_url"),
        }

    asyncio.create_task(process_video_task(req, task_id))
    return {"success": True, "job_id": task_id, "status": "processing"}


@app.get("/stream/queue-status")
async def get_queue_status():
    global total_videos_rendered
    playable_paths = _collect_playable_videos(output_dir)
    video_files = [os.path.basename(p) for p in playable_paths]
    active_processing = [
        jid for jid, info in jobs.items() if info.get("status") == "processing"
    ]
    visual_worker_running = visual_worker is not None and (
        visual_worker.is_running or _visual_worker_pipeline_active()
    )
    broadcast_booting = _broadcast_boot_state == "starting"
    visual_worker_initializing = (
        visual_worker is not None and not visual_worker_running and broadcast_booting
    )
    is_broadcasting = (
        (broadcaster_process is not None and broadcaster_process.poll() is None)
        or visual_worker_running
        or broadcast_booting
    )

    utterance_pending = 0
    ready_utterance_count = 0
    playback_armed = False
    if is_ai_worker_mode():
        bridge = get_speech_bridge(output_dir)
        if bridge is not None:
            utterance_pending = bridge.pending_count()
            ready_fn = getattr(bridge, "ready_pending_count", None)
            ready_utterance_count = (
                int(ready_fn()) if callable(ready_fn) else utterance_pending
            )
        playback_armed = os.path.exists(
            os.path.join(output_dir, "playback_active.flag")
        )
        stream_paused = os.path.exists(
            os.path.join(output_dir, "stream_paused.flag")
        )
    else:
        stream_paused = False
    playable_seconds = sum(_probe_duration_seconds(p) for p in playable_paths)
    in_flight_seconds = len(active_processing) * AVG_RENDER_SECONDS
    buffer_seconds = round(playable_seconds + in_flight_seconds, 2)
    queued_videos_count = len(video_files)

    broadcast_mode = os.environ.get("BROADCAST_MODE", "segment")
    if is_ai_worker_mode():
        avg_utt_sec = 12.0
        prep_sec = 3.0
        playable_seconds = round(utterance_pending * avg_utt_sec, 2)
        in_flight_seconds = round(len(active_processing) * prep_sec, 2)
        buffer_seconds = round(playable_seconds + in_flight_seconds, 2)
        queued_videos_count = utterance_pending

    rtmp_connected = False
    rtmp_error = ""
    rtmp_state = "disconnected"
    if is_broadcasting:
        if read_rtmp_status is not None:
            rtmp_state, rtmp_error = read_rtmp_status(output_dir)
            rtmp_connected = rtmp_state == "connected"
        else:
            status_file = os.path.join(output_dir, "rtmp_status.txt")
            if os.path.exists(status_file):
                try:
                    with open(status_file, "r") as f:
                        rtmp_state = f.read().strip()
                        rtmp_connected = rtmp_state == "connected"
                except Exception:
                    pass
        if (
            not rtmp_connected
            and rtmp_state == "connecting"
            and _broadcast_started_at > 0
            and not rtmp_error
        ):
            connecting_sec = time.time() - _broadcast_started_at
            if connecting_sec >= 90:
                try:
                    from rtmp_utils import USER_HINT_CONNECTING_SLOW
                except ImportError:
                    USER_HINT_CONNECTING_SLOW = (
                        "RTMP masih handshake — klik Go Live di platform lalu tunggu."
                    )
                rtmp_error = USER_HINT_CONNECTING_SLOW
        if not rtmp_connected and rtmp_state not in ("failed", "connecting"):
            legacy_flag = os.path.join(output_dir, "rtmp_connected.flag")
            if os.path.exists(legacy_flag):
                try:
                    with open(legacy_flag, "r") as f:
                        rtmp_connected = f.read().strip() == "connected"
                except Exception:
                    pass
        if (
            not rtmp_connected
            and visual_worker is not None
            and getattr(visual_worker, "is_rtmp_connected", False)
        ):
            rtmp_connected = True
            rtmp_state = "connected"
            rtmp_error = ""
    elif read_rtmp_status is not None:
        rtmp_state, rtmp_error = read_rtmp_status(output_dir)

    return {
        "success": True,
        "ready_videos_count": total_videos_rendered,
        "queued_videos_count": queued_videos_count,
        "ready_videos": video_files,
        "playable_buffer_seconds": round(playable_seconds, 2),
        "queued_videos_duration_seconds": round(playable_seconds, 2),
        "in_flight_buffer_seconds": round(in_flight_seconds, 2),
        "buffer_seconds": buffer_seconds,
        "active_processing_count": len(active_processing),
        "broadcasting": is_broadcasting,
        "rtmp_connected": rtmp_connected,
        "rtmp_error": rtmp_error,
        "rtmp_state": rtmp_state,
        "rtmp_connecting_seconds": (
            round(max(0.0, time.time() - _broadcast_started_at), 1)
            if _broadcast_started_at > 0 and not rtmp_connected
            else 0
        ),
        "warmed_up": getattr(worker, "_warmed_up", False) or visual_worker_running,
        "utterance_queue_count": utterance_pending,
        "ready_utterance_count": ready_utterance_count,
        "playback_armed": playback_armed,
        "stream_paused": stream_paused,
        "visual_worker_running": visual_worker_running,
        "visual_worker_pipeline_active": _visual_worker_pipeline_active(),
        "visual_worker_initializing": visual_worker_initializing,
        "broadcast_boot_state": _broadcast_boot_state,
        "broadcast_boot_error": _broadcast_boot_error,
        "broadcast_mode": broadcast_mode,
    }


class BroadcastRequest(BaseModel):
    model_config = {"extra": "ignore"}
    rtmp_url: Optional[str] = None
    rtmpUrl: Optional[str] = None
    stream_key: Optional[str] = None
    streamKey: Optional[str] = None
    idle_video: Optional[str] = None
    idleVideo: Optional[str] = None
    product_name: Optional[str] = None
    productName: Optional[str] = None
    product_price: Optional[str] = None
    productPrice: Optional[str] = None
    product_image_url: Optional[str] = None
    productImageUrl: Optional[str] = None
    banner_image_url: Optional[str] = None
    bannerImageUrl: Optional[str] = None
    platform: Optional[str] = None
    stock_count: Optional[Any] = None
    cta_label: Optional[str] = None
    host_name: Optional[str] = None
    hostName: Optional[str] = None
    avatar_name: Optional[str] = None
    avatarName: Optional[str] = None


@app.post("/stream/rtmp-preflight")
async def rtmp_preflight(req: BroadcastRequest):
    """Validasi DNS + URL publish sebelum boot MuseTalk (fail-fast)."""
    final_rtmp_url = (req.rtmp_url or req.rtmpUrl or "").strip()
    final_stream_key = (
        (req.stream_key or req.streamKey or "")
        .replace("\r", "")
        .replace("\n", "")
        .strip()
    )
    if not final_rtmp_url or not final_stream_key:
        raise HTTPException(
            status_code=400, detail="rtmp_url dan stream_key wajib diisi"
        )
    try:
        from rtmp_utils import (
            join_rtmp_url,
            preflight_rtmp_publish,
            validate_publish_url,
        )
    except ImportError:
        join_rtmp_url = lambda base, key: f"{base.rstrip('/')}/{key}"  

        def validate_publish_url(u):  
            return u

        def preflight_rtmp_publish(_u): 
            return None

    publish_url = join_rtmp_url(final_rtmp_url, final_stream_key)
    publish_url = validate_publish_url(publish_url)
    preflight_rtmp_publish(publish_url)
    return {"success": True, "publish_url": publish_url.split("?")[0] + "?**"}


class PlaybackRequest(BaseModel):
    action: str


@app.post("/stream/start-playback")
async def start_playback(req: PlaybackRequest):
    """Arm speech playback (Go Live). Prefive boleh enqueue+prep tanpa flag ini."""
    os.makedirs(output_dir, exist_ok=True)
    flag_path = os.path.join(output_dir, "playback_active.flag")
    paused_flag = os.path.join(output_dir, "stream_paused.flag")
    if req.action == "start_playback":
        if os.path.exists(paused_flag):
            try:
                os.remove(paused_flag)
            except OSError:
                pass
        with open(flag_path, "w", encoding="utf-8") as f:
            f.write("1")
        print("[AI-Worker] STAGE: playback_armed (Go Live) — antrian mulai diputar")
        return {
            "success": True,
            "message": "Playback armed — queued utterances will start playing.",
            "playback_armed": True,
        }
    return {"success": False, "message": "Unknown action"}


@app.post("/stream/pause-broadcast")
async def pause_broadcast_soft():
    """Soft pause: speech hold, RTMP + idle animation tetap."""
    try:
        from ai_worker import pause_visual_broadcast

        result = pause_visual_broadcast(output_dir)
        return result if isinstance(result, dict) else {"success": True, "paused": True}
    except Exception as err:
        return {"success": False, "error": str(err)}


@app.post("/stream/resume-broadcast")
async def resume_broadcast_soft():
    """Resume setelah soft pause."""
    try:
        from ai_worker import resume_visual_broadcast

        result = resume_visual_broadcast(output_dir)
        return result if isinstance(result, dict) else {"success": True, "paused": False}
    except Exception as err:
        return {"success": False, "error": str(err)}


@app.post("/stream/start-broadcast")
async def start_broadcast(req: BroadcastRequest):
    global _broadcast_boot_task, _broadcast_boot_state, _broadcast_boot_error

    final_rtmp_url = (req.rtmp_url or req.rtmpUrl or "").strip()
    final_stream_key = (
        (req.stream_key or req.streamKey or "")
        .replace("\r", "")
        .replace("\n", "")
        .strip()
    )
    if not final_rtmp_url or not final_stream_key:
        raise HTTPException(
            status_code=400, detail="rtmp_url dan stream_key wajib diisi"
        )

    if (
        is_ai_worker_mode()
        and visual_worker is not None
        and _visual_worker_pipeline_active()
    ):
        rtmp_state = "disconnected"
        if read_rtmp_status is not None:
            rtmp_state, _ = read_rtmp_status(output_dir)
        if rtmp_state == "connected":
            same_target = (
                current_broadcast_env is not None
                and current_broadcast_env.get("RTMP_URL") == final_rtmp_url
                and current_broadcast_env.get("STREAM_KEY") == final_stream_key
            )
            # Hanya skip jika target RTMP/key sama. Env None + status connected
            # sering stale setelah stop — jangan skip start ke key baru.
            if same_target:
                print(
                    "[AI-Worker] start-broadcast diabaikan — AIVisualWorker sudah "
                    "connected dengan target yang sama."
                )
                return {
                    "success": True,
                    "status": "already_running",
                    "pid": os.getpid(),
                    "mode": "ai_worker",
                }

    if (
        broadcaster_process is not None
        and broadcaster_process.poll() is None
        and current_broadcast_env is not None
        and current_broadcast_env.get("RTMP_URL") == final_rtmp_url
        and current_broadcast_env.get("STREAM_KEY") == final_stream_key
    ):
        rtmp_state = "disconnected"
        if read_rtmp_status is not None:
            rtmp_state, _ = read_rtmp_status(output_dir)
        if rtmp_state == "connected":
            print(
                "[AI-Worker] start-broadcast diabaikan — siaran dengan target yang "
                f"sama sudah aktif (PID: {broadcaster_process.pid})."
            )
            return {
                "success": True,
                "status": "already_running",
                "pid": broadcaster_process.pid,
            }

    print(f"[AI-Worker] start-broadcast diterima (async) rtmp={final_rtmp_url[:60]}...")

    async def _boot() -> None:
        global _broadcast_boot_state, _broadcast_boot_error, visual_worker
        _broadcast_boot_state = "starting"
        _broadcast_boot_error = ""
        try:
            await asyncio.to_thread(_start_broadcast_sync, req)
            _broadcast_boot_state = "running"
        except asyncio.CancelledError:
            _broadcast_boot_state = "idle"
            if stop_visual_broadcast is not None:
                stop_visual_broadcast()
            visual_worker = None
            raise
        except Exception as exc:
            _broadcast_boot_state = "error"
            _broadcast_boot_error = str(exc)
            if stop_visual_broadcast is not None:
                stop_visual_broadcast()
            visual_worker = None
            traceback.print_exc()

    if _broadcast_boot_task and not _broadcast_boot_task.done():
        if _broadcast_boot_state == "starting":
            return {"success": True, "status": "starting", "async": True}
        _broadcast_boot_task.cancel()
    _broadcast_boot_task = asyncio.create_task(_boot())
    return {"success": True, "status": "starting", "async": True}


def _start_broadcast_sync(req: BroadcastRequest) -> Dict[str, Any]:
    global broadcaster_process, total_videos_rendered, current_broadcast_env
    global broadcaster_restarts, broadcaster_next_restart_at, visual_worker
    global _broadcast_boot_state, _broadcast_started_at

    final_rtmp_url = (req.rtmp_url or req.rtmpUrl or "").strip()
    final_stream_key = (
        (req.stream_key or req.streamKey or "")
        .replace("\r", "")
        .replace("\n", "")
        .strip()
    )
    if not final_rtmp_url or not final_stream_key:
        raise ValueError("rtmp_url dan stream_key wajib diisi")

    try:
        from rtmp_utils import join_rtmp_url
    except ImportError:
        join_rtmp_url = lambda base, key: f"{base.rstrip('/')}/{key}"  # type: ignore

    publish_url = join_rtmp_url(final_rtmp_url, final_stream_key)

    try:
        from rtmp_utils import preflight_rtmp_publish, validate_publish_url

        publish_url = validate_publish_url(publish_url)
        preflight_rtmp_publish(publish_url)
        print(f"[AI-Worker] RTMP preflight OK → {publish_url.split('?')[0]}?**")
    except ImportError:
        pass
    except ValueError as preflight_err:
        if write_rtmp_status is not None:
            write_rtmp_status(output_dir, "failed", str(preflight_err))
        raise

    already_connected = False
    mode = (os.environ.get("BROADCAST_MODE") or "segment").strip().lower()
    ai_mode = mode in ("ai_worker", "ai-worker", "realtime", "visual_worker")

    if ai_mode and visual_worker is not None and _visual_worker_pipeline_active():
        rtmp_state = "disconnected"
        if read_rtmp_status is not None:
            rtmp_state, _ = read_rtmp_status(output_dir)
        already_connected = rtmp_state == "connected"
    elif (
        broadcaster_process is not None
        and broadcaster_process.poll() is None
        and current_broadcast_env is not None
        and current_broadcast_env.get("RTMP_URL") == final_rtmp_url
        and current_broadcast_env.get("STREAM_KEY") == final_stream_key
    ):
        rtmp_state = "disconnected"
        if read_rtmp_status is not None:
            rtmp_state, _ = read_rtmp_status(output_dir)
        already_connected = rtmp_state == "connected"
    if already_connected:
        pid = broadcaster_process.pid if broadcaster_process else 0
        print(
            "[AI-Worker] start-broadcast diabaikan — siaran dengan target yang "
            f"sama sudah aktif."
        )
        return {
            "success": True,
            "status": "already_running",
            "pid": pid,
        }

    os.makedirs(output_dir, exist_ok=True)
    resolved_idle = req.idle_video or req.idleVideo or ""
    if not resolved_idle or not os.path.exists(resolved_idle):
        for candidate in [
            "/workspace/ai_live_worker/assets/3d/namira_idle_1.mp4",
            "/workspace/ai_live_worker/assets/3d/namira_idle_2.mp4",
            "/workspace/live-streaming-ai/deploy/assets/3d/namira_idle_1.mp4",
            "/workspace/live-streaming-ai/deploy/assets/3d/namira_idle_2.mp4",
            os.path.join(os.path.dirname(__file__), "assets/3d/namira_idle_1.mp4"),
            os.path.join(os.path.dirname(__file__), "assets/3d/namira_idle_2.mp4"),
        ]:
            if os.path.exists(candidate):
                resolved_idle = candidate
                break
    if resolved_idle and prefer_idle_clip is not None:
        resolved_idle = prefer_idle_clip(resolved_idle)

    _terminate_broadcaster(timeout=2.0)
    _keep_warm = (os.environ.get("BROADCAST_MODE") or "").strip().lower() in (
        "ai_worker",
        "ai-worker",
        "realtime",
        "visual_worker",
    )
    if stop_visual_broadcast is not None:
        if _keep_warm:
            try:
                # Restart broadcast: stop threads, keep model + antrian ucapan.
                stop_visual_broadcast(destroy=False)
            except TypeError:
                stop_visual_broadcast()
                visual_worker = None
            except Exception:
                stop_visual_broadcast()
                visual_worker = None
        else:
            stop_visual_broadcast()
            visual_worker = None
            _clear_speech_bridge_queue()
    else:
        visual_worker = None
        _clear_speech_bridge_queue()
    if write_rtmp_status is not None:
        write_rtmp_status(output_dir, "connecting")
    # Reset log supaya error NVENC/sesi lama tidak mengacaukan diagnosis.
    try:
        log_path = os.path.join(output_dir, "ai_worker_rtmp.log")
        with open(log_path, "w", encoding="utf-8") as fh:
            fh.write(
                f"=== broadcast start {time.strftime('%Y-%m-%d %H:%M:%S')} "
                f"codec=libx264 ===\n"
            )
    except Exception:
        pass
    _broadcast_started_at = time.time()

    total_videos_rendered = 0
    broadcaster_restarts = 0
    broadcaster_next_restart_at = 0.0


    flag_path = os.path.join(output_dir, "playback_active.flag")
    if os.path.exists(flag_path):
        try:
            os.remove(flag_path)
        except Exception:
            pass
    idle_abs = os.path.abspath(resolved_idle) if resolved_idle else ""

    config_path = os.path.join(output_dir, "broadcast_config.json")
    config_data = {
        "rtmp_url": final_rtmp_url,
        "stream_key": final_stream_key,
        "idle_video": resolved_idle,
        "output_folder": output_dir,
        "product_name": req.product_name or req.productName or "",
        "product_price": req.product_price or req.productPrice or "",
        "product_image_url": req.product_image_url or req.productImageUrl or "",
        "banner_image_url": req.banner_image_url or req.bannerImageUrl or "",
        "platform": req.platform or "",
    }
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config_data, f)


    env = os.environ.copy()
    env.pop("PRODUCT_IMAGE_URL", None)
    env.pop("BANNER_IMAGE_URL", None)
    env["RTMP_URL"] = final_rtmp_url
    env["STREAM_KEY"] = final_stream_key
    env["IDLE_VIDEO"] = resolved_idle
    env["OUTPUT_FOLDER"] = output_dir
    env["CONFIG_PATH"] = config_path
    env["WORKER_REQUIRE_AUDIO"] = "1"

    mode = (
        (os.environ.get("BROADCAST_MODE") or env.get("BROADCAST_MODE") or "segment")
        .strip()
        .lower()
    )
    env["BROADCAST_MODE"] = mode

    if mode in ("frame_feed", "frame-feed", "continuous"):
        os.environ["BROADCAST_MODE"] = mode
        os.environ.setdefault("MUSETALK_RAW_FEED", "1")
        os.environ.setdefault("MUSETALK_SKIP_MP4", "1")
        env["MUSETALK_RAW_FEED"] = os.environ.get("MUSETALK_RAW_FEED", "1")
        env["MUSETALK_SKIP_MP4"] = os.environ.get("MUSETALK_SKIP_MP4", "1")
    current_broadcast_env = env


    try:
        from broadcaster import prepare_overlay_files

        prepare_overlay_files(
            output_dir,
            product_name=config_data.get("product_name", ""),
            product_price=config_data.get("product_price", ""),
            product_image_url=config_data.get("product_image_url", ""),
            banner_image_url=config_data.get("banner_image_url", ""),
        )
    except Exception as overlay_err:
        print(f"[AI-Worker] Overlay notice: {overlay_err}")

    if ai_mode and get_visual_worker is not None:
        os.environ["AI_WORKER_FPS"] = os.environ.get(
            "AI_WORKER_FPS", os.environ.get("FRAME_FEED_FPS", "25")
        )
        host_raw = (
            req.host_name
            or req.hostName
            or req.avatar_name
            or req.avatarName
            or "namira"
        )
        host_slug = str(host_raw).strip().lower() or "namira"
        assets_dir = (
            os.path.dirname(resolved_idle)
            if resolved_idle and os.path.exists(resolved_idle)
            else None
        )
        vw = get_visual_worker(output_dir)
        visual_worker = vw  # expose segera agar broadcast-status bisa dipoll saat init
        vw.rtmp_url = publish_url
        if assets_dir:
            vw.assets_dir = assets_dir
        vw.host = host_slug
        if output_dir:
            vw.output_folder = output_dir
        print(
            f"[AI-Worker] STAGE: init model/assets ({host_slug}) — "
            "skip jika sudah hangat; bisa 1–3 menit saat cold start"
        )
        vw.initialize()
        print("[AI-Worker] STAGE: model READY — mulai RTMP handshake")
        try:
            vw.start(wait_rtmp=True)
        except Exception as start_err:
            if stop_visual_broadcast is not None:
                try:
                    stop_visual_broadcast(destroy=False)
                except TypeError:
                    stop_visual_broadcast()
            visual_worker = None
            _clear_speech_bridge_queue()
            if write_rtmp_status is not None:
                write_rtmp_status(output_dir, "failed", str(start_err)[:240])
            raise RuntimeError(str(start_err)) from start_err
        global _broadcast_boot_state
        _broadcast_boot_state = "running"
        bridge = get_speech_bridge(output_dir)
        if bridge is not None:
            bridge.output_folder = output_dir
        print(
            f"[AI-Worker] STAGE: LIVE pipeline aktif @ "
            f"{os.environ.get('AI_WORKER_FPS', '25')}fps "
            f"(RTMP connected / handshake selesai)"
        )
        broadcaster_process = None
        return {
            "success": True,
            "status": "starting",
            "pid": os.getpid(),
            "mode": "ai_worker",
        }

    if ai_mode and get_visual_worker is None:
        raise RuntimeError(
            "BROADCAST_MODE=ai_worker tetapi modul ai_worker gagal diimpor — "
            "cek api_server.log / bash deploy/sync.sh --restart."
        )

    broadcaster_process = _spawn_broadcaster(env)
    print(
        f"[AI-Worker] Broadcaster dipicu (PID: {broadcaster_process.pid}, "
        f"mode={env.get('BROADCAST_MODE', 'segment')})"
    )

    def _deferred_cleanup() -> None:
        try:
            _cleanup_playable_outputs(output_dir, idle_abs)
        except Exception as cleanup_err:
            print(f"[AI-Worker] deferred cleanup notice: {cleanup_err}")

    threading.Thread(target=_deferred_cleanup, daemon=True).start()
    return {"success": True, "status": "starting", "pid": broadcaster_process.pid}


@app.post("/stream/stop-broadcast")
async def stop_broadcast():
    global broadcaster_process, total_videos_rendered, current_broadcast_env
    global \
        _broadcast_boot_state, \
        _broadcast_boot_error, \
        _broadcast_boot_task, \
        visual_worker
    global _broadcast_started_at
    current_broadcast_env = None
    _broadcast_boot_state = "idle"
    _broadcast_boot_error = ""
    _broadcast_started_at = 0.0
    if _broadcast_boot_task and not _broadcast_boot_task.done():
        _broadcast_boot_task.cancel()
    _terminate_broadcaster(timeout=10.0)
    if stop_visual_broadcast is not None:
        stop_visual_broadcast()
    visual_worker = None
    _clear_speech_bridge_queue()

    # Jangan biarkan FE/status baca "connected" dari sesi lama.
    if write_rtmp_status is not None:
        try:
            write_rtmp_status(output_dir, "disconnected")
        except Exception:
            pass

    total_videos_rendered = 0

    flag_path = os.path.join(output_dir, "playback_active.flag")
    if os.path.exists(flag_path):
        try:
            os.remove(flag_path)
        except Exception:
            pass

    _cleanup_playable_outputs(output_dir)

    return {"success": True, "status": "stopped"}


class UpdateProductRequest(BaseModel):
    product_name: Optional[str] = None
    productName: Optional[str] = None
    product_price: Optional[str] = None
    productPrice: Optional[str] = None
    product_image_url: Optional[str] = None
    productImageUrl: Optional[str] = None
    banner_image_url: Optional[str] = None
    bannerImageUrl: Optional[str] = None


@app.post("/stream/update-product")
async def update_stream_product(req: UpdateProductRequest):
    update_file = os.path.join(output_dir, "update_overlay.json")
    payload = {
        "product_name": req.product_name or req.productName or "",
        "product_price": req.product_price or req.productPrice or "",
        "product_image_url": req.product_image_url or req.productImageUrl or "",
        "banner_image_url": req.banner_image_url or req.bannerImageUrl or "",
    }
    with open(update_file, "w") as f:
        json.dump(payload, f)
    return {"success": True, "message": "Product overlay update queued for hot-swap"}


@app.get("/stream/broadcast-status")
async def broadcast_status():
    vw_running = visual_worker is not None and (
        visual_worker.is_running or _visual_worker_pipeline_active()
    )
    vw_initializing = (
        visual_worker is not None
        and not vw_running
        and _broadcast_boot_state == "starting"
    )
    running = (
        broadcaster_process is not None and broadcaster_process.poll() is None
    ) or vw_running
    rtmp_connected = False
    rtmp_state = "disconnected"
    rtmp_error = ""
    if read_rtmp_status is not None:
        rtmp_state, rtmp_error = read_rtmp_status(output_dir)
        rtmp_connected = rtmp_state == "connected"
    if _broadcast_boot_state == "error" and _broadcast_boot_error:
        return {
            "success": False,
            "status": "error",
            "boot_state": "error",
            "error": _broadcast_boot_error,
            "rtmp_connected": rtmp_connected,
            "rtmp_state": rtmp_state,
        }
    if rtmp_connected or running:
        return {
            "success": True,
            "status": "streaming",
            "boot_state": "running",
            "rtmp_connected": rtmp_connected,
            "rtmp_state": rtmp_state,
            "visual_worker_running": vw_running,
            "visual_worker_pipeline_active": _visual_worker_pipeline_active(),
            "visual_worker_initializing": vw_initializing,
        }
    if _broadcast_boot_state == "starting":
        return {
            "success": True,
            "status": "starting",
            "boot_state": "starting",
            "rtmp_connected": False,
            "rtmp_state": rtmp_state,
            "visual_worker_running": vw_running,
            "visual_worker_pipeline_active": _visual_worker_pipeline_active(),
            "visual_worker_initializing": vw_initializing,
        }
    return {
        "success": True,
        "status": "stopped",
        "boot_state": _broadcast_boot_state,
        "rtmp_connected": False,
        "rtmp_state": rtmp_state,
        "rtmp_error": rtmp_error,
    }


@app.get("/stream/status/{job_id}")
async def get_job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    try:
        uvicorn.run(app, host="0.0.0.0", port=port)
    except OSError as exc:
        errno = getattr(exc, "errno", None)
        if errno in (48, 98, 10048) or "address already in use" in str(exc).lower():
            print(
                f"\n[ERROR] Port {port} sudah dipakai — instance api_server lain masih berjalan.\n"
                f"        pkill -9 -f api_server.py\n"
                f"        fuser -k {port}/tcp   # atau: lsof -ti:{port} | xargs kill -9\n"
                f"        Lalu jalankan ulang: bash start.sh\n",
                flush=True,
            )
        raise
