# Deployment Guide

Live host AI: **frontend** (Next.js) + **backend** (Node, LLM/orkestrasi) + **AI worker** (RunPod RTX 4090: **VoxCPM2 TTS** + MuseTalk + RTMP).

`
Browser  →  Frontend :3000  →  Backend :4000
                                │
                                └─ RunPod proxy :8000
                                      ├─ /tts/synthesize  → VoxCPM2 (GPU, venv terpisah)
                                      └─ /stream/*        → MuseTalk + FFmpeg RTMP
`

**Satu TTS engine saja: VoxCPM2.** Piper dan Supertonic sudah dihapus (tidak ada fallback).

Voice: oice_id=default_host → /workspace/voices/default_host/reference.wav (ganti file tanpa ubah kode).

---

## 1. Arsitektur & peran

| Komponen | Mesin | Tugas |
|---|---|---|
| Frontend | VPS / laptop | UI, Go Live, preview suara (via worker) |
| Backend | VPS / laptop | LLM/script bank, orkestrasi live, panggil worker /tts/synthesize |
| AI worker | RunPod GPU + network volume /workspace | VoxCPM2 + MuseTalk + idle clips + RTMP |

**Pod statis vs on-demand** (backend .env):

- RUNPOD_POD_ID **terisi** → pakai pod itu (health / resume). Tidak GraphQL-find / create on-demand.
- RUNPOD_POD_ID **kosong** → buat pod on-demand (butuh RUNPOD_NETWORK_VOLUME_ID + API key).
- RUNPOD_WORKER_URL diisi untuk pod statis, contoh: https://POD_ID-8000.proxy.runpod.net. Jangan set ke localhost di VPS.

---

## 2. Setup Network Volume RunPod

`
RunPod Console → Storage → Network Volume → Create
Pod → Edit → Network Volume → Mount Path: /workspace
HTTP service: port 8000 (proxy publik worker)
`

Layout volume:

`
/workspace/models/voxcpm2/
/workspace/voices/default_host/reference.wav
/workspace/voxcpm2_env/          # torch 2.5+ / CUDA 12 (VoxCPM2)
/workspace/ai_live_worker/       # MuseTalk torch 2.1 / cu118
`

Simpan RUNPOD_API_KEY, volume ID, pod ID, dan URL proxy ke backend .env.

---

## 3. VoxCPM2 TTS (GPU di AI Worker)

Venv **terpisah** dari MuseTalk (konflik torch). pi_server spawn 127.0.0.1:8091 saat startup.

Endpoints: GET /tts/health, POST /tts/synthesize, POST /tts/invalidate-voice.

`
cd /workspace/live-streaming-ai/deploy
bash voxcpm2_tts/setup.sh
FORCE_ASSETS=1 bash sync.sh --restart
curl -s http://127.0.0.1:8000/tts/health
`

Backend test (butuh worker URL):

`
cd backend
npx tsx test-tts.ts
`

Ganti suara: timpa 
eference.wav → POST /tts/invalidate-voice.

Piper/Supertonic: **REMOVED**. sync.sh membersihkan sisa folder/env lama.

---

## 4. Dev lokal (laptop)

Terminal 1 — backend (butuh RUNPOD_WORKER_URL ke pod VoxCPM2):

```
cd backend
cp -n .env.example .env
# isi GROQ/GEMINI, RunPod, dll.
npm install
npx prisma generate
npm run dev
```

Terminal 2 — frontend:

```
cd frontend
cp -n .env.example .env
npm install
npm run dev
```

Opsional worker lokal: `AVATAR_WORKER_URL` / `RUNPOD_WORKER_URL` ke `http://localhost:8000`. Live ke platform tetap butuh GPU worker di RunPod.

Cek:

```
curl -s http://localhost:4000/health
curl -s http://localhost:3000
```

TTS: `cd backend && npm run tts:test` → `tts-test.wav`. Jangan pakai `curl` JSON dari PowerShell ke `/api/tts` tanpa body yang valid.

---

## 5. Setup worker pertama kali (di dalam pod)

