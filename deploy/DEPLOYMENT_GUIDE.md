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

*(Skrip `setup.sh` otomatis memasang seluruh dependensi Python yang sudah dikunci versinya, menginstal MMCV/MMPose, mengunduh model AI dari Hugging Face, dan menjalankan API server di port 8000).*

> **Catatan:** Setup pertama kali memakan waktu ~15-20 menit karena MMCV harus di-compile dari source. Pastikan sampai muncul `SETUP SELESAI 100%!` sebelum lanjut.

---

### 2. Upload Video Avatar (WAJIB)

Setelah setup selesai, upload file video avatar ke RunPod. Tanpa file ini, worker tidak bisa generate video.

**Upload via SCP dari komputer lokal:**
```bash
# Dari terminal komputer lokal
scp path/to/your/host_3d_dinamis_namira.mp4 root@<RUNPOD_IP>:/workspace/ai_live_worker/assets/3d/
scp path/to/your/host_2d_statis_nana.mp4 root@<RUNPOD_IP>:/workspace/ai_live_worker/assets/2d/
```

**Atau download langsung di RunPod:**
```bash
cd /workspace/ai_live_worker/assets/3d
wget "https://your-url.com/host_3d_dinamis_namira.mp4"

cd /workspace/ai_live_worker/assets/2d
wget "https://your-url.com/host_2d_statis_nana.mp4"
```

**Struktur folder yang benar:**
```
/workspace/ai_live_worker/
├── assets/
│   ├── 2d/
│   │   └── host_2d_statis_nana.mp4    ← Video avatar 2D
│   └── 3d/
│       └── host_3d_dinamis_namira.mp4  ← Video avatar 3D
```

---

### 3. Cek API Worker Berjalan

```bash
# Health check
curl http://localhost:8000/

# Response: {"status":"ok","message":"AI Live Worker API is running"}

# Cek proses
ps aux | grep api_server
```

---

### 4. Sambungkan ke Backend Komputer Anda

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

## 📋 Cek Status & Debug

### Cek Log Setup
```bash
# Log proses setup
cat /workspace/ai_live_worker/setup_log.txt
```

### Cek Log API Worker
```bash
# Real-time log
tail -f /workspace/ai_live_worker/api_server.log

# 100 baris terakhir
tail -100 /workspace/ai_live_worker/api_server.log
```

### Cek Status Job Video
```bash
# Ganti <job_id> dengan job_id yang dikembalikan worker
curl http://localhost:8000/stream/status/<job_id>
```

**Response yang mungkin:**

| Status | Artinya |
|--------|---------|
| `{"status": "processing"}` | Masih diproses, tunggu |
| `{"status": "done", "video_url": "/output/..."}` | Selesai, video siap |
| `{"status": "error", "error": "..."}` | Gagal, lihat pesan error |

### Test Generate Video Manual
```bash
curl -X POST http://localhost:8000/stream/live-utterance \
  -H "Content-Type: application/json" \
  -d '{
    "avatar_name": "host_3d_dinamis_namira",
    "text": "Halo testing worker!",
    "voice": "id-ID-GadisNeural",
    "speed": 1.0
  }'
```

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

---

## 🛠️ Troubleshooting

### No space left on device
Jika pip gagal dengan `Errno 28`:
```bash
pip cache purge
rm -rf ~/.cache/pip
export PIP_NO_CACHE_DIR=1
cd /workspace/live-streaming-ai/deploy
bash setup.sh
```
Perbesar **Container Disk** RunPod ke minimal 30–50 GB jika masih penuh.

### Repair / Setup Ulang
Jika worker error (CUDA mismatch, numpy, huggingface_hub, mmcv undefined symbol, dll):
```bash
cd /workspace/live-streaming-ai
git pull
bash deploy/setup.sh
```
Skrip setup sekarang **idempotent** — bisa dijalankan berulang untuk repair. Langsung mencakup: symlink, pin deps, verifikasi model, dan restart API.

### MMCV undefined symbol (ABI mismatch)
Error: `/usr/local/lib/python3.10/dist-packages/mmcv/_ext.cpython-310-x86_64-linux-gnu.so: undefined symbol: _ZN2at4_ops10zeros_like4call...`

**Penyebab:** MMCV compiled untuk PyTorch build berbeda.

**Solusi:** Pastikan menggunakan versi setup terbaru, lalu jalankan:
```bash
cd /workspace/live-streaming-ai
git pull
bash deploy/setup.sh
```
Setup akan compile MMCV dari source sesuai PyTorch 2.1.

### "Gagal me-render video"
**Penyebab:** File video avatar tidak ditemukan di `assets/2d/` atau `assets/3d/`.

**Solusi:** Upload file video avatar ke folder yang benar (lihat langkah 2 di atas).

### Dependency conflicts (bukan fatal)
Pesan seperti ini **bukan error fatal** (hanya peringatan pip):
```text
ERROR: pip's dependency resolver does not currently take into account...
gradio ... pillow ... incompatible
tensorflow ... numpy ... incompatible
```

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
- `MMCV`: 2.1.0 (compiled from source)
- `Edge-TTS`: 6.1.9
