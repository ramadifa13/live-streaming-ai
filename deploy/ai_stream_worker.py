"""
LiveStreamerAI - Photorealistic Neural Video Worker
Powered by SadTalker (Real Lip-Sync) + Edge-TTS (Indonesian TTS)
RunPod RTX 4090 | Port 8000

Pipeline:
1. Text -> Edge-TTS (Indonesian Neural Voice, FREE)
2. Photo + Audio -> SadTalker (Lip-Sync + Expression + Head Pose)
3. Output -> MP4 9:16 (720x1280, 30fps)
"""
import os
import asyncio
import subprocess
import time
import tempfile
import shutil
from pathlib import Path
from typing import Dict, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import edge_tts

app = FastAPI(title="LiveStreamerAI - SadTalker Neural Lip-Sync Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
TEMP_DIR = Path(tempfile.gettempdir()) / "live_stream_ai"
STATIC_OUTPUT_DIR = BASE_DIR / "live_videos"
SADTALKER_DIR = BASE_DIR / "SadTalker"

TEMP_DIR.mkdir(parents=True, exist_ok=True)
STATIC_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/live_videos", StaticFiles(directory=str(STATIC_OUTPUT_DIR)), name="live_videos")

active_rtmp_processes: Dict[str, subprocess.Popen] = {}
SADTALKER_AVAILABLE = False


def check_sadtalker() -> bool:
    """Check if SadTalker is installed with its checkpoints."""
    global SADTALKER_AVAILABLE
    if (SADTALKER_DIR / "inference.py").exists() and (SADTALKER_DIR / "checkpoints").exists():
        SADTALKER_AVAILABLE = True
        print("[SadTalker] ACTIVE - Real lip-sync enabled")
    else:
        SADTALKER_AVAILABLE = False
        print("[SadTalker] NOT FOUND - FFmpeg motion fallback active")
    return SADTALKER_AVAILABLE


def get_optimal_video_encoder() -> list:
    """Detect NVENC GPU or fall back to libx264."""
    try:
        import torch  # pyrefly: ignore [missing-import]
        if torch.cuda.is_available():
            return ["-c:v", "h264_nvenc", "-preset", "p2", "-rc", "vbr", "-b:v", "4000k"]
    except Exception:
        pass
    return ["-c:v", "libx264", "-preset", "veryfast", "-b:v", "2800k"]


def clean_vram_cache():
    """Explicit GPU VRAM cleanup."""
    try:
        import torch  # pyrefly: ignore [missing-import]
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def resolve_avatar_image(avatar_image_path: str, avatar_name: str) -> str:
    """Resolve avatar image path from local files, candidate folders, or remote URLs."""
    if not avatar_image_path:
        avatar_image_path = ""

    # 1. Handle remote URLs (e.g. Unsplash / CDN)
    if avatar_image_path.startswith("http://") or avatar_image_path.startswith("https://"):
        try:
            import urllib.request
            import hashlib
            url_hash = hashlib.md5(avatar_image_path.encode()).hexdigest()
            downloaded_path = TEMP_DIR / f"avatar_{url_hash}.jpg"
            if not downloaded_path.exists():
                urllib.request.urlretrieve(avatar_image_path, str(downloaded_path))
            return str(downloaded_path)
        except Exception as e:
            print(f"[Worker] Warning: Failed to download remote avatar ({e}), falling back to local asset")

    # 2. Check direct path
    if os.path.exists(avatar_image_path):
        return avatar_image_path

    # 3. Check public avatar directories
    base_dir = BASE_DIR.parent / "frontend" / "public"
    name_lower = avatar_name.lower() if avatar_name else ""
    candidates = [
        base_dir / avatar_image_path.lstrip("/"),
        base_dir / f"avatars/{name_lower}-3d.jpg",
        base_dir / f"avatars/{name_lower}-2d.jpg",
        base_dir / "avatars/luna-3d.jpg",
        base_dir / "avatars/alya-2d.jpg",
        base_dir / "avatars/cinta-3d.jpg",
    ]
    for p in candidates:
        if p.exists():
            return str(p)

    return str(base_dir / "avatars/luna-3d.jpg")


async def run_sadtalker(avatar_img: str, audio_path: str, output_path: str, job_id: str) -> bool:
    """
    SadTalker: Real lip-sync + facial expressions + natural head pose.
    Returns True on success, False to trigger FFmpeg fallback.
    """
    if not SADTALKER_AVAILABLE:
        return False

    sadtalker_tmp = TEMP_DIR / f"sadtalker_{job_id}"
    sadtalker_tmp.mkdir(parents=True, exist_ok=True)

    cmd = [
        "python", str(SADTALKER_DIR / "inference.py"),
        "--driven_audio", audio_path,
        "--source_image", avatar_img,
        "--result_dir", str(sadtalker_tmp),
        "--still",                   # Reduce excessive head shake for natural look
        "--preprocess", "full",      # Process full face (not just center crop)
        "--enhancer", "gfpgan",      # GFPGAN HD face enhancement
        "--expression_scale", "1.0", # Natural expression intensity
        "--pose_style", "0",         # Natural head pose
        "--batch_size", "2",
        "--size", "256",
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(SADTALKER_DIR),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await asyncio.wait_for(proc.communicate(), timeout=180)

        if proc.returncode == 0:
            generated = list(sadtalker_tmp.glob("**/*.mp4"))
            if generated:
                # Scale SadTalker 256x256 output to 9:16 vertical (720x1280)
                enc = get_optimal_video_encoder()
                scale_cmd = [
                    "ffmpeg", "-y", "-i", str(generated[0]),
                    *enc,
                    "-pix_fmt", "yuv420p",
                    "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black",
                    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
                    output_path,
                ]
                sp = await asyncio.create_subprocess_exec(
                    *scale_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                await sp.communicate()
                shutil.rmtree(sadtalker_tmp, ignore_errors=True)
                clean_vram_cache()
                return os.path.exists(output_path)
    except asyncio.TimeoutError:
        print(f"[SadTalker] Timeout job {job_id}")
    except Exception as e:
        print(f"[SadTalker] Error: {e}")

    shutil.rmtree(sadtalker_tmp, ignore_errors=True)
    return False


async def run_ffmpeg_motion_fallback(avatar_img: str, audio_path: str, output_path: str):
    """Cinematic breathing + sway motion fallback when SadTalker not installed."""
    enc = get_optimal_video_encoder()
    vf = (
        "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,"
        "zoompan=z='1.02+0.015*sin(2*PI*t/4)':x='iw/2-(iw/zoom/2)+8*sin(2*PI*t/7)':"
        "y='ih/2-(ih/zoom/2)+5*sin(2*PI*t/5)':d=1:s=720x1280:fps=30"
    )
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-i", avatar_img,
        "-i", audio_path,
        *enc,
        "-pix_fmt", "yuv420p",
        "-vf", vf,
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
        "-shortest",
        output_path,
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    await proc.communicate()


# ─── Request Models ──────────────────────────────────────────────────────────

class NeuralVideoRequest(BaseModel):
    avatar_name: str = "Luna"
    avatar_image_path: str = "avatars/luna-3d.jpg"
    text: str = "Halo semuanya! Selamat datang di live streaming Luna."
    voice: str = "id-ID-GadisNeural"
    speed: float = 1.0
    tone: str = "Persuasif"
    use_enhancement: bool = True


class LiveRTMPRequest(BaseModel):
    avatar_name: str = "Luna"
    avatar_image_path: str = "avatars/luna-3d.jpg"
    text: str = ""
    voice: str = "id-ID-GadisNeural"
    rtmp_url: str = ""
    stream_key: str = ""
    speed: float = 1.0


class StopRTMPRequest(BaseModel):
    stream_key: Optional[str] = None


# ─── Lifecycle ───────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup_event():
    check_sadtalker()
    mode = "SadTalker ACTIVE" if SADTALKER_AVAILABLE else "FFmpeg fallback"
    print(f"[Worker] LiveStreamerAI Neural Worker started | Lip-sync: {mode}")


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    try:
        import torch  # pyrefly: ignore [missing-import]
        gpu_available = torch.cuda.is_available()
        gpu_name = torch.cuda.get_device_name(0) if gpu_available else "CPU"
        vram_gb = round(torch.cuda.get_device_properties(0).total_memory / (1024**3), 2) if gpu_available else 0
    except Exception:
        gpu_available = False
        gpu_name = "CPU (Python Native)"
        vram_gb = 0

    return {
        "status": "healthy",
        "service": "ai_stream_worker",
        "engine": "SadTalker + Edge-TTS" if SADTALKER_AVAILABLE else "FFmpeg Motion + Edge-TTS (Fallback)",
        "lip_sync": "SadTalker ACTIVE" if SADTALKER_AVAILABLE else "FFmpeg fallback - install SadTalker for real lip-sync",
        "gpu_acceleration": "NVIDIA NVENC (Active)" if gpu_available else "CPU Fallback",
        "device": gpu_name,
        "vram_total_gb": vram_gb,
        "sadtalker_installed": SADTALKER_AVAILABLE,
        "active_rtmp_streams": len(active_rtmp_processes),
        "timestamp": time.time(),
    }


@app.post("/stream/generate-neural-video")
async def generate_neural_video(req: NeuralVideoRequest):
    """
    Generates photorealistic talking-head video.
    - SadTalker ON (RunPod RTX 4090): Real lip-sync + expression + head pose
    - SadTalker OFF: Cinematic breathing motion + audio sync (fallback)
    """
    job_id = f"job_{int(time.time() * 1000)}"
    temp_audio = str(TEMP_DIR / f"{job_id}.mp3")
    output_video = str(STATIC_OUTPUT_DIR / f"{job_id}.mp4")

    try:
        # Step 1: Edge-TTS Indonesian Neural Voice (FREE)
        rate_str = f"+{int((req.speed - 1.0) * 100)}%" if req.speed >= 1.0 else f"-{int((1.0 - req.speed) * 100)}%"
        communicate = edge_tts.Communicate(text=req.text, voice=req.voice, rate=rate_str)
        await communicate.save(temp_audio)

        # Step 2: Resolve avatar photo
        avatar_img = resolve_avatar_image(req.avatar_image_path, req.avatar_name)

        # Step 3: SadTalker lip-sync OR FFmpeg cinematic fallback
        lip_sync_ok = await run_sadtalker(avatar_img, temp_audio, output_video, job_id)
        if not lip_sync_ok:
            await run_ffmpeg_motion_fallback(avatar_img, temp_audio, output_video)

        try:
            if os.path.exists(temp_audio):
                os.remove(temp_audio)
        except Exception:
            pass
        clean_vram_cache()

        return {
            "success": True,
            "job_id": job_id,
            "video_url": f"/live_videos/{job_id}.mp4",
            "status": "ready",
            "engine": "SadTalker Neural Lip-Sync" if lip_sync_ok else "FFmpeg Cinematic Motion (Fallback)",
            "lip_sync_active": lip_sync_ok,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/stream/live-utterance")
async def live_utterance(req: LiveRTMPRequest):
    """Generates one utterance segment for live streaming with real lip-sync."""
    try:
        job_id = f"live_{int(time.time() * 1000)}"
        temp_audio = str(TEMP_DIR / f"{job_id}.mp3")
        output_video = str(STATIC_OUTPUT_DIR / f"{job_id}.mp4")

        rate_str = f"+{int((req.speed - 1.0) * 100)}%" if req.speed >= 1.0 else f"-{int((1.0 - req.speed) * 100)}%"
        communicate = edge_tts.Communicate(text=req.text, voice=req.voice, rate=rate_str)
        await communicate.save(temp_audio)

        avatar_img = resolve_avatar_image(req.avatar_image_path, req.avatar_name)

        lip_sync_ok = await run_sadtalker(avatar_img, temp_audio, output_video, job_id)
        if not lip_sync_ok:
            await run_ffmpeg_motion_fallback(avatar_img, temp_audio, output_video)

        if req.rtmp_url and req.stream_key:
            full_rtmp = f"{req.rtmp_url.rstrip('/')}/{req.stream_key}"
            stream_proc = subprocess.Popen(
                ["ffmpeg", "-re", "-i", output_video, "-c", "copy", "-f", "flv", full_rtmp],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            active_rtmp_processes[req.stream_key] = stream_proc

        try:
            if os.path.exists(temp_audio):
                os.remove(temp_audio)
        except Exception:
            pass
        clean_vram_cache()

        return {
            "success": True,
            "job_id": job_id,
            "video_url": f"/live_videos/{job_id}.mp4",
            "stream_active": bool(req.rtmp_url and req.stream_key),
            "lip_sync_active": lip_sync_ok,
            "status": "ready",
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/stream/stop-rtmp")
async def stop_rtmp(req: StopRTMPRequest):
    """Gracefully terminates active RTMP stream processes."""
    terminated = 0
    if req.stream_key and req.stream_key in active_rtmp_processes:
        p = active_rtmp_processes.pop(req.stream_key)
        try:
            p.terminate()
            terminated += 1
        except Exception:
            pass
    else:
        for key, p in list(active_rtmp_processes.items()):
            try:
                p.terminate()
                terminated += 1
            except Exception:
                pass
            active_rtmp_processes.pop(key, None)

    return {"success": True, "terminated_processes": terminated}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
