# Panduan Lengkap Deployment & Arsitektur: LiveStreamer AI

Panduan operasional, konfigurasi multi-tier, dan deployment produksi platform **LiveStreamer AI** untuk UMKM dan agensi live streaming.

---

## 1. Arsitektur Sistem Multi-Tier

```mermaid
flowchart TD
    subgraph ClientTier [1. Client / UMKM Dashboard]
        FE[Next.js 16 App Router\nInteractive Wizard & Analytics]
    end

    subgraph BackendTier [2. Backend & Intelligence Engine]
        BE[Node.js Fastify Server]
        DB[(PostgreSQL Database\nNeon / Supabase)]
        Gemini[Google Gemini 3.6 Flash\nRAG Sales & Chat Engine]
        TTS[Edge-TTS + Persona Modulator\nPre-buffered Audio Buffer]
        Orchestrator[RunPod Lifecycle Manager\nGrace Period Cooldown]
    end

    subgraph WorkerTier [3. AI Worker GPU Tier (RunPod)]
        WorkerAPI[FastAPI Port 8000\nTTL Job Store & Memory Guard]
        MuseTalk[MuseTalk v1.5 UNet FP16\nPre-Cached Video Landmarks]
        Chatterbox[Chatterbox-TTS Microservice\nIndonesian Voice Cloning (Port 8090)]
        Broadcaster[FFmpeg RTMP Broadcaster\nDirect Stream Engine]
    end

    subgraph PlatformTier [4. Target Live Platforms]
        TikTok[♪ TikTok LIVE]
        Shopee[🛍️ Shopee Live]
        YouTube[▶ YouTube Live]
        Instagram[📸 Instagram Live]
        Custom[🔗 Custom RTMP]
    end

    FE <-->|REST API / SSE| BE
    BE <--> DB
    BE <--> Gemini
    BE --> TTS
    BE <-->|Auto-Provisioning / GraphQL| Orchestrator
    Orchestrator <-->|On-Demand Pod Management| WorkerAPI
    TTS -->|Audio Base64 Pre-buffered| WorkerAPI
    WorkerAPI <--> MuseTalk
    WorkerAPI <--> Chatterbox
    MuseTalk --> Broadcaster
    Broadcaster --> PlatformTier
```

---

## 2. Matriks Paket Durasi, Harga & Hak Akses Otomatisasi

| Paket             |   Durasi   |     Harga     | Auto-Reply Chat | Auto-Pin Produk | Auto-Promo Diskon | Auto-Moderasi AI | Target Penggunaan                             |
| :---------------- | :--------: | :-----------: | :-------------: | :-------------: | :---------------: | :--------------: | :-------------------------------------------- |
| **Demo Live**     | **1 Jam**  | **Rp49.000**  |    ✅ Aktif     |  🔒 _Terkunci_  |   🔒 _Terkunci_   |  🔒 _Terkunci_   | Uji coba fitur & presentasi ke klien UMKM.    |
| **Express Live**  | **2 Jam**  | **Rp99.000**  |    ✅ Aktif     |    ✅ Aktif     |   🔒 _Terkunci_   |  🔒 _Terkunci_   | Sesi flash live singkat / prime time malam.   |
| **Shift Live**    | **8 Jam**  | **Rp299.000** |    ✅ Aktif     |    ✅ Aktif     |     ✅ Aktif      |     ✅ Aktif     | Siaran marathon 1 shift kerja (malam-pagi).   |
| **Marathon 24/7** | **24 Jam** | **Rp699.000** |    ✅ Aktif     |    ✅ Aktif     |     ✅ Aktif      |     ✅ Aktif     | Siaran 24 jam nonstop + rotasi katalog penuh. |

> [!NOTE]
> Seluruh pengaturan durasi, platform, dan sistem otomatisasi akan **terkunci otomatis (_disabled_) saat siaran langsung sedang berlangsung (`isLiveActive = true`)** demi menjaga kestabilan _pipeline_ video dan koneksi RTMP.

---

## 3. Matriks Environment Variables

### A. Backend (`backend/.env`)

