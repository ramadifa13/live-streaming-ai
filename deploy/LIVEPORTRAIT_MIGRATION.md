# Roadmap AI Host Natural — Production & LivePortrait

Dokumen ini menjelaskan **urutan implementasi** agar AI Host terasa natural, dengan **biaya platform ~Rp 5.000–12.000/jam** sehingga harga user **≤ Rp 50.000/jam** tetap aman — whether live **2 jam atau 24 jam**, tanpa tier GPU.

> **Status saat ini:** MuseTalk + Edge TTS + clip gesture + orchestrator buffer (detik).  
> **LivePortrait belum diimplementasikan** — fase opsional setelah Phase 0–2 stabil.

---

## Kebijakan produk (wajib)

| Aturan | Detail |
|--------|--------|
| Harga user | **≤ Rp 50.000 / jam siaran aktif** (flat, bukan tier) |
| Durasi | 2 jam atau 24 jam — **stack & harga per jam sama** |
| Idle platform | **$0 GPU** saat tidak ada yang live (pod terminate) |
| Preview dashboard | Static video — **tidak pakai GPU** |
| Natural | Target UX natural via **otak + suara + lipsync + transisi**, bukan GPU mahal default |

---

## Stack production yang direkomendasikan

```
┌─────────────────────────────────────────────────────────┐
│ VPS (frontend + backend + FFmpeg RTMP + idle loop)      │
│  • Siaran continuous ke TikTok/Shopee/IG               │
│  • Loop namira_idle.mp4 saat AI tidak bicara            │
│  • Terima clip MP4 dari worker → sisip ke stream        │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP: audio in, MP4 out
                           ▼
┌─────────────────────────────────────────────────────────┐
│ RunPod — NVIDIA L4 (EU-RO-1, network volume)            │
│  • MuseTalk V1.5 render clip 8–14 detik                 │
│  • ON saat sesi live, TERMINATE saat stop               │
│  • Tidak menjalankan RTMP (hemat GPU ~40–60%)           │
└─────────────────────────────────────────────────────────┘
         ▲
         │ Groq OSS 20B + Gemini 3.6 fallback
         │ Edge TTS + emotion prosody (gratis)
         │ Orchestrator buffer 15–22 detik
```

| Lapisan | Teknologi | Peran naturalitas |
|---------|-----------|-------------------|
| Otak | Groq `openai/gpt-oss-20b` + Gemini `3.6-flash` | Script pendek, respons komentar, emotion + action |
| Suara | **Edge TTS** (`id-ID-GadisNeural`) + prosody | Intonasi hidup, **gratis** (penting untuk live 24 jam) |
| Bibir | **MuseTalk V1.5** | Lipsync pada clip talk |
| Tubuh | Clip gesture + idle loop | Wave/nod/laugh — transisi di VPS |
| GPU | **L4** on-demand | Murah, 24 GB, CUDA 11.8 OK |
| Siaran | **VPS FFmpeg** | RTMP stabil, tidak di RunPod |

**Jangan default production:** RTX 4090, Blackwell (PRO 4500/4000), static pod, ElevenLabs (mahal di live panjang), LivePortrait full-time.

---

## Perbandingan mode render

| Mode | Natural visual | COGS/jam live | Muat Rp 50k/jam (2h–24h) | Status |
|------|----------------|---------------|---------------------------|--------|
| **A — MuseTalk + VPS split** (rekomendasi) | ⭐⭐⭐⭐ | ~Rp 5.000–8.000 | ✅ | **Target Phase 0–2** |
| B — MuseTalk full pod (RTMP di RunPod) | ⭐⭐⭐ | ~Rp 8.000–12.000 | ✅ | Saat ini |
| C — LivePortrait MP4 drop-in | ⭐⭐⭐⭐ | ~Rp 12.000–18.000 | ⚠️ | Phase 3 |
| D — LivePortrait streaming | ⭐⭐⭐⭐⭐ | ~Rp 18.000–35.000 | ❌ flat 50k | Phase 4+ |
| E — D-ID / HeyGen API | ⭐⭐⭐⭐⭐ | >Rp 20.000 | ❌ | Tidak direkomendasikan |

