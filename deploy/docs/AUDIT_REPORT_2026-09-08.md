# Audit AI Worker, Audio, Video, dan MuseTalk

Tanggal audit: 2026-09-08
Ruang lingkup: folder `deploy/`, termasuk worker Python, bridge audio, MuseTalk inference, FFmpeg/RTMP, supervisor, shell script, invariant check, dan dokumentasi deployment.
Metode: read-only code review dan pemeriksaan diagnostik workspace. Tidak ada file runtime, environment, service, deployment, atau stream yang diubah atau dijalankan.

## Verdict

Sistem belum dapat dinyatakan bebas idle, bebas temuan tak terduga, atau 100% sinkron. Ada temuan kritis yang dapat membuat endpoint utterance gagal, temuan high yang dapat membuat playback idle/stall, dan kontrak FPS/durasi yang belum dipaksa secara konsisten.

`get_errors` workspace tidak melaporkan error diagnostik, tetapi itu tidak mendeteksi nama global Python yang belum didefinisikan atau kegagalan runtime asynchronous.

## Temuan terverifikasi

### AUD-001 - Global lifecycle broadcast belum diinisialisasi

Severity: Critical

`api_server.py` hanya menginibantu saya validasi dan cek terkait audit report doc ini apakah valid atau tidak ? jangan langsung eksekusi code sialisasi `_broadcast_boot_state`, tetapi route memakai `_broadcast_boot_task`, `_broadcast_boot_error`, dan `_broadcast_started_at` sebelum ada assignment global yang aman.

Lokasi: global state startup worker, `start_broadcast`, `get_queue_status`, dan `broadcast_status` di `api_server.py`.

Dampak:

- Request start/status dapat berhenti dengan `NameError`.
- UI dapat melihat status tidak konsisten atau broadcast tidak pernah masuk ke state running.

### AUD-002 - Fungsi `_visual_worker_ready` dan `_normalize_body_action` tidak ditemukan

Severity: Critical

`process_video_task` memanggil `_visual_worker_ready()` dan `_normalize_body_action()`, tetapi pencarian seluruh `deploy/**/*.py` hanya menemukan pemanggilnya, bukan definisinya.

Dampak:

- Request `/stream/live-utterance` pada mode `ai_worker` dapat gagal sebelum audio masuk ke `SpeechBridge`.
- Gejala dari sisi pengguna tampak seperti AI idle atau queue tidak diputar.

### AUD-003 - Queue audio tidak bounded dan membuat satu thread prep per utterance

Severity: High

`SpeechBridge.enqueue()` menambahkan job ke deque tanpa batas ukuran dan membuat thread `_prepare_job` baru untuk setiap job. Jika model belum siap, thread dapat menunggu sampai 300 detik.

Dampak: burst request dapat menghasilkan thread dan pekerjaan Whisper bersamaan, memory growth, VRAM pressure/OOM, latency tinggi, dan apparent stall.

### AUD-004 - Hard preroll dapat menahan audio terlalu lama

Severity: High

`MUSETALK_HARD_PREROLL` aktif secara default. Job dikembalikan ke pending sampai `lipsync_ready`. Callback preroll melakukan polling inference berulang, sementara inferensi gagal hanya mencetak error dan dapat membuat kesiapan tertunda.

Konfigurasi yang terlihat: `deploy/.env` menetapkan `MUSETALK_PREROLL_TIMEOUT_SEC=4.0` dan `SPEECH_BRIDGE_MIN_READY=2`.

Dampak: playback pertama dapat menunggu dua utterance siap; jika preroll lambat atau gagal, preview dapat idle berkepanjangan.

### AUD-005 - Sinyal akhir utterance terlalu bergantung pada urutan lintas thread

Severity: High

`SpeechBridge` baru dibersihkan oleh `signal_visual_complete()`. Pemanggilan ini berasal dari `frame_fetcher_loop` setelah `sm.utterance_visual_complete()`. Transisi audio selesai, state visual, callback, dan queue berjalan lintas thread tanpa watchdog khusus untuk job aktif.

Dampak: jika callback atau state visual tidak mencapai kondisi complete, `_current` dapat tetap aktif dan utterance berikutnya tidak pernah dimulai. Hold-talk dan silence fallback dapat menyamarkan kondisi tersebut.

Status: perlu test deterministik dengan audio kosong, audio sangat pendek, audio panjang, dan inference exception.

### AUD-006 - Kontrak FPS tidak tunggal antara mode worker dan frame-feed

Severity: High

