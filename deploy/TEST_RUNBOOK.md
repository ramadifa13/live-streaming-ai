# Runbook Deploy & Uji Manual

Panduan menerapkan perbaikan hasil audit AI host dan mengujinya di siaran nyata.

Kedua sisi (backend VPS dan pod RunPod) melakukan `git pull`, jadi **perubahan
harus di-push ke `origin/main` lebih dulu** — kalau tidak, keduanya akan tetap
menjalankan kode lama.

---

## 0. Push perubahan

Dari mesin development:

```bash
git add -A
git commit -m "fix(live): normalisasi aset, encoder konsisten, cegah FFmpeg yatim, hentikan tagihan pod statis"
git push origin main
```

Perubahan mencakup 8 file MP4 aset yang sudah dinormalisasi, jadi push-nya
membawa sekitar 6 MB data biner.

---

## 1. Pod RunPod (GPU worker)

### 1.1 Redeploy

Jalankan di terminal pod:

```bash
bash /workspace/live-streaming-ai/deploy/redeploy-worker.sh
```

Skrip ini `git pull`, menyinkronkan semua skrip dan aset, mematikan worker lama,
lalu menyalakan ulang.

> **Penting:** gunakan `redeploy-worker.sh`, jangan `start.sh` saja.
> `sync-worker.sh` default memakai `cp -rn` yang **tidak menimpa** aset lama,
> sehingga klip berresolusi campur akan tetap terpakai. `redeploy-worker.sh`
> menyetel `FORCE_ASSETS=1` sehingga aset benar-benar diganti.

Jika `git pull` konflik:

```bash
FORCE_GIT_RESET=1 bash /workspace/live-streaming-ai/deploy/redeploy-worker.sh
```

### 1.2 Smoke test

```bash
bash /workspace/ai_live_worker/smoke-test.sh
```

Harus melaporkan `0 gagal`. Yang divalidasi:

| Langkah | Yang dibuktikan |
| --- | --- |
| Lingkungan | vCPU minimal 8 dan RAM minimal 20 GB, sesuai kebutuhan pipeline |
| Keseragaman aset | 8 klip semuanya 720x1280, 25 fps, punya stream audio |
| Invariant FFmpeg | 7 varian perintah broadcaster keluar dengan parameter stream identik |
| Render nyata | Output MuseTalk benar-benar 720x1280 25 fps |
| Penamaan prioritas | Jawaban komentar memakai prefix `prio_` |
| Proses yatim | Tidak ada FFmpeg tertinggal setelah `stop-broadcast` |

Kalau langkah aset gagal, aset belum tersinkron:

```bash
FORCE_ASSETS=1 bash /workspace/ai_live_worker/sync-worker.sh
```

Cache landmark basi (`*_coords.pkl`) tidak perlu dihapus manual. Cache sekarang
menyimpan signature berisi jumlah frame, dimensi, dan `bbox_shift`, lalu
diekstrak ulang otomatis saat tidak cocok. Log akan menampilkan
`[AvatarCache] Cache landmark ... tidak cocok`.

---

## 2. Backend VPS

```bash
bash /root/deploy.sh
```

Skrip ini pull, `npm install`, `prisma generate`, build backend dan frontend,
lalu restart PM2.

Verifikasi:

```bash
pm2 status
pm2 logs api --lines 50
```

### Variabel environment baru

Semuanya punya default aman, jadi tidak wajib diisi. Tambahkan ke
`backend/.env` hanya bila ingin menyetel ulang:

| Variabel | Default | Fungsi |
| --- | --- | --- |
| `RUNPOD_MIN_VCPU` | `8` | Turunkan bila stok pod 8 vCPU langka |
| `RUNPOD_MIN_MEMORY_GB` | `24` | Turunkan bila stok terbatas |
| `RUNPOD_CONTAINER_DISK_GB` | `10` | Ruang untuk log dan output |
| `RUNPOD_KEEP_POD_WARM` | `false` | `true` = pod statis dibiarkan menyala (GPU tetap ditagih) |
| `LIVE_PENDING_TIMEOUT_MS` | `1800000` | Batas sesi menggantung di status `pending` |
| `BROADCAST_IDLE_CHUNK_SECONDS` | `3.0` | Panjang chunk idle di worker |

### Perubahan perilaku yang perlu Anda tahu

Sebelumnya pod statis (`RUNPOD_POD_ID` terisi) **dilewati** saat stop, sehingga
GPU tertagih terus. Sekarang pod itu menerima `podStop`.

