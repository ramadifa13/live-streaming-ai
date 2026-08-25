Agar benar-benar siap demo, saya akan cocokkan checklist dengan wiring yang sudah dibuat: database, Ollama, RunPod worker, broadcaster, RTMP, lalu uji satu ucapan end-to-end. Saya juga akan menandai bagian yang masih hanya “terlihat terintegrasi” tetapi belum terbukti berjalan di mesin Anda.

Saya menemukan blocker utama yang harus dibereskan sebelum demo: saat ini video hasil AI Worker belum tentu masuk ke RTMP. Backend Node masih menjalankan FFmpeg dengan video idle, sedangkan `broadcaster.py` yang membaca output worker tidak dijalankan oleh `start.sh`. Jadi wiring AI Worker ada, tetapi jalur output ke penonton masih terbelah.
Agar benar-benar sesuai, urutannya harus seperti ini.

**Status saat ini**

Fitur UI dan AI sudah hampir sesuai:

- Produk dapat dibuat otomatis oleh AI.
- Knowledge dan `copywriting` disimpan di database.
- Step 2 hanya host 3D.
- Step 3 hanya durasi 1 jam.
- Orchestrator sudah memanggil AI Worker.
- Watchdog sudah menghentikan sesi setelah 1 jam.
  Namun ada **blocker utama**:

> Backend Node masih mengirim video idle langsung ke RTMP, sedangkan `broadcaster.py` yang membaca hasil video dari AI Worker belum dijalankan oleh `start.sh`.

Akibatnya, AI Worker bisa menghasilkan video, tetapi suara host belum tentu tampil di live RTMP.

**Langkah berikutnya**
**Satukan jalur output RTMP**

Pilihan yang disarankan:
Backend
|
| start session
v
RunPod AI Worker
|
| Edge-TTS + MuseTalk
v
output/\*.mp4
|
v
broadcaster.py
|
v
RTMP platform

1. Jangan menjalankan dua publisher sekaligus. Pilih salah satu:

- `broadcaster.py` sebagai publisher utama, atau
- `rtmp-streamer.ts` dimodifikasi agar membaca output worker.

Untuk demo, lebih mudah menggunakan `broadcaster.py` sebagai publisher utama. 2. **Tambahkan endpoint worker untuk broadcaster**

Worker perlu memiliki endpoint seperti:
POST /stream/start-broadcast
POST /stream/stop-broadcast

Backend mengirim:
{
"rtmp_url": "rtmps://...",
"stream_key": "...",
"idle_video": "...",
"output_folder": "..."
}

1. Saat stop atau durasi mencapai 1 jam, backend memanggil endpoint stop broadcaster terlebih dahulu, lalu menjalankan `stopPod()`.
2. **Aktifkan auto-shutdown RunPod**

Saat ini di `.env` terdapat:
GPU_IDLE_TIMEOUT_MINUTES=0

Nilai `0` berarti auto-shutdown idle dinonaktifkan. Untuk sesi demo, lifecycle 1 jam tetap akan memanggil stop karena watchdog, tetapi sebaiknya gunakan:
GPU_IDLE_TIMEOUT_MINUTES=10

1. Watchdog tetap menjadi pengaman utama untuk batas 1 jam.
2. **Pastikan Ollama tersedia**

Generator knowledge membutuhkan Ollama. Jalankan:
ollama pull qwen2.5:latest
ollama serve

Lalu pastikan backend dapat mengakses:

LLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2.5:latest

Jika Ollama tidak tersedia, sistem masih berjalan memakai fallback template, tetapi copywriting bukan hasil AI penuh.

Perbaiki database deployment

Repository saat ini memiliki ketidaksesuaian:

schema.prisma menggunakan SQLite.
migration_lock.toml menggunakan PostgreSQL.
Untuk demo lokal, prisma db push sudah berhasil. Untuk production, pilih satu database dan rapikan migration history sebelum deploy. Jangan mengandalkan db push untuk production.

Lakukan acceptance test

Tes produk:Tambah produk
-> klik Simpan
-> pastikan description, benefits, usage, faq, targetAudience,
dan copywriting otomatis terisi

tes live:
Start session durationHours = 1
-> start RTMP
-> worker membuat video suara
-> broadcaster mengirim video hasil AI
-> host berbicara setiap 30-45 detik
-> stop otomatis setelah 3600 detik
-> RunPod status menjadi STOPPED

Bisa, tetapi “tanpa idle” harus berarti host selalu punya antrean video bicara siap diputar. Saya akan cek dulu apakah worker/broadcaster saat ini mendukung antrean video yang cukup; bila belum, saya akan ubah orkestrator supaya menyiapkan ucapan berikutnya sebelum ucapan sebelumnya selesai, lalu saya jelaskan batas teknisnya secara jujur.

