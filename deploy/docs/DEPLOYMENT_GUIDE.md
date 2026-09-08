# Deployment Guide

## 1. Setup worker pertama kali (di dalam pod)

Butuh `HF_TOKEN` (Hugging Face) untuk model MuseTalk.

### Setup awal lengkap

```bash
apt-get update
apt-get install -y git curl ffmpeg ca-certificates

cd /workspace
git clone https://github.com/ramadifa13/live-streaming-ai.git live-streaming-ai
cd /workspace/live-streaming-ai/deploy
export HF_TOKEN="hf_xxx"
bash setup.sh
cp -n .env.example /workspace/ai_live_worker/.env
nano /workspace/ai_live_worker/.env
FORCE_ASSETS=1 bash sync.sh --restart
curl -s http://127.0.0.1:8000/health
```

Repo sudah ada:

```bash
cd /workspace/live-streaming-ai && git checkout main && git pull origin main
cd deploy && export HF_TOKEN="hf_xxx" && bash setup.sh
```

### Start worker

```bash
cd /workspace/live-streaming-ai/deploy
bash start.sh
```

Untuk mengambil kode terbaru lalu start ulang:

```bash
bash /workspace/live-streaming-ai/deploy/start.sh --pull
```

Worker dianggap siap jika hasilnya `status: ok`:

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:8000/tts/health
```

Health worker **hanya**:

```bash
curl -s http://127.0.0.1:8000/health
```

Audio lip-sync datang dari backend sebagai WAV (`audio_base64`) ke `/stream/live-utterance`.


### Redeploy worker

Dari shell pod (**satu perintah**):

```bash
bash /workspace/live-streaming-ai/deploy/redeploy.sh
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
bash /workspace/live-streaming-ai/deploy/start.sh
```

Jika env dikelola dari checkout repo, simpan salinannya di `deploy/.env`, lalu
sync akan menambahkan key baru tanpa menimpa value yang sudah ada di worker:

```bash
nano /workspace/live-streaming-ai/deploy/.env
bash /workspace/live-streaming-ai/deploy/sync.sh --restart
```

Jangan menaruh token di `.env.example` atau melakukan commit terhadap `.env`.

### Cek log worker

```bash
tail -f /workspace/ai_live_worker/api_server.log
tail -f /workspace/ai_live_worker/output/broadcaster.log
tail -f /workspace/ai_live_worker/logs/master_ffmpeg.log
```

Pengecekan cepat tanpa mengikuti log:

```bash
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/logs
ps aux | grep -E '[a]pi_server|[b]roadcaster|[f]fmpeg'
```

### Edit env worker (cara lama, tetap didukung)

```bash
nano /workspace/ai_live_worker/.env
bash /workspace/live-streaming-ai/deploy/sync.sh --restart
```

`sync.sh --restart` akan melakukan sync dan restart. Gunakan ini setelah mengubah
kode atau dependency worker.

### Log worker (referensi)

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

## 2. Setup FE + BE di VPS (pertama kali)


```bash
ssh root@202.10.35.186
apt update && apt upgrade -y
apt install -y nodejs npm git ufw nginx certbot python3-certbot-nginx python3 python3-venv python3-pip ffmpeg
pm2 delete api frontend 2>/dev/null || true
systemctl stop nginx 2>/dev/null || true
cd /var/www
git clone https://github.com/ramadifa13/live-streaming-ai.git app
```

```bash
cd /var/www/app/backend
cp -n .env.example .env
nano .env
npm install
npx prisma generate
npx prisma migrate deploy
npm run build

cd /var/www/app/backend/pocket_tts
python3 -m venv env
env/bin/python -m pip install --upgrade pip
env/bin/python -m pip install -r requirements.txt

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

### Membersihkan setup lama yang sudah terlanjur ada

Gunakan ini jika VPS pernah dipasang versi lama, library TTS lama, atau build
yang rusak. Jalankan setelah backup env. Perintah ini tidak menghapus database.

```bash
pm2 delete api frontend 2>/dev/null || true
pkill -f 'pocket_tts|piper_tts|supertonic|api_server.py' 2>/dev/null || true

cd /var/www/app
rm -rf backend/dist frontend/.next
rm -rf backend/node_modules frontend/node_modules
rm -rf backend/pocket_tts/env
```

Install ulang dependency sesuai source terbaru:

```bash
cd /var/www/app/backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
python3 -m venv pocket_tts/env
pocket_tts/env/bin/python -m pip install --upgrade pip
pocket_tts/env/bin/python -m pip install -r pocket_tts/requirements.txt

cd ../frontend
npm install
npm run build
```

Pocket TTS **jangan dihapus dari source** selama `backend/src/services/tts.ts`
atau `backend/src/services/pocket-tts-bridge.ts` masih merujuk ke folder tersebut.
Jika sudah benar-benar migrasi ke VoxCPM2, hapus hanya setelah kode terbaru tidak
lagi memiliki referensi Pocket TTS, lalu jalankan build bersih.

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

### Redeploy setelah library baru ditambahkan

`npm install` akan mengambil dependency yang tercantum di `package.json`. Jika
fitur baru seperti remove-background menambah library, pastikan library tersebut
masuk ke `package.json` dan `package-lock.json`, lalu jalankan:

```bash
cd /var/www/app
git pull origin main

cd backend
npm install
npm run build

cd ../frontend
npm install
npm run build

pm2 restart api --update-env
pm2 restart frontend --update-env
pm2 save
```

Jika ingin memastikan dependency lama tidak tersisa:

```bash
cd /var/www/app/frontend
rm -rf node_modules .next
npm ci
npm run build

cd ../backend
rm -rf node_modules dist
npm ci
npx prisma generate
npm run build
```

Gunakan `npm ci` bila `package-lock.json` tersedia dan sudah di-commit. Jangan
menjalankan `npm install <nama-library>` hanya di VPS tanpa memperbarui manifest
di repository, karena library itu akan hilang pada redeploy berikutnya.

### Edit env FE/BE

```bash
nano /var/www/app/backend/.env
nano /var/www/app/frontend/.env
pm2 restart api --update-env
pm2 restart frontend --update-env
pm2 save
```

Untuk perubahan `NEXT_PUBLIC_*`, wajib jalankan build frontend lagi karena nilainya
dibaca saat build:

```bash
cd /var/www/app/frontend
npm run build
pm2 restart frontend --update-env
```

Untuk perubahan backend, restart API saja cukup:

```bash
pm2 restart api --update-env
```


### Log FE/BE

```bash
pm2 logs api --lines 50
pm2 logs frontend --lines 50
curl -s http://127.0.0.1:4000/health
curl -s https://livio.id/api/health
```
