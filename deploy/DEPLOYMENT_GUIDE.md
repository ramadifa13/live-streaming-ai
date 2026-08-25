# Deployment AI Worker di RunPod

Panduan ini untuk konfigurasi demo saat **frontend dan backend berjalan lokal**, sedangkan **AI Worker MuseTalk dan Ollama berjalan di RunPod**.

## Arsitektur Demo

```text
Browser
  -> Frontend Next.js lokal :3000
  -> Backend Fastify lokal :4000
       -> Ollama di RunPod :11434 (generate knowledge/copywriting)
       -> AI Worker di RunPod :8000 (Edge-TTS + MuseTalk)
            -> video MP4 hasil lipsync
       -> RTMP publisher yang dipilih untuk platform live
```

RTMP hanya mengirim audio/video. Komentar tidak dibaca dari RTMP; komentar harus masuk melalui API platform atau webhook ke backend.

## 1. Persiapan RunPod

Buat satu Pod GPU dengan rekomendasi:

- NVIDIA RTX 4090 atau RTX 3090
- Template PyTorch dengan Python 3.10 dan CUDA toolkit 11.8
- Container disk minimal 30 GB, lebih aman 50 GB
- Port `8000` untuk AI Worker
- Port `11434` hanya melalui private network atau proxy yang dilindungi autentikasi
- Volume persistent untuk `/workspace/ai_live_worker`

Catat `RUNPOD_POD_ID` dan pastikan Pod dapat diakses melalui proxy RunPod.

## 2. Clone Repository dan Setup MuseTalk

Jalankan di terminal Pod:

```bash
cd /workspace
git clone <URL_REPOSITORY_ANDA> live-streaming-ai
cd /workspace/live-streaming-ai/deploy
export HF_TOKEN='hf_xxxxxxxxxxxxxxxxx'
bash setup-safe.sh
```

`setup-safe.sh` adalah installer resmi. Script ini memeriksa GPU/CUDA/Python, memasang PyTorch dan dependensi MuseTalk, mengunduh model, menyiapkan symlink, menjalankan verifikasi, dan membuat marker:

```text
/workspace/ai_live_worker/.setup_complete
```

Jangan memakai `setup.sh`; file tersebut sudah dihapus.

## 3. Simpan Asset Host Namira

Untuk tahap demo gunakan satu host saja. Asset runtime harus berada di RunPod, bukan bergantung pada folder frontend lokal:

```text
/workspace/ai_live_worker/assets/3d/namira.mp4
/workspace/ai_live_worker/assets/3d/namira.png
```

Upload dari komputer lokal menggunakan SCP atau upload melalui volume RunPod:

```bash
scp namira.mp4 root@<RUNPOD_IP>:/workspace/ai_live_worker/assets/3d/
scp namira.png root@<RUNPOD_IP>:/workspace/ai_live_worker/assets/3d/
```

Frontend boleh menyimpan salinan preview di `frontend/public/avatars`, tetapi file yang dipakai MuseTalk wajib tersedia di RunPod.

## 4. Install Ollama di RunPod

Ollama dan model open-weight tidak memiliki biaya lisensi, tetapi GPU, storage, dan network RunPod tetap berbayar.

`setup-safe.sh` menyiapkan binary Ollama. Saat `start.sh` dijalankan, script otomatis memulai Ollama, melakukan health check, dan mengunduh model yang belum tersedia.

```bash
curl http://127.0.0.1:11434/api/tags
ollama list
```

Jika backend lokal mengakses Ollama melalui proxy, expose port `11434` di konfigurasi Pod dan gunakan network/proxy yang aman. Jangan membuka Ollama ke internet tanpa autentikasi.

## 5. Jalankan AI Worker

Setelah setup selesai:

```bash
cd /workspace/ai_live_worker
bash start.sh
```

`start.sh` menjalankan Ollama terlebih dahulu, memastikan model `OLLAMA_MODEL` tersedia, lalu menjalankan FastAPI Worker. Log Ollama berada di `/workspace/ai_live_worker/ollama.log`; log Worker berada di `/workspace/ai_live_worker/api_server.log`.

Health check dari terminal Pod:

```bash
curl http://127.0.0.1:8000/
tail -f /workspace/ai_live_worker/api_server.log
```

Response sehat:

```json
{ "status": "ok", "message": "AI Live Worker API is running" }
```

Test render manual:

```bash
curl -X POST http://127.0.0.1:8000/stream/live-utterance \
  -H 'Content-Type: application/json' \
  -d '{"avatar_name":"namira","avatar_image_path":"assets/3d/namira.png","text":"Halo, ini adalah pengujian AI Host Namira.","voice":"id-ID-GadisNeural","speed":1.0}'
```

Simpan `job_id`, lalu cek:

```bash
curl http://127.0.0.1:8000/stream/status/<job_id>
```

Status harus berubah dari `processing` menjadi `done` dan menghasilkan `video_url`.

## 6. Konfigurasi Backend Lokal

Di `backend/.env`, gunakan konfigurasi demo berikut. Jangan commit file `.env` dan jangan membagikan secret.

