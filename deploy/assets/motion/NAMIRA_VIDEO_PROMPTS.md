# Namira — Prompt pack video body (Motion Library)

Pakai **`namira.png`** sebagai reference wajah/outfit (image-to-video / character lock).  
MuseTalk hanya ganti mulut — **body clip jangan bicara keras / jangan articulasi bibir berlebih**.

## Lock global (tempel di setiap prompt)

**Character lock**
```
Same young Southeast Asian woman as reference: long dark wavy hair parted in the middle, light beige blazer with sleeves rolled to elbows, white scoop-neck top, dark bottoms, natural makeup, subtle closed-mouth smile. Exact same identity, outfit, hairstyle, and colors as the reference image.
```

**Camera / frame**
```
Vertical 9:16, medium shot waist-up, subject centered, headroom above hair, clean light-gray studio background, soft even studio lighting, no harsh shadows, no props unless specified, no text, no watermark, photorealistic live-commerce host.
```

**Motion rules**
```
Natural human motion, smooth, no teleport, no morph ghosting, no sudden jumps, keep torso mostly stable for face compositing, hands stay in frame, loop-friendly: first frame nearly matches last frame for idle/talk loops.
```

**Negative (semua clip)**
```
different face, different clothes, different hair, cartoon, anime, extra fingers, deformed hands, blurry face, talking with wide mouth, chewing, singing, dancing, walking away, sitting down, zoom in/out, camera shake, cut edits, split screen, logo, subtitles, product close-up covering face
```

**Tech target**
| | |
|---|---|
| Aspect | 9:16 |
| Res | 1080×1920 (min 720×1280) |
| FPS | 30 |
| Durasi idle | 3–5 s (loop) |
| Durasi talk/gesture | 4–8 s |
| Durasi transition | 1–2 s |

---

## Catatan aset seed (2026-09-05)

`namira_idle_2/3/4` aslinya **talk body** yang dipotong start≈end.  
Sudah di-remap di `assets/3d/`:

| File | Peran |
|---|---|
| `namira_idle.mp4` / `namira_idle_1.mp4` | true idle |
| `namira_talk.mp4` | ex idle_2 |
| `namira_talk_2.mp4` | ex idle_3 |
| `namira_talk_3.mp4` | ex idle_4 |

## P0 — Talk (sudah terisi dari remap; regenerate kalau mau kualitas khusus talk)

File → `deploy/assets/3d/`

### `namira_talk.mp4` — speaking utama
```
[CHARACTER LOCK] [CAMERA]
Live shopping host speaking to camera with calm sales energy: small natural hand gestures near waist/chest, slight forward lean, gentle head nods while explaining, shoulders relaxed, closed or lightly parted lips (no exaggerated talking mouth), friendly eye contact to camera, subtle breathing. Loop-friendly: start and end pose nearly identical, hands returning near clasped position. Duration 5–6 seconds, 30fps.
```

### `namira_talk_2.mp4` — speaking variasi
```
[CHARACTER LOCK] [CAMERA]
Same host mid-pitch explanation: open right hand palm-up presenting an imaginary product at chest height, left hand relaxed at side/waist, soft rhythmic nods, slight weight shift, warm engaging expression, minimal mouth movement. Start/end near neutral waist-up pose for looping. Duration 5–6 seconds, 30fps.
```

### `namira_talk_3.mp4` — explaining
```
[CHARACTER LOCK] [CAMERA]
Host explaining product benefits: both hands open in a counting/listing gesture (one then two fingers lightly), then return toward center, head tilts slightly while clarifying, energetic but controlled, eye contact camera, no walking. Loop-friendly start≈end. Duration 6–7 seconds, 30fps.
```

---

## P1 — Idle (sudah punya 1–4; opsional tambah)

Sudah ada: `namira_idle_1..4.mp4`. Tambahan jika mau coverage:

### `namira_idle.mp4` — primary rest (opsional alias)
```
[CHARACTER LOCK] [CAMERA]
True idle rest pose: hands softly clasped at waist, very subtle breathing, tiny natural blinks and micro head sway, almost still, calm polite smile, no gestures. Perfect loop first≈last frame. Duration 4 seconds, 30fps.
```

### `namira_idle_5.mp4` — micro sway
```
[CHARACTER LOCK] [CAMERA]
Idle micro-motion: ultra-subtle side-to-side weight shift, soft shoulder breathe, occasional blink, hands stay clasped, no big arm moves. Loop-friendly. Duration 3–4 seconds, 30fps.
```

---

## P2 — MVP library (setelah talk jalan)

Naming: `namira_{stem}.mp4` → import jadi asset id `{stem}`.

### Speaking pool (tambahan → total ~10)

| File | Prompt inti |
|---|---|
| `namira_talk_4.mp4` | Soft nod + small open-hand invitation “ayo cobain”, energy medium, loopable |
| `namira_talk_5.mp4` | Lean-in confidential tip tone, hands closer to chest, quieter energy |
| `namira_talk_6.mp4` | Cheerful upsell energy, light bounce in shoulders, smile brighter, still waist-up |
| `namira_talk_7.mp4` | Steady presenter mode, hands parallel moving slightly apart/together |
| `namira_talk_8.mp4` | Q&A answer vibe: head tilt listen→nod→small affirmative hand |
| `namira_talk_9.mp4` | Closing sentence energy: hands settle, gentle bow-nod, return rest |
| `namira_talk_10.mp4` | Warm thank-you speaking, palms soft open then clasp |

