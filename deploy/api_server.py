import os
import asyncio
import uuid
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn
from live_worker import AILiveWorker

app = FastAPI(title="LiveStreamer AI Worker")

# Init AI Worker
worker = AILiveWorker()

class GenerateVideoRequest(BaseModel):
    text: str
    avatar_name: str
    avatar_image_path: str = None
    voice: str = None
    speed: float = 1.0
    tone: str = "Persuasif"

# Mount output folder to serve the generated video files
output_dir = worker.output_dir
os.makedirs(output_dir, exist_ok=True)
app.mount("/output", StaticFiles(directory=output_dir), name="output")

@app.get("/")
async def root():
    return {"status": "ok", "message": "AI Live Worker API is running"}

jobs = {}

async def process_video_task(req: GenerateVideoRequest, task_id: str):
    try:
        host_type = "3d" if "3d" in req.avatar_name.lower() or "3d" in str(req.avatar_image_path).lower() else "2d"
        host_name = req.avatar_name.lower()
        
        final_video_path = await worker.run_pipeline(
            host_type=host_type,
            host_name=host_name,
            text_answer=req.text,
            task_id=task_id
        )
        
        if not final_video_path:
            jobs[task_id] = {"status": "error", "error": "Gagal me-render video"}
            return
            
        rel_path = os.path.relpath(final_video_path, os.path.abspath("output"))
        video_url = f"/output/{rel_path}".replace("\\", "/")
        
        jobs[task_id] = {
            "status": "done",
            "video_url": video_url,
            "engine": "XTTSv2 + Wav2Lip",
            "lip_sync_active": True
        }
        print(f"[API SUCCESS] Video berhasil dibuat untuk {task_id}: {video_url}")
    except Exception as e:
        print(f"[API FATAL ERROR] Terjadi kesalahan sistem: {str(e)}")
        jobs[task_id] = {"status": "error", "error": str(e)}

@app.post("/stream/generate-neural-video")
@app.post("/stream/live-utterance")
async def generate_neural_video(req: GenerateVideoRequest):
    print(f"\n=======================================================")
    print(f"[API INCOMING] Menerima request dari Backend")
    print(f"[DATA] Avatar: {req.avatar_name}, Teks: '{req.text[:30]}...'")
    
    task_id = f"task_{int(asyncio.get_event_loop().time() * 1000)}_{uuid.uuid4().hex[:8]}"
    jobs[task_id] = {"status": "processing"}
    
    # Start the task in background
    asyncio.create_task(process_video_task(req, task_id))
    
    print(f"[API ACCEPTED] Memproses {task_id} di background")
    print(f"=======================================================\n")
    return {"success": True, "job_id": task_id, "status": "processing"}

@app.get("/stream/status/{job_id}")
async def get_job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]

if __name__ == "__main__":
    # RunPod typically maps port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
