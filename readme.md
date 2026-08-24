# 🚀 LiveStreamer AI - 24/7 Autonomous AI Live Streaming for E-Commerce

Platform siaran langsung (*Live Streaming*) otomatis berbasis Artificial Intelligence untuk TikTok LIVE, Shopee Live, dan Instagram Live. Dilengkapi dengan Avatar Presenter 2D/3D Photorealistic, Lipsync Real-time (MuseTalk), dan Otak Penjualan Cerdas (LLM + Edge-TTS).

---

## 🌟 Fitur Utama

- **🎭 Photorealistic AI Avatar Host (2D & 3D):** Avatar hidup dengan animasi napas dan gerakan *idle ping-pong* yang mulus tanpa patah-patah.
- **⚡ Real-Time Lip-Sync Engine (MuseTalk v1.5):** Sinkronisasi bibir super cepat di GPU RunPod dengan *tensor coordinate caching*.
- **🧠 Sales AI Brain (Luna Engine):** Membaca komentar penonton, menyaring pertanyaan produk, dan memberikan respon persuasif khas host live Indonesia.
- **🛍️ Dynamic E-Commerce Overlay:** Menampilkan Banner Keranjang Kuning / Flash Sale, info diskon, harga coret, dan sisa stok secara *real-time*.
- **🚦 Smart Comment Queue:** Sistem antrean komentar cerdas untuk mencegah *overload* GPU saat ribuan penonton membanjiri *chat*.
- **📡 Multi-Platform Broadcast:** Kompatibel dengan RTMP Ingest TikTok LIVE Studio, Shopee Live, YouTube Live, dan Instagram Live.

---

## 📁 Struktur Direktori

```
live-streaming-ai/
├── backend/          # Fastify Node.js API, Prisma DB, LLM Brain, RunPod Bridge
├── frontend/         # Next.js 14 React Dashboard, Canvas Live Studio, Media Assets
├── deploy/           # Skrip Worker GPU RunPod (MuseTalk, FastAPI, setup.sh)
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
*Backend akan berjalan di `http://localhost:4000`.*

### 2. Menjalankan Frontend
```bash
cd frontend
npm install
npm run dev
```
*Buka browser Anda di `http://localhost:3000`.*

### 3. Menjalankan Worker AI di RunPod
1. Buka instance Pod GPU RunPod Anda (RTX 4090 / 3090).
2. Jalankan perintah instalasi di terminal RunPod:
   ```bash
   bash setup.sh
   python api_server.py
   ```
3. Salin Pod ID Anda dan masukkan ke file `backend/.env`:
   ```env
   RUNPOD_POD_ID=your_pod_id_here
   ```

---

## 📄 Lisensi
Hak Cipta © 2026 LiveStreamer AI.
