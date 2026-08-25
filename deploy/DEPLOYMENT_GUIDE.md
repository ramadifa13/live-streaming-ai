# 🚀 Panduan Lengkap Migrasi & Setup AI Worker RunPod (MuseTalk)

Panduan ini digunakan jika Anda membuat **Pod GPU RunPod baru** atau memigrasikan server worker.

---

## ⚡ Langkah Cepat (1-Click Migration)

Setiap kali Anda membuat Pod GPU baru di RunPod (Rekomendasi: **NVIDIA RTX 4090 / RTX 3090** dengan template **PyTorch 2.1**):

### 1. Buka Web Terminal RunPod dan Jalankan:
```bash
cd /workspace
git clone https://github.com/ramadifa13/live-streaming-ai.git
cd live-streaming-ai/deploy
bash setup.sh
```

*(Skrip `setup.sh` otomatis memasang seluruh dependensi Python yang sudah dikunci versinya, menginstal MMCV/MMPose, dan mengunduh model AI dari Hugging Face secara otomatis).*

---

### 2. Jalankan Worker AI
Setelah skrip setup selesai (muncul tulisan `SETUP SELESAI 100%!`), jalankan:
```bash
bash start.sh
# atau dari folder worker setelah setup:
# cd /workspace/ai_live_worker && bash start.sh
```
*Server FastAPI akan menyala di port 8000 dan siap menerima request dari backend.*

> **Penting:** `setup.sh` dan `start.sh` ada di folder `deploy/`. Jangan jalankan dari `/workspace/ai_live_worker` sebelum setup pertama selesai — folder itu baru diisi otomatis oleh `setup.sh`.

### Troubleshooting: No space left on device
Jika pip gagal dengan `Errno 28`:
```bash
pip cache purge
export PIP_NO_CACHE_DIR=1
cd /workspace/live-streaming-ai/deploy
bash setup.sh
```
Perbesar **Container Disk** RunPod ke minimal 30–50 GB jika masih penuh.

### Troubleshooting: repair cepat tanpa setup ulang
Jika worker error (CUDA mismatch, numpy, huggingface_hub, dwpose file not found):
```bash
cd /workspace/live-streaming-ai
git pull
bash deploy/repair-worker.sh
```
Skrip ini: symlink `./musetalk` + `./models`, pin deps Python, verifikasi model, restart API.

### Troubleshooting: dependency conflicts & MMCV build error
Pesan seperti ini **bukan error fatal** (hanya peringatan pip):
```text
ERROR: pip's dependency resolver does not currently take into account...
gradio ... pillow ... incompatible
tensorflow ... numpy ... incompatible
```

Error **fatal** yang menghentikan setup biasanya:
```text
ModuleNotFoundError: No module named 'pkg_resources'
ERROR: Failed to build 'mmcv'
```

Penyebab umum: template RunPod memakai **PyTorch 2.13** sementara worker ini ditest dengan **PyTorch 2.1 + CUDA 11.8**.

Solusi:
1. Gunakan template RunPod **PyTorch 2.1** (bukan 2.13), atau
2. Pull versi setup terbaru — skrip akan memasang ulang `torch==2.1.0+cu118` dan mmcv dari wheel prebuilt:
   ```bash
   cd /workspace/live-streaming-ai && git pull
   cd deploy && bash setup.sh
   ```

---

### 3. Sambungkan ke Backend Komputer Anda
1. Buka file `backend/.env` di komputer Anda.
2. Isi konfigurasi RunPod:
    ```env
    RUNPOD_API_KEY=api_key_runpod_anda
    RUNPOD_POD_ID=id_pod_baru_anda
    ```
3. Opsional: Isi `RUNPOD_WORKER_URL` jika menggunakan domain kustom, atau biarkan kosong agar backend otomatis menggunakan URL proxy RunPod:
    ```
    https://<RUNPOD_POD_ID>-8000.proxy.runpod.net
    ```
