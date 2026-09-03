# AI Worker Pod — Setup (satu perintah)

## Network Volume

```
RunPod → Storage → Network Volume → Mount: /workspace
```

## Setup penuh (MuseTalk → lalu Piper otomatis)

```bash
cd /workspace
git clone https://github.com/ramadifa13/live-streaming-ai.git live-streaming-ai
cd /workspace/live-streaming-ai/deploy
export HF_TOKEN="hf_xxx"
bash setup.sh
```

```bash
# kalau repo sudah ada:
cd /workspace/live-streaming-ai && git pull origin main
cd deploy && export HF_TOKEN="hf_xxx" && bash setup.sh
```

## Env + start

```bash
cp -n /workspace/live-streaming-ai/deploy/.env.example /workspace/ai_live_worker/.env
FORCE_ASSETS=1 bash /workspace/live-streaming-ai/deploy/sync.sh --restart
```

## Health

```bash
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/tts/health
curl -s http://127.0.0.1:8090/health
```

## Test TTS host=namira

```bash
curl -s -X POST http://127.0.0.1:8000/tts/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"Halo kak, selamat datang di live.","host":"namira"}' \
  --output /tmp/namira_test.wav
ls -la /tmp/namira_test.wav
```

## Opsi

```bash
SKIP_PIPER_SETUP=1 bash setup.sh
FORCE_PIPER=1 bash piper_tts/setup.sh
```

## Redeploy

```bash
bash /workspace/live-streaming-ai/deploy/sync.sh --pull --restart
```
