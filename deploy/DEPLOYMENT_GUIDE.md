### Setup RunPod GPU Worker (RTX 3090 / RTX 4090)
    ```bash
    cd /workspace
    git clone https://github.com/ramadifa13/live-streaming-ai.git live-streaming-ai
    cd /workspace/live-streaming-ai/deploy
    export HF_TOKEN="hf_YourHuggingFaceTokenHere"
    bash setup-safe.sh

    cd /workspace/ai_live_worker
    bash start.sh
    ```

### Deploy Backend & Frontend di VPS (Rumahweb)

 1. **Persiapan VPS**
    - Login via SSH: `ssh root@<IP_VPS>`
    - Update OS: `apt update && apt upgrade -y`
    - Install Node.js LTS, git, ufw, nginx, certbot:
      ```bash
      apt install -y nodejs npm git ufw nginx certbot python3-certbot-nginx
      ```

 2. **Clone repository**
    ```bash
    cd /var/www
    git clone <your-repo-url> app   
    cd /var/www/app
    ```

 3. **Backend setup**
    ```bash
    cd backend
    npm install
    npx prisma generate   # ensure Prisma client generated
    npm run build         # if you have a build step (e.g., tsc)
    cd ..
    ```

 4. **Frontend setup (Next.js)**
    ```bash
    cd frontend
    npm install
    npm run build         # produces .next/
    cd ..
    ```

 5. **Run both services with PM2**
    ```bash
    pm2 start backend/dist/server.js --name api   # adjust entry point if needed
    pm2 start frontend/npm --name frontend -- start   # assumes "start": "next start"
    pm2 save
    pm2 startup   # follow the printed command to enable PM2 on boot
    ```

 6. **Configure Nginx as reverse proxy**
    Create/edit `/etc/nginx/sites-available/app`:
    ```nginx
    server {
        listen 80;
        server_name yourdomain.com www.yourdomain.com;   # replace with your domain

        client_max_body_size 20M;   # adjust as needed

        # Frontend
        location / {
            proxy_pass http://localhost:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }

        # Backend API
        location /api/ {
            proxy_pass http://localhost:4000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }

        # SSL will be added by Certbot
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

 7. **Obtain SSL certificate (Let's Encrypt)**
    ```bash
    certbot --nginx -d yourdomain.com -d www.yourdomain.com
    # Follow prompts, choose redirect HTTP → HTTPS
    ```

 8. **Environment variables**
      ```bash
      pm2 restart api   # for backend .env changes
      pm2 restart frontend   # for frontend .env changes
      pm2 save
      ```

  9. **Redeploy script **
    ```bash
    ssh root@202.10.35.186 "/root/deploy.sh"
    ```

 10. **Verification**
      - Visit `https://yourdomain.com` – frontend should load.
      - Test API: `https://yourdomain.com/api/health` (or any endpoint).
      - Check logs if needed: `pm2 logs api`, `pm2 logs frontend`, `sudo tail -f /var/log/nginx/error.log`.


