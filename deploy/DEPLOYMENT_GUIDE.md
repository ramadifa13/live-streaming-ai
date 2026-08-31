# Deployment Guide

## 1. Setup RunPod GPU Worker (Pertama Kali)

```bash
cd /workspace
git clone https://github.com/ramadifa13/live-streaming-ai.git live-streaming-ai
cd /workspace/live-streaming-ai/deploy
export HF_TOKEN="hf_YourHuggingFaceTokenHere"
bash setup-safe.sh
cd /workspace/ai_live_worker
bash start.sh
```

---

## 2. Redeploy RunPod Worker

### 2.1 Pertama kali (skrip belum ada di pod)

```bash
cd /workspace/live-streaming-ai && git pull origin main && bash deploy/redeploy-worker.sh
```

### 2.2 Redeploy rutin

```bash
bash /workspace/live-streaming-ai/deploy/redeploy-worker.sh
```

### 2.3 Background

```bash
nohup bash /workspace/live-streaming-ai/deploy/redeploy-worker.sh > /workspace/ai_live_worker/redeploy.log 2>&1 &
```

### 2.4 Git konflik

```bash
FORCE_GIT_RESET=1 bash /workspace/live-streaming-ai/deploy/redeploy-worker.sh
```

### 2.5 Verifikasi

```bash
curl -s http://localhost:8000/health
tail -f /workspace/ai_live_worker/api_server.log
```

### 2.5b Aktifkan frame-feed (opsional, lebih natural)

Di `/workspace/ai_live_worker/.env` (atau `env`):

```bash
BROADCAST_MODE=frame_feed
MUSETALK_RAW_FEED=1
MUSETALK_SKIP_MP4=1
```

Lalu restart worker / redeploy. Idle dipotong per frame; MuseTalk menyerahkan
`.ffseg` raw (tanpa encode MP4); pose cycle berlanjut antar clip.
Rollback: `BROADCAST_MODE=segment`.

### 2.6 Redeploy VPS (backend + frontend)

```bash
ssh root@202.10.35.186 "/root/deploy.sh"
```

---

## 3. Deploy Backend & Frontend di VPS

### 3.1 Persiapan VPS

```bash
ssh root@<IP_VPS>
apt update && apt upgrade -y
apt install -y nodejs npm git ufw nginx certbot python3-certbot-nginx
```

### 3.2 Clone repository

```bash
cd /var/www
git clone <your-repo-url> app
cd /var/www/app
```

### 3.3 Backend setup

```bash
cd backend
npm install
npx prisma generate
npm run build
cd ..
```

### 3.4 Frontend setup

```bash
cd frontend
npm install
npm run build
cd ..
```

### 3.5 PM2

```bash
pm2 start backend/dist/server.js --name api
pm2 start frontend/npm --name frontend -- start
pm2 save
pm2 startup
```

### 3.6 Nginx

Buat `/etc/nginx/sites-available/app`:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    client_max_body_size 20M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
}
```

```bash
ln -s /etc/nginx/sites-available/app /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### 3.7 SSL

```bash
certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

### 3.8 Restart setelah ubah .env

Di `.env` backend VPS:

```bash
# Off = tidak LLM tiap clip/komentar (default jika tidak di-set)
LIVE_BRAIN_DURING_LIVE=0

# On = jika bank hampir habis, LLM isi ulang (throttled). Set 0 untuk lokal-only.
LIVE_BRAIN_REFILL_WHEN_LOW=1

# Provider: auto | groq | gemini  (ollama/vllm sudah dihapus)
LIVE_BRAIN_PROVIDER=auto
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-20b
GEMINI_API_KEY=...
```

Stack LLM: **Groq primary** (`openai/gpt-oss-20b`, fallback `openai/gpt-oss-120b`) + **Gemini cadangan**. Tidak perlu LLM ketiga selama Gemini key tersedia.

```bash
pm2 restart api
pm2 restart frontend
pm2 save
```

### 3.9 Verifikasi

```bash
curl -s https://yourdomain.com/api/health
pm2 logs api --lines 50
pm2 logs frontend --lines 50
```

---

## 4. Health Check

### 4.1 Backend (VPS)

```bash
curl -s http://localhost:4000/health
```

### 4.2 AI Worker (RunPod)

```bash
curl -s http://localhost:8000/health
```

---

## 5. Monitoring Log RunPod

### 5.1 API Worker

```bash
tail -f /workspace/ai_live_worker/api_server.log
```

### 5.2 Broadcaster RTMP

```bash
tail -f /workspace/ai_live_worker/output/broadcaster.log
```

### 5.3 FFmpeg stream

```bash
tail -f /workspace/ai_live_worker/logs/master_ffmpeg.log
```

### 5.4 Semua log

```bash
tail -f /workspace/ai_live_worker/api_server.log /workspace/ai_live_worker/output/broadcaster.log
```

### 5.5 Snapshot 50 baris

```bash
tail -n 50 /workspace/ai_live_worker/api_server.log
tail -n 50 /workspace/ai_live_worker/output/broadcaster.log
```

### 5.6 Log via HTTP

```bash
curl -s http://localhost:8000/logs
```

---

## 6. Storage Cleanup RunPod

### 6.1 Temp files

```bash
rm -rf /workspace/ai_live_worker/temp/*
```

### 6.2 Video segmen lama

```bash
find /workspace/ai_live_worker/output -name "task_*.mp4" -delete 2>/dev/null || true
find /workspace/ai_live_worker/output -name "temp_*.mp4" -delete 2>/dev/null || true
find /workspace/ai_live_worker/output -name "*.tmp" -delete 2>/dev/null || true
```

### 6.3 Kosongkan log

```bash
> /workspace/ai_live_worker/api_server.log 2>/dev/null || true
> /workspace/ai_live_worker/broadcaster.log 2>/dev/null || true
> /workspace/ai_live_worker/logs/master_ffmpeg.log 2>/dev/null || true
```

### 6.4 Cache pip

```bash
rm -rf /workspace/tmp/pip_cache /workspace/tmp/* 2>/dev/null || true
```

### 6.5 Jangan hapus

- `/workspace/ai_live_worker/env`
- `/workspace/ai_live_worker/MuseTalk/models`
- `/workspace/ai_live_worker/assets`
