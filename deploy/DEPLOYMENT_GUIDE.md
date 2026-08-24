# 🚀 LiveStreamerAI — Deployment Guide (Wav2Lip + RunPod)

Panduan ini berisi langkah-langkah untuk menjalankan AI Worker berbasis Wav2Lip di mesin virtual GPU RunPod. 
Arsitektur baru ini **jauh lebih stabil dan cepat** karena memisahkan antara proses rendering (Worker) dan streaming (Broadcaster).

---

## 🗺️ Arsitektur Sistem Baru (FastAPI + XTTSv2)

```
[ Terminal 1 (AI Worker / Server API) ]                [ Terminal 2 (Broadcaster) ]
                  │                                                 │
                  ▼                                                 ▼
       python api_server.py  ──────────────────────►          broadcaster.py
 (Mendengarkan instruksi Backend via      (Tugas: Memutar /output secara real-time
  FastAPI di Port 8000. Merender suara           ke Platform TikTok/Shopee)
  via XTTSv2 dan Lipsync Wav2Lip, 
  lalu menyimpan hasilnya ke /output)
```

---

## TAHAP 1: Membangun Sistem di Mesin Baru (RunPod)

Setiap kali Anda membuat atau mereset Pod baru di RunPod:

1. Buka [runpod.io/console/pods](https://www.runpod.io/console/pods) → **+ Deploy Pod**
2. Pilih GPU: **NVIDIA RTX 4090**
3. Template: **RunPod PyTorch 2.1 (CUDA 12.1)**
4. Container Disk: Minimal **20 GB**
5. Volume Disk: Minimal **40 GB**
6. Klik **Deploy On-Demand**

Tunggu 1-2 menit sampai statusnya Running, lalu buka **Terminal / JupyterLab**.

Langkah pertama adalah **meng-clone (mengunduh) repositori ini** ke dalam RunPod agar semua skrip otomatis tersedia:

```bash
cd /workspace
git clone https://github.com/ramadifa13/live-streaming-ai.git
cd live-streaming-ai/deploy

# Jalankan skrip instalasi utama (Untuk Wav2Lip & Folder)
bash setup.sh

# Install dependensi tambahan AI Worker (Untuk FastAPI & XTTSv2)
pip install -r requirements-worker.txt --ignore-installed blinker
```

*(Proses ini akan mengunduh repositori Anda, model XTTSv2, Wav2Lip, PyTorch, dan FastAPI).*

---

## TAHAP 2: Mengunggah File Aset Video & Suara

Setelah struktur folder `/workspace/ai_live_worker/` selesai dibuat oleh skrip, langkah selanjutnya adalah menyiapkan aset Video ke dalam RunPod Anda (via FileZilla/JupyterLab):

1. **Upload Aset Video Idle**:
   - Masukkan video idle host 2D ke `/workspace/ai_live_worker/assets/2d/` (Wajib bernama `host_2d_statis_nana.mp4`)
   - Masukkan video idle host 3D ke `/workspace/ai_live_worker/assets/3d/` (Wajib bernama `host_3d_dinamis_namira.mp4`)

*(Catatan: Anda tidak perlu mengunggah file suara referensi (`.wav`) karena repositori ini sudah menyertakan `default.wav` yang akan dipakai otomatis oleh sistem! Anda juga tidak perlu menyalin skrip Python karena `setup.sh` telah menatanya untuk Anda).*

---

## TAHAP 3: Menjalankan Siaran (Live)

Buka dua tab Terminal di RunPod Anda.

**Terminal 1 (Jalankan AI Worker API Server):**
Skrip ini akan membuka Port 8000 dan bersiap menerima instruksi / perintah teks dari Backend (Dashboard/Laptop Anda) untuk diproses menjadi suara XTTSv2 dan lipsync Wav2Lip.
```bash
cd /workspace/ai_live_worker
python api_server.py
```

**Terminal 2 (Jalankan Broadcaster):**
Skrip ini akan langsung terhubung ke RTMP (Tiktok/Shopee) dan memutar video idle jika belum ada video render-an baru. Saat Terminal 1 selesai me-render video baru, Terminal 2 akan otomatis menayangkannya.
```bash
cd /workspace/ai_live_worker
python broadcaster.py
```
*(Pastikan mengedit URL RTMP dan Stream Key pelanggan di dalam file `broadcaster.py` terlebih dahulu sebelum dijalankan).*

---

## TAHAP 4: Menghemat Biaya (Mencegah Tagihan Mengalir)

Saat Anda selesai bekerja hari ini, **jangan biarkan Pod menyala atau hanya diklik "Stop"**.
Jika Anda hanya men-stop pod, Anda tetap ditagih biaya sewa penyimpanan (storage disk).

1. Buka dashboard RunPod Anda.
2. Klik ikon **Tempat Sampah (Terminate)** pada Pod RTX 4090 tersebut.
3. Konfirmasi penghapusan.

Dengan ini, argo tagihan Anda benar-benar Rp 0 / jam. Anda bisa membangun ulang sistem keesokan harinya menggunakan panduan ini hanya dalam waktu 5 menit!

---

## 🛠️ Troubleshooting (Solusi Error Umum)

Jika Anda menemui error saat merender video, berikut adalah solusinya:

### 1. `Error: RunPod API Error: 400 - Cannot query field "lastStatus"`
Ini terjadi karena backend lokal belum diperbarui ke versi terbaru. Pastikan Anda telah mem-pull repositori terbaru yang sudah menggunakan `desiredStatus` pada file `runpod-manager.ts`.

### 2. `[ERROR] Video '...' tidak ada di folder assets/...`
Pastikan Anda mengunggah file `.mp4` dengan huruf kecil semua dan **tanpa ekstensi tambahan** di namanya (contoh: `namira.mp4`, bukan `namira.png.mp4`).

### 3. `[ERROR] Gagal membuat suara: Language id is not supported`
Model suara AI XTTSv2 bawaan tidak mendukung bahasa `id`. Pastikan file `live_worker.py` (pada baris ke-56) sudah di-set ke `language="en"`.

### 4. `EOFError: Ran out of input` saat meload Wav2Lip
Ini artinya file model `wav2lip_gan.pth` Anda korup/tidak utuh. Jalankan perintah ini di RunPod untuk mendownload ulang:
```bash
rm -f /workspace/ai_live_worker/Wav2Lip/checkpoints/wav2lip_gan.pth
wget -O /workspace/ai_live_worker/Wav2Lip/checkpoints/wav2lip_gan.pth https://huggingface.co/camenduru/Wav2Lip/resolve/main/checkpoints/wav2lip_gan.pth
```

### 5. Video berhasil digenerate tapi tidak ada suara atau Error `ffmpeg: not found`
Ini terjadi jika RunPod tidak memiliki `ffmpeg`. Pastikan Anda telah menjalankan:
```bash
apt update && apt install -y ffmpeg
```
