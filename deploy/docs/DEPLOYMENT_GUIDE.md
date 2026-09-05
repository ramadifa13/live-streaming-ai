# Deployment Guide

Live host AI: **frontend** (Next.js) + **backend** (Node, LLM/orkestrasi) + **AI worker** (RunPod **L40S** / 4090: **VoxCPM2 TTS** + MuseTalk + RTMP).

```
Browser  →  Frontend :3000  →  Backend :4000
                                │
                                └─ RunPod proxy :8000
                                      ├─ /tts/synthesize  → VoxCPM2 (GPU, venv terpisah :8091)
                                      └─ /stream/*        → MuseTalk + FFmpeg RTMP
```

**Satu TTS engine: VoxCPM2.** Piper / Supertonic / Chatterbox sudah dihapus.

**Pre-live:** preview suara = file lokal `frontend/public/voices/<voice_id>/preview_{id|en}.wav` (tidak hit pod).  
**Live:** VoxCPM2 di worker memakai `voices/<voice_id>/reference.wav`.

Katalog `voice_id` (host perempuan):

| voice_id | Label |
|---|---|
| `girl_cute_kids` | girl - cute kids |
| `girl_warm_youthful` | girl - warm & youthful |
| `girl_warm_friendly` | girl - warm & friendly |
| `girl_calm_professional` | girl - calm & professional |

---

## 1. Arsitektur & peran

| Komponen | Mesin | Tugas |
|---|---|---|
| Frontend | VPS / laptop | UI, Go Live, **preview suara lokal** |
| Backend | VPS / laptop | LLM/script bank, orkestrasi live, panggil worker saat live |
| AI worker | RunPod GPU + volume `/workspace` | VoxCPM2 + MuseTalk + idle clips + RTMP |

### Pod STATIS vs ON-DEMAND (backend `.env`)

| Mode | `RUNPOD_POD_ID` | `RUNPOD_WORKER_URL` | `RUNPOD_API_KEY` + `NETWORK_VOLUME_ID` | Perilaku |
|---|---|---|---|---|
| **STATIS** | terisi | terisi (proxy pod) | opsional | Pakai pod tetap; health/resume; end-live biasanya pause (jika `KEEP_POD_WARM=1`) |
| **ON-DEMAND** | **kosong** | **kosong** | **wajib** | Mulai Siaran = create pod; Akhiri = terminate |

Frontend `AVATAR_WORKER_URL` pada mode statis **samakan** dengan `RUNPOD_WORKER_URL`. Pada on-demand, pre-live tidak bergantung worker.

---

## 2. Setup Network Volume RunPod

```
RunPod Console → Storage → Network Volume → Create (disarankan ≥50GB)
Pod → Edit → Network Volume → Mount Path: /workspace
HTTP service: port 8000 (proxy publik worker)
```

Layout volume (setelah bootstrap):

```
/workspace/models/voxcpm2/
/workspace/models/...          # MuseTalk weights (via sync/setup)
/workspace/voices/
  girl_cute_kids/reference.wav
  girl_warm_youthful/reference.wav
  girl_warm_friendly/reference.wav
  girl_calm_professional/reference.wav
/workspace/voxcpm2_env/        # torch 2.5+ / CUDA 12 (VoxCPM2 saja)
/workspace/ai_live_worker/     # kode worker + MuseTalk venv (torch 2.1 / cu118)
  env/
  assets/3d/namira_idle_*.mp4
  .env                         # copy dari deploy/.env.example
```

Simpan `RUNPOD_API_KEY`, volume ID, (opsional) pod ID + URL proxy ke backend `.env`.

---

## 3. VoxCPM2 TTS (GPU di AI Worker)

Venv **terpisah** dari MuseTalk (konflik torch). `api_server` spawn `127.0.0.1:8091` saat startup.

Requirements: [`deploy/voxcpm2_tts/requirements.txt`](voxcpm2_tts/requirements.txt)  
MuseTalk worker: [`deploy/requirements-worker.txt`](requirements-worker.txt)

Endpoints: `GET /tts/health`, `POST /tts/synthesize`, `POST /tts/invalidate-voice`.

```bash
cd /workspace/ai_live_worker   # atau path sync deploy/
bash voxcpm2_tts/setup.sh
cp -n .env.example .env        # VOICE_ID=girl_cute_kids
# pastikan /workspace/voices/<voice_id>/reference.wav ada
bash sync.sh --restart         # atau: python -u api_server.py
curl -s http://127.0.0.1:8000/tts/health
curl -s http://127.0.0.1:8000/health
```

Ganti suara live: timpa `reference.wav` → `POST /tts/invalidate-voice` `{ "voice_id": "girl_cute_kids" }`.

---

## 4. Dev lokal (laptop)

Terminal 1 — backend:

```bash
cd backend
cp -n .env.example .env
# Mode STATIS: isi RUNPOD_POD_ID + RUNPOD_WORKER_URL (+ KEEP_POD_WARM=1)
# Mode ON-DEMAND: kosongkan keduanya; isi API_KEY + NETWORK_VOLUME_ID
npm install && npx prisma generate && npm run dev
```