---

## Fase implementasi (urutan wajib)

### Phase 0 — Production economics & GPU (1 minggu)

**Tujuan:** Satu jam live = satu jam bill GPU yang terkontrol; L4; terminate on stop.

| # | Task | File / config |
|---|------|----------------|
| 0.1 | Default GPU **L4**, fallback A5000 → A4000 | `backend/src/services/runpod-manager.ts`, `.env` |
| 0.2 | Exclude Blackwell dari auto-pick | `runpod-manager.ts` `BUDGET_GPU_TIERS` |
| 0.3 | Retry 4090/L4 + `RUNPOD_DATACENTER_ID=EU-RO-1` | `.env` |
| 0.4 | **Terminate pod** on session stop (bukan static pod) | `live-session-manager.ts`, jangan set `RUNPOD_POD_ID` di prod |
| 0.5 | Redeploy worker script | `deploy/redeploy-worker.sh`, `sync-worker.sh` |
| 0.6 | GPU FP32 fallback di Blackwell/non-FP16 | `deploy/gpu_compat.py`, `inference.py` |

**Env production:**

```env
RUNPOD_GPU_TYPE="NVIDIA L4"
RUNPOD_DATACENTER_ID="EU-RO-1"
RUNPOD_NETWORK_VOLUME_ID="f30wga954u"
RUNPOD_GPU_RETRY=5
# RUNPOD_POD_ID=          ← kosong di prod
GROQ_MODEL="openai/gpt-oss-20b"
GEMINI_MODEL="gemini-3.6-flash"
EDGE_TTS_VOICE="id-ID-GadisNeural"
```

**Go/no-go:** 1 sesi live 2 jam → COGS GPU < Rp 15.000/jam di invoice RunPod.

---

### Phase 1 — Naturalness di stack MuseTalk (1–2 minggu)

**Tujuan:** Natural tanpa ganti engine — otak, suara, buffer, idle.

| # | Task | File |
|---|------|------|
| 1.1 | Speech **15–25 kata**, emotion → action | `groq-brain.ts` ✅ |
| 1.2 | Emotion → TTS rate/pitch/volume | `tts.ts` ✅ |
| 1.3 | Buffer **detik** (target 15–22s, idle ≤5s) | `live-host-orchestrator.ts`, `api_server.py` ✅ |
| 1.4 | Action → gesture clip (`[CLIP]` mapping) | `live_worker.py` ✅ |
| 1.5 | **Clip talk panjang** (30–60s) ganti loop pendek | Asset: `deploy/assets/3d/namira_talk_expressive.mp4` |
| 1.6 | 2–3 variasi idle clip (anti monoton) | Assets: `namira_idle_*.mp4` |
| 1.7 | Broadcaster idle chunk ≤3.5s + warn >5s | `broadcaster.py` ✅ |

**Go/no-go:** Uji live 30 menit — idle on-air ≤5s, tidak ada hard freeze >3s.

---

### Phase 2 — Split VPS siaran + GPU render-only (2–3 minggu)

**Tujuan:** GPU hanya MuseTalk; RTMP di VPS → COGS turun ~40%, tetap natural.

#### Arsitektur

```
Backend (VPS)
  ├─ POST /internal/stream/start   → spawn FFmpeg RTMP + idle
  ├─ POST /internal/stream/play    → sisipkan MP4 clip ke FFmpeg
  └─ POST /internal/stream/stop    → kill FFmpeg

RunPod worker (L4)
  ├─ POST /stream/live-utterance   → render MP4 (existing)
  └─ POST /stream/upload-clip      → push MP4 ke VPS (URL callback)
```

#### Implementasi

