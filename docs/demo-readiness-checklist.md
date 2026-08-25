# Demo Readiness Checklist

Dokumen ini adalah checklist acceptance untuk demo AI Host 3D selama 1 jam. `[x]` hanya berarti sudah diverifikasi di kode atau environment lokal; `[ ]` membutuhkan pengujian RunPod/platform nyata.

## 1. Repository dan konfigurasi

- [x] Installer resmi ditetapkan ke `deploy/setup-safe.sh`.
- [x] Referensi dokumentasi tidak lagi memakai `setup.sh`.
- [x] File deployment stale `deploy/setup.sh` dihapus.
- [x] File PM2 stale yang menunjuk `deploy/ai_stream_worker.py` dihapus.
- [x] Backend production build lulus.
- [x] Frontend production build lulus.
- [ ] `backend/.env` production dibuat dari `.env.example` tanpa secret yang ter-commit.
- [ ] RunPod API key lama di-rotate jika pernah terekspos.
- [ ] Backend, frontend, dan worker memakai commit/version yang sama.
- [x] Referensi legacy 2D sudah dibersihkan dari source aktif dan asset 2D sudah dihapus.
- [x] Asset host tunggal tersedia sebagai `namira.mp4` dan `namira.png` di frontend serta deploy worker.
- [x] `setup-safe.sh` menyalin asset dari folder `deploy/assets` ke volume Worker.

## 2. Database dan produk

- [x] Route produk diregistrasikan di `backend/src/server.ts`.
- [x] Produk menyimpan `description`, `benefits`, `usage`, `faq`, `targetAudience`, dan `copywriting`.
- [x] Saat produk disimpan, backend memanggil generator knowledge AI.
- [x] Fallback konservatif tersedia jika Ollama tidak dapat diakses.
- [x] Frontend menyimpan hasil produk dari backend, bukan ID lokal sementara.
- [ ] Migration history production diselaraskan: schema saat ini SQLite, migration lock lama PostgreSQL.
- [ ] Tambah produk dan verifikasi seluruh field knowledge terisi di database.

## 3. Ollama / AI Host Brain

- [x] Backend mendukung `OLLAMA_HOST` dan `OLLAMA_MODEL`.
- [x] `setup-safe.sh` memastikan binary Ollama tersedia.
- [x] `start.sh` menjalankan Ollama, health-check port 11434, dan pull model.
- [x] Copywriting produk digunakan sebagai acuan ucapan pertama host.
- [x] Topik proaktif berganti antara pembukaan, manfaat, cara pakai, tips, dan promo.
- [ ] Ollama terpasang di RunPod dan model sudah di-pull.
- [ ] Backend berhasil memanggil `GET <OLLAMA_HOST>/api/tags` atau request chat nyata.
- [ ] Model diuji agar tidak mengarang klaim medis, sertifikasi, atau manfaat.
- [ ] Beban Ollama dan MuseTalk diuji bersamaan pada GPU yang dipilih.

## 4. AI Worker dan video

- [x] Backend mengirim teks ke `/stream/live-utterance`.
- [x] Worker memiliki endpoint `/stream/live-utterance` dan status job.
- [x] Edge-TTS dan MuseTalk menjadi pipeline render.
- [x] Queue backend menserialkan job speech agar GPU tidak bertabrakan.
- [ ] `setup-safe.sh` berhasil selesai sampai marker setup lengkap.
- [ ] File `namira.mp4` tersedia di `assets/3d` RunPod.
- [ ] Model MuseTalk, Whisper, DWPose, VAE, dan face parsing tervalidasi.
- [ ] Satu request worker menghasilkan MP4 yang dapat diputar.
- [ ] Tiga job speech berurutan selesai tanpa OOM atau job macet.
- [ ] `api_server.py` dan `broadcaster.py` memakai kontrak asset/path Namira yang sama.

## 5. RTMP dan broadcaster

- [x] UI mengunci avatar ke 3D dan durasi ke 1 jam.
- [x] Backend menolak `durationHours` selain `1`.
- [x] Scheduler berhenti saat session dihentikan.
- [x] Publisher demo ditetapkan sebagai `broadcaster.py` yang dikontrol API Worker; Node `rtmp-streamer` tidak dipakai untuk live.
- [x] Worker memiliki endpoint start/stop/status broadcaster.
- [x] Backend memulai dan menghentikan broadcaster Worker melalui `runpod-bridge.ts`.
- [ ] Backend start flow menjalankan publisher yang dipilih; saat ini `broadcaster.py` belum dipicu otomatis oleh endpoint broadcast.
- [ ] Jalur yang dipilih sudah diuji: worker output MP4 -> broadcaster -> RTMP.
- [ ] `broadcaster.py` dijalankan dengan RTMP URL dan stream key yang valid.
- [ ] Pre-buffer minimal 2-3 video speech terbukti cukup untuk menghindari idle.
- [x] Backend menunggu `LIVE_HOST_PREBUFFER_COUNT` video selesai sebelum memulai publisher.
- [ ] Audio dan gerak avatar terdengar/terlihat di platform live.

## 6. Komentar platform

- [x] Komentar webhook/poller diteruskan ke Luna Brain.
- [x] Produk database digunakan sebagai context komentar.
- [x] Respons komentar masuk ke queue speech ketika connector aktif.
- [ ] Credential dan permission API platform sudah aktif.
- [ ] Komentar nyata platform diterima dan respons AI muncul di live.
- [ ] RTMP tidak dianggap sebagai sumber komentar; komentar wajib melalui API/webhook.

## 7. Acceptance test demo 1 jam

- [ ] Ollama health check lulus.
- [ ] Worker health check `GET /` lulus.
- [ ] RunPod status `RUNNING` sebelum mulai live.
- [ ] Produk baru menghasilkan knowledge dan copywriting otomatis.
- [ ] Start session berhasil dengan `durationHours: 1`.
- [ ] RTMP handshake berhasil.
- [ ] Host mulai dari copywriting lalu berbicara tanpa kembali ke idle.
- [ ] Speech baru tampil minimal setiap 30-45 detik.
- [ ] Komentar nyata dapat dijawab jika platform connector diaktifkan.
- [ ] Pada detik ke-3600 session berhenti.
- [ ] Broadcaster berhenti.
- [ ] RunPod berubah ke `STOPPED` atau `TERMINATED`.
- [ ] Tidak ada video/audio/job tertinggal yang terus berjalan.
- [ ] Log backend, worker, dan broadcaster disimpan untuk demo support.

## Urutan eksekusi yang disarankan

1. Selesaikan bagian 1-4 di RunPod.
2. Pilih dan selesaikan satu jalur publisher RTMP pada bagian 5.
3. Jalankan acceptance test pendek 5 menit dengan interval 30 detik.
4. Uji komentar platform, bila credential sudah tersedia.
5. Jalankan demo 1 jam hanya setelah acceptance test pendek lulus.
