# Voice profiles for VoxCPM2 (female hosts)

```
voices/
  girl_cute_kids/reference.wav
  girl_warm_youthful/reference.wav
  girl_warm_friendly/reference.wav
  girl_calm_professional/reference.wav
```

| voice_id | Label |
|----------|--------|
| `girl_cute_kids` | girl - cute kids |
| `girl_warm_youthful` | girl - warm & youthful |
| `girl_warm_friendly` | girl - warm & friendly |
| `girl_calm_professional` | girl - calm & professional |

Pre-live FE memakai sample statis di `frontend/public/voices/<voice_id>/preview_{id|en}.wav` (tidak hit pod).
Live streaming memakai VoxCPM2 di AI Worker dengan `voice_id` di atas.

Setelah ganti `reference.wav` di Network Volume (`/workspace/voices/...`), panggil `POST /tts/invalidate-voice` atau restart worker.