## 7. Health Check, Monitoring Log & Diagnostik di Pod

 ### A. Health Check Status Sistem

 Jalankan perintah berikut untuk menguji kesiapan sistem:

 ```bash
 # 1. Test Backend Health (Port 4000)
 curl -s http://localhost:4000/health
 # Output: {"ok":true,"status":"healthy","timestamp":"..."}

 # 2. Test AI Worker RunPod (Port 8000)
 curl -s http://localhost:8000/health
 # Output: {"status":"ok","message":"AI Live Worker API is running","warmed_up":true,"batch_size":16,"active_jobs":0}
 ```

 ---

 ### B. Cara Cek & Pantau Log di RunPod (Real-Time)

 Gunakan perintah di bawah ini dari terminal RunPod untuk memantau aktivitas sistem:

 #### 1. Pantau Log API Worker & Render MuseTalk (Live Tail)

 Melihat proses inferensi AI, pembuatan skrip, penerimaan audio, dan waktu render lipsync secara langsung:

 ```bash
 tail -f /workspace/ai_live_worker/api_server.log
 ```

 #### 2. Pantau Log Broadcaster & Transmisi RTMP (Live Tail)

 Melihat alur pemutaran video segmen, interupsi video idle, pembaruan overlay produk, dan status siaran live:

 ```bash
 tail -f /workspace/ai_live_worker/output/broadcaster.log
 ```

 #### 3. Pantau Log Master FFmpeg (Telemetri Stream)

 Melihat bitrate streaming, koneksi handshake RTMP, dan frame rate output ke server siaran (TikTok/Shopee/YouTube/Instagram):

 ```bash
 tail -f /workspace/ai_live_worker/logs/master_ffmpeg.log
 ```

 #### 4. Pantau Semua Log Sekaligus (All-in-One Split View)

 ```bash
 tail -f /workspace/ai_live_worker/api_server.log /workspace/ai_live_worker/output/broadcaster.log
 ```

 #### 5. Melihat 50 Baris Terakhir Saja (Snapshot Cepat)

 ```bash
 # 50 baris terakhir log API
 tail -n 50 /workspace/ai_live_worker/api_server.log

 # 50 baris terakhir log Broadcaster
 tail -n 50 /workspace/ai_live_worker/output/broadcaster.log
 ```

 #### 6. Cek Log via HTTP Endpoint (JSON API)

 Anda juga dapat mengecek log langsung via HTTP API tanpa membuka file log:

 ```bash
 curl -s http://localhost:8000/logs
 ```

 ---

 ## 8. Panduan Update Kode (Git Pull), Auto-Sync & Pembersihan Berkas di RunPod

 Saat ada pembaruan kode pada repository GitHub (perbaikan skrip worker, broadcaster, API, atau optimasi model), Anda **TIDAK PERLU mengunduh ulang model AI (3GB+) atau menjalankan setup dari awal**.

 Cukup jalankan langkah cepat di bawah ini langsung dari terminal RunPod:

 ### A. Redeploy Worker (Disarankan)

 Jalankan skrip redeploy di terminal RunPod — **menarik kode terbaru, menyalin semua file worker, menimpa assets gesture, lalu restart**:

 ```bash
 bash /workspace/live-streaming-ai/deploy/redeploy-worker.sh
 ```

 Background (daemon):

 ```bash
 nohup bash /workspace/live-streaming-ai/deploy/redeploy-worker.sh > /workspace/ai_live_worker/redeploy.log 2>&1 &
 ```

 **Yang disinkronkan otomatis:**

 | Sumber | Tujuan |
 |--------|--------|
 | `deploy/*.py` | `/workspace/ai_live_worker/` |
 | `deploy/*.sh` | `/workspace/ai_live_worker/` |
 | `deploy/inference.py` | `.../MuseTalk/scripts/inference.py` |
 | `deploy/preprocessing.py` | `.../MuseTalk/musetalk/utils/preprocessing.py` |
 | `deploy/assets/**` | `.../ai_live_worker/assets/` _(ditimpa)_ |
 | `MuseTalk/.../sfd_detector.py` | patch face detection (jika ada) |

 > [!TIP]
 > **Backend & Frontend tidak ikut ter-update** oleh skrip ini — orchestrator/TTS/brain jalan di VPS. Setelah redeploy RunPod, jalankan juga: `ssh root@202.10.35.186 "/root/deploy.sh"`

 ### A2. 1-Liner (alternatif, sama dengan skrip di atas)

 ```bash
 cd /workspace/live-streaming-ai && git pull origin main && FORCE_ASSETS=1 bash deploy/sync-worker.sh && cd /workspace/ai_live_worker && pkill -9 -f "api_server.py" 2>/dev/null || true && pkill -9 -f "broadcaster.py" 2>/dev/null || true && pkill -9 -f "live_worker.py" 2>/dev/null || true && bash start.sh
 ```

 ---

 ### B. Pembersihan Berkas Sampah yang Aman (Storage Cleanup)

 Untuk menjaga kapasitas Network Volume tetap lega tanpa risiko menghapus dependensi atau model AI:

 ```bash
 # 1. Bersihkan sisa temporary audio dan file .yaml konfigurasi sementara
 rm -rf /workspace/ai_live_worker/temp/*

 # 2. Bersihkan file video segmen lama di folder output (Aman: TIDAK menghapus namira_idle.mp4)
 find /workspace/ai_live_worker/output -name "task_*.mp4" -delete 2>/dev/null || true
 find /workspace/ai_live_worker/output -name "temp_*.mp4" -delete 2>/dev/null || true
 find /workspace/ai_live_worker/output -name "*.tmp" -delete 2>/dev/null || true

 # 3. Kosongkan log lama yang membesar tanpa menghapus filenya
 > /workspace/ai_live_worker/api_server.log 2>/dev/null || true
 > /workspace/ai_live_worker/broadcaster.log 2>/dev/null || true
 > /workspace/ai_live_worker/logs/master_ffmpeg.log 2>/dev/null || true

 # 4. Bersihkan cache build pip sementara (Aman: TIDAK menghapus virtual environment / package terinstall)
 rm -rf /workspace/tmp/pip_cache /workspace/tmp/* 2>/dev/null || true
 ```

 > [!CAUTION]
 > **DILARANG MENGHAPUS DIREKTORI BERIKUT:**
 >
 > - ❌ `rm -rf /workspace/ai_live_worker/env` _(Menghapus Virtual Environment Python & PyTorch)_
 > - ❌ `rm -rf /workspace/ai_live_worker/MuseTalk/models` _(Menghapus bobot model AI 3GB+)_
 > - ❌ `rm -rf /workspace/ai_live_worker/assets` _(Menghapus video & foto avatar)_

 ---

 ### C. Troubleshooting Update Git (Jika Terjadi Konflik File)

 Jika perintah `git pull` gagal karena ada perubahan berkas lokal di dalam Pod:

 ```bash
 FORCE_GIT_RESET=1 bash /workspace/live-streaming-ai/deploy/redeploy-worker.sh
 ```