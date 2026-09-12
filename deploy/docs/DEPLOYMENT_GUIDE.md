# Deployment Guide

- Worker GPU (pod): bagian 1
- FE + BE produksi lewat Cursor Remote-SSH: bagian 2
- Setup VPS pertama kali: bagian 3

## 1. Setup worker pertama kali (di dalam pod)

Butuh `HF_TOKEN` (Hugging Face) untuk model MuseTalk.

### Setup awal lengkap

```bash
apt-get update
apt-get install -y git curl ffmpeg ca-certificates

cd /workspace
git clone https://github.com/ramadifa13/live-streaming-ai.git live-streaming-ai
cd /workspace/live-streaming-ai/deploy
export HF_TOKEN="<your-token>"
bash setup.sh
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

## 2. FE + BE di VPS lewat Cursor / VS Code Remote-SSH

Produksi: **https://livio.id** di VPS `root@202.10.35.186`, app di `/var/www/app`.
PM2: proses `api` (backend `:4000`) dan `frontend` (Next.js `:3000`). Nginx
meneruskan `/` ke frontend dan `/api/` ke backend.

Kode aplikasi diubah di laptop, di-push ke GitHub, lalu di-pull di VPS.
File `.env` **hanya hidup di VPS** — jangan di-commit.

### 2.1 Sambungkan Cursor ke VPS

1. Install extension **Remote - SSH**
   (`anysphere.remote-ssh` di Cursor, atau `ms-vscode-remote.remote-ssh` di VS Code).
2. Tambah host di SSH config laptop.

Windows: `C:\Users\<user>\.ssh\config`  
macOS / Linux: `~/.ssh/config`

```
Host livio-vps
  HostName 202.10.35.186
  User root
  IdentityFile ~/.ssh/id_ed25519
```

Kalau login masih password, hapus baris `IdentityFile` dulu. Setelah masuk, tempel
kunci publik laptop ke `/root/.ssh/authorized_keys` di VPS supaya connect berikutnya
tidak minta password.

3. Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) → **Remote-SSH: Connect to Host…**
   → pilih `livio-vps`.
4. Setelah window Remote terbuka: **File → Open Folder…** → `/var/www/app`.
5. Buka terminal di window itu (**Terminal → New Terminal**). Itu shell VPS,
   bukan laptop. Prompt biasanya `root@…:/var/www/app`.

Jangan buka workspace laptop dan VPS di tab yang sama lalu menyimpan file silang.
Satu window = satu mesin.

### 2.2 Peta folder di VPS

| Path | Isi |
| --- | --- |
| `/var/www/app` | checkout git (`main`) |
| `/var/www/app/backend` | API Fastify, Prisma, Pocket TTS |
| `/var/www/app/backend/.env` | secret backend (tidak di git) |
| `/var/www/app/backend/dist` | hasil `npm run build` yang dijalankan PM2 |
| `/var/www/app/frontend` | Next.js |
| `/var/www/app/frontend/.env` | `NEXT_PUBLIC_*` (terbakar saat build) |
| `/var/www/app/deploy/vps-deploy.sh` | script redeploy FE+BE |

### 2.3 Redeploy FE + BE (setelah kode di-push)

Di laptop: commit + `git push origin main`.

Di terminal Remote-SSH: ssh root@202.10.35.186

```bash
cd /var/www/app
git status
git pull origin main
bash deploy/vps-deploy.sh --on-vps --skip-pull
```

`--skip-pull` dipakai karena `git pull` sudah dijalankan di atas. Tanpa itu,
script ikut pull lagi (aman jika working tree bersih).

Script itu: install dependency, `prisma generate` + `migrate deploy`, build
backend, pastikan venv Pocket TTS, build frontend, lalu

```bash
pm2 restart api --update-env
pm2 restart frontend --update-env
pm2 save
```

Opsi lain:

```bash
# pull + build + restart (satu perintah, dari dalam /var/www/app)
bash deploy/vps-deploy.sh --on-vps

# hapus node_modules / dist / .next lalu npm ci (setelah ganti library besar)
bash deploy/vps-deploy.sh --on-vps --clean-deps

# rebuild venv Pocket TTS (requirements.txt berubah / TTS rusak)
bash deploy/vps-deploy.sh --on-vps --refresh-tts
```

`git pull` gagal karena ada file lokal di VPS? Jangan `reset --hard` sebelum
memastikan `.env` tidak terhapus (`.env` biasanya untracked). Stash hanya file
tracked, atau copy `.env` dulu.

```bash
cp backend/.env /root/backend.env.bak
cp frontend/.env /root/frontend.env.bak
```

Jangan `npm install <paket>` hanya di VPS. Tambah dependency di laptop, commit
`package.json` + lockfile, lalu redeploy.

### 2.4 Redeploy cepat (tanpa script)

Hanya perubahan TypeScript/Python yang sudah ter-pull:

```bash
cd /var/www/app
git pull origin main

cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build

cd ../frontend
npm ci
npm run build