| Variabel                   |   Wajib   | Contoh / Default                                                          | Keterangan                                                                        |
| :------------------------- | :-------: | :------------------------------------------------------------------------ | :-------------------------------------------------------------------------------- |
| `PORT`                     | Opsional  | `4000`                                                                    | Port listening HTTP backend.                                                      |
| `HOST`                     | Opsional  | `0.0.0.0`                                                                 | Bind host address.                                                                |
| `DATABASE_URL`             | **Wajib** | `postgresql://user:pass@ep-sample.neon.tech/livestreamai?sslmode=require` | Connection string PostgreSQL (Neon.tech / Supabase / Render).                     |
| `GROQ_API_KEY`             | **Wajib** | `gsk_YourGroqApiKeyHere`                                                  | API Key Groq untuk dynamic LLM & model discovery (https://console.groq.com/keys). |
| `GEMINI_API_KEY`           | Opsional  | `AIzaSyYourApiKeyHere`                                                    | API Key Google Gemini (opsional fallback).                                        |
| `AVATAR_PROVIDER`          | **Wajib** | `mock` (Local) / `liveportrait` (Prod GPU)                                | Provider avatar rendering.                                                        |
| `ALLOW_MEDIA_FALLBACK`     | Opsional  | `true`                                                                    | Mengizinkan video demo fallback saat GPU pod standby.                             |
| `RUNPOD_API_KEY`           | Opsional  | `rpa_YourRunPodApiKey`                                                    | API key akun RunPod untuk auto-start / stop pod.                                  |
| `RUNPOD_NETWORK_VOLUME_ID` | Opsional  | `vol-your-network-volume`                                                 | ID Network Volume RunPod tempat menyimpan bobot model AI.                         |
| `RUNPOD_POD_ID`            | Opsional  | `your-pod-id`                                                             | ID Pod GPU spesifik (jika menggunakan dedicated pod).                             |
| `RUNPOD_WORKER_URL`        | Opsional  | `http://localhost:8000`                                                   | URL langsung ke worker API.                                                       |
| `RUNPOD_IDLE_TIMEOUT_MS`   | Opsional  | `600000` (10 Menit)                                                       | Batas waktu idle GPU sebelum otomatis dimatikan.                                  |
| `POD_TERMINATE_DELAY_MS`   | Opsional  | `60000` (60 Detik)                                                        | **Grace Period Cooldown**: Jeda waktu sebelum Pod dimatikan saat sesi stop.       |
| `EDGE_TTS_VOICE`           | Opsional  | `id-ID-GadisNeural`                                                       | Default suara bahasa Indonesia Edge-TTS.                                          |

### B. Frontend (`frontend/.env.local`)

| Variabel                  |   Wajib   | Contoh / Default                                             | Keterangan                         |
| :------------------------ | :-------: | :----------------------------------------------------------- | :--------------------------------- |
| `NEXT_PUBLIC_BACKEND_URL` | **Wajib** | `http://localhost:4000` (Dev) / `https://api.yourdomain.com` | Endpoint REST & WebSocket Backend. |

### C. AI Worker (`deploy/.env`)

| Variabel                   |  Wajib   | Contoh / Default                              | Keterangan                                         |
| :------------------------- | :------: | :-------------------------------------------- | :------------------------------------------------- |
| `PORT`                     | Opsional | `8000`                                        | Port HTTP Worker FastAPI.                          |
| `CHATTERBOX_SERVICE_URL`   | Opsional | `http://127.0.0.1:8090`                       | URL Microservice Chatterbox TTS.                   |
| `CHATTERBOX_PORT`          | Opsional | `8090`                                        | Port Microservice Chatterbox.                      |
| `CHATTERBOX_DEVICE`        | Opsional | `cuda`                                        | Device PyTorch (`cuda` / `cpu`).                   |
| `VOICE_REF_DIR`            | Opsional | `/workspace/ai_live_worker/assets/voice_refs` | Folder sampel suara cloning WAV/MP3.               |
| `MUSETALK_BATCH_SIZE`      | Opsional | `8` (RTX 3090) / `16` (RTX 4090)              | Batch size inferensi UNet MuseTalk v1.5.           |
| `MUSETALK_WARMUP_ON_START` | Opsional | `0` (Lazy) / `1` (Eager)                      | Pre-load model saat container boot.                |
| `WORKER_REQUIRE_AUDIO`     | Opsional | `1`                                           | Wajib menerima pre-synthesized audio dari Backend. |

---

## 4. Langkah-Langkah Deployment

### Langkah 1: Setup RunPod GPU Worker (RTX 3090 / RTX 4090)

1. Buat **Network Volume** (20–30 GB) di region pilihan Anda pada dashboard RunPod.
2. Deploy GPU Pod dengan template **PyTorch (Python 3.10 & CUDA 11.8 / 12.1)** dan pasang Network Volume ke mount path `/workspace`.
3. Buka terminal Pod dan jalankan instalasi:
   ```bash
   cd /workspace
   git clone <URL_REPOSITORY_ANDA> live-streaming-ai
   cd /workspace/live-streaming-ai/deploy
   bash setup-safe.sh
   ```
4. Pastikan file referensi suara persona ada di `deploy/assets/voice_refs/`:
   - `namira_energetik.mp3`
   - `namira_fomo.mp3`
   - `namira_professional.mp3`
5. Jalankan service worker dan microservice TTS:
   ```bash
   bash start.sh
   ```

---

### Langkah 2: Deploy Backend di Render / VPS / Railway

1. Buat Web Service baru (Node.js runtime).
2. Konfigurasi direktori dan perintah:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install && npx prisma generate && npm run build`
   - **Start Command**: `npm start`
3. Masukkan Environment Variables sesuai `backend/.env.example`.
4. Inisialisasi skema tabel PostgreSQL:
   ```bash
   npx prisma db push
   ```

---

### Langkah 3: Deploy Frontend di Vercel

1. Hubungkan repository GitHub ke Vercel.
2. Konfigurasi:
   - **Root Directory**: `frontend`
   - **Framework Preset**: `Next.js`
3. Masukkan Environment Variable:
   - `NEXT_PUBLIC_BACKEND_URL`: `https://api-anda.onrender.com`
4. Klik **Deploy**.

---

## 5. Optimasi Latensi Rendah (< 1.2 – 1.5 Detik)

Untuk mencegah jeda hening (_awkward silence_) saat siaran langsung, 3 optimasi utama telah diimplementasikan:

1. **Pre-Cached Video Landmarks (`_precache_idle_videos`)**:
   - Deteksi landmark DWPose pada wajah avatar dilakukan sekali saat startup. Saat siaran live berjalan, koordinat wajah dibaca instan dari memori cache (`use_saved_coord=True`, `saved_coord=True`), menghemat **~800ms**.
2. **Precision FP16 & Batch Processing**:
   - UNet MuseTalk berjalan dengan presisi `use_float16=True` dan pembersihan VRAM otomatis `torch.cuda.empty_cache()` setelah setiap inferensi.
3. **Backend Audio Pre-Buffering**:
   - Backend memproses sintesis Edge-TTS lebih awal, menyesuaikan persona (`Energetic`, `FOMO`, `Professional`), lalu mengirimkan buffer mentah `audioBase64` ke worker. Worker hanya bertugas merender gerakan bibir, sehingga latensi total respons terpangkas menjadi **~1.2 detik**.

---

## 6. Solusi Pelaporan Metrik & RTMP Data

| Platform            | Metode Ingestion Data                                         | Metrik yang Didapatkan                                  |
| :------------------ | :------------------------------------------------------------ | :------------------------------------------------------ |
| **YouTube Live**    | Polling adaptif via YouTube Data API v3 (`liveChat/messages`) | Viewer realtime, live chat messages, super chat.        |
| **Instagram Live**  | Facebook Graph API (`/comments` & live status)                | Jumlah komentar audiens, status siaran langsung.        |
| **TikTok & Shopee** | Webhook Ingestion (`POST /api/live-session/webhook/events`)   | Event keranjang kuning, klik produk, jumlah orderan.    |
| **Custom RTMP**     | Telemetri FFmpeg Broadcaster                                  | Bitrate, FPS, dropped frames, estimasi ROI & biaya GPU. |

---

## 7. Health Check & Diagnostics

Jalankan perintah berikut untuk menguji kesiapan sistem:

```bash
# 1. Test Backend Health
curl -s http://localhost:4000/health
# Output: {"ok":true,"status":"healthy","timestamp":"..."}

# 2. Test AI Worker RunPod
curl -s http://localhost:8000/health
# Output: {"status":"ok","message":"AI Live Worker API is running","warmed_up":true,"batch_size":8,"active_jobs":0}

# 3. Test Chatterbox TTS Microservice
curl -s http://127.0.0.1:8090/health
# Output: {"status":"ok","model_loaded":true,"device":"cuda"}
```
