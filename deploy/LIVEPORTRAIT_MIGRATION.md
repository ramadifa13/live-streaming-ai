# LivePortrait Real-Time Migration Guide

Dokumen ini menjelaskan apa saja yang perlu diimplementasikan jika ingin migrasi dari **MuseTalk batch + clip per action** ke **LivePortrait streaming** untuk AI Host yang lebih natural.

> **Status saat ini:** Stack production = MuseTalk + Edge TTS + clip gesture (`namira_wave.mp4`, dll).  
> LivePortrait **belum diimplementasikan** — dokumen ini roadmap teknis saja.

---

## Mengapa LivePortrait?

| Aspek | MuseTalk + clip (sekarang) | LivePortrait streaming |
|-------|---------------------------|------------------------|
| Gerakan badan | Terbatas clip 3–8 detik, loop jika audio panjang | Fluid frame-by-frame dari 1 foto |
| Latency render | 3–15 detik per clip | <1 detik per frame batch |
| Transisi | Hard cut idle ↔ AI | Bisa smooth / continuous |
| Biaya GPU | Rendah (~Rp12.500/jam RunPod) | Lebih tinggi (GPU lebih aktif) |
| Kompleksitas | Sedang | Tinggi |

**Target biaya user:** < Rp50.000/jam → LivePortrait hanya feasible dengan GPU kecil + aggressive idle policy + short utterances.

---

## Arsitektur Target

```
Brain (Groq) → TTS (Edge) → Audio stream/chunks
                                    ↓
                         LivePortrait Engine (GPU)
                                    ↓
                         Frame buffer (ring 2–3s)
                                    ↓
                         FFmpeg RTMP (existing broadcaster)
```

Perbedaan utama: **tidak ada file MP4 per utterance**. Engine menghasilkan frame stream langsung ke broadcaster pipe.

---

## Komponen yang Harus Dibuat

### 1. `deploy/liveportrait_engine.py`

Wrapper around LivePortrait inference:

- Input: `source_image` (avatar PNG), `driving_audio` (16kHz WAV path atau PCM stream)
- Output: raw H.264 frames atau PNG sequence → pipe ke FFmpeg
- Warmup: load model sekali saat worker boot (sama seperti MuseTalk warmup)
- Config: `LP_FPS=25`, `LP_BATCH=4`, `LP_USE_FP16=true`

**Fungsi minimum:**

```python
class LivePortraitEngine:
    def warmup(self, avatar_image_path: str) -> None: ...
    def render_utterance(self, audio_path: str, task_id: str) -> Iterator[bytes]: ...
    def render_idle_loop(self) -> Iterator[bytes]: ...  # micro-motion dari foto
```

### 2. `deploy/liveportrait_worker.py`

Pengganti sebagian `live_worker.run_pipeline`:

| Endpoint lama | Endpoint baru |
|---------------|---------------|
| `POST /stream/live-utterance` (async MP4) | `POST /stream/live-utterance-stream` (start frame pump) |
| `GET /stream/queue-status` | `GET /stream/buffer-status` (frame buffer depth ms) |

**Queue model baru:**

- `playable_buffer_ms` — ms frame siap di ring buffer
- `render_in_flight` — boolean
- Tidak pakai `total_videos_rendered` counter

### 3. Refactor `deploy/broadcaster.py`

Saat ini: baca file MP4 dari folder `output/`.

LivePortrait mode:

- Baca dari **named pipe** atau **shared memory frame queue**
- Mode hybrid (transisi): MuseTalk MP4 fallback jika LivePortrait gagal
- Idle: LivePortrait micro-motion loop (blink + head sway) bukan file `namira_idle.mp4`

**Perubahan:**

```python
# Mode flag dari broadcast_config.json
"render_mode": "musetalk" | "liveportrait" | "hybrid"
```

### 4. Backend `runpod-bridge.ts`

- Tambah `forwardToRunPodStream()` — kirim audio WAV, tidak tunggu MP4
- Poll `buffer-status` dengan metrik **milliseconds**, bukan file count
- Feature flag: `AVATAR_RENDER_MODE=liveportrait`

### 5. Backend `live-host-orchestrator.ts`

- Buffer policy based on `playable_buffer_ms` (target: 3000–8000ms)
- Speech max 15–25 kata (LivePortrait lebih sensitif durasi)
- Parallel: TTS chunk N+1 while frame N rendering (pipeline overlap)

### 6. `tts.ts` — streaming chunks (opsional fase 2)

- Split speech jadi 2 chunk by punctuation
- Chunk 1 mulai render sebelum chunk 2 selesai di-TTS
- Mengurangi perceived latency ~30–40%

---

## Asset Requirements