Terminal 2 — frontend:

```bash
cd frontend
cp -n .env.example .env
# AVATAR_WORKER_URL = sama dengan RUNPOD_WORKER_URL (statis)
npm install && npm run dev
```

Cek: `curl -s http://localhost:4000/health` · preview suara di dashboard **tidak** memanggil pod.

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

Dari shell pod (**satu perintah**):

```bash
bash /workspace/live-streaming-ai/deploy/redeploy.sh
# alias: bash deploy/sync.sh --restart   ← otomatis git pull + sync + start (venv)
```

Opsi:

```bash
# timpa assets (idle clips, dll.)
FORCE_ASSETS=1 bash /workspace/live-streaming-ai/deploy/redeploy.sh

# git reset keras lalu sync (buang perubahan lokal di repo pod)
FORCE_GIT_RESET=1 bash /workspace/live-streaming-ai/deploy/redeploy.sh

# tanpa git pull
SKIP_PULL=1 bash /workspace/live-streaming-ai/deploy/sync.sh --restart

# background
nohup bash /workspace/live-streaming-ai/deploy/redeploy.sh \
  > /workspace/ai_live_worker/redeploy.log 2>&1 &
```

Jika `git pull` gagal (`not a git repository`): `sync.sh` otomatis restore `.git` dari GitHub lalu pull.

**Penting:** API harus dijalankan dengan `/workspace/ai_live_worker/env/bin/python` (lewat `start.sh` / `redeploy.sh`), bukan `python3` sistem.

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
# GROQ/GEMINI, RUNPOD_* (statis ATAU on-demand), VOICE_ID=girl_cute_kids
# VoxCPM2 setup di pod: bash deploy/voxcpm2_tts/setup.sh
# Pre-live voices: frontend/public/voices/<voice_id>/preview_*.wav
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

- `VOICE_ID=girl_cute_kids` (katalog perempuan; bukan `default_host`).
- **Statis:** isi `RUNPOD_POD_ID` + `RUNPOD_WORKER_URL` (+ `KEEP_POD_WARM=1`).
- **On-demand:** kosongkan keduanya; isi `RUNPOD_API_KEY` + `RUNPOD_NETWORK_VOLUME_ID` (+ `KEEP_POD_WARM=0`).
- Pre-live **tidak** butuh TTS di backend; live memanggil worker `/tts/synthesize`.

**Worker** (`deploy/.env.example` → `/workspace/ai_live_worker/.env`):

- `PORT=8000`, `BROADCAST_MODE=ai_worker`, `WORKER_REQUIRE_AUDIO=1`.
- `VOICE_ID=girl_cute_kids`, `VOICE_ROOT=/workspace/voices`, `VOXCPM2_VENV=/workspace/voxcpm2_env`.
- L40S: `MUSETALK_BATCH_SIZE=16`, `AI_WORKER_HOLD_TALK_SEC=90`, `MUSETALK_PREROLL_TIMEOUT_SEC=2.5`, `MUSETALK_HARD_PREROLL=1`, `AI_WORKER_TALK_CLIP=talk`, `AI_WORKER_PIN_TALK=1`, `AI_WORKER_TALK_STREAK=999`, `AI_WORKER_OVERLAP_FRAMES=12`. Assets: `namira_idle.mp4` + `namira_talk.mp4` (+ `talk_2`/`talk_3`). Validate: `python validate_idle_assets.py --assets-dir assets/3d --write-meta`.
- Jangan install Piper/Supertonic.

**Frontend**:

- Browser memakai `NEXT_PUBLIC_BACKEND_URL`.
- Preview suara = `/public/voices/...` (lokal).
- `AVATAR_WORKER_URL` hanya server-side (rewrite `/live_videos`); samakan dengan worker URL saat mode statis.

### Kontinuitas visual (anti “clip disambung”)

Worker **bukan** merender MP4 lalu concatenate — tubuh loop di RAM + lipsync MuseTalk @30fps. Agar terasa realtime:

| Setting / perilaku | Tujuan |
|---|---|
| Soft cut + soft loop wrap | Hindari hard pose jump mid-speech |
| Complete utterance setelah audio (+ grace singkat), **bukan** tunggu `end_pose` | Hilangkan mute talking-body & delay kalimat berikutnya |
| Hold talk 90s | Jangan jatuh ke idle saat TTS lambat |
| Talk pool `talk,talk_2,talk_3` | Bedakan rest (`idle`) vs talk |
| Script bank **tidak** harus match durasi clip | Clip loop mengikuti audio; yang penting buffer audio nyata |

---

## 10. Cek alur live (ringkas)

1. Worker curl /tts/health; backend npx tsx test-tts.ts (engine voxcpm2).
2. Worker: `curl :8000/health` (`status: ok`).
3. Go Live → VoxCPM2 → MuseTalk + RTMP.

Jika bibir tidak gerak: pastikan WAV sampai worker, `playback_active` setelah konfirmasi Go Live, dan Whisper di MuseTalk mendapat audio 16 kHz (backend sudah men-synth/resample 16 kHz).