| # | Task | File (baru / ubah) |
|---|------|---------------------|
| 2.1 | **Stream service di VPS** — kelola FFmpeg per sessionId | **NEW** `backend/src/services/vps-stream-service.ts` |
| 2.2 | Install ffmpeg + assets idle di VPS | `deploy/vps/setup-stream.sh` **NEW** |
| 2.3 | Copy `namira_idle.mp4` + overlay ke VPS | `deploy/assets/` → `/var/lib/livio/assets/` |
| 2.4 | Worker: setelah render, **POST clip** ke VPS (multipart atau signed URL) | `deploy/live_worker.py`, `api_server.py` |
| 2.5 | Backend: orchestrator panggil VPS play, bukan worker broadcast | `live-session.ts`, `runpod-bridge.ts` |
| 2.6 | **Matikan** `broadcaster.py` RTMP di RunPod (flag `BROADCAST_ON_VPS=1`) | `broadcaster.py`, `start.sh` |
| 2.7 | RunPod: worker cukup **render API** — terminate lebih cepat setelah sesi | `runpod-manager.ts` |

#### VPS requirements

| Spec | Minimum |
|------|---------|
| Upload | ≥5 Mbps stabil per stream |
| CPU | 2 vCPU + 1 FFmpeg per live |
| ffmpeg | `apt install ffmpeg` |

**Go/no-go:** 1 jam live — GPU bill < MuseTalk full pod; RTMP stabil di platform.

---

### Phase 3 — Transisi visual halus (1 minggu)

**Tujuan:** Kurangi hard cut clip — terasa lebih hidup tanpa LivePortrait.

| # | Task | File |
|---|------|------|
| 3.1 | **Crossfade** idle ↔ talk (FFmpeg `xfade` 0.3–0.5s) | `vps-stream-service.ts` atau `broadcaster.py` |
| 3.2 | Normalisasi loudness clip (EBU R128 ringan) | FFmpeg filter di VPS |
| 3.3 | Perluas gesture map di brain prompt | `groq-brain.ts` |
| 3.4 | Optional: 2–3 clip per action (random pick) | `live_worker.py` `_resolve_action_clip()` |

**Go/no-go:** Review blind — transisi tidak “lompat” antar segmen.

---

### Phase 4 — LivePortrait MP4 drop-in (opsional, 2 minggu)

**Tujuan:** A/B kualitas vs MuseTalk **tanpa** ubah broadcaster/stream pipe.

| # | Task | File |
|---|------|------|
| 4.1 | **NEW** `deploy/liveportrait_engine.py` | Output MP4 per utterance (same contract as MuseTalk) |
| 4.2 | Feature flag `AVATAR_RENDER_MODE=musetalk\|liveportrait` | `live_worker.py`, `.env` |
| 4.3 | Asset: 1 PNG frontal 512×512 (`namira.jpg` upgrade) | `deploy/assets/3d/` |
| 4.4 | Benchmark: latency, VRAM, COGS/jam pada **L4** | Spreadsheet / log |

**Go/no-go:**

- Kualitas ≥ MuseTalk pada utterance yang sama
- Latency p95 ≤ 10 detik per clip
- COGS **≤ Rp 15.000/jam** pada sesi 2 jam — jika tidak, **tetap MuseTalk**

---

### Phase 5 — LivePortrait streaming (opsional, 3+ minggu)

**Hanya jika** Phase 4 go **dan** harga jual user naik **ata** COGS turun signifikan.

```
Brain → Edge TTS → LivePortrait Engine (GPU, frame stream)
                              ↓
                    Ring buffer (2–3s)
                              ↓
                    VPS FFmpeg RTMP
```

| # | Task | File |
|---|------|------|
| 5.1 | `LivePortraitEngine.render_utterance()` → frame iterator | `liveportrait_engine.py` |
| 5.2 | `POST /stream/live-utterance-stream` | `api_server.py` |
| 5.3 | Buffer telemetry **milliseconds** | `api_server.py`, `runpod-bridge.ts` |
| 5.4 | Orchestrator policy ms-based (target 3–8s) | `live-host-orchestrator.ts` |
| 5.5 | Idle micro-motion dari engine (ganti idle MP4) | `liveportrait_engine.py` |
| 5.6 | Hybrid fallback MuseTalk | `live_worker.py` |

