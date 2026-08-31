# Runbook Deploy & Uji Manual

Panduan menerapkan perbaikan hasil audit AI host dan mengujinya di siaran nyata.

Kedua sisi (backend VPS dan pod RunPod) melakukan `git pull`, jadi **perubahan
harus di-push ke `origin/main` lebih dulu** — kalau tidak, keduanya akan tetap
menjalankan kode lama.

## Sisi mana yang perlu di-redeploy untuk apa

| Perubahan | Pod RunPod | Backend VPS |
| --- | --- | --- |
| Perbaikan audio/video (aset, broadcaster, api_server, inference) | **Ya** | Tidak |
| Perbaikan biaya GPU & lifecycle sesi (runpod-manager, session-manager) | Tidak | **Ya** |
| Paket durasi 1 Jam (orchestrator, panel frontend) | Tidak | **Ya** |

Kalau belum pernah menerapkan perbaikan audit, jalankan **keduanya**.

---

## 0. Push perubahan

Dari mesin development:

```bash
git add -A
git commit -m "feat(live): tambah paket 1 jam; fix: smoke test worker + runbook deploy"
git push origin main
```

Jika push perbaikan audit (normalisasi aset) belum dilakukan, push-nya juga
membawa 8 file MP4 sekitar 6 MB data biner.

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
| `BROADCAST_IDLE_CHUNK_SECONDS` | `1.5` | Panjang chunk idle di worker (mode segment) |
| `BROADCAST_MODE` | `segment` | `frame_feed` = encoder kontinu + idle interruptible |


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

## 2b. Paket durasi 1 Jam

Sebelumnya hanya ada 2, 8, dan 24 jam. Paket 1 jam berjalan seluruhnya di
backend dan frontend, jadi **pod tidak perlu di-redeploy** untuk fitur ini.

Yang berubah:

- `StreamPlan` di `live-host-orchestrator.ts` kini mencakup `"1H"`, lengkap
  dengan `PLAN_POLICIES["1H"]`
- `durationHoursToPlan` memetakan durasi di bawah 2 jam ke `"1H"`, sebelumnya
  semuanya jatuh ke `"2H"`
- `DURATIONS` di `BroadcastSettingsPanel.tsx` menambahkan tombol 1 Jam, dan grid
  berubah dari 3 kolom menjadi 2 kolom di mobile serta 4 kolom di desktop

Buffer paket 1H sengaja disamakan dengan 2H (`minBuffer` 10 detik,
`targetBuffer` 22 detik). Ukuran buffer melindungi syarat "tanpa idle" dan tidak
bergantung pada panjang sesi. Yang diperkecil hanya kapasitas memori host dan
rentang rotasi mode, karena sesi satu jam tidak sempat mengulang topik sebanyak
sesi panjang.

### Dua hal yang perlu Anda putuskan

**Harga.** Saya isi `Rp59.000 (Trial)` agar tangga diskon volume tetap konsisten
(per jam: 59rb, 49,5rb, 37,4rb, 29,1rb). Ubah di `DURATIONS` bila angka bisnisnya
berbeda. Biaya GPU tetap sekitar Rp12.500 per jam, masih di bawah batas Rp50.000
dari klien.

**Waktu tunggu Go Live memakan kuota.** `deadlineAt` dihitung sejak sesi dibuat,
bukan sejak siaran benar-benar mulai, sehingga menunggu operator menekan Go Live
ikut memotong durasi berbayar. Ini perilaku lama, tapi jauh lebih terasa di paket
1 jam. Sebagai penahan, batas status `pending` sekarang diskalakan ke seperempat
panjang paket dengan lantai 5 menit:

| Paket | Batas pending |
| --- | --- |
| 1 Jam | 15 menit |
| 2 Jam | 30 menit |
| 8 dan 24 Jam | 30 menit (batas `LIVE_PENDING_TIMEOUT_MS`) |

Kalau Anda ingin durasi berbayar dihitung sejak Go Live dan bukan sejak sesi
dibuat, itu perubahan terpisah pada `deadlineAt` di `live-session-manager.ts` —
beri tahu saya bila mau dikerjakan.

### Uji cepat setelah deploy

Di dashboard, pilih 1 Jam lalu mulai sesi. Verifikasi di log backend bahwa plan
yang terpakai benar:

```bash
pm2 logs api --lines 50 | grep -i "plan="
```

Harus muncul `plan=1H`, bukan `plan=2H`.

---

## 3. Uji siaran manual

Jalankan satu sesi pendek, misalnya 15-20 menit, ke akun uji.

### Yang harus diamati

**Sambungan antar segmen.** Perhatikan peralihan dari satu kalimat ke kalimat
berikutnya, dan dari idle ke bicara. Dengan `BROADCAST_MODE=frame_feed`, idle
bisa dipotong per frame dan tidak ada spawn FFmpeg antar clip — jeda seharusnya
jauh lebih pendek. Mode `segment` masih bisa punya jeda singkat di batas file.

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

## 5. Yang belum diperbaiki (di luar scope natural A/V)

1. **Ingest komentar TikTok dan Shopee** — butuh keputusan API/mitra.
2. **Multi-tenant** 2–3 sesi per pod — butuh keputusan COGS/arsitektur.

### Frame-feed + raw handoff — SELESAI

Aktif di worker `.env` (sudah di `deploy/.env`):

```bash
BROADCAST_MODE=frame_feed
MUSETALK_RAW_FEED=1
MUSETALK_SKIP_MP4=1
```

Yang sudah jalan:

- Encoder RTMP kontinu (`frame_feed.py`)
- Handoff raw `.ffseg` (tanpa double-encode MP4)
- Streaming tulis `.ffseg` (hemat RAM)
- Prefetch clip berikutnya + join AI→AI tanpa idle/fade
- Idle interruptible per frame
- Pose cycle MuseTalk berlanjut antar clip
- Auto-load `.env` di `start.sh` + `api_server.py`

Verifikasi lokal:

```bash
python deploy/verify_frame_feed.py
```

Rollback:

```bash
BROADCAST_MODE=segment
MUSETALK_SKIP_MP4=0
```
