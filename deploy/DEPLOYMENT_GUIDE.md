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
4. Volume Disk: Minimal **30 GB**
5. Klik **Deploy On-Demand**

Tunggu 1-2 menit sampai statusnya Running, lalu buka **Terminal / JupyterLab**.
Jalankan skrip instalasi untuk memasang seluruh dependensi (termasuk FastAPI dan XTTSv2):

```bash
cd /workspace
# Copy atau jalankan file setup.sh yang ada di folder deploy/
bash setup.sh

# Install dependensi tambahan untuk AI Worker
pip install -r requirements-worker.txt
```

*(Proses ini akan mengunduh model XTTSv2, Wav2Lip, PyTorch, dan FastAPI).*

---

## TAHAP 2: Mengunggah File dan Aset

Setelah struktur folder `/workspace/ai_live_worker/` selesai dibuat oleh skrip, transfer aset dan skrip Python dari laptop Anda ke RunPod (bisa via web JupyterLab atau SFTP FileZilla):

1. **Upload Aset Video Idle**:
   - Masukkan video idle 2D ke `/workspace/ai_live_worker/assets/2d/` (misal: `host_2d_statis.mp4`)
   - Masukkan video idle 3D ke `/workspace/ai_live_worker/assets/3d/` (misal: `host_3d_dinamis.mp4`)

2. **Upload Aset Suara XTTSv2 (PENTING)**:
   - Buat folder `/workspace/ai_live_worker/assets/voice_refs/` jika belum ada.
   - Unggah audio referensi berdurasi ~10 detik format WAV dengan nama host (misal: `nana.wav`, `namira.wav`, dan `default.wav`).
   - Tanpa ini, kloning suara XTTSv2 tidak akan berbunyi dengan benar.

3. **Upload Skrip Python**:
   - Pindahkan `live_worker.py`, `api_server.py`, `broadcaster.py`, dan `requirements-worker.txt` ke `/workspace/ai_live_worker/`

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
