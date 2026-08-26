# Deployment Guide: Realtime AI Live Streaming System

Panduan ini berisi arsitektur dan langkah-langkah implementasi (refactor) sistem AI Live Streamer.
Sistem ini dirancang untuk:
1. **Low-latency Realtime Streaming (<1.5s)**: Stream video+audio secara real-time.
2. **Cost Efficiency**: Memanfaatkan layanan gratis saat masa inkubasi.
3. **Zero-Manual Setup di GPU Pod**: Sekali klik langsung siap live.

## Arsitektur Terbaru

Fase: Dashboard & Preview (Pre-Live)
- **Frontend**: Vercel (Free)
- **Backend**: Render (Free)
- **AI Brain & RAG**: Google Gemini Flash API (Free Tier)
- **Voice Preview**: Kokoro TTS JS (Vercel/Render CPU-mode)

Fase: Live Broadcast (24 Jam)
- **AI Worker (GPU)**: RunPod Network Volume, Serverless Endpoint (FastAPI)
- **TTS Realtime**: Kokoro TTS (82M)
- **Video Lipsync**: MuseTalk Realtime Inpainting
- **Live Output**: RTMP FFmpeg Subprocess (ke TikTok/YouTube Live)
- **Storage**: Persistent Volume RunPod (20GB) - Estimasi Rp 23.000 / bulan ($1.40).
- **Compute GPU**: RTX 3090/4090 ($0.35-$0.75/hour)


## Rincian Biaya (Cost Breakdown)

Sistem ini didesain untuk meminimalisir biaya dengan memanfaatkan free-tier di fase Pre-Live dan hanya membayar server GPU saat live stream benar-benar berjalan.

### 1. Komponen Gratis (Fase Pre-Live / Setup)
- **Frontend Hosting**: Vercel (Gratis).
- **Backend Hosting**: Render (Gratis).
- **AI Brain (LLM/RAG)**: Google Gemini Flash API (Gratis).
- **Voice Preview & Text to Speech**: Kokoro TTS (Gratis / Open Source).

### 2. Biaya Per Sesi Live (Live Broadcast 24 Jam)
- **Komputasi GPU (RunPod)**: Menggunakan instance NVIDIA RTX 3090 atau RTX 4090.
  - Estimasi: **$0.35 - $0.75 per jam** (sekitar Rp 5.500 - Rp 11.500 per jam).
  - Biaya ini dipotong dari saldo RunPod Anda **hanya saat pod menyala (running)**. Begitu live stream selesai dan pod dimatikan (beralih ke Stopped/Offline), Anda tidak lagi ditagihkan biaya per jam ini.

### 3. Biaya Tetap Bulanan (Monthly Fixed Costs)
Untuk menjalankan sistem secara utuh sebagai website, ada beberapa biaya tetap (subscription) bulanan/tahunan yang tidak bisa dihindari:

- **RunPod Persistent Storage (Network Volume)**:
  - Dibutuhkan 20GB hingga 30GB untuk menyimpan setup data, dependencies (`/env`), dan AI Models (Kokoro, MuseTalk) agar pod bisa boot dengan instan tanpa harus instalasi dari awal.
  - Estimasi Harga: **$1.40 per bulan** (sekitar Rp 23.000 / bulan).
- **Domain Website (Tahunan)**:
  - Untuk menggunakan custom domain (misalnya `namatokoanda.com` daripada URL vercel bawaan), Anda perlu membeli nama domain.
  - **Rekomendasi Penyedia Domain Murah (Sering Ada Diskon Promo)**:
    - **Porkbun**: Mulai dari $4 - $6 untuk tahun pertama pada domain `.com` atau domain ekstensi lainnya.
    - **Namecheap**: Mulai dari $1 - $6 untuk tahun pertama (terutama domain `.xyz`, `.site`, `.com`).
    - **Cloudflare Registrar**: Menawarkan harga dasar perpanjangan termurah di pasar (tanpa markup harga grosir, sekitar $9/tahun untuk `.com`).
    - **Niagahoster / Idwebhost (Lokal)**: Sering menyediakan diskon untuk domain lokal seperti `.id`, `.my.id` (mulai dari Rp 10.000/tahun untuk `.my.id`).

