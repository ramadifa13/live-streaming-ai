import os
import io
import traceback
import asyncio
import base64
from fastapi import FastAPI, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional
from starlette.concurrency import run_in_threadpool

try:
    from app import inference
except ImportError:
    def inference(*args, **kwargs):
        return "mock_output.mp4", "mock_bbox"

app = FastAPI()

class UtteranceRequest(BaseModel):
    avatar_name: str
    avatar_image_path: str
    text: str
    voice: Optional[str] = "id-ID-GadisNeural"
    speed: Optional[float] = 1.0
    tone: Optional[str] = "Casual"
    rtmp_url: Optional[str] = ""
    stream_key: Optional[str] = ""
    audio_base64: Optional[str] = ""
    audio_url: Optional[str] = ""

class GenerateVideoRequest(BaseModel):
    avatar_name: str
    avatar_image_path: str
    text: str
    voice: Optional[str] = "id-ID-GadisNeural"
    speed: Optional[float] = 1.0
    tone: Optional[str] = "Persuasif"
    audio_base64: Optional[str] = ""

class BroadcastRequest(BaseModel):
    rtmpUrl: str
    streamKey: str

def cleanup_temp_files(*filepaths):
    for fp in filepaths:
        if fp and os.path.exists(fp):
            try:
                os.remove(fp)
                print(f"Deleted {fp}")
            except Exception as e:
                print(f"Error deleting {fp}: {e}")

def cleanup_video_delayed(filepath: str, delay_sec: int = 600):
    async def delayed_delete():
        await asyncio.sleep(delay_sec)
        cleanup_temp_files(filepath)
    asyncio.create_task(delayed_delete())

@app.on_event("startup")
async def startup_event():
    os.makedirs("./results/output", exist_ok=True)
    os.makedirs("./results/input", exist_ok=True)

@app.post("/stream/live-utterance")
async def live_utterance(req: UtteranceRequest, background_tasks: BackgroundTasks):
    job_id = f"job_{os.urandom(4).hex()}"
    audio_path = f"./results/input/{job_id}.wav"

    # We expect audio to be passed in from the backend TTS via audio_base64
    if req.audio_base64:
        with open(audio_path, "wb") as fh:
            fh.write(base64.b64decode(req.audio_base64))
    else:
        # Fallback empty audio just in case it's missing (prevent total crash)
        import wave
        with wave.open(audio_path, 'wb') as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(44100)
            wav_file.writeframes(b'\x00' * 44100)

    video_path = req.avatar_image_path
    # Create a 1x1 black transparent PNG
    VALID_1x1_PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
    if not os.path.exists(video_path):
        video_path = f"./results/input/{job_id}_fallback.png"
        with open(video_path, 'wb') as f:
            f.write(VALID_1x1_PNG)
        cleanup_video_delayed(video_path, 3600)

    try:
        out_vid, bbox = await run_in_threadpool(inference, audio_path, video_path, 0, 10, "jaw", 90, 90)

        background_tasks.add_task(cleanup_temp_files, audio_path)
        cleanup_video_delayed(out_vid, 600)

        return {
            "success": True,
            "job_id": job_id,
            "status": "done",
            "video_url": f"/{out_vid}",
            "audio_path": f"/{audio_path}"
        }
    except Exception as e:
        background_tasks.add_task(cleanup_temp_files, audio_path)
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/stream/generate-neural-video")
async def generate_neural_video(req: GenerateVideoRequest, background_tasks: BackgroundTasks):
    job_id = f"job_{os.urandom(4).hex()}"
    audio_path = f"./results/input/{job_id}.wav"

    if req.audio_base64:
        with open(audio_path, "wb") as fh:
            fh.write(base64.b64decode(req.audio_base64))
    else:
        import wave
        with wave.open(audio_path, 'wb') as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(44100)
            wav_file.writeframes(b'\x00' * 44100)

    video_path = req.avatar_image_path
    VALID_1x1_PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
    if not os.path.exists(video_path):
        video_path = f"./results/input/{job_id}_fallback.png"
        with open(video_path, 'wb') as f:
            f.write(VALID_1x1_PNG)
        cleanup_video_delayed(video_path, 3600)

    try:
        out_vid, bbox = await run_in_threadpool(inference, audio_path, video_path, 0, 10, "jaw", 90, 90)

        background_tasks.add_task(cleanup_temp_files, audio_path)
        cleanup_video_delayed(out_vid, 600)

        return {
            "success": True,
            "job_id": job_id,
            "status": "done"
        }
    except Exception as e:
        background_tasks.add_task(cleanup_temp_files, audio_path)
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/stream/status/{job_id}")
async def get_status(job_id: str):
    return {
        "status": "done",
        "video_url": f"/results/output/{job_id}_out.mp4",
        "engine": "MuseTalk",
        "lip_sync_active": True
    }

@app.post("/stream/start-broadcast")
async def start_broadcast(req: BroadcastRequest):
    return {"success": True, "status": "broadcasting"}

@app.post("/stream/stop-broadcast")
async def stop_broadcast():
    return {"success": True, "status": "stopped"}

@app.get("/stream/broadcast-status")
async def broadcast_status():
    return {"success": True, "status": "stopped"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
