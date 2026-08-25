# 🚀 LiveStreamer AI - 24/7 Autonomous AI Live Streaming for E-Commerce

Platform siaran langsung (_Live Streaming_) otomatis berbasis Artificial Intelligence untuk TikTok LIVE, Shopee Live, dan Instagram Live. Dilengkapi dengan Avatar Presenter 2D/3D Photorealistic, Lipsync Real-time (MuseTalk), dan Otak Penjualan Cerdas (LLM + Edge-TTS).

---

## 🌟 Fitur Utama

- **🎭 Photorealistic AI Avatar Host (2D & 3D):** Avatar hidup dengan animasi napas dan gerakan _idle ping-pong_ yang mulus tanpa patah-patah.
- **⚡ Real-Time Lip-Sync Engine (MuseTalk v1.5):** Sinkronisasi bibir super cepat di GPU RunPod dengan _tensor coordinate caching_.
- **🧠 Sales AI Brain (Luna Engine):** Membaca komentar penonton, menyaring pertanyaan produk, dan memberikan respon persuasif khas host live Indonesia.
- **🛍️ Dynamic E-Commerce Overlay:** Menampilkan Banner Keranjang Kuning / Flash Sale, info diskon, harga coret, dan sisa stok secara _real-time_.
- **🚦 Smart Comment Queue:** Sistem antrean komentar cerdas untuk mencegah _overload_ GPU saat ribuan penonton membanjiri _chat_.
- **📡 Multi-Platform Broadcast:** Kompatibel dengan RTMP Ingest TikTok LIVE Studio, Shopee Live, YouTube Live, dan Instagram Live.

---

## 📁 Struktur Direktori

```
live-streaming-ai/
├── backend/          # Fastify Node.js API, Prisma DB, LLM Brain, RunPod Bridge
├── frontend/         # Next.js 14 React Dashboard, Canvas Live Studio, Media Assets
├── deploy/           # Skrip Worker GPU RunPod (MuseTalk, FastAPI, setup-safe.sh)
├── docs/             # Dokumentasi Arsitektur & Panduan Low-Latency
└── README.md         # Dokumentasi Utama Proyek
```

---

## 🚀 Panduan Memulai Cepat

### 1. Menjalankan Backend

```bash
cd backend
npm install
npm run dev
```

_Backend akan berjalan di `http://localhost:4000`._

### 2. Menjalankan Frontend

```bash
cd frontend
npm install
npm run dev
```

_Buka browser Anda di `http://localhost:3000`._

### 3. Menjalankan Worker AI di RunPod

Frontend dan backend tetap berjalan di komputer lokal. Hanya AI Worker MuseTalk dan Ollama yang berjalan di RunPod. Panduan lengkap, termasuk asset Namira, port, health check, dan test render tersedia di [deploy/DEPLOYMENT_GUIDE.md](deploy/DEPLOYMENT_GUIDE.md).

1. Buka instance Pod GPU RunPod Anda (RTX 4090 / 3090, Container Disk disarankan 30–50 GB).
2. Clone repo dan jalankan setup resmi dari folder `deploy` (bukan dari `/workspace/ai_live_worker`):
   ```bash
   cd /workspace
   git clone https://github.com/ramadifa13/live-streaming-ai.git
   cd live-streaming-ai/deploy
   bash setup-safe.sh
   bash start.sh
   ```
3. Salin Pod ID Anda dan masukkan ke file `backend/.env`:
   ```env
   RUNPOD_API_KEY=api_key_runpod_anda
   RUNPOD_POD_ID=your_pod_id_here
   ```

---

## 📄 Lisensi

Hak Cipta © 2026 LiveStreamer AI.
