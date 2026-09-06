# AI Worker (`deploy/`)

Kode GPU worker: **VoxCPM2 TTS** + **MuseTalk** + RTMP. Di pod, file di sini di-sync ke `/workspace/ai_live_worker`.

## Layout

```
deploy/
  README.md                 ← file ini
  sync.sh / start.sh / redeploy.sh   # update & jalankan harian
  setup.sh / bootstrap_pod.sh        # setup pertama kali
  *.py                      # runtime worker (di-copy flat ke ai_live_worker)
  .env.example
  requirements-worker.txt
  voxcpm2_tts/              # paket TTS + setup venv terpisah
  voices/                   # reference.wav per voice_id
  assets/                   # idle/talk clips avatar
  live_videos/              # output sementara (tidak di-commit)
  scripts/                  # helper ops (bukan entry harian)
  docs/                     # panduan panjang
```

## Perintah yang sering dipakai

```bash
# Update kode + sync + restart API (venv)
bash /workspace/live-streaming-ai/deploy/redeploy.sh

# Setup pod baru (butuh HF_TOKEN)
export HF_TOKEN=hf_xxx
bash /workspace/live-streaming-ai/deploy/bootstrap_pod.sh
```

Ringkas: [docs/SETUP_POD.md](docs/SETUP_POD.md) · Lengkap: [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)

## `scripts/`

| Script | Fungsi |
|--------|--------|
| `run_bootstrap.sh` | Alternatif bootstrap penuh |
| `check_tts_integration.sh` | Preflight VoxCPM2 setelah sync |
| `apply_l40s_opts.sh` | Patch env L40S + restart |
| `_start_worker.sh` | Alias restart via `sync.sh --restart` |
| `validate_idle_assets.py` | Cek continuity clip idle/talk |

Contoh: `bash deploy/scripts/check_tts_integration.sh`