Bisa, tetapi versi sekarang belum benar-benar tanpa idle.

Masalahnya:

createProactiveUtterance() hanya membuat ucapan setiap interval.
MuseTalk membutuhkan waktu untuk membuat video.
forwardToRunPodGPU() hanya mengembalikan URL video, belum memasukkan hasilnya langsung ke RTMP.
broadcaster.py belum dijalankan otomatis oleh start.sh.
Jika worker sedang merender, broadcaster bisa kehabisan video bicara.
Agar host benar-benar terus bergerak dan berbicara, flow yang benar harus memakai pre-buffer queue:

Agar host benar-benar terus bergerak dan berbicara, flow yang benar harus memakai pre-buffer queue:
AI membuat 2-3 video ucapan terlebih dahulu
↓
Broadcaster mengambil video pertama
↓
Saat video pertama diputar, worker membuat video berikutnya
↓
Video berikutnya langsung diputar tanpa kembali ke idle

Implementasi yang diperlukan:

Worker membuat antrean minimal 2-3 video speech.
Broadcaster dijadikan publisher RTMP utama.
Backend tidak lagi menjalankan dua publisher RTMP sekaligus.
Saat satu video hampir selesai, video berikutnya sudah tersedia.
Ucapan komentar dan ucapan promosi masuk ke antrean yang sama.
Setelah 1 jam:
stop scheduler,
habiskan atau hentikan antrean,
stop broadcaster,
panggil stopPod().

Jadi jawabannya:
Ya, bisa dibuat tanpa idle secara visual, tetapi harus menggunakan pre-buffer video dan satu broadcaster RTMP utama. Implementasi sekarang baru memiliki scheduler speech, belum menyelesaikan pre-buffer dan jalur broadcaster-to-RTMP secara penuh.

Untuk kualitas demo, gunakan:
LIVE_HOST_INTERVAL_SECONDS=20
LIVE_HOST_PREBUFFER_COUNT=3

Target realistisnya bukan host menghasilkan kalimat baru secara real-time setiap detik, melainkan host selalu memiliki video ucapan siap tayang. Jeda alami antar kalimat tetap bisa dibuat sekitar 1-3 detik tanpa menampilkan video idle.

Ya, Ollama bisa dipasang di RunPod, tetapi saya akan bedakan biaya software, model, dan GPU agar keputusan arsitekturnya tepat. Saya juga akan cocokkan dengan kode sekarang, karena backend saat ini mencari Ollama di localhost, bukan otomatis di RunPod.

Ya, Ollama gratis sebagai software. Model seperti Qwen juga umumnya gratis digunakan, tetapi RunPod tetap berbayar berdasarkan durasi GPU/instance dan biaya storage/network.

Backend lokal
↓ HTTP :11434
Ollama di RunPod
↓
AI Host Brain
↓
Edge-TTS + MuseTalk

Namun kode sekarang masih default ke:
OLLAMA_HOST=http://localhost:11434
Itu berarti backend mencari Ollama di komputer lokal, bukan RunPod. Untuk memakai Ollama di RunPod, lakukan:

Install Ollama di RunPod:
curl -fsSL https://ollama.com/install.sh | sh
ollama serve
ollama pull qwen2.5:7b

Jalankan Ollama agar menerima koneksi dari backend:
OLLAMA_HOST=0.0.0.0:11434 ollama serve
Expose port 11434 RunPod melalui proxy atau private network.

Isi .env:
OLLAMA_HOST=https://<RUNPOD_ID>-11434.proxy.runpod.net
OLLAMA_MODEL=qwen2.5:7b

Jangan membuka port Ollama ke internet tanpa autentikasi. Ollama API secara default tidak memiliki authentication yang kuat.

Untuk tahap demo, satu RunPod berisi Ollama + MuseTalk + Edge-TTS masih bisa. Tetapi ada risiko GPU berebut resource antara LLM dan MuseTalk. Flow paling stabil:
Ollama menghasilkan teks
→ Ollama selesai
→ MuseTalk membuat video
→ video dikirim ke RTMP

Ketika sesi 1 jam selesai dan RunPod dimatikan, Ollama juga otomatis berhenti. Perlu diperhatikan, setup-safe.sh saat ini belum meng-install Ollama secara otomatis, jadi langkah install tersebut harus dijalankan di RunPod sebelum benar-benar deploy.

Installer resmi yang dipakai adalah setup-safe.sh; setup.sh dan konfigurasi PM2 stale sudah dihapus.
