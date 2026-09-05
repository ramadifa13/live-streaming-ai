# Motion Engine — Phase 1 (offline)

**Live path: unchanged.** All tools here are offline. Feature flags default OFF.

## Layout

```
deploy/assets/motion/{avatar}/
  library.json
  thresholds.json          # per-avatar pose/vel thresholds (calibrate later)
  graph.json
  graph_coverage.json
  meta/{asset_id}.json
  features/                # reserved for .npz dumps
  media/                   # optional copies; import may reference ../../3d/
```

## Commands (from `deploy/`)

```bash
# 1) Import legacy MP4s + extract CPU features
python -m motion.import_legacy --avatar namira --extract-features

# 2) Validate schemas
python -m motion.validate_motion_assets --avatar namira --require-media

# 3) Build graph + coverage report
python -m motion.build_graph --avatar namira

# 4) CPU matcher microbench (dry-run, not live)
python -m motion.dry_run_matcher --avatar namira --queries 1000
```

## Flags (see `.env.example`)

```
AI_MOTION_LIBRARY=0
AI_MOTION_MATCH=0
AI_SPEECH_BODY_DECOUPLE=0
AI_FRAME_BUFFER=0
AI_BEHAVIOR_ENGINE=0
AI_GPU_COMPOSITOR=0
AI_WORKER_OF_TRANSITIONS=0
```

Phase 1 does **not** read these in `ai_worker.py`. They reserve rollout slots for later phases.

## Notes

- Features use MediaPipe when installed; otherwise OpenCV silhouette proxies (`feature_source=opencv_proxy`).
- Graph coverage targets (critical >95%, dead-end=0, fallback <1%) are ENGINEERING TARGETS — tiny MVP seeds will WARN, not block.
- No generative video, no GPU residency of motion frames, no live rewrite.
