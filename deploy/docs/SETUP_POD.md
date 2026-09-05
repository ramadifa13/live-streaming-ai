# AI Worker Pod — Setup & run cepat

Worker GPU: **VoxCPM2 TTS** + **MuseTalk** + RTMP.

Panduan lengkap: [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md).

## Perintah yang paling sering dipakai

```bash
# Update kode (git pull / restore .git) + sync + restart API (pakai venv)
bash /workspace/live-streaming-ai/deploy/redeploy.sh

# Sama:
bash /workspace/live-streaming-ai/deploy/sync.sh --restart
```

**Jangan** `python3 api_server.py` — pakai venv lewat `start.sh` / `sync.sh --restart`.

```bash
# Cek
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/tts/health
tail -f /workspace/ai_live_worker/api_server.log
```

## Folder bukan git repo? (`fatal: not a git repository`)

`sync.sh --restart` otomatis **restore `.git`** dari GitHub lalu pull. Atau:

```bash
bash /workspace/live-streaming-ai/deploy/sync.sh --pull --restart
```

## Pod yang sudah ada (update)

```bash
bash /workspace/live-streaming-ai/deploy/redeploy.sh
# atau paksa timpa assets + hard reset git:
FORCE_ASSETS=1 FORCE_GIT_RESET=1 bash /workspace/live-streaming-ai/deploy/redeploy.sh
```

## Setup MuseTalk + VoxCPM2 baru (pertama kali)

```bash
export HF_TOKEN="hf_xxx"
# simpan token (opsional):
# echo "$HF_TOKEN" > /workspace/.hf_token && chmod 600 /workspace/.hf_token

bash /workspace/live-streaming-ai/deploy/bootstrap_pod.sh
# atau:
bash /workspace/live-streaming-ai/deploy/run_bootstrap.sh
```

Manual:

```bash
cd /workspace
git clone https://github.com/ramadifa13/live-streaming-ai.git live-streaming-ai
cd /workspace/live-streaming-ai/deploy
export HF_TOKEN="hf_xxx"
bash setup.sh
cp -n .env.example /workspace/ai_live_worker/.env
FORCE_ASSETS=1 bash sync.sh --restart
```

## Start saja (tanpa pull)

```bash
cd /workspace/ai_live_worker
bash start.sh
# atau dengan pull:
GIT_PULL=1 bash start.sh
```

## Ganti reference voice

```bash
# Timpa /workspace/voices/girl_cute_kids/reference.wav lalu:
curl -s -X POST http://127.0.0.1:8000/tts/invalidate-voice \
  -H 'Content-Type: application/json' \
  -d '{"voice_id":"girl_cute_kids"}'
```
