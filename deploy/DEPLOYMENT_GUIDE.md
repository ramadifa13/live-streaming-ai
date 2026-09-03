# Deployment Guide

## Setup Network Volume RunPod

```
RunPod Console → Storage → Network Volume → Create
Pod → Edit → Network Volume → Mount Path: /workspace
```

## Setup Piper TTS

```
Otomatis di akhir bash setup.sh (setelah MuseTalk OK).
Manual ulang: FORCE_PIPER=1 bash deploy/piper_tts/setup.sh
Skip: SKIP_PIPER_SETUP=1 bash setup.sh
```

## Cek Log Piper

```bash
tail -f /workspace/piper_tts/logs/piper.log
```

## Setup Worker Pertama Kali

```bash
cd /workspace
git clone https://github.com/ramadifa13/live-streaming-ai.git live-streaming-ai
cd /workspace/live-streaming-ai/deploy
export HF_TOKEN="---key---"
bash setup.sh
cp -n .env.example /workspace/ai_live_worker/.env
FORCE_ASSETS=1 bash sync.sh --restart
curl -s http://localhost:8000/health
curl -s http://localhost:8000/tts/health
```

## Deploy Worker

```bash
cd /workspace/live-streaming-ai
git pull origin main
bash deploy/sync.sh --pull --restart
curl -s http://localhost:8000/health
```

## Redeploy Worker

```bash
bash /workspace/live-streaming-ai/deploy/sync.sh --pull --restart
```

```bash
FORCE_ASSETS=1 bash /workspace/live-streaming-ai/deploy/sync.sh --pull --restart
```

```bash
FORCE_GIT_RESET=1 bash /workspace/live-streaming-ai/deploy/sync.sh --pull --restart
```

```bash
nohup bash /workspace/live-streaming-ai/deploy/sync.sh --pull --restart > /workspace/ai_live_worker/redeploy.log 2>&1 &
```

## Edit Env Worker

```bash
apt install nano -y
nano /workspace/ai_live_worker/.env
bash /workspace/live-streaming-ai/deploy/sync.sh --restart
```

## Cek Log Worker

```bash
tail -f /workspace/ai_live_worker/api_server.log
tail -f /workspace/ai_live_worker/output/broadcaster.log
tail -f /workspace/ai_live_worker/logs/master_ffmpeg.log
tail -f /workspace/ai_live_worker/api_server.log /workspace/ai_live_worker/output/broadcaster.log
```

```bash
tail -f /workspace/ai_live_worker/output/broadcaster.log
```

```bash
tail -f /workspace/ai_live_worker/logs/master_ffmpeg.log
```

```bash
tail -f /workspace/ai_live_worker/api_server.log /workspace/ai_live_worker/output/broadcaster.log
```

```bash
tail -n 50 /workspace/ai_live_worker/api_server.log
```

```bash
curl -s http://localhost:8000/logs
```

```bash
curl -s http://localhost:8000/health
```

## Setup FE BE VPS Pertama Kali

```bash
ssh root@202.10.35.186
apt update && apt upgrade -y
apt install -y nodejs npm git ufw nginx certbot python3-certbot-nginx
cd /var/www
git clone https://github.com/ramadifa13/live-streaming-ai.git app
cd /var/www/app/backend
cp -n .env.example .env
nano .env
npm install
npx prisma generate
npm run build
cd /var/www/app/frontend
cp -n .env.example .env
nano .env
npm install
npm run build
pm2 start /var/www/app/backend/dist/server.js --name api
pm2 start /var/www/app/frontend/npm --name frontend -- start
pm2 save
pm2 startup
```

```nginx
server {
    listen 80;
    server_name livio.id www.livio.id;
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
        proxy_connect_timeout 30s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }
}
```

```bash
ln -sf /etc/nginx/sites-available/app /etc/nginx/sites-enabled/app
nginx -t
systemctl reload nginx
certbot --nginx -d livio.id -d www.livio.id
```

## Deploy FE BE

```bash
scp deploy.sh root@202.10.35.186:/root/deploy.sh
ssh root@202.10.35.186 "bash /root/deploy.sh"
```

## Redeploy FE BE

```bash
ssh root@202.10.35.186 "bash /root/deploy.sh"
```

```bash
ssh root@202.10.35.186
cd /var/www/app
git pull origin main
cd backend && npm install && npx prisma generate && npm run build
cd ../frontend && npm install && npm run build
pm2 restart api --update-env
pm2 restart frontend --update-env
pm2 save
```

## Edit Env FE BE

```bash
ssh root@202.10.35.186
nano /var/www/app/backend/.env
nano /var/www/app/frontend/.env
pm2 restart api --update-env
pm2 restart frontend --update-env
pm2 save
```

## Cek Log FE BE

```bash
ssh root@202.10.35.186 "pm2 logs api --lines 50"
```

```bash
ssh root@202.10.35.186 "pm2 logs frontend --lines 50"
```

```bash
ssh root@202.10.35.186 "pm2 logs --lines 100"
```

```bash
ssh root@202.10.35.186 "curl -s http://localhost:4000/health"
```

```bash
curl -s https://livio.id/api/health
```

## Cleanup Worker Storage

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