Butuh `HF_TOKEN` (Hugging Face) untuk model MuseTalk.

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

Repo sudah ada:

```bash
cd /workspace/live-streaming-ai && git checkout main && git pull origin main
cd deploy && export HF_TOKEN="hf_xxx" && bash setup.sh
```

Worker dir: `/workspace/ai_live_worker`. Env: `/workspace/ai_live_worker/.env` (lihat `deploy/.env.example`). RTMP diisi saat Go Live dari backend, bukan di-hardcode di pod kecuali tes manual.

Health worker **hanya**:

```bash
curl -s http://127.0.0.1:8000/health
```

Audio lip-sync datang dari backend sebagai WAV (`audio_base64`) ke `/stream/live-utterance`.

### Bersihkan Piper/Supertonic lama (sekali saja)

Jalankan di **terminal pod**, bukan di laptop. `setup.sh` MuseTalk **tidak** perlu diulang.

```bash
pkill -f 'piper_tts/server.py|uvicorn.*8090' || true
rm -rf /workspace/piper_tts /workspace/supertonic_tts

cd /workspace/live-streaming-ai
git checkout main
git pull origin main
bash deploy/sync.sh --pull --restart

curl -s http://127.0.0.1:8000/health
ls /workspace/piper_tts 2>/dev/null && echo "MASIH ADA piper_tts" || echo "OK: piper_tts sudah hilang"
ss -lptn | grep -E ':8000|:8090' || true
```

Yang harus hidup: **port 8000**. Port **8090** harus kosong. Jangan install Piper/Supertonic. Pakai bash voxcpm2_tts/setup.sh.

sync.sh menghapus folder/env Piper dan Supertonic.

---

## 6. Redeploy worker

Dari shell pod:

```bash
# kode terbaru + restart API
bash /workspace/live-streaming-ai/deploy/sync.sh --pull --restart

# timpa assets (idle clips, dll.)
FORCE_ASSETS=1 bash /workspace/live-streaming-ai/deploy/sync.sh --pull --restart

# git reset keras lalu sync (hati-hati: buang perubahan lokal di repo pod)
FORCE_GIT_RESET=1 bash /workspace/live-streaming-ai/deploy/sync.sh --pull --restart

# background
nohup bash /workspace/live-streaming-ai/deploy/sync.sh --pull --restart \
  > /workspace/ai_live_worker/redeploy.log 2>&1 &
```

Tanpa git pull (hanya salin `deploy/` → worker):

```bash
bash /workspace/live-streaming-ai/deploy/sync.sh --restart
```

### Edit env worker

```bash
apt update
apt install -y nano
nano /workspace/ai_live_worker/.env
bash /workspace/live-streaming-ai/deploy/sync.sh --restart
```

### Log worker

```bash
tail -f /workspace/ai_live_worker/api_server.log
tail -f /workspace/ai_live_worker/output/broadcaster.log
tail -f /workspace/ai_live_worker/logs/master_ffmpeg.log
curl -s http://127.0.0.1:8000/logs
curl -s http://127.0.0.1:8000/health
```

### Cleanup storage worker

```bash
rm -rf /workspace/ai_live_worker/temp/*
find /workspace/ai_live_worker/output -name "task_*.mp4" -delete 2>/dev/null || true
find /workspace/ai_live_worker/output -name "temp_*.mp4" -delete 2>/dev/null || true
find /workspace/ai_live_worker/output -name "*.tmp" -delete 2>/dev/null || true
> /workspace/ai_live_worker/api_server.log 2>/dev/null || true
> /workspace/ai_live_worker/output/broadcaster.log 2>/dev/null || true
> /workspace/ai_live_worker/logs/master_ffmpeg.log 2>/dev/null || true
rm -rf /workspace/tmp/pip_cache /workspace/tmp/* 2>/dev/null || true
```

---

## 7. Setup FE + BE di VPS (pertama kali)

Ganti host/domain sesuai server. Contoh di bawah: `202.10.35.186`, `livio.id`.

