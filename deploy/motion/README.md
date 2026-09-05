# Motion Engine — Phase 1 (offline) + Phase 2 (matcher, flag-gated)

**Live path default: unchanged.** `AI_MOTION_MATCH=0` keeps legacy VSM (pin-talk / ping-pong).

## Layout

```
deploy/assets/motion/{avatar}/
  library.json
  thresholds.json
  graph.json
  graph_coverage.json
  meta/{asset_id}.json
  features/
  media/
```

## Commands (from `deploy/`)

```bash
# 1) Import legacy MP4s + extract CPU features
python -m motion.import_legacy --avatar namira --extract-features

# 2) Validate schemas
python -m motion.validate_motion_assets --avatar namira --require-media

# 3) Build graph + coverage report
python -m motion.build_graph --avatar namira

# 4) CPU matcher microbench (uses Phase-2 MotionMatcher)
python -m motion.dry_run_matcher --avatar namira --queries 1000

# 5) Invariants
python check_invariants.py
```

## Flags (see `.env.example`)

```
AI_MOTION_LIBRARY=0
AI_MOTION_MATCH=0          # set 1 to enable runtime matcher + TransitionPlanner
AI_SPEECH_BODY_DECOUPLE=0
AI_FRAME_BUFFER=0
AI_BEHAVIOR_ENGINE=0
AI_GPU_COMPOSITOR=0
AI_WORKER_OF_TRANSITIONS=0
```

When `AI_MOTION_MATCH=1`:
- `AI_WORKER_PIN_TALK` is ignored for clip selection
- idle/talk loop prefers matcher next-asset over ping-pong
- requires on-disk library under `assets/motion/{avatar}/`

## Notes

- Features use MediaPipe when installed; otherwise OpenCV silhouette proxies.
- Graph coverage targets are ENGINEERING TARGETS — idle-only MVP seeds will WARN.
- No generative video on the live path.
