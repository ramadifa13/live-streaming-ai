"""
Chatterbox-TTS-Indonesian microservice — runs in its OWN Python venv,
completely isolated from the MuseTalk worker (see requirements-chatterbox.txt
for why: conflicting transformers/diffusers pins).

Exposes a tiny HTTP API the main worker (api_server.py) calls over localhost:
  POST /synthesize {text, avatar, tone} -> audio/wav bytes
  GET  /health                          -> {"status": "ok", "model_loaded": bool}

Voice cloning reference lookup order (first match wins):
  assets/voice_refs/{avatar}_{tone}.wav   e.g. namira_fomo.wav
  assets/voice_refs/{avatar}_default.wav  e.g. namira_default.wav
  assets/voice_refs/default.wav
"""
import io
import os
import time
import contextlib

import torch
import torchaudio as ta
import torch.utils._pytree
if not hasattr(torch.utils._pytree, "register_pytree_node") and hasattr(torch.utils._pytree, "_register_pytree_node"):
    torch.utils._pytree.register_pytree_node = torch.utils._pytree._register_pytree_node

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from huggingface_hub import hf_hub_download
from safetensors.torch import load_file

MODEL_REPO = "grandhigh/Chatterbox-TTS-Indonesian"
CHECKPOINT_FILENAME = "t3_cfg.safetensors"
VOICE_REF_DIR = os.environ.get(
    "VOICE_REF_DIR", os.path.join(os.path.dirname(__file__), "..", "assets", "voice_refs")
)
DEVICE = os.environ.get("CHATTERBOX_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")

@contextlib.contextmanager
def gpu_lock(lock_path="/tmp/gpu_inference.lock"):
    """File-based inter-process lock to prevent concurrent GPU execution between MuseTalk and Chatterbox."""
    lock_file = None
    try:
        try:
            import fcntl
            lock_file = open(lock_path, "w")
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        except (ImportError, AttributeError, OSError):
            pass
        yield
    finally:
        if lock_file:
            try:
                import fcntl
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
                lock_file.close()
            except Exception:
                pass

# VRAM Isolation: Batasi Chatterbox 25% VRAM agar tidak bentrok dengan MuseTalk
if torch.cuda.is_available() and DEVICE == "cuda":
    try:
        vram_fraction = float(os.environ.get("CHATTERBOX_VRAM_FRACTION", "0.25"))
        torch.cuda.set_per_process_memory_fraction(vram_fraction, device=0)
        print(f"[Chatterbox] CUDA VRAM fraction set to {vram_fraction*100:.0f}%")
    except Exception as vram_err:
        print(f"[Chatterbox WARNING] Could not set per-process VRAM fraction: {vram_err}")

# Tone -> (exaggeration, cfg_weight). Chatterbox has no explicit "style" input,
# but these two knobs meaningfully change delivery energy/pacing per Resemble's
# own tuning guide, so tone actually affects the voice here (unlike Edge-TTS).
TONE_PRESETS = {
    "Persuasif": {"exaggeration": 0.5, "cfg_weight": 0.5},
    "Energetic": {"exaggeration": 0.75, "cfg_weight": 0.35},
    "FOMO": {"exaggeration": 0.8, "cfg_weight": 0.3},
    "Professional": {"exaggeration": 0.35, "cfg_weight": 0.6},
    "Casual": {"exaggeration": 0.5, "cfg_weight": 0.5},
}
DEFAULT_TONE_PRESET = {"exaggeration": 0.5, "cfg_weight": 0.5}

app = FastAPI(title="Chatterbox-TTS-Indonesian Microservice")

_model = None


def get_model():
    global _model
    if _model is None:
        with gpu_lock():
            from chatterbox.tts import ChatterboxTTS

            print(f"[Chatterbox] Loading base model on {DEVICE}...")
            model = ChatterboxTTS.from_pretrained(device=DEVICE)

            print(f"[Chatterbox] Downloading Indonesian finetune checkpoint ({MODEL_REPO})...")
            checkpoint_path = hf_hub_download(repo_id=MODEL_REPO, filename=CHECKPOINT_FILENAME)
            t3_state = load_file(checkpoint_path, device="cpu")
            model.t3.load_state_dict(t3_state)

            if DEVICE == "cuda":
                torch.cuda.empty_cache()

            _model = model
            print("[Chatterbox] Model ready.")
    return _model


def resolve_voice_ref(avatar: str, tone: str) -> str:
    avatar_slug = (avatar or "namira").lower()
    tone_slug = (tone or "casual").lower()
    candidates = [
        f"{avatar_slug}_{tone_slug}.wav",
        f"{avatar_slug}_default.wav",
        "default.wav",
    ]
    for name in candidates:
        path = os.path.join(VOICE_REF_DIR, name)
        if os.path.exists(path):
            return path
    raise HTTPException(
        status_code=500,
        detail=f"No voice reference found for avatar='{avatar}' tone='{tone}' (checked {candidates})",
    )


class SynthesizeRequest(BaseModel):
    text: str
    avatar: str = "namira"
    tone: str = "Casual"


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": _model is not None, "device": DEVICE}


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    start = time.time()
    model = get_model()
    voice_ref = resolve_voice_ref(req.avatar, req.tone)
    preset = TONE_PRESETS.get(req.tone, DEFAULT_TONE_PRESET)

    try:
        with gpu_lock():
            wav = model.generate(
                req.text,
                audio_prompt_path=voice_ref,
                exaggeration=preset["exaggeration"],
                cfg_weight=preset["cfg_weight"],
            )
    except torch.cuda.OutOfMemoryError as oom:
        print(f"[Chatterbox OOM] Out of GPU memory: {oom}")
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        raise HTTPException(status_code=500, detail="Chatterbox GPU OOM")
    finally:
        if DEVICE == "cuda":
            torch.cuda.empty_cache()

    buffer = io.BytesIO()
    ta.save(buffer, wav, model.sr, format="wav")
    buffer.seek(0)
    gen_ms = round((time.time() - start) * 1000)
    print(f"[Chatterbox] Synthesized {len(req.text)} chars in {gen_ms}ms (avatar={req.avatar}, tone={req.tone})")

    from fastapi.responses import Response

    return Response(
        content=buffer.read(),
        media_type="audio/wav",
        headers={"X-Gen-Time-Ms": str(gen_ms)},
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("CHATTERBOX_PORT", "8090"))
    uvicorn.run(app, host="0.0.0.0", port=port)