```bash
ssh root@202.10.35.186
apt update && apt upgrade -y
apt install -y nodejs npm git ufw nginx certbot python3-certbot-nginx python3 python3-venv python3-pip ffmpeg
cd /var/www
git clone https://github.com/ramadifa13/live-streaming-ai.git app

cd /var/www/app/backend
cp -n .env.example .env
nano .env
# Wajib: DATABASE_URL, BACKEND_PUBLIC_URL, CORS_ORIGIN,
# GROQ/GEMINI, RUNPOD_*, VOICE_ID=default_host
# VoxCPM2 setup di pod: bash deploy/voxcpm2_tts/setup.sh
npm install
npx prisma generate
npx prisma migrate deploy
npm run build

cd /var/www/app/frontend
cp -n .env.example .env
nano .env
# NEXT_PUBLIC_BACKEND_URL=https://livio.id
# NEXT_PUBLIC_APP_URL=https://livio.id
# AVATAR_WORKER_URL=https://POD_ID-8000.proxy.runpod.net
npm install
npm run build

cd /var/www/app/backend
pm2 start dist/server.js --name api
cd /var/www/app/frontend
pm2 start npm --name frontend -- start
pm2 save
pm2 startup
```

`BACKEND_PUBLIC_URL` harus URL publik (HTTPS) yang sama dengan Nginx `/api`. `RUNPOD_WORKER_URL` harus URL proxy RunPod, bukan `http://localhost:8000`.

Nginx — tulis ke `/etc/nginx/sites-available/app`:

```nginx
server {
    listen 80;
    server_name livio.id www.livio.id;
    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 30s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }
}
```

```bash
ln -sf /etc/nginx/sites-available/app /etc/nginx/sites-enabled/app
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
certbot --nginx -d livio.id -d www.livio.id
```

---

## 8. Redeploy FE + BE

Tidak ada `deploy.sh` di repo. Dari VPS:

```bash
ssh root@202.10.35.186
cd /var/www/app
git pull origin main

cd backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
# jika voxcpm2_tts/ berubah:
# # VoxCPM2 setup di pod: bash deploy/voxcpm2_tts/setup.sh
# legacy Piper/Supertonic sudah dihapus

cd ../frontend
npm install
npm run build

pm2 restart api --update-env
pm2 restart frontend --update-env
pm2 save
```

### Edit env FE/BE

```bash
nano /var/www/app/backend/.env
nano /var/www/app/frontend/.env
pm2 restart api --update-env
pm2 restart frontend --update-env
pm2 save
```

Setelah ganti reference.wav / model VoxCPM2, restart API atau invalidate-voice.

### Log FE/BE

```bash
pm2 logs api --lines 50
pm2 logs frontend --lines 50
curl -s http://127.0.0.1:4000/health
curl -s https://livio.id/api/health
```

---

## 9. Env yang sering salah

**Backend** (`backend/.env.example`):

- `VOICE_ID=default_host` — tidak ada TTS di worker.
- `# (removed) SUPERTONIC_*`, `TTS_LANGUAGE=id`, `# VOXCPM2 on worker`.
- `RUNPOD_POD_ID` + `RUNPOD_WORKER_URL` untuk pod yang sudah nyala 24/7.

**Worker** (`deploy/.env.example` → `/workspace/ai_live_worker/.env`):

- `PORT=8000`, `BROADCAST_MODE=ai_worker`, `WORKER_REQUIRE_AUDIO=1`.
- Tidak ada variabel TTS/Piper/Supertonic.

**Frontend**:

- Browser memakai `NEXT_PUBLIC_BACKEND_URL`.
- `AVATAR_WORKER_URL` hanya server-side (rewrite `/live_videos`), bukan TTS.

---

## 10. Cek alur live (ringkas)

1. Worker curl /tts/health; backend npx tsx test-tts.ts (engine voxcpm2).
2. Worker: `curl :8000/health` (`status: ok`).
3. Go Live → VoxCPM2 → MuseTalk + RTMP.

Jika bibir tidak gerak: pastikan WAV sampai worker, `playback_active` setelah konfirmasi Go Live, dan Whisper di MuseTalk mendapat audio 16 kHz (backend sudah men-synth/resample 16 kHz).