`ai_worker.py`, `speech_bridge.py`, `core_pipeline.py`, dan inference memakai `AI_WORKER_FPS`. `frame_feed.py` memakai `FRAME_FEED_FPS` dengan default 25. `inference.py` memiliki CLI default 25. Sementara `deploy/.env` dan `.env.example` menetapkan `AI_WORKER_FPS=24`.

Dampak: mode `frame_feed` dapat membaca segmen yang dibuat pada FPS berbeda dari FPS player. Durasi video, jumlah chunk audio per frame, dan pacing RTMP dapat drift.

### AUD-007 - `.ffseg` tidak memvalidasi kesamaan durasi audio dan video

Severity: High

`FfsegWriter.finalize()` menulis `frames` dan `audio_bytes`, tetapi tidak menolak mismatch. `iter_ffseg_frames()` hanya menghasilkan sebanyak `meta["frames"]`; audio yang lebih panjang tidak menghasilkan frame tambahan. Inference menentukan jumlah frame dari Whisper chunk, bukan invariant eksplisit durasi PCM.

Dampak: tail audio dapat terpotong jika frame output lebih pendek dari durasi audio. Audio yang lebih pendek dapat dipad silence tanpa mismatch dilaporkan.

Status: kontrak bermasalah terverifikasi secara statis; besar mismatch aktual perlu fixture runtime.

### AUD-008 - Exit code FFmpeg segment tidak diverifikasi

Severity: High

Pada `inference.py`, `BrokenPipeError` saat menulis frame hanya diabaikan dan `ffmpeg_proc.wait()` tidak diperiksa dengan `returncode`. File output dapat dianggap selesai walaupun encoder gagal atau hasilnya parsial.

Dampak: artefak rusak dapat lolos ke queue atau diteruskan ke broadcaster.

### AUD-009 - RTMP/FFmpeg berhenti tetapi watchdog tidak melakukan restart

Severity: High

`MAX_BROADCASTER_RESTARTS` tersedia di `broadcast_supervisor.py`, tetapi `periodic_cleanup_and_watchdog()` hanya mencatat proses keluar dan menulis status failed. Tidak ada restart dengan backoff atau pemulihan pipeline.

Dampak: stream berhenti permanen setelah FFmpeg mati.

### AUD-010 - Cancellation boot tidak menghentikan pekerjaan blocking secara deterministik

Severity: High

`start_broadcast` menjalankan `_start_broadcast_sync` melalui `asyncio.to_thread()`. Pembatalan task asyncio tidak membatalkan thread sinkron yang sedang load model atau start pipeline. Stop hanya memulai cleanup background.

Dampak: thread boot lama dapat selesai setelah stop; restart cepat berisiko membuat dua lifecycle menyentuh GPU, bridge, atau RTMP pipe.

### AUD-011 - Pipe raw FFmpeg blocking tanpa batas waktu tulis

Severity: Medium

`StreamBroadcaster._write_all()` menggunakan blocking pipe write sampai buffer selesai. Jika FFmpeg hidup tetapi RTMP macet, thread dapat tertahan dan `join(timeout=3)` tidak menjamin thread benar-benar berhenti.

### AUD-012 - Status connected dapat false-positive

Severity: Medium

`FfmpegLogWatcher` menandai progress berdasarkan log `frame=`. Itu membuktikan encoder membuat frame, bukan selalu bahwa platform ingest sudah menerima dan menayangkan stream.

### AUD-013 - `sync.sh` dapat hard reset tanpa flag force

Severity: Medium

Jika `git pull --ff-only` gagal, script mencetak warning lalu menjalankan `git reset --hard origin/main` walaupun `FORCE_GIT_RESET` bukan `1`.

Dampak: perubahan lokal di pod dapat hilang tanpa persetujuan eksplisit.

### AUD-014 - Cleanup proses bersifat global dan memakai SIGKILL

Severity: Low/Medium

`start.sh` memakai `pkill -9` berdasarkan pola `api_server.py`, broadcaster, dan `ffmpeg.*rtmp`, bukan PID/process group worker tertentu. Service lain pada host/pod dapat ikut berhenti dan cleanup normal tidak terjadi.

### AUD-015 - Artefak Pocket-TTS kosong dan helper VoxCPM2 tidak terhubung

Severity: Medium, dead code/operational ambiguity

`deploy/pocket_tts/worker.py` dan `tts_service.py` kosong. `api_server.py` memiliki `_synthesize_voxcpm2_wav()` yang merujuk `voxcpm2_bridge`, tetapi simbol itu tidak ditemukan pada folder deploy. Dokumentasi juga menyebut `/tts/health`, tetapi tidak ada route worker yang membuktikan kontrak tersebut.

