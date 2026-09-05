# AI Host continuity — manual repro matrix (Phase 0)

Run after deploying worker changes. Capture metrics from worker logs
(`soft_cut_mid_pose`, `soft_loop_wrap`, `preroll_timeout`, `mouth_miss_body_only`,
`broadcast_micro_advance`, `hold_talk_to_idle`, `frames_duplicated`).

## 0. Asset baseline

```bash
cd /workspace/ai_live_worker   # or deploy/
python validate_idle_assets.py --assets-dir assets/3d --write-meta --strict
python check_invariants.py
```

Expect: all idle/talk* SSIM ≥ `AI_WORKER_SEAMLESS_THRESHOLD` (0.92), or LOW flagged
clips will ping-pong instead of soft wrap.

## 1. Buffer penuh (happy path)

1. Go Live with ≥ `LIVE_MIN_BUFFER` / `GO_LIVE_MIN_UTTERANCES`.
2. Speak continuously ~5 minutes (script bank).
3. Pass if: no hard body jump; soft cut ≤ 1/min; no freeze mouth open; A/V onset < ~100ms.

## 2. Underrun TTS

1. Temporarily delay TTS (or starve GPU) ~15s mid-stream.
2. Pass if: hold talk stays on talk clip; no jump to idle before `AI_WORKER_HOLD_TALK_SEC`;
   micro-advance (not hard freeze) if render lags.

## 3. Loop wrap

1. Use a short talk clip; speak longer than one loop.
2. Seamless clip: soft wrap end→base (metric `soft_loop_wrap`).
3. Non-seamless: ping-pong (metric `talk_ping_pong`) — no morph ghost.

## 4. Sentence start lipsync

1. Watch first 200ms of each utterance.
2. Pass if: no closed-mouth-then-jump; hard preroll delays start instead of partial mouths.