```env
PORT=4000
HOST=0.0.0.0
DATABASE_URL="file:./dev.db"
GPU_PROVIDER=runpod
AVATAR_PROVIDER=liveportrait
RUNPOD_API_KEY=<RUNPOD_API_KEY_BARU>
RUNPOD_POD_ID=<RUNPOD_POD_ID>
RUNPOD_WORKER_URL=https://<RUNPOD_POD_ID>-8000.proxy.runpod.net
OLLAMA_HOST=https://<RUNPOD_ID>-11434.proxy.runpod.net
OLLAMA_MODEL=qwen2.5:7b
LIVE_HOST_INTERVAL_SECONDS=35
LIVE_HOST_PREBUFFER_COUNT=2
```

Jalankan backend dari komputer lokal:

```powershell
cd backend
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Health check:

```powershell
Invoke-RestMethod http://localhost:4000/health
```

## 7. Jalankan Frontend Lokal

Di terminal lokal kedua:

```powershell
cd frontend
npm install
npm run dev
```

Buka `http://localhost:3000`.

Flow UI demo:

1. Tambah produk dengan nama, gambar, harga, stok, kategori, dan deskripsi opsional.
2. Klik simpan. Backend membuat knowledge dan copywriting menggunakan Ollama.
3. Pilih host Namira 3D.
4. Pastikan durasi menunjukkan 1 jam.
5. Jalankan live setelah RTMP URL dan stream key valid.

Saat broadcast dimulai, backend lebih dahulu menunggu dua video ucapan Namira selesai dirender (`LIVE_HOST_PREBUFFER_COUNT=2`). Setelah itu broadcaster RTMP dijalankan, sehingga stream tidak dimulai dari antrean kosong.

## 8. Verifikasi Produk dan AI Brain

Tes dari komputer lokal:

```powershell
$body = @{ name = 'Produk Demo'; price = 99000; stock = 50; category = 'Skincare'; description = 'Produk demo untuk pengujian live.' } | ConvertTo-Json
Invoke-RestMethod http://localhost:4000/api/products -Method Post -ContentType 'application/json' -Body $body
```

Response harus memiliki nilai pada `description`, `benefits`, `usage`, `faq`, `targetAudience`, dan `copywriting`.

Jika Ollama mati, sistem memakai fallback konservatif. Untuk demo klien, fallback tidak cukup; health check Ollama dan hasil copywriting harus diverifikasi lebih dahulu.

## 9. RTMP dan Durasi Demo

Publisher RTMP demo dijalankan oleh Worker melalui API FastAPI. Backend lokal memanggil `/stream/start-broadcast` setelah menerima perintah live. Jangan menjalankan `broadcaster.py` manual atau publisher Node secara bersamaan karena keduanya dapat berebut satu stream key.

Endpoint kontrol publisher pada Worker:

```text
POST /stream/start-broadcast
POST /stream/stop-broadcast
GET  /stream/broadcast-status
```

Endpoint tersebut dipanggil oleh backend melalui `runpod-bridge.ts`; user cukup menjalankan live dari dashboard.

Sebelum demo, verifikasi:

- Worker menerima `POST /stream/live-utterance`.
- Worker menerima `POST /stream/start-broadcast`, `/stream/stop-broadcast`, dan `GET /stream/broadcast-status`.
- Video hasil worker dapat diputar.
- Publisher yang dipilih membaca hasil video worker dan mengirimkannya ke RTMP.
- Audio dan gerakan Namira terlihat di platform live.
- Ucapan proaktif berjalan setiap 30-45 detik.
- Komentar platform masuk melalui connector API/webhook, bukan RTMP.

Backend membatasi `durationHours` menjadi `1`. Setelah sekitar 3600 detik:

1. Scheduler AI Host berhenti.
2. Publisher RTMP berhenti.
3. Session ditutup.
4. Backend memanggil `stopPod()`.

## 10. Troubleshooting

### Worker tidak dapat dijangkau

```bash
curl https://<RUNPOD_ID>-8000.proxy.runpod.net/
```

Periksa port Pod, `RUNPOD_WORKER_URL`, status Pod, dan `api_server.log`.

### Model tidak ditemukan

```bash
test -f /workspace/ai_live_worker/models/musetalkV15/unet.pth
test -f /workspace/ai_live_worker/models/whisper/config.json
test -f /workspace/ai_live_worker/assets/3d/namira.mp4
```

Jika gagal, jalankan ulang `bash setup-safe.sh` setelah memastikan disk dan `HF_TOKEN` benar.

### Ollama timeout

```bash
curl https://<RUNPOD_ID>-11434.proxy.runpod.net/api/tags
```

Periksa port, proxy, firewall, model name, dan `OLLAMA_HOST` di backend lokal.

### Jangan menganggap build lokal sebagai tes live

`npm run build` hanya memvalidasi aplikasi frontend/backend. Readiness live baru dianggap lulus setelah worker, Ollama, render video, RTMP, komentar, dan auto-stop diuji di RunPod.

## 11. Checklist Acceptance

Gunakan checklist terperinci di [demo-readiness-checklist.md](../docs/demo-readiness-checklist.md). Demo klien baru boleh dijalankan setelah bagian worker, Ollama, RTMP, dan acceptance 5 menit dicentang.
