# Deployment Guide: Realtime AI Live Streaming System

This guide covers deploying all components of the system: the Node.js Fastify Backend, Next.js Frontend, and the RunPod AI Worker (MuseTalk / LivePortrait).

## Environment Setup

### Backend Environment Setup
1. Duplicate `backend/.env.example` as `backend/.env`
2. Configure the following critical environment variables:
   - `GEMINI_API_KEY`: Required for LLM operations.
   - `DATABASE_URL`: Ensure a PostgreSQL database is reachable.
   - `RUNPOD_API_KEY` & `RUNPOD_NETWORK_VOLUME_ID`: Required for dynamic GPU pod allocation.
   - `AVATAR_PROVIDER`: Use `liveportrait` for the RunPod AI worker.
3. The backend manages the lifecycle of AI Workers on RunPod by dynamically creating and terminating Pods using the Network Volume ID specified.

### Frontend Environment Setup
1. Duplicate `frontend/.env.example` as `frontend/.env.local`
2. Map the environment variables to the backend port and worker proxy.
   - Local: `NEXT_PUBLIC_BACKEND_URL=http://localhost:4000`
   - Production (Vercel): `NEXT_PUBLIC_BACKEND_URL=<YOUR_BACKEND_RENDER_URL>`
   - `AVATAR_WORKER_URL`: The URL to the RunPod Proxy endpoint, usually formatted as `https://<pod_id>-8000.proxy.runpod.net`. This allows the frontend to retrieve realtime generated live portrait video streams directly from the worker.

---

### Contoh Prompt Generator (Kling AI / Luma)

**1. Aksi Biasa (namira_idle.mp4):**

> _A highly realistic, 4k resolution video of an Indonesian female presenter standing in front of a clean studio background. She is looking directly at the camera with a soft, friendly smile. She blinks naturally and subtly shifts her weight, but her mouth is completely closed and motionless. No talking._

**2. Aksi Melambai / Menyapa (namira_raise_hand.mp4):**

> _A highly realistic, 4k resolution video of an Indonesian female presenter standing in a studio. She smiles warmly, raises her right hand, and waves enthusiastically at the camera as if greeting someone. Her mouth is completely closed and motionless. No talking._

**3. Aksi Menunjuk Bawah (namira_point_down.mp4):**

> _A highly realistic, 4k resolution video of an Indonesian female presenter in a studio. She looks directly at the camera, smiles, and uses her right index finger to point downwards toward the bottom of the screen (indicating a shopping cart). Her mouth is completely closed and motionless. No talking._

**4. Aksi Antusias (namira_excited.mp4):**

> _A highly realistic, 4k resolution video of an Indonesian female presenter in a studio. She opens her eyes wide in excitement, raises both hands slightly in joy, and nods enthusiastically. Her mouth is completely closed and motionless. No talking._

Setelah video-video tersebut di-generate, ganti namanya sesuai tag (contoh: `namira_idle.mp4`, `namira_raise_hand.mp4`, `namira_point_down.mp4`, `namira_excited.mp4`) dan masukkan ke folder `assets/3d/` (atau `assets/2d/`) di RunPod Anda.

## Langkah 1: Persiapan Network Volume RunPod

Untuk menjaga environment dan weights/model (MuseTalk, Chatterbox-TTS-Indonesian) agar tidak ter-reset, siapkan Network Volume:

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
6. Setup script `setup-safe.sh` bersifat _Idempotent_. Jika `env` dan `models` sudah terunduh pada Network Volume, script ini akan langsung _skip_ sehingga setup memakan waktu kurang dari 45 detik.
7. `setup-safe.sh` juga otomatis membuat **virtualenv terpisah** untuk `chatterbox_service` (lihat Langkah 4a) — ini WAJIB terpisah dari env utama karena `chatterbox-tts` butuh `transformers==5.2.0` yang bentrok dengan pin MuseTalk (`4.38.2`).
8. Isi sample suara untuk voice cloning di `deploy/assets/voice_refs/` (di-upload manual ke Network Volume, TIDAK ikut ter-generate otomatis):
   ```
   assets/voice_refs/{avatar}_{tone}.wav   contoh: namira_fomo.wav, namira_professional.wav, namira_energetik.wav
   assets/voice_refs/{avatar}_default.wav  fallback per-avatar
   assets/voice_refs/default.wav           fallback terakhir (sudah ada placeholder)
   ```
   Sample idealnya 10-20 detik, suara bersih 1 orang, tanpa musik/noise, direkam dalam gaya bicara (tone) yang sesuai nama filenya.

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
3. Isi file template preview suara pre-live (tidak butuh TTS/GPU sama sekali) di `frontend/public/voice-templates/`:
   ```
   {avatar}_{tone}.mp3   contoh: namira_fomo.mp3, namira_professional.mp3, namira_energetik.mp3
   {avatar}_default.mp3  fallback per-avatar
   default.mp3           fallback terakhir
   ```

## Langkah 4: Menjalankan AI Worker (Fase Live)

Saat Anda masuk mode Live Broadcast di dashboard, backend akan mem-ping Worker API. Pastikan Pod menyala dan Worker API telah berjalan (ini otomatis jika diset sebagai entrypoint, namun untuk manual):

```bash
cd /workspace/live-streaming-ai/deploy
bash start.sh
```

- Worker API akan berjalan di Port `8000`.
- Microservice **Chatterbox-TTS-Indonesian** berjalan terpisah di Port `8090` (venv sendiri: `chatterbox_service/env-chatterbox`), otomatis ikut start bersama `start.sh` jika venv-nya sudah dibuat.
- Worker memiliki fitur **Pre-Cache Idle Video**. Worker akan meload dan mengeksekusi face bounding-box dari video idle sehingga tak perlu direkalkulasi setiap kali ada balasan komentar.
- Worker menggunakan Chunking Buffer untuk merespon AI secara lebih instan (<1.5s latency).

### Langkah 4a: Setup Manual Chatterbox-TTS-Indonesian (jika belum otomatis)

```bash
cd /workspace/live-streaming-ai/deploy/chatterbox_service
python -m venv env-chatterbox
source env-chatterbox/bin/activate
pip install -r requirements-chatterbox.txt
deactivate
```

Model finetune Bahasa Indonesia (`grandhigh/Chatterbox-TTS-Indonesian`) di-download otomatis dari Hugging Face saat request pertama masuk (lazy load).

## 5. Simulasi Testing Integrasi Backend - Worker

Saat dashboard mengirimkan _Utterance_ / Pertanyaan dari penonton:

1. Backend merespon menggunakan `GEMINI_API_KEY` untuk menyusun RAG sales pitch.
2. Backend mengirim teks respons + tone ke `[Worker_IP]:8000/stream/live-utterance` (TIDAK mengirim audio — TTS sepenuhnya di worker).
3. Worker meneruskan teks ke microservice **Chatterbox-TTS-Indonesian** (Port `8090`) yang melakukan voice cloning dari sample di `assets/voice_refs/{avatar}_{tone}.wav`.
4. Audio hasil cloning dikirim langsung ke MuseTalk Inpainting untuk disync dengan video idle yang telah ter-cache.
5. Worker RTMP Streamer (FFmpeg) memutar hasil stream tersebut ke server RTMP live (TikTok/YT). Saat AI tidak sedang bicara, RTMP Streamer otomatis me-loop video Idle.
