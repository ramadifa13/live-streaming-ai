import os
import asyncio
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

@app.post("/stream/generate-neural-video")
async def generate_neural_video(req: GenerateVideoRequest):
    print(f"\n=======================================================")
    print(f"[API INCOMING] Menerima request dari Backend")
    print(f"[DATA] Avatar: {req.avatar_name}, Teks: '{req.text[:30]}...'")
    try:
        task_id = f"task_{int(asyncio.get_event_loop().time() * 1000)}"
        
        # Determine host type based on avatar_name or path
        host_type = "3d" if "3d" in req.avatar_name.lower() or "3d" in str(req.avatar_image_path).lower() else "2d"
        host_name = req.avatar_name.lower()
        
        # In a real app, you might map avatar_name ("Namira") to the actual file name ("host_3d_dinamis_namira")
        # Here we just use what was provided
        
        final_video_path = await worker.run_pipeline(
            host_type=host_type,
            host_name=host_name,
            text_answer=req.text,
            task_id=task_id
        )
        
        if not final_video_path:
            print(f"[API ERROR] Gagal memproses video untuk task {task_id}")
            raise HTTPException(status_code=500, detail="Gagal me-render video")
            
        # Return URL to the served file
        filename = os.path.basename(final_video_path)
        video_url = f"/output/{filename}"
        
        print(f"[API SUCCESS] Video berhasil dibuat dan dikirim ke Backend: {video_url}")
        print(f"=======================================================\n")
        
        return {
            "success": True,
            "video_url": video_url,
            "job_id": task_id,
            "engine": "XTTSv2 + Wav2Lip",
            "lip_sync_active": True
        }
    except Exception as e:
        print(f"[API FATAL ERROR] Terjadi kesalahan sistem: {str(e)}")
        print(f"=======================================================\n")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    # RunPod typically maps port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