Template:
```
[CHARACTER LOCK] [CAMERA]
{PROMPT INTI}. Minimal mouth articulation, photoreal, loop-friendly start≈end, 5–6s, 30fps.
```

### Explain (10)

| File | Prompt inti |
|---|---|
| `namira_explain_1.mp4` | Point to features in air with index (not aggressive), then open palm |
| `namira_explain_2.mp4` | Compare A vs B: two-hand left/right present |
| `namira_explain_3.mp4` | Step-by-step: count 1-2-3 with fingers |
| `namira_explain_4.mp4` | “Ingredient / bahan” show: cupped hands presenting |
| `namira_explain_5.mp4` | Size/scale: hands measuring distance in front of torso |
| `namira_explain_6.mp4` | Benefit highlight: upward open hand + nod |
| `namira_explain_7.mp4` | How-to use: small demo motion mid-air |
| `namira_explain_8.mp4` | Price-value: calm emphatic palms down settle |
| `namira_explain_9.mp4` | Storytelling explain: softer hands, head sway |
| `namira_explain_10.mp4` | Summary wrap: hands gather to center clasp |

### Emphasis (5)

| File | Prompt |
|---|---|
| `namira_emphasis_1.mp4` | Strong single nod + short open-hand punch (not violent), “penting!” energy, 4s |
| `namira_emphasis_2.mp4` | Both hands brief outward pop then settle, excited but controlled |
| `namira_emphasis_3.mp4` | Index finger up “poin utama”, then lower |
| `namira_emphasis_4.mp4` | Heart/chest touch brief then open to camera (sincere) |
| `namira_emphasis_5.mp4` | Double nod + smile brighten, micro bounce |

### Pointing (5)

| File | Prompt |
|---|---|
| `namira_point_1.mp4` | Point lower-third product zone (down-right of frame), eyes glance then back to camera |
| `namira_point_2.mp4` | Point down-left, same gaze pattern |
| `namira_point_3.mp4` | Point toward camera “kamu”, friendly not rude |
| `namira_point_4.mp4` | Two-hand present toward product shelf zone then retract |
| `namira_point_5.mp4` | Soft point + open palm invite |

### Reaction (5)

| File | Prompt |
|---|---|
| `namira_react_happy.mp4` | Delighted reaction: smile widen, small clap-ready hands (no loud clap), nod |
| `namira_react_surprise.mp4` | Soft surprise: eyebrows up, hand near chest, then recover smile |
| `namira_react_agree.mp4` | Strong agree: repeated nods, thumbs-up optional then lower |
| `namira_react_laugh.mp4` | Light laugh shoulders, closed-mouth chuckle, eyes soft |
| `namira_react_wow.mp4` | “Wow” silent mouth shape brief + open hands, then neutral |

### Thinking / waiting (4)

| File | Prompt |
|---|---|
| `namira_think_1.mp4` | Thinking: slight gaze away/down, finger near chin lightly, then back to camera |
| `namira_think_2.mp4` | Listening: attentive head tilt, hands clasped, micro nod |
| `namira_wait_1.mp4` | Waiting patiently: calm blink, tiny sway, polite smile |
| `namira_wait_2.mp4` | Soft “one moment” palm-up gesture then rest |

### Transition bridges (10) — pendek, untuk A→B

| File | Prompt |
|---|---|
| `namira_trans_idle_to_talk.mp4` | From clasped idle → hands begin to open for speaking, 1.5–2s |
| `namira_trans_talk_to_idle.mp4` | From open speaking hands → settle clasped idle, 1.5–2s |
| `namira_trans_talk_to_explain.mp4` | Speaking hands → explain counting posture |
| `namira_trans_explain_to_point.mp4` | Explain open hands → point gesture |
| `namira_trans_point_to_talk.mp4` | Point retract → speaking open hand |
| `namira_trans_talk_to_react.mp4` | Neutral speak → happy react start |
| `namira_trans_react_to_idle.mp4` | React settle → idle clasp |
| `namira_trans_think_to_talk.mp4` | Chin-think → camera eye contact speak ready |
| `namira_trans_idle_micro_a.mp4` | Idle clasp → micro sway idle, 1s |
| `namira_trans_idle_micro_b.mp4` | Micro sway → clasp rest, 1s |

Tambah tag semantic di prompt: `transition bridge clip, seamless pose continuity, no cut`.

---

## Urutan produksi (praktis)

1. **P0** — `talk`, `talk_2`, `talk_3` (biar live + MuseTalk usable)  
2. Match lighting/pose ke idle yang sudah ada (cek frame tengah idle_1)  
3. Import: taruh di `deploy/assets/3d/` lalu  
   `python -m motion.import_legacy --avatar namira --extract-features`  
   `python -m motion.build_graph --avatar namira`  
4. Baru lanjut explain / point / react / transition  
5. Jangan generate ratusan dulu — **P0 dulu**

## QA cepat sebelum pakai

- [ ] Wajah & outfit = reference  
- [ ] 9:16 waist-up, background abu studio  
- [ ] Tidak ada gerak ekstrem / keluar frame  
- [ ] Idle/talk loop: frame awal ≈ akhir  
- [ ] Mulut tidak “nyanyi / ngomong lebar” (MuseTalk yang isi)  
- [ ] Nama file sesuai tabel di atas  