pm2 restart api --update-env
pm2 restart frontend --update-env
pm2 save
```

Hanya backend:

```bash
cd /var/www/app && git pull origin main
cd backend && npm ci && npx prisma generate && npx prisma migrate deploy && npm run build
pm2 restart api --update-env
```

Hanya frontend:

```bash
cd /var/www/app && git pull origin main
cd frontend && npm ci && npm run build
pm2 restart frontend --update-env
```

Pocket TTS (`backend/pocket_tts/*.py`) ikut proses `api`. Restart `api` mematikan
dan menyalakan ulang worker Python. Tanpa restart, file `.py` baru tidak kepakai.

### 2.5 Ubah `.env` backend

Di window Remote-SSH buka `/var/www/app/backend/.env` dari sidebar Cursor, edit,
simpan. Jangan `git add` file ini.

Key yang sering disentuh:

| Key | Fungsi |
| --- | --- |
| `BACKEND_PUBLIC_URL` | URL publik API, harus `https://livio.id` |
| `CORS_ORIGIN` | origin frontend, biasanya `https://livio.id` |
| `RUNPOD_POD_ID` | id pod worker GPU |
| `RUNPOD_WORKER_URL` | `https://<POD_ID>-8000.proxy.runpod.net` (bukan localhost) |
| `RUNPOD_API_KEY` | token RunPod |
| `POCKET_TTS_EOS_THRESHOLD` | ambang EOS TTS |
| `POCKET_TTS_FRAMES_AFTER_EOS` | sisa frame setelah EOS (contoh `8`) |
| `POCKET_TTS_AUDIO_FILTER` | `1` = high-pass hum vocoder |

Terapkan perubahan:

```bash
pm2 restart api --update-env
pm2 save
pm2 logs api --lines 40
curl -s http://127.0.0.1:4000/health
```

`--update-env` memaksa PM2 membaca ulang environment proses. Pocket TTS di-spawn
dari proses `api`, jadi restart `api` juga memuat ulang env TTS.

Kalau hanya ganti `.env` (tanpa kode baru) **tidak perlu** `npm run build`.

### 2.6 Ubah `.env` frontend

Buka `/var/www/app/frontend/.env`. Yang wajib di produksi:

```
NEXT_PUBLIC_BACKEND_URL=https://livio.id
NEXT_PUBLIC_APP_URL=https://livio.id
AVATAR_WORKER_URL=https://<POD_ID>-8000.proxy.runpod.net
```

`NEXT_PUBLIC_*` dibaca saat **build**, bukan saat `pm2 restart`. Setelah simpan:

```bash
cd /var/www/app/frontend
npm run build
pm2 restart frontend --update-env
pm2 save
```

Restart tanpa build tidak mengubah nilai `NEXT_PUBLIC_*` yang sudah terbakar di
`.next`.

### 2.7 Kapan rebuild vs restart saja

| Yang diubah | Tindakan |
| --- | --- |
| `backend/.env` saja | `pm2 restart api --update-env` |
| `frontend/.env` (`NEXT_PUBLIC_*`) | `npm run build` di frontend + restart `frontend` |
| Kode backend / `pocket_tts/*.py` | `git pull` + `npm run build` di backend + restart `api` |
| Kode frontend | `git pull` + `npm run build` di frontend + restart `frontend` |
| `package.json` / lockfile / Prisma schema | `vps-deploy.sh --on-vps` (atau `--clean-deps`) |
| `pocket_tts/requirements.txt` | `vps-deploy.sh --on-vps --refresh-tts` |

### 2.8 Cek setelah deploy

```bash
pm2 ls
pm2 logs api --lines 50
pm2 logs frontend --lines 50
curl -s http://127.0.0.1:4000/health
curl -s https://livio.id/api/health
```

`api` dan `frontend` harus `online`. Kalau `errored`, `pm2 logs` proses itu.

---

## 3. Setup FE + BE di VPS (pertama kali)

Hanya untuk VPS baru. Harian pakai bagian 2.

```bash
ssh root@202.10.35.186
apt update && apt upgrade -y
apt install -y nodejs npm git ufw nginx certbot python3-certbot-nginx python3 python3-venv python3-pip ffmpeg
npm install -g pm2
pm2 delete api frontend 2>/dev/null || true
systemctl stop nginx 2>/dev/null || true
cd /var/www
git clone https://github.com/ramadifa13/live-streaming-ai.git app
```

```bash
cd /var/www/app/backend
# salin dari laptop / isi manual — file ini tidak ada di git
nano .env
npm install
npx prisma generate
npx prisma migrate deploy
npm run build

cd /var/www/app/backend/pocket_tts
python3 -m venv env
env/bin/python -m pip install --upgrade pip
env/bin/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
env/bin/python -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu

cd /var/www/app/frontend
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

`BACKEND_PUBLIC_URL` harus URL publik (HTTPS) yang sama dengan Nginx `/api`.
`RUNPOD_WORKER_URL` harus URL proxy RunPod, bukan `http://localhost:8000`.

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

```bash
pm2 delete api frontend 2>/dev/null || true
pkill -f 'pocket_tts|piper_tts|supertonic|api_server.py' 2>/dev/null || true

cd /var/www/app
rm -rf backend/dist frontend/.next
rm -rf backend/node_modules frontend/node_modules
rm -rf backend/pocket_tts/env
```

Lalu jalankan lagi build di bagian 3, atau:

```bash
cd /var/www/app
bash deploy/vps-deploy.sh --on-vps --clean-deps --refresh-tts
```
