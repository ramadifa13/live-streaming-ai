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

### 2. Jalankan Server API
Setelah skrip setup selesai (muncul tulisan `SETUP SELESAI 100%!`), jalankan:
```bash
cd /workspace/ai_live_worker
python api_server.py
```
*Server FastAPI akan menyala dan siap di port 8000.*

---

### 3. Sambungkan ke Backend Komputer Anda
1. Buka file `backend/.env` di komputer Anda.
2. Perbarui `RUNPOD_POD_ID` dengan ID Pod RunPod baru Anda:
   ```env
   RUNPOD_POD_ID=id_pod_baru_anda
   ```
*(Simpan file `.env`, backend akan otomatis terhubung kembali!)*

---

## 📁 Struktur File & Aset di RunPod

Pastikan file video avatar dasar ditaruh di folder yang sesuai di server RunPod:
- **Host 2D:** `/workspace/ai_live_worker/assets/2d/host_2d_statis_nana.mp4`
- **Host 3D:** `/workspace/ai_live_worker/assets/3d/host_3d_dinamis_namira.mp4`

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
