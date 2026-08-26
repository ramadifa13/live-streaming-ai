# Deployment AI Worker di RunPod

Panduan ini untuk konfigurasi demo saat **frontend dan backend berjalan lokal**, sedangkan **AI Worker MuseTalk berjalan di RunPod**. Ollama/LLM diproses **di backend lokal** (default), dan hanya dijalankan di RunPod bila `ENABLE_RUNPOD_OLLAMA=1` di-set.

## Arsitektur Demo

```text
Browser
  -> Frontend Next.js lokal :3000
   -> Backend Fastify lokal :4000
        -> Ollama di Backend lokal :11434 (generate knowledge/copywriting)
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
export HF_TOKEN='secret-key'
bash setup-safe.sh
```


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


## 4. Jalankan AI Worker

Setelah setup selesai:

```bash
cd /workspace/ai_live_worker
bash start.sh
```

`start.sh` menjalankan AI Worker (FastAPI) dan MuseTalk. Ollama **hanya** dijalankan bila `ENABLE_RUNPOD_OLLAMA=1` (memastikan model `OLLAMA_MODEL` tersedia dulu); untuk setup standard Ollama berjalan di backend lokal sehingga langkah ini dilewati. Log Ollama (bila aktif) berada di `/workspace/ai_live_worker/ollama.log`; log Worker berada di `/workspace/ai_live_worker/api_server.log`.

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
  -d '{"avatar_name":"namira","avatar_image_path":"assets/3d/namira.png","text":"Halo, ini adalah pengujian AI Host Namira.","voice":"id-ID-GadisNeural","speed":1.0,"tone":"Persuasif"}'
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
CORS_ORIGIN=http://localhost:3000
DATABASE_URL="file:./dev.db"
BACKEND_PUBLIC_URL=http://localhost:4000

# AI / GPU
GPU_IDLE_TIMEOUT_MINUTES=30
GPU_PROVIDER=runpod
LLM_PROVIDER=ollama
TTS_PROVIDER=edge-tts
# Setup standard: Ollama berjalan di backend lokal
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
# Alternatif bila Ollama dijalankan di RunPod (ENABLE_RUNPOD_OLLAMA=1):
# OLLAMA_HOST=https://<RUNPOD_ID>-11434.proxy.runpod.net
LIVE_HOST_INTERVAL_SECONDS=35
LIVE_HOST_PREBUFFER_COUNT=2
AVATAR_PROVIDER=liveportrait

# RunPod GPU Worker configuration
RUNPOD_API_KEY=<RUNPOD_API_KEY_BARU>
RUNPOD_POD_ID=<RUNPOD_POD_ID>
RUNPOD_WORKER_URL=https://<RUNPOD_POD_ID>-8000.proxy.runpod.net
AVATAR_WORKER_URL=
```

Jalankan backend dari komputer lokal:

```powershell
cd backend
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Backend akan berjalan di port 4000.

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
2. Klik simpan. Backend membuat knowledge dan copywriting menggunakan Ollama (di backend lokal).
3. Pilih host Namira 3D.
4. Pastikan durasi menunjukkan 1 jam (durasi maksimal untuk demo).
5. Pilih platform live (TikTok LIVE, Shopee Live, dll).
6. Jalankan live setelah RTMP URL dan stream key valid.

Saat broadcast dimulai, backend lebih dahulu menunggu dua video ucapan Namira selesai dirender (`LIVE_HOST_PREBUFFER_COUNT=2`). Setelah itu broadcaster RTMP dijalankan, sehingga stream tidak dimulai dari antrean kosong.

## 8. Verifikasi Produk dan AI Brain

Tes dari komputer lokal:

```powershell
$body = @{ name = 'Produk Demo'; price = 99000; stock = 50; category = 'Skincare'; description = 'Produk demo untuk pengujian live.' } | ConvertTo-Json
Invoke-RestMethod http://localhost:4000/api/products -Method Post -ContentType 'application/json' -Body $body
```

Response harus memiliki nilai pada `description`, `benefits`, `usage`, `faq`, `targetAudience`, dan `copywriting`.

Pastikan Ollama berjalan di backend lokal dan dapat menghasilkan copywriting yang berkualitas. Untuk demo klien, health check Ollama dan hasil copywriting harus diverifikasi lebih dahulu.