**Tidak direkomendasikan** untuk flat Rp 50.000/jam tanpa efisiensi Phase 2 (split VPS).

---

## Estimasi biaya (flat pricing)

| Skenario | COGS/jam | Margin @ Rp 50k/jam |
|----------|----------|---------------------|
| MuseTalk full pod L4 | ~Rp 8.000–12.000 | ~76–84% |
| **MuseTalk split VPS + L4** | **~Rp 5.000–8.000** | **~84–90%** |
| LivePortrait MP4 | ~Rp 12.000–18.000 | ~64–76% |
| LivePortrait stream | ~Rp 18.000–35.000 | ❌ |

Live 24 jam @ split stack: revenue Rp 1.200.000, COGS GPU ~Rp 120.000–192.000 → **masih profitable**.

---

## File checklist (kumulatif)

| File | Phase | Change |
|------|-------|--------|
| `backend/src/services/runpod-manager.ts` | 0 | L4, retry, no Blackwell |
| `backend/.env` | 0 | L4, EU-RO-1, no static pod |
| `deploy/gpu_compat.py` | 0 | FP16/FP32 detect |
| `deploy/redeploy-worker.sh` | 0 | Full sync |
| `backend/src/services/groq-brain.ts` | 1 | ✅ speech, emotion, models |
| `backend/src/services/tts.ts` | 1 | ✅ emotion prosody |
| `backend/src/services/live-host-orchestrator.ts` | 1 | ✅ buffer seconds |
| `deploy/broadcaster.py` | 1–2 | idle chunk; later disable RTMP |
| `backend/src/services/vps-stream-service.ts` | 2 | **NEW** FFmpeg on VPS |
| `deploy/vps/setup-stream.sh` | 2 | **NEW** |
| `backend/src/services/runpod-bridge.ts` | 2 | clip delivery to VPS |
| `deploy/live_worker.py` | 2, 4 | upload clip; render mode |
| `deploy/liveportrait_engine.py` | 4 | **NEW** |
| `deploy/api_server.py` | 4–5 | buffer-ms endpoints |

---

## Risiko & mitigasi

| Risiko | Mitigasi |
|--------|----------|
| GPU rebutan on-demand | L4 default; retry; nanti queue + cap concurrent |
| Live 24 jam LLM rate limit | Gemini fallback; circuit breaker ✅ |
| VPS upload lemah | Test speed; turunkan bitrate 720p; VPS stream dedicated |
| Clip EU→ID latency | Buffer 15–22s ✅ |
| LivePortrait > Rp 50k COGS | **Tetap MuseTalk**; LP hanya Phase 4+ dengan go/no-go |
| Blackwell CUDA error | L4/A5000 only; `gpu_compat.py` |

---

## Rekomendasi eksekusi

1. **Selesaikan Phase 0–1** — sudah sebagian besar ✅; fokus asset clip talk panjang + idle variasi.
2. **Phase 2 (VPS split)** — **prioritas terbesar** untuk economics + natural siaran stabil.
3. **Phase 3 crossfade** — impact visual tinggi, effort rendah.
4. **LivePortrait Phase 4+** — hanya setelah COGS terukur; **bukan blocker** untuk launch public Rp 50k/jam.

**Keputusan produk:** Satu pengalaman natural untuk semua user; **MuseTalk + Edge + Groq + VPS split + L4** adalah path production; LivePortrait adalah upgrade teknis masa depan, bukan requirement launch.

---

## Referensi

- MuseTalk: `deploy/inference.py`, `deploy/live_worker.py`
- Worker API: `deploy/api_server.py`
- Orchestrator: `backend/src/services/live-host-orchestrator.ts`
- Deploy RunPod: `deploy/DEPLOYMENT_GUIDE.md`
- LivePortrait: https://github.com/KwaiVGI/LivePortrait
