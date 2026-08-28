import os
import asyncio
import uuid
import subprocess
import base64
import tempfile
import time
from contextlib import asynccontextmanager
from typing import Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import uvicorn
from live_worker import AILiveWorker

# Init AI Worker
worker = AILiveWorker()

# In-memory jobs tracking with TTL cleanup
jobs: Dict[str, Dict[str, Any]] = {}
MAX_JOBS_STORE = 200
JOB_TTL_SECONDS = 3600  # 1 hour TTL

def prune_old_jobs():
    """Prune expired jobs to prevent memory leaks during 24/7 streaming."""
    now = time.time()
    if len(jobs) > MAX_JOBS_STORE:
        expired_keys = [
            jid for jid, data in jobs.items()
            if now - data.get("created_at", now) > JOB_TTL_SECONDS
        ]
        for key in expired_keys:
            jobs.pop(key, None)
        # If still over limit, drop oldest
        if len(jobs) > MAX_JOBS_STORE:
            sorted_keys = sorted(jobs.keys(), key=lambda k: jobs[k].get("created_at", 0))
            for key in sorted_keys[: len(jobs) - MAX_JOBS_STORE]:
                jobs.pop(key, None)

broadcaster_process: Optional[subprocess.Popen] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("[AI-Worker] FastAPI Server starting up. Initializing directories...")
    os.makedirs(worker.output_dir, exist_ok=True)
    os.makedirs(worker.temp_dir, exist_ok=True)
    yield
    # Shutdown
    global broadcaster_process
    print("[AI-Worker] FastAPI Server shutting down. Cleaning up processes...")
    if broadcaster_process and broadcaster_process.poll() is None:
        broadcaster_process.terminate()
        try:
            broadcaster_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            broadcaster_process.kill()
        broadcaster_process = None

app = FastAPI(title="LiveStreamer AI Worker", lifespan=lifespan)

class GenerateVideoRequest(BaseModel):
    text: str
    avatar_name: str = "namira"
    avatarName: Optional[str] = None
    avatar_image_path: Optional[str] = None
    avatarImagePath: Optional[str] = None
    voice: Optional[str] = None
    speed: float = 1.0
    tone: str = "Persuasif"
    audio_base64: Optional[str] = None
    audioBase64: Optional[str] = None
    audio_url: Optional[str] = None
    audioUrl: Optional[str] = None
    wait: Optional[bool] = False
    rtmp_url: Optional[str] = None
    stream_key: Optional[str] = None
    idle_video_loop: Optional[bool] = False

# Mount output folder to serve the generated video files
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