*(Simpan file `.env`, backend akan otomatis terhubung kembali!)*

---

## 📁 Struktur File & Aset di RunPod

Pastikan file video avatar dasar ditaruh di folder yang sesuai di server RunPod:
- **Host 2D:** `/workspace/ai_live_worker/assets/2d/host_2d_statis_nana.mp4`
- **Host 3D:** `/workspace/ai_live_worker/assets/3d/host_3d_dinamis_namira.mp4`

---

## 🔄 Lifecycle Otomatis (Backend)

Backend sekarang mengontrol lifecycle Pod RunPod secara penuh:

| Fitur | Deskripsi |
|-------|-----------|
| **Auto-Start** | Pod otomatis dijalankan saat ada job streaming atau preview |
| **Auto-Stop** | Pod otomatis dimatikan saat sesi live berakhir |
| **Idle Monitor** | Pod mati otomatis jika tidak ada aktivitas GPU selama `GPU_IDLE_TIMEOUT_MINUTES` (default: 30 menit) |
| **GPU Lease** | Setiap job (preview, komentar video) memperoleh lease GPU temporary |

Backend API endpoints untuk kontrol manual:
- `GET /api/runpod/status` — Cek status pod
- `POST /api/runpod/start` — Jalankan pod
- `POST /api/runpod/stop` — Matikan pod

---

## 📡 API Worker Endpoints

Setelah worker berjalan di RunPod, endpoint yang tersedia:

| Endpoint | Method | Deskripsi |
|----------|--------|-----------|
| `/` | GET | Health check |
| `/stream/live-utterance` | POST | Generate video avatar dari teks (async job) |
| `/stream/generate-neural-video` | POST | Alias untuk `/stream/live-utterance` |
| `/stream/status/{job_id}` | GET | Cek status job video |

Contoh request generate video:
```bash
curl -X POST "https://<POD_ID>-8000.proxy.runpod.net/stream/live-utterance" \
  -H "Content-Type: application/json" \
  -d '{
    "avatar_name": "host_3d_dinamis_namira",
    "text": "Halo selamat malam!",
    "voice": "id-ID-GadisNeural",
    "speed": 1.0
  }'
```

Response akan berisi `job_id`. Gunakan `/stream/status/{job_id}` untuk polling hingga status `"done"`.

---

## 🛠️ Konfigurasi Lanjutan

### Menjalankan dengan PM2
```bash
pm2 start deploy/ecosystem.config.js
```

### Menjalankan Broadcaster RTMP (Opsional)
Jika ingin worker langsung broadcast ke RTMP tanpa backend Node:
```bash
START_BROADCASTER=true RTMP_URL=rtmp://live.example.com/live STREAM_KEY=your_key bash start.sh
```

### Environment Variables di RunPod
| Variable | Wajib | Deskripsi |
|----------|-------|-----------|
| `RUNPOD_API_KEY` | Ya | API key untuk kontrol lifecycle pod |
| `RUNPOD_POD_ID` | Ya | ID Pod RunPod Anda |
| `RUNPOD_WORKER_URL` | Tidak | URL worker kustom (opsional) |
| `GPU_IDLE_TIMEOUT_MINUTES` | Tidak | Timeout idle sebelum auto-shutdown (default: 30) |
| `START_BROADCASTER` | Tidak | Set `true` untuk jalankan broadcaster Python |
| `RTMP_URL` | Ketika `START_BROADCASTER=true` | Base URL RTMP destination |
| `STREAM_KEY` | Ketika `START_BROADCASTER=true` | Stream key untuk RTMP |

---

## 🛠️ Daftar Versi Pustaka Kunci (Telah Diuji):
- `Python`: 3.10
- `PyTorch`: 2.1.0+cu118 / 2.1.2
- `NumPy`: 1.26.4
- `OpenCV`: 4.8.0.76
- `Transformers`: 4.38.2
- `Diffusers`: 0.27.2
- `Accelerate`: 0.28.0
- `Edge-TTS`: 6.1.9
