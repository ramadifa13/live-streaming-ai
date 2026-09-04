# AI Worker Pod — Setup cepat

Worker GPU: **VoxCPM2 TTS** + **MuseTalk** + RTMP (RTX 4090).

Panduan lengkap: [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md).

## Pod yang sudah ada (bersihkan engine TTS lama)

```bash
pkill -f 'piper_tts/server.py|uvicorn.*8090|supertonic' || true
rm -rf /workspace/piper_tts /workspace/supertonic_tts
cd /workspace/live-streaming-ai
git checkout main
git pull origin main
bash deploy/sync.sh --pull --restart
# Setup VoxCPM2 (sekali / setelah update deps)
bash deploy/voxcpm2_tts/setup.sh
FORCE_ASSETS=1 bash deploy/sync.sh --restart
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/tts/health
```

## Setup MuseTalk + VoxCPM2 baru

```bash
cd /workspace
git clone https://github.com/ramadifa13/live-streaming-ai.git live-streaming-ai
cd /workspace/live-streaming-ai/deploy
export HF_TOKEN="hf_xxx"
bash setup.sh
cp -n .env.example /workspace/ai_live_worker/.env
# Pastikan VOXCPM2_MODEL_PATH, VOICE_ROOT, VOXCPM2_VENV terisi
FORCE_ASSETS=1 bash sync.sh --restart
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/tts/health
```

## Ganti reference voice

Timpa `/workspace/voices/<voice_id>/reference.wav` (contoh `girl_cute_kids`) lalu:

```bash
curl -s -X POST http://127.0.0.1:8000/tts/invalidate-voice \
  -H 'Content-Type: application/json' \
  -d '{"voice_id":"girl_cute_kids"}'
```
