# 🚀 LiveStreamerAI — Deployment Guide (Wav2Lip + RunPod)

Panduan ini berisi langkah-langkah untuk menjalankan AI Worker berbasis Wav2Lip di mesin virtual GPU RunPod. 
Arsitektur baru ini **jauh lebih stabil dan cepat** karena memisahkan antara proses rendering (Worker) dan streaming (Broadcaster).

---

## 🗺️ Arsitektur Sistem Baru

```
[ Terminal 1 (RunPod) ]                [ Terminal 2 (RunPod) ]
          │                                        │
          ▼                                        ▼
   live_worker.py  ───────────────►        broadcaster.py
 (AI Generates Video)  (Simpan ke /output)  (Membaca /output)
                                                   │
                                                   ▼
                                           Platform Live Streaming
                                              (TikTok/Shopee)
```

---

## TAHAP 1: Membangun Sistem di Mesin Baru (RunPod)

Setiap kali Anda membuat atau mereset Pod baru di RunPod:

1. Buka [runpod.io/console/pods](https://www.runpod.io/console/pods) → **+ Deploy Pod**
2. Pilih GPU: **NVIDIA RTX 4090**
3. Template: **RunPod PyTorch 2.1 (CUDA 12.1)**
4. Volume Disk: Minimal **30 GB**
5. Klik **Deploy On-Demand**

Tunggu 1-2 menit sampai statusnya Running, lalu buka **Terminal / JupyterLab**.
Jalankan skrip `setup.sh` untuk menginstal seluruh dependensi secara otomatis:

```bash
cd /workspace
# Copy atau jalankan file setup.sh yang ada di folder deploy/
bash setup.sh
```

*(Skrip ini akan mengunduh Wav2Lip, model AI, dan mengatur semua folder yang dibutuhkan dalam 2-3 menit).*

---

## TAHAP 2: Mengunggah File dan Aset

Setelah struktur folder `/workspace/ai_live_worker/` selesai dibuat oleh skrip, transfer aset dan skrip Python dari laptop Anda ke RunPod (bisa via web JupyterLab atau SFTP FileZilla):

1. **Upload Aset Video Idle**:
   - Masukkan video idle 2D ke `/workspace/ai_live_worker/assets/2d/` (misal: `host_2d_statis.mp4`)
   - Masukkan video idle 3D ke `/workspace/ai_live_worker/assets/3d/` (misal: `host_3d_dinamis.mp4`)

2. **Upload Skrip Python**:
   - Pindahkan `live_worker.py` ke `/workspace/ai_live_worker/`
   - Pindahkan `broadcaster.py` ke `/workspace/ai_live_worker/`

---

## TAHAP 3: Menjalankan Siaran (Live)

Buka dua tab Terminal di RunPod Anda.

**Terminal 1 (Jalankan Broadcaster):**
Skrip ini akan langsung terhubung ke RTMP dan memutar video idle jika belum ada jawaban dari AI.
```bash
cd /workspace/ai_live_worker
python broadcaster.py
```
*(Jangan lupa edit URL RTMP dan Stream Key pelanggan di dalam file `broadcaster.py` terlebih dahulu).*

**Terminal 2 (Jalankan AI Worker):**
Skrip ini digunakan untuk merender suara dan video ketika ada pemicu/pertanyaan dari penonton.
```bash
cd /workspace/ai_live_worker
python live_worker.py
```

---

## TAHAP 4: Menghemat Biaya (Mencegah Tagihan Mengalir)

Saat Anda selesai bekerja hari ini, **jangan biarkan Pod menyala atau hanya diklik "Stop"**.
Jika Anda hanya men-stop pod, Anda tetap ditagih biaya sewa penyimpanan (storage disk).

1. Buka dashboard RunPod Anda.
2. Klik ikon **Tempat Sampah (Terminate)** pada Pod RTX 4090 tersebut.
3. Konfirmasi penghapusan.

Dengan ini, argo tagihan Anda benar-benar Rp 0 / jam. Anda bisa membangun ulang sistem keesokan harinya menggunakan panduan ini hanya dalam waktu 5 menit!
