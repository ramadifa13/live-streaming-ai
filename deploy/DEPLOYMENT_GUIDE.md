# 🚀 LiveStreamerAI — Deployment Guide (Development / Local + RunPod)

Panduan ini ditujukan untuk masa *development*, di mana **Frontend dan Backend dijalankan secara lokal (di komputer/laptop Anda)**, dan **AI Worker (GPU) dijalankan di RunPod secara On-Demand** (hanya menyala otomatis saat digunakan untuk menghemat biaya).

---

## 🗺️ Arsitektur Sistem

```
Browser Klien (Lokal)
       │
       ▼
Frontend (Next.js :3000) ───► (Lokal)
       │
       ▼
Backend Fastify (:4000) ────► (Lokal)
       │
       │ API Call (Start/Stop Pod) & Proxy Video
       ▼
AI Worker SadTalker (:8000) ─► (Berjalan di RunPod GPU)
```

---

## LANGKAH 1 — Persiapan AI Worker di RunPod

1. Buka [runpod.io/console/pods](https://www.runpod.io/console/pods) → **+ Deploy Pod**
2. Pilih GPU: **NVIDIA RTX 4090** (24GB VRAM) atau **NVIDIA L4**
3. Template: **RunPod PyTorch 2.1 (CUDA 12.1)**
4. **Expose Ports** (Wajib):
   - `8000` → AI Worker SadTalker
5. Volume Disk: Minimal **30 GB**
6. Klik **Deploy On-Demand**

Buka **Terminal** di console RunPod / JupyterLab, lalu jalankan:

```bash
# 1. Masuk ke workspace & clone repository
cd /workspace
git clone <URL_REPOSITORY_ANDA> app
cd /workspace/app

# 2. Hapus folder frontend & backend agar tidak memenuhi disk RunPod (Opsional)
rm -rf frontend backend

# 3. Install SadTalker, Edge-TTS, & download model checkpoints (~600MB)
bash deploy/setup_runpod_sadtalker.sh

# 3. Install PM2 & Jalankan AI Worker
npm install -g pm2
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup
```

*(Di RunPod, sekarang PM2 HANYA menjalankan `ai-worker`)*

---

## LANGKAH 2 — Dapatkan Kredensial RunPod

Anda butuh dua hal dari RunPod untuk ditaruh di Backend lokal Anda:
1. **API Key:** Buat di [runpod.io/console/settings](https://www.runpod.io/console/settings)
2. **Pod ID:** ID unik dari Pod Anda (contoh: `kxg2abc123`). Bisa dilihat di halaman Pods.

---

## LANGKAH 3 — Setup Backend (Lokal)

Di komputer/laptop Anda:

```bash
cd backend
npm install
```

Copy file `.env.example` menjadi `.env`, lalu isi data RunPod:
```env
RUNPOD_API_KEY=KODE_API_KEY_ANDA_DISINI
RUNPOD_POD_ID=KODE_POD_ID_ANDA_DISINI
# Biarkan RUNPOD_WORKER_URL kosong agar URL otomatis di-generate backend
RUNPOD_WORKER_URL=
```

Jalankan Backend:
```bash
npm run dev
```

---

## LANGKAH 4 — Setup Frontend (Lokal)

Buka terminal baru di komputer/laptop Anda:

```bash
cd frontend
npm install
npm run dev
```

Buka browser dan akses **`http://localhost:3000`**.
Ketika Anda mengklik tombol untuk men-generate video atau memulai Live, Backend Anda di lokal akan otomatis memerintahkan RunPod untuk menyala (start) dan mematikan kembali GPU tersebut saat selesai!
