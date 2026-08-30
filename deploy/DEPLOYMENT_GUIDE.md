
### Setup RunPod GPU Worker (RTX 3090 / RTX 4090)

1. Buat **Network Volume** (20–30 GB) di region pilihan Anda pada dashboard RunPod.
2. Deploy GPU Pod dengan template **PyTorch (Python 3.10 & CUDA 11.8)** dan pasang Network Volume ke mount path `/workspace`.
3. Buka terminal Pod dan jalankan instalasi awal (hanya dilakukan **sekali** saat pertama kali membuat Pod):
   ```bash
   cd /workspace
   git clone https://github.com/ramadifa13/live-streaming-ai.git live-streaming-ai
   cd /workspace/live-streaming-ai/deploy
   export HF_TOKEN="hf_YourHuggingFaceTokenHere"
   bash setup-safe.sh
   ```
4. Jalankan AI Worker:
   ```bash
   cd /workspace/ai_live_worker
   bash start.sh
   ```

---

### Deploy Backend di Render / VPS / Railway

1. Buat Web Service baru (Node.js runtime).
2. Konfigurasi direktori dan perintah:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install && npx prisma generate && npm run build`
   - **Start Command**: `npm start`
3. Masukkan Environment Variables sesuai `backend/.env`.
4. Inisialisasi skema tabel PostgreSQL:
   ```bash
   npx prisma db push
   ```

---

### Deploy Frontend di Vercel

1. Hubungkan repository GitHub ke Vercel.
2. Konfigurasi:
   - **Root Directory**: `frontend`
   - **Framework Preset**: `Next.js`
3. Masukkan Environment Variable:
   - `NEXT_PUBLIC_BACKEND_URL`: `https://api-anda.onrender.com`
4. Klik **Deploy**.

---

## 5. Optimasi Latensi Rendah & Zero-Idle Audio/Video

Untuk menghasilkan siaran langsung yang natural tanpa jeda canggung (_zero awkward silence_):

1. **Native 16kHz Audio Ingest (Zero FFmpeg Re-sampling Overhead)**:
   - Backend TTS langsung menghasilkan audio berformat `16000Hz 16-bit Mono PCM WAV`. Worker GPU MuseTalk langsung membaca stream audio tanpa perlu menjalankan proses _re-sampling_ FFmpeg tambahan, **menghemat 200–500ms per kalimat**.
2. **Pre-Cached Video Landmarks (`_precache_idle_videos`)**:
   - Deteksi landmark DWPose dan face parsing dilakukan saat startup. Saat siaran live berlangsung, koordinat wajah dibaca instan dari RAM cache (`Using saved coordinates`), menghemat **~800ms**.
3. **Precision FP16 & Dedicated GPU**:
   - UNet MuseTalk berjalan di VRAM GPU RTX 4090 dengan presisi `use_float16=True` (kecepatan render **~16.5 fps**, durasi render 4–6 detik untuk 20 detik video bicara).
4. **Zero-Idle Two-Stage Pipeline (Pre-Buffering V1 & V2)**:
   - Tombol **"GO! Konfirmasi Siaran"** di frontend otomatis aktif saat Video 1 & Video 2 selesai di-render di disk RunPod.
   - Saat tombol GO ditekan, broadcaster langsung menginterupsi video idle (< 50ms) dan memutar Video 1.
   - Saat Video 1 tayang, GPU secara otomatis merender Video 3, 4, dst., sehingga antrean video tidak pernah kosong.

---

## 6. Solusi Pelaporan Metrik & RTMP Data

| Platform            | Metode Ingestion Data                                         | Metrik yang Didapatkan                                  |
| :------------------ | :------------------------------------------------------------ | :------------------------------------------------------ |
| **YouTube Live**    | Polling adaptif via YouTube Data API v3 (`liveChat/messages`) | Viewer realtime, live chat messages, super chat.        |
| **Instagram Live**  | Facebook Graph API (`/comments` & live status)                | Jumlah komentar audiens, status siaran langsung.        |
| **TikTok & Shopee** | Webhook Ingestion (`POST /api/live-session/webhook/events`)   | Event keranjang kuning, klik produk, jumlah orderan.    |
| **Custom RTMP**     | Telemetri FFmpeg Broadcaster                                  | Bitrate, FPS, dropped frames, estimasi ROI & biaya GPU. |

---

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

### A. Perintah Cepat Update & Restart (1-Liner)

Jalankan **satu baris perintah** ini di terminal RunPod:

```bash
cd /workspace/live-streaming-ai && git pull origin main && cp -f deploy/*.py deploy/*.sh /workspace/ai_live_worker/ 2>/dev/null || true && cd /workspace/ai_live_worker && pkill -9 -f "api_server.py" 2>/dev/null || true && pkill -9 -f "broadcaster.py" 2>/dev/null || true && bash start.sh
```

Atau jika ingin menjalankan di **background (daemon)** agar tetap aktif meskipun terminal ditutup:

```bash
cd /workspace/live-streaming-ai && git pull origin main && cp -f deploy/*.py deploy/*.sh /workspace/ai_live_worker/ 2>/dev/null || true && cd /workspace/ai_live_worker && pkill -9 -f "api_server.py" 2>/dev/null || true && pkill -9 -f "broadcaster.py" 2>/dev/null || true && nohup bash start.sh > /workspace/ai_live_worker/start.log 2>&1 &
```

> [!TIP]
> **Cara Kerja Auto-Sync**: Perintah di atas akan menarik perubahan dari GitHub (`git pull`), menyinkronkan seluruh skrip deploy terbaru (`live_worker.py`, `broadcaster.py`, `api_server.py`, `inference.py`, `start.sh`) ke direktori worker, dan me-restart server dalam **< 1 detik**.
> Anda **tidak perlu meng-copy file satu per satu**, karena `start.sh` secara otomatis menyinkronkan seluruh file yang dibutuhkan ke folder MuseTalk.

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
cd /workspace/live-streaming-ai
# 1. Reset perubahan lokal dan paksa sinkronisasi dengan remote repository
git fetch --all
git reset --hard origin/main
# 2. Salin skrip terbaru
cp -f deploy/*.py deploy/*.sh /workspace/ai_live_worker/
# 3. Restart worker
cd /workspace/ai_live_worker && pkill -9 -f "api_server.py" 2>/dev/null || true && pkill -9 -f "broadcaster.py" 2>/dev/null || true && bash start.sh
```