Artinya setelah setiap sesi berakhir, pod dev Anda akan **berhenti**. Volume dan
seluruh setup tetap utuh, dan sesi berikutnya menyalakannya kembali otomatis
lewat `podResume` di `startPodAndWait` — tetapi start pertama akan lebih lambat
karena harus resume. Kalau untuk sesi uji Anda ingin pod tetap panas, set
`RUNPOD_KEEP_POD_WARM=true` sementara, lalu **kembalikan ke `false`** sebelum
produksi.

---

## 3. Uji siaran manual

Jalankan satu sesi pendek, misalnya 15-20 menit, ke akun uji.

### Yang harus diamati

**Sambungan antar segmen.** Perhatikan peralihan dari satu kalimat ke kalimat
berikutnya, dan dari idle ke bicara. Sebelumnya di sini siaran bisa terputus
karena parameter stream berubah. Sekarang seharusnya mulus, meski masih ada jeda
sangat singkat di batas segmen — itu keterbatasan arsitektur segmen-per-file yang
hanya hilang lewat migrasi frame-feed.

**Idle tidak berkedip.** Idle dulu diberi fade in dan fade out setiap chunk
sehingga terlihat berdenyut. Sekarang idle memakai `-stream_loop` tanpa fade.

**Tidak ada suara ganda saat idle.** Audio idle kini disenyapkan eksplisit lewat
`anullsrc`, bukan mengandalkan isi file.

**Urutan bicara logis.** Host tidak boleh menyinggung sesuatu yang belum
diucapkan. Ini yang diperbaiki oleh pengurutan berbasis urutan submit.

**Komentar dijawab cepat.** Kirim komentar dari akun lain. Jawaban seharusnya
naik ke depan antrian, bukan menunggu seluruh buffer habis.

### Log yang dipantau

```bash
# Terminal pod 1
tail -f /workspace/ai_live_worker/api_server.log

# Terminal pod 2
tail -f /workspace/ai_live_worker/live_videos/broadcaster.log
```

Yang wajar terlihat:

- `[BROADCASTER] Crossfade 0.5s: ... → ...`
- `[AvatarCache] Avatar ... cached` sekali per klip di awal
- `[AI-Worker] start-broadcast diabaikan` bila backend melakukan retry — ini
  justru bukti perbaikan idempoten bekerja dan buffer tidak dibuang

Yang menandakan masalah:

- `[WATCHDOG ALERT]` berulang → broadcaster crash, biasanya RTMP URL atau stream
  key salah. Setelah 8 percobaan watchdog berhenti sendiri dan mencetak
  `[WATCHDOG STOP]`, jadi tidak lagi restart tanpa akhir
- `Broadcaster tidak berhenti — mengirim SIGKILL` → proses tidak merespons SIGTERM
- Pesan FFmpeg soal perubahan resolusi atau `Non-monotonous DTS` → ada klip yang
  lolos normalisasi, cek ulang langkah aset

### Setelah sesi dihentikan

Pastikan tagihan benar-benar berhenti:

```bash
# Dari log backend
pm2 logs api --lines 30 | grep -i "podStop\|di-STOP\|Tagihan GPU"
```

Harus muncul `Pod ... di-STOP ... Tagihan GPU berhenti`. Konfirmasi juga di
dashboard RunPod bahwa status pod adalah `Exited`/`Stopped`, bukan `Running`.

Lalu pastikan tidak ada proses tertinggal di pod:

```bash
pgrep -a ffmpeg
pgrep -a broadcaster.py
```

Keduanya harus kosong.

---

## 4. Rollback

Aset original tersimpan di `deploy/assets_original/` pada mesin development
(tidak di-commit, ada di `.gitignore`).

Rollback kode:

```bash
git log --oneline -5
git revert <commit-sha>
git push origin main
```

Lalu jalankan ulang `redeploy-worker.sh` di pod dan `deploy.sh` di VPS.

---

## 5. Yang belum diperbaiki

Tiga item ini sengaja belum dikerjakan karena butuh keputusan, bukan sekadar
waktu:

1. **Ingest komentar TikTok dan Shopee.** TikTok tidak punya API komentar publik
   resmi. Pilihannya antara library tidak resmi, webhook, atau jalur mitra resmi.
   Selama ini belum ada, fitur jawab komentar hanya berjalan di YouTube dan
   Instagram.
2. **Migrasi frame-feed** memakai `MuseTalk/scripts/realtime_inference.py` yang
   sudah ada di repo. Ini yang menghapus jeda di batas segmen dan membuat idle
   bisa dipotong per frame.
3. **Multi-tenant** 2-3 sesi per pod untuk menurunkan COGS.