async def process_video_task(req: GenerateVideoRequest, task_id: str):
    audio_path = None
    try:
        host_type = "3d"
        host_name = "namira"

        if req.audio_base64:
            try:
                raw_audio = base64.b64decode(req.audio_base64)
                fd, audio_path = tempfile.mkstemp(suffix=".mp3", dir=worker.temp_dir)
                os.close(fd)
                with open(audio_path, "wb") as audio_file:
                    audio_file.write(raw_audio)
            except Exception as audio_err:
                jobs[task_id] = {
                    "status": "error",
                    "error": f"Audio backend invalid: {str(audio_err)}",
                    "created_at": time.time(),
                }
                return
        elif req.audio_url:
            audio_path = req.audio_url

        # Apply timeout safety to avoid stuck tasks
        final_video_path = await asyncio.wait_for(
            worker.run_pipeline(
                host_type=host_type,
                host_name=host_name,
                text_answer=req.text,
                task_id=task_id,
                audio_path=audio_path,
                tone=req.tone,
            ),
            timeout=180.0,  # 3 minutes maximum timeout
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

        jobs[task_id] = {
            "status": "done",
            "video_url": video_url,
            "engine": "Backend TTS + MuseTalk",
            "lip_sync_active": True,
            "created_at": time.time(),
        }
        print(f"[API SUCCESS] Video berhasil dibuat untuk {task_id}: {video_url}")
    except asyncio.TimeoutError:
        print(f"[API TIMEOUT] Video generation timed out for {task_id}")
        jobs[task_id] = {
            "status": "error",
            "error": "Render video timeout (180s limit exceeded)",
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
        if audio_path and os.path.exists(audio_path):
            try:
                os.remove(audio_path)
            except Exception:
                pass

@app.post("/stream/generate-neural-video")
@app.post("/stream/live-utterance")
async def generate_neural_video(req: GenerateVideoRequest, wait: bool = False):
    prune_old_jobs()
    task_id = f"task_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
    jobs[task_id] = {
        "status": "processing",
        "created_at": time.time(),
    }

    should_wait = req.wait or wait
    if should_wait:
        await process_video_task(req, task_id)
        job_result = jobs.get(task_id, {})
        if job_result.get("status") == "error":
            raise HTTPException(status_code=500, detail=job_result.get("error", "Video render failed"))
        return {
            "success": True,
            "job_id": task_id,
            "status": "done",
            "video_url": job_result.get("video_url"),
        }

    # Start the task in background
    asyncio.create_task(process_video_task(req, task_id))
    return {"success": True, "job_id": task_id, "status": "processing"}

@app.get("/stream/queue-status")
async def get_queue_status():
    import glob
    video_files = [
        os.path.basename(f)
        for f in glob.glob(os.path.join(output_dir, "**", "*.mp4"), recursive=True)
    ]
    active_processing = [
        jid for jid, info in jobs.items() if info.get("status") == "processing"
    ]
    is_broadcasting = broadcaster_process is not None and broadcaster_process.poll() is None
    return {
        "success": True,
        "ready_videos_count": len(video_files),
        "ready_videos": video_files,
        "active_processing_count": len(active_processing),
        "broadcasting": is_broadcasting,
    }

class BroadcastRequest(BaseModel):
    rtmp_url: Optional[str] = None
    rtmpUrl: Optional[str] = None
    stream_key: Optional[str] = None
    streamKey: Optional[str] = None
    idle_video: str = "/workspace/ai_live_worker/assets/3d/namira.mp4"

class PlaybackRequest(BaseModel):
    action: str

@app.post("/stream/start-playback")
async def start_playback(req: PlaybackRequest):
    flag_path = os.path.join(output_dir, "playback_active.flag")
    if req.action == "start_playback":
        with open(flag_path, "w") as f:
            f.write("1")
        return {"success": True, "message": "Playback flag created, queue will be played."}
    return {"success": False, "message": "Unknown action"}

@app.post("/stream/start-broadcast")
async def start_broadcast(req: BroadcastRequest):
    global broadcaster_process
    final_rtmp_url = req.rtmp_url or req.rtmpUrl or ""
    final_stream_key = req.stream_key or req.streamKey or ""
    if not final_rtmp_url or not final_stream_key:
        raise HTTPException(status_code=400, detail="rtmp_url dan stream_key wajib diisi")

    if broadcaster_process and broadcaster_process.poll() is None:
        return {"success": True, "status": "streaming", "message": "Broadcaster already running"}

    # Bersihkan sisa video lama dan flag lama sebelum mulai siaran baru
    flag_path = os.path.join(output_dir, "playback_active.flag")
    if os.path.exists(flag_path):
        try:
            os.remove(flag_path)
        except Exception:
            pass
    import glob
    for f in glob.glob(os.path.join(output_dir, "**", "*.mp4"), recursive=True):
        try:
            os.remove(f)
        except Exception:
            pass

    env = os.environ.copy()
    env["RTMP_URL"] = final_rtmp_url
    env["STREAM_KEY"] = final_stream_key
    env["IDLE_VIDEO"] = req.idle_video
    env["OUTPUT_FOLDER"] = output_dir
    env["WORKER_REQUIRE_AUDIO"] = "1"

    log_path = os.path.join(output_dir, "broadcaster.log")
    broadcaster_process = subprocess.Popen(
        ["python", os.path.join(os.path.dirname(__file__), "broadcaster.py")],
        cwd=os.path.dirname(__file__),
        env=env,
        stdout=open(log_path, "a"),
        stderr=subprocess.STDOUT,
    )
    return {"success": True, "status": "starting", "pid": broadcaster_process.pid}

@app.post("/stream/stop-broadcast")
async def stop_broadcast():
    global broadcaster_process
    if broadcaster_process and broadcaster_process.poll() is None:
        broadcaster_process.terminate()
        try:
            broadcaster_process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            broadcaster_process.kill()
    broadcaster_process = None
    
    # Reset playback flag
    flag_path = os.path.join(output_dir, "playback_active.flag")
    if os.path.exists(flag_path):
        try:
            os.remove(flag_path)
        except Exception:
            pass

    # Bersihkan file video sisa dari sesi sebelumnya
    import glob
    for f in glob.glob(os.path.join(output_dir, "**", "*.mp4"), recursive=True):
        try:
            os.remove(f)
        except Exception:
            pass

    return {"success": True, "status": "stopped"}

@app.get("/stream/broadcast-status")
async def broadcast_status():
    running = broadcaster_process is not None and broadcaster_process.poll() is None
    return {"success": True, "status": "streaming" if running else "stopped"}

@app.get("/stream/status/{job_id}")
async def get_job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