## Langkah 1: Persiapan Network Volume RunPod

Untuk menjaga environment dan weights/model (Kokoro, MuseTalk) agar tidak ter-reset, siapkan Network Volume:
1. Masuk ke dashboard RunPod > **Network Volumes** > **Create Network Volume**.
2. Alokasikan ukuran 20-30GB.
3. Centang region yang sama dengan ketersediaan GPU Anda (misalnya Eropa atau Amerika).
4. Volume Anda akan terhubung pada direktori `/workspace` pada GPU Pod yang akan Anda buat.

## Langkah 2: Setup Pod RTX 3090 / 4090

1. Deploy sebuah Pod baru di RunPod.
2. Pilih Template PyTorch (Python 3.10 & CUDA 11.8).
3. Sambungkan Network Volume yang sudah Anda buat pada langkah sebelumnya.
4. Buka terminal (Web Terminal / SSH).
5. Lakukan setup awal dan download environment (Ini hanya berjalan **Satu Kali**):
   ```bash
   cd /workspace
   git clone <URL_REPOSITORY_ANDA> live-streaming-ai
   cd /workspace/live-streaming-ai/deploy
   bash setup-safe.sh
   ```
6. Setup script `setup-safe.sh` bersifat *Idempotent*. Jika `env` dan `models` sudah terunduh pada Network Volume, script ini akan langsung _skip_ sehingga setup memakan waktu kurang dari 45 detik.

## Langkah 3: Deploy Frontend & Backend (Pre-Live & Dashboard)

### Backend (Render)
1. Deploy `backend` direktori menggunakan Node.js environment di Render.com (gratis).
2. Set Environment Variables di Render:
   - `GEMINI_API_KEY`: Kunci API Google Gemini (Free tier).
   - `RUNPOD_API_KEY`: API Key akun RunPod Anda.
   - `RUNPOD_POD_ID`: ID Pod Worker yang menyala.
3. Backend akan menangani RAG Produk (melalui Gemini API) tanpa memerlukan GPU.

### Frontend (Vercel)
1. Deploy `frontend` direktori menggunakan Next.js di Vercel (gratis).
2. Atur Environment Variable:
   - `NEXT_PUBLIC_BACKEND_URL`: Mengarah ke URL backend Render yang telah Anda buat.

## Langkah 4: Menjalankan AI Worker (Fase Live)

Saat Anda masuk mode Live Broadcast di dashboard, backend akan mem-ping Worker API. Pastikan Pod menyala dan Worker API telah berjalan (ini otomatis jika diset sebagai entrypoint, namun untuk manual):

```bash
cd /workspace/live-streaming-ai/deploy
bash start.sh
```

- Worker API akan berjalan di Port `8000`.
- Worker memiliki fitur **Pre-Cache Idle Video**. Worker akan meload dan mengeksekusi face bounding-box dari video idle sehingga tak perlu direkalkulasi setiap kali ada balasan komentar.
- Worker menggunakan Chunking Buffer untuk merespon AI secara lebih instan (<1.5s latency).

## 5. Simulasi Testing Integrasi Backend - Worker

Saat dashboard mengirimkan *Utterance* / Pertanyaan dari penonton:
1. Backend merespon menggunakan `GEMINI_API_KEY` untuk menyusun RAG sales pitch.
2. Backend mengirim teks respons ke `[Worker_IP]:8000/stream/live-utterance`.
3. Worker memecah teks per tanda baca, mengirimkannya ke *Kokoro TTS* untuk di-synthesize.
4. Audio Kokoro dikirim langsung ke MuseTalk Inpainting untuk disync dengan video idle yang telah ter-cache.
5. Worker RTMP Streamer (FFmpeg) memutar hasil stream tersebut ke server RTMP live (TikTok/YT). Saat AI tidak sedang bicara, RTMP Streamer otomatis me-loop video Idle.