| Asset | MuseTalk (now) | LivePortrait |
|-------|----------------|----------------|
| Avatar | 7 clip MP4 + 1 PNG | **1 PNG high-res** (512×512 min, frontal) |
| Gesture library | Per-action MP4 | **Driving template** (optional .pkl motion) |
| Idle | `namira_idle.mp4` loop | **Micro-motion dari engine** |

Tidak perlu expand gesture library MP4 — LivePortrait bisa pakai driving signal dari audio energy + optional template.

---

## GPU & Biaya

Estimasi RunPod RTX 4090 / A4000:

| Mode | GPU util | Est. cost/jam |
|------|----------|---------------|
| MuseTalk batch (now) | 20–40% burst | ~Rp12.500 |
| LivePortrait continuous | 60–85% | ~Rp25.000–40.000 |
| Hybrid (LP live + MuseTalk fallback) | 40–60% | ~Rp18.000–30.000 |

Untuk tetap **< Rp50.000/jam**:

- Pod mati saat tidak live (sudah ada `runpod-manager` idle shutdown)
- Preview dashboard tetap static (tidak GPU) — **sudah sesuai kebijakan user**
- Max concurrent render = 1, speech pendek
- Gunakan GPU tier lebih kecil (RTX 3060 12GB) dengan batch kecil

---

## Migration Phases

### Phase 0 — Preparation (1 minggu)

- [ ] Benchmark LivePortrait di RunPod pod yang sama dengan MuseTalk
- [ ] Ukur: latency audio→first-frame, FPS stabil, VRAM usage
- [ ] Tentukan `render_mode` feature flag di `.env`

### Phase 1 — Parallel engine (2 minggu)

- [ ] Implement `LivePortraitEngine` dengan output MP4 (drop-in replacement MuseTalk)
- [ ] A/B test kualitas vs MuseTalk pada utterance yang sama
- [ ] Tidak ubah broadcaster — masih file-based

### Phase 2 — Streaming pipe (2–3 minggu)

- [ ] Frame ring buffer + broadcaster pipe input
- [ ] Buffer telemetry in milliseconds
- [ ] Idle micro-motion dari engine (ganti `namira_idle.mp4` loop)

### Phase 3 — Full integration (1–2 minggu)

- [ ] Orchestrator buffer policy ms-based
- [ ] TTS chunk overlap
- [ ] Hybrid fallback MuseTalk
- [ ] Load test 2H session

### Phase 4 — Production (1 minggu)

- [ ] Feature flag rollout
- [ ] Monitoring: idle streak, buffer ms, render latency p95
- [ ] Cost dashboard per session

---

## Files to Modify (Checklist)

| File | Change |
|------|--------|
| `deploy/liveportrait_engine.py` | **NEW** — core inference |
| `deploy/liveportrait_worker.py` | **NEW** — API endpoints |
| `deploy/live_worker.py` | Add `render_mode` switch |
| `deploy/broadcaster.py` | Pipe input mode + micro-idle |
| `deploy/api_server.py` | New buffer-status endpoint |
| `backend/src/services/runpod-bridge.ts` | Stream mode + ms metrics |
| `backend/src/services/live-host-orchestrator.ts` | ms-based buffer policy |
| `backend/src/services/tts.ts` | Optional chunk streaming |
| `backend/.env.example` | `AVATAR_RENDER_MODE`, `LP_*` vars |

---

## Risiko & Mitigasi

| Risiko | Mitigasi |
|--------|----------|
| GPU cost > Rp50k/jam | Hybrid mode, pod auto-stop, short speech |
| Lip-sync quality regression | A/B test phase 1 before streaming |
| VRAM OOM | fp16, batch=2, single avatar cache |
| Latency spike on cold start | Pre-warm at Step 3 (optional, user pays only on live) |
| Breaking existing MuseTalk flow | Feature flag `AVATAR_RENDER_MODE=musetalk` default |

---

## Rekomendasi

1. **Jangan migrasi big-bang** — jalankan Phase 1 (LP output MP4) dulu tanpa ubah broadcaster.
2. **Tetap MuseTalk sebagai fallback** minimal 3 bulan setelah LP production.
3. **Fokus naturalness dulu di MuseTalk stack** (sudah diimplementasikan: action wiring, buffer fix, emotion TTS, idle chunk ≤5s) sebelum invest LivePortrait.
4. Go/no-go decision setelah Phase 1 benchmark: jika LP MP4 quality ≥ MuseTalk dan latency ≤ 8s, lanjut Phase 2.

---

## Referensi

- LivePortrait: https://github.com/KwaiVGI/LivePortrait
- MuseTalk (current): `deploy/inference.py`, `MuseTalk/`
- Worker API: `deploy/api_server.py`
- Orchestrator: `backend/src/services/live-host-orchestrator.ts`