## Penilaian terhadap permintaan

### 1. Idle pada AI worker

Belum aman. Jalur idle/stall yang teridentifikasi: `NameError` lifecycle atau utterance route, pre-queue gate dan hard preroll, queue/thread prep tanpa batas, completion lintas thread, blocking pipe, serta fallback video yang tetap berjalan walaupun inference atau publish gagal.

### 2. Temuan perilaku tak terduga

Belum nol. Temuan paling berisiko adalah global/function undefined, cancellation async yang tidak menghentikan thread sync, hard reset deployment, dan cleanup proses global.

### 3. Audio/video/MuseTalk sync dan truncation

Belum dapat dinyatakan 100% sync. Mode `ai_worker` sudah berusaha menjaga satu packet sequence untuk frame dan PCM, memakai preroll mouth, grace tail, serta body-only saat mouth miss. Namun kontrak durasi `.ffseg`, FPS lintas mode, dan exit code FFmpeg belum dipaksa sehingga truncation/drift masih mungkin.

### 4. Audit mendalam

Audit statis folder `deploy/` telah dilakukan. Audit runtime belum dilakukan dan memang tidak dieksekusi sesuai permintaan. Hasil ini tidak mengklaim stream production sehat.

## Langkah perbaikan yang direkomendasikan, belum dijalankan

1. Perbaiki semua simbol lifecycle undefined dan tambahkan test endpoint start, status, queue, utterance.
2. Tetapkan satu `STREAM_FPS` dan satu kontrak sample rate/channel untuk inference, SpeechBridge, `.ffseg`, frame-feed, core pipeline, dan FFmpeg.
3. Ubah prep audio menjadi bounded queue dengan worker terbatas, rate limit, status job, dan backpressure.
4. Tetapkan deadline preroll absolut. Jika inferensi gagal, tandai job failed atau fallback body-only tanpa menahan audio.
5. Buat completion state machine yang idempotent dengan watchdog active utterance dan test semua kombinasi audio/visual tail.
6. Validasi invariants media sebelum `ready.flag`: frame count, `frames/fps`, durasi PCM, dan toleransi drift.
7. Periksa `returncode` FFmpeg, stderr, `ffprobe`, dan ukuran output sebelum job sukses.
8. Tambahkan supervisor restart dengan backoff, batas percobaan, serialisasi start/stop, dan cancellation event.
9. Pastikan shutdown dapat memutus blocking write dan semua thread/FD selesai.
10. Pisahkan status encoder, bytes written, ingest handshake, dan platform acknowledgement.
11. Ubah sync/cleanup script agar tidak hard reset atau membunuh proses global tanpa flag eksplisit.
12. Bersihkan atau implementasikan kontrak TTS worker agar tidak ada dead code yang tampak sebagai fallback.

## Validasi wajib setelah perbaikan

Validasi berikut belum dijalankan:

- AST check bahwa semua global/function route terdefinisi.
- Unit test SpeechBridge untuk audio 0 ms, 1 frame, audio lebih panjang dari Whisper, dan queue burst.
- Unit test state machine untuk audio end, grace tail, visual exception, stop, restart, dan utterance berurutan.
- Fixture `.ffseg` yang membandingkan durasi PCM dengan `frames / fps`.
- Test inference dengan FFmpeg exit non-zero dan BrokenPipe.
- Stress test 24/30 FPS dengan queue penuh dan RTMP write lambat.
- Soak test minimal 1 jam untuk memastikan queue/thread/VRAM tidak tumbuh.
- Telemetry untuk sequence gap, duplicate frame, dropped speech packet, queue age, drift, preroll wait, active utterance age, dan FFmpeg health.
- Smoke test endpoint health, start-broadcast, broadcast-status, live-utterance, queue-status, stop-broadcast, serta start ulang target sama/berbeda.

## Catatan non-temuan

- `get_errors` tidak melaporkan diagnostic error workspace.
- `AIVisualWorker` memang membuat `self._face_registry`; klaim bahwa atribut itu selalu hilang tidak dimasukkan sebagai temuan.
- Desain sudah memiliki mitigasi yang benar arahnya: packet frame+PCM bersamaan, hard preroll, grace tail, sequence ordering, body-only saat mouth miss, dan fallback idle. Mitigasi tersebut belum cukup untuk menyatakan kontrak bebas truncation dan bebas stall.
