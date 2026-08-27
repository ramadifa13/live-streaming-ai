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
    avatar_image_path: Optional[str] = None
    voice: Optional[str] = None
    speed: float = 1.0
    tone: str = "Persuasif"
    audio_base64: Optional[str] = None
    audio_url: Optional[str] = None

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
async def generate_neural_video(req: GenerateVideoRequest):
    prune_old_jobs()
    task_id = f"task_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
    jobs[task_id] = {
        "status": "processing",
        "created_at": time.time(),
    }

    # Start the task in background
    asyncio.create_task(process_video_task(req, task_id))
    return {"success": True, "job_id": task_id, "status": "processing"}

class BroadcastRequest(BaseModel):
    rtmp_url: str
    stream_key: str
    idle_video: str = "/workspace/ai_live_worker/assets/3d/namira.mp4"

@app.post("/stream/start-broadcast")
async def start_broadcast(req: BroadcastRequest):
    global broadcaster_process
    if broadcaster_process and broadcaster_process.poll() is None:
        return {"success": True, "status": "streaming", "message": "Broadcaster already running"}

    env = os.environ.copy()
    env["RTMP_URL"] = req.rtmp_url
    env["STREAM_KEY"] = req.stream_key
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