## 9. RTMP dan Durasi Demo

Publisher RTMP demo dijalankan oleh Worker (RunPod) melalui `broadcaster.py`. Backend lokal memanggil `/stream/start-broadcast` pada worker setelah menerima perintah live dan prebuffer selesai. Jangan menjalankan `broadcaster.py` manual atau publisher Node secara bersamaan karena keduanya dapat berebut satu stream key.

Endpoint kontrol publisher pada Worker:

```text
POST /stream/start-broadcast
POST /stream/stop-broadcast
GET  /stream/broadcast-status
```

Endpoint tersebut dipanggil oleh backend melalui `runpod-bridge.ts` dan `live-session.ts`; user cukup menjalankan live dari dashboard.

Sebelum demo, verifikasi:

- Worker menerima `POST /stream/live-utterance`.
- Worker menerima `POST /stream/start-broadcast`, `/stream/stop-broadcast`, dan `GET /stream/broadcast-status`.
- Video hasil worker dapat diputar.
- Publisher yang dipilih membaca hasil video worker dan mengirimkannya ke RTMP.
- Audio dan gerakan Namira terlihat di platform live.
- Ucapan proaktif berjalan setiap 30-45 detik (sesuai `LIVE_HOST_INTERVAL_SECONDS`).
- Komentar platform masuk melalui connector API/webhook, bukan RTMP.

Backend membatasi `durationHours` menjadi `1` (maksimal untuk demo). Setelah sekitar 3600 detik:

1. Scheduler AI Host berhenti.
2. Publisher RTMP berhenti.
3. Session ditutup.
4. Backend memanggil `stopPod()` jika GPU idle timeout tercapai.

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

Jika menggunakan Ollama di backend lokal:

```powershell
Test-NetConnection -ComputerName localhost -Port 11434
```

Periksa:
- Ollama service berjalan di backend lokal
- `OLLAMA_HOST` di backend `.env` (default standard: http://localhost:11434)
- Jika ingin menggunakan Ollama di RunPod, set `ENABLE_RUNPOD_OLLAMA=1` (di `setup-safe.sh` dan `start.sh`) dan `OLLAMA_HOST=https://<RUNPOD_ID>-11434.proxy.runpod.net`

### Jangan menganggap build lokal sebagai tes live

`npm run build` hanya memvalidasi aplikasi frontend/backend. Readiness live baru dianggap lulus setelah worker, Ollama, render video, RTMP, komentar, dan auto-stop diuji di RunPod.

## 11. Checklist Acceptance

Sebelum demo klien, pastikan:

**Worker & GPU:**
- [ ] Pod RunPod berjalan dan dapat diakses via proxy
- [ ] `api_server.py` berjalan di port 8000 dan health check OK
- [ ] MuseTalk model terdownload dan dapat render video
- [ ] Test render manual berhasil (via `/stream/live-utterance`)

**Ollama & AI Brain:**
- [ ] Ollama berjalan di backend lokal
- [ ] Produk dapat ditambah dan copywriting tergenerate dengan baik
- [ ] Knowledge base (description, benefits, usage, faq) lengkap

**RTMP & Broadcasting:**
- [ ] Publisher worker dapat start/stop broadcast
- [ ] Video hasil worker dapat diputar dan dikirim ke RTMP
- [ ] Audio dan gerakan Namira terlihat di platform live
- [ ] Overlay produk (nama, harga, stok, CTA) muncul di stream

**Live Flow:**
- [ ] Prebuffer video selesai sebelum broadcast dimulai
- [ ] Ucapan proaktif berjalan setiap interval yang dikonfigurasi
- [ ] Komentar platform dapat masuk (via webhook/connector)
- [ ] Auto-stop berfungsi setelah durasi 1 jam

**Environment Variables:**
- [ ] `RUNPOD_API_KEY` dan `RUNPOD_POD_ID` terkonfigurasi
- [ ] `RUNPOD_WORKER_URL` mengarah ke proxy RunPod yang benar
- [ ] `OLLAMA_HOST` dan `OLLAMA_MODEL` terkonfigurasi
- [ ] `LIVE_HOST_INTERVAL_SECONDS` dan `LIVE_HOST_PREBUFFER_COUNT` sesuai kebutuhan
