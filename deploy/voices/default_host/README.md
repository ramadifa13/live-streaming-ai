# Voice profiles for VoxCPM2

Ganti reference voice **tanpa** mengubah Backend / LLM / Script Bank / MuseTalk.

## Struktur

```
voices/
  default_host/
    reference.wav      ← 5–30 detik, bersih, mono/stereo OK
    prompt.txt         ← opsional: transcript exact untuk hi-fi cloning
```

## Cara ganti suara

1. Rekam / siapkan WAV referensi host.
2. Timpa `voices/default_host/reference.wav` (di Network Volume: `/workspace/voices/default_host/reference.wav`).
3. (Opsional) panggil `POST /tts/invalidate-voice` di AI worker, atau restart worker.
4. Utterance berikutnya memakai timbre baru.

`voice_id` default: `default_host` (env `VOICE_ID`).

Jangan hard-code speaker name di business logic — hanya `voice_id`.
