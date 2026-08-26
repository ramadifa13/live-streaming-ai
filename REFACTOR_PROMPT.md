# PROMPT REFACTOR CODEBASE: REALTIME AI LIVE STREAMING SYSTEM

Role: Senior AI Fullstack & Systems Infrastructure Engineer
Task: Refactor existing codebase for Low-Latency Realtime Streaming (<1.5s latency), Cost Efficiency (Fixed Cost < Rp50.000/month), and Zero-Manual Setup on RunPod GPU Cloud.

---

## 1. CORE OBJECTIVES & SYSTEM SPECIFICATIONS

1. **Zero-Setup Pod Booting (<45 seconds):** Seluruh environment Python, dependencies, dan model checkpoints harus dimuat dari RunPod Network Volume (`/workspace`). Hapus script yang melakukan instalasi `pip` atau download bobot model saat pod baru dibuat.
2. **Real-time Pipeline (<1.5s Latency):** Ganti arsitektur full-batch video generation dengan streaming chunking pipeline:
   `Token Stream LLM -> Sentence Buffer -> Fast TTS Chunk -> MuseTalk UNet Inpainting -> FFmpeg RTMP Output`.
3. **Upgrade Audio Engine:** Hapus ketergantungan `edge-tts` dan beralih ke **Kokoro TTS (82M)** agar audio lebih natural, ekspresif, dan berlisensi komersial bebas (Apache 2.0).
4. **Pemisahan Pipeline Biaya (Pre-Live vs Live):**
   - **Pre-Live (Web Preview & Ingestion RAG Produk):** Berjalan di CPU Serverless (Vercel/Render) menggunakan **Google Gemini Flash API (Free Tier)** untuk embedding/chat tanpa GPU.
   - **Live Stream (Siaran 24 Jam):** Berjalan di GPU Pod (FastAPI + MuseTalk + Kokoro + Ollama).

---

## 2. REFACTOR STEP-BY-STEP PER SERVICE

### A. AI WORKER REFACTOR (`FastAPI` + `MuseTalk` + `Kokoro TTS`)

1. **Pre-Cache Video Idle (One-Time Execution on Lifespan/Startup):**
   - Lakukan ekstraksi _bounding box_, _DWPose facial landmarks_, dan _VAE latents_ dari file video idle **hanya satu kali** saat worker pertama kali booting.
   - Simpan cache frame dan landmark di RAM/VRAM.
   - **Strict Rule:** Jangan pernah menjalankan face detection atau DWPose extraction secara berulang pada tiap komentar live stream.

2. **Realtime Chunking & Streaming Buffer:**
   - Tangkap token respons LLM dan buffer per potongan tanda baca (`,`, `.`, `!`, `?`, `\n`).
   - Setiap potongan kalimat (chunk) langsung dikirim ke Kokoro TTS untuk generate potongan audio dalam ~100–200ms.
   - Masukkan audio chunk ke MuseTalk UNet untuk inpainting area mulut pada frame video idle yang telah di-cache.

3. **Continuous RTMP Streamer (FFmpeg Subprocess Pipeline):**
   - Jalankan background task FFmpeg pipe ke output RTMP (YouTube/TikTok Live):
     - Saat antrean audio kosong: Putar frame video idle asli secara looping konstan.
     - Saat ada audio chunk: Masukkan frame hasil inpainting mulut MuseTalk secara tersinkronisasi.

4. **Integrasi Kokoro TTS di Worker:**
   - Hapus dependency `edge-tts`.
   - Setup inference Kokoro TTS:

     ```python
     from kokoro import KPipeline
     import soundfile as sf

     pipeline = KPipeline(lang_code='a')  # Kokoro 82M Pipeline
     # Jalankan pipeline streaming per chunk kalimat
     ```

---

### B. BACKEND & PRE-LIVE REFACTOR (`Fastify` + `TypeScript`)

1. **Offload RAG & Ingestion Produk:**
   - Refactor controller penambahan katalog produk klien agar menggunakan **Google Gemini Flash API (Free Tier)** untuk proses embedding dan query RAG.
   - Pastikan backend Fastify tidak memerlukan GPU untuk fitur input produk dan preview teks sebelum live.

2. **Audio Preview Endpoint:**
   - Sediakan endpoint preview suara ringan di backend (menggunakan Kokoro TTS mode CPU atau caching) untuk fitur "Test Suara" di web sebelum user mengaktifkan pod GPU.

---

### C. DEPLOYMENT & SHELL SCRIPTS REFACTOR

1. **Struktur Direktori Network Volume (`/workspace`):**
   - Pastikan path aplikasi merujuk ke direktori persisten:
     - `/workspace/env/` (Python Virtual Environment & packages)
     - `/workspace/models/` (Checkpoint MuseTalk, DWPose, VAE, Kokoro weights)
     - `/workspace/app/` (Worker source code)

2. **Refactor `start.sh` (Instant Production Entrypoint):**
   Perbarui script agar langsung mengaktifkan environment yang ada tanpa download ulang
3. Refactor setup-safe.sh (Idempotent / First-Run Only):

Tambahkan pengecekan: jika folder /workspace/env dan file bobot model sudah ada, script langsung melewati proses install/download (exit 0).

4. ACCEPTANCE CRITERIA
[ ] Pod GPU baru menyala dan endpoint status FastAPI menjadi healthy dalam waktu < 45 detik.

[ ] Latensi dari komentar penonton diterima sampai AI mulai berbicara di stream adalah < 1.5 detik.

[ ] Tidak ada dependency edge-tts yang tersisa di codebase.

[ ] VRAM usage saat live stream (MuseTalk + Kokoro + Ollama 7B) stabil di kisaran 12–16 GB VRAM pada kartu grafis 24GB.

Silakan periksa codebase, temukan file yang relevan, dan buat perubahan kodenya sekarang.

audit juga bagian frontend,backend, dan ai worker secara keseluruhan .