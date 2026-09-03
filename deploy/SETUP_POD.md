# AI Worker Pod — Setup cepat

Worker GPU hanya MuseTalk + RTMP. TTS Piper di backend CPU.

Panduan lengkap: [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md).

## Pod yang sudah ada (bersihkan TTS lama)

```bash
pkill -f 'piper_tts/server.py|uvicorn.*8090' || true
rm -rf /workspace/piper_tts
cd /workspace/live-streaming-ai
git pull origin main
bash deploy/sync.sh --pull --restart
curl -s http://127.0.0.1:8000/health
ls /workspace/piper_tts 2>/dev/null || echo "OK: Piper di pod sudah dihapus"
```

## Setup MuseTalk baru

```bash
cd /workspace
git clone https://github.com/ramadifa13/live-streaming-ai.git live-streaming-ai
cd /workspace/live-streaming-ai/deploy
export HF_TOKEN="hf_xxx"
bash setup.sh
cp -n .env.example /workspace/ai_live_worker/.env
FORCE_ASSETS=1 bash sync.sh --restart
curl -s http://127.0.0.1:8000/health
```
