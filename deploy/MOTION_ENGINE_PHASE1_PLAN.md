# Motion Engine — Performance Lock + Phase 1 Implementation Plan

**Branch:** `feature/motion-engine-migration`  
**Base:** `main` @ `81be5e12ff65ab25f3e618ee27726f6b6959f553`  
**Date:** 2026-09-05  
**Status:** Phase 1 **IMPLEMENTED** (offline package). Live runtime still untouched; flags default OFF.

This document **amends** `MOTION_ENGINE_SPEC.md` with performance & safety locks from the engineering review. Where they conflict, **this document wins**.

---

## 0. Git gate (completed)

| Item | Value |
|---|---|
| Previous branch | `main` |
| Working tree at branch create | **clean** (no uncommitted local changes to preserve) |
| New branch | `feature/motion-engine-migration` |
| Base SHA | `81be5e12ff65ab25f3e618ee27726f6b6959f553` |
| Spec already on base | `deploy/MOTION_ENGINE_SPEC.md` (tracked) |
| `deploy/motion/` package | **does not exist yet** |

Convention note: repo uses `feature/...` (not `feat/...`); branch name follows that.

---

## 1. Locked architecture (reminder)

```
LLM → BehaviorEngine → BehaviorScheduler → MotionMatcher → TransitionPlanner
    → BodyEngine → FaceEngine/MuseTalk → GPUCompositor → VideoBuffer → NVENC → RTMP
```

Generative (EchoMimicV3 / Wan2.2-Animate / MimicMotion) = **OFFLINE / ASYNC asset factory only**.

Priority order: Naturalness → Continuity → Low latency → Stability → GPU efficiency → Scalability → Visual quality.

---

## 2. Spec amendments (performance locks)

| Topic | Previous spec | Locked now |
|---|---|---|
| Playback defaults | Fixed 5 / 18 / 1.5 | **Profiles A/B/C**; pick via benchmark; prefer **minimum stable** depth |
| Lookahead storage | Implied decoded frames OK | Lookahead = **plans + asset refs + selective decode**; **no** multi-10s raw BGR in VRAM |
| A/V packing | `FrameSlot { video, audioPcm }` | **VideoRing + AudioRing** synced by PTS + AVClock |
| Pose features | jointsXy + head + shoulder | **Must include** shoulder/elbow/wrist, head orient, hand, silhouette, scale, translation, vel, accel |
| Transition thresholds | Hard-coded 0.08 / 0.10 | **Per-avatar calibrated**; no universal constants |
| Graph acceptance | avg degree ≥ 2 | **Critical coverage >95%, dead-end critical=0, fallback <1%** |
| Phase order | Spec K phases | **This plan’s order** (§5): Library+Graph → Matcher+Transition → BodyClock decouple → Behavior+Idle → Buffer/GPU/NVENC → Asset factory |
| Matcher | Could grow complex | **CPU/lightweight**; simple search for hundreds of assets; no vector DB / neural retrieval in Phase 1–2 |
| Behavior | — | No LLM/micro-inference per blink/gaze/gesture |
| Concurrency | “2 sessions estimate” | **No claim** until 1/2/3-session L40S soak |
| GPU compositor | Phase 4 target | Phase early may stay CPU OpenCV; migrate only after CPU proven bottleneck |
| OF / diffusion live | Rare / offline | Confirmed: OF rare flag-off; diffusion **never** live |
| Repetition | Strong penalty | Priority: compatibility → behavior → repetition → variety |

### Runtime MUST NEVER (enforced by flags + invariants)

Same list as engineering review §31 (first≈last playback req, rest-gate, pin-talk, ping-pong, BodyClock blocks, gen-video critical path, freeze, aggressive warp, OF/diffusion every transition, multi-10s GPU BGR, LLM for micro-motion, variety over continuity, concurrency claims without bench, delete legacy before rollback validated).

---

## 3. Current implementation review (vs locked target)

| Area | Current (`main`) | Gap vs target | Phase that closes gap |
|---|---|---|---|
| Body control | `VideoStateMachine` + seamless/ping-pong/rest-gate/pin-talk | Loop foundation still live | P2–P3 |
| Assets | `ClipAsset` + `assets/3d/*.mp4` + SSIM meta | No MotionAsset / graph / pose features | **P1** |
| Matching | None (named clip + streak) | No matcher | P2 |
| Transitions | Soft overlap / morph / ping-pong | No TransitionPlanner priority stack | P2 |
| Speech∥Body | Coupled begin_utterance / hold-talk / preroll | Not execution-decoupled | P3 |
| Behavior | Backend forces `action: "talk"`; gestures off | No BehaviorEngine/Scheduler/Timeline | P4 (this plan) |
| Idle | Single idle loop + disabled ambient | No continuous macro+micro idle | P4 |
| Buffers | `raw_queue`~24 + `render_queue`~48; A/V co-packed in packets | Need VideoRing/AudioRing + profiles A/B/C | P5 |
| Compose | CPU OpenCV mouth blend | OK for now; GPU later | P5 |
| Encode | libx264; NVENC rejected | Probe + fallback | P5 |
| Gen video | Separate ads path | Keep offline factory | P6 |
| MuseTalk | v1.5 face crop — **aligned** | Keep; decouple wait | P3 |

**Verdict:** Live stack is still Rest-Pose Loop host. Spec file exists; **zero** `deploy/motion/` code. Phase 1 is greenfield package + adapter, runtime path unchanged when flags OFF.

---

## 4. Implementation plan matrix (all phases, high level)

| File / module | Current behavior | Target behavior | Change | Risk | Perf impact | Rollback |
|---|---|---|---|---|---|---|
| `deploy/motion/schemas.py` | — | MotionAsset, PoseFeature (full), Transition, Behavior types | **ADD** | Low | None (import only) | Delete package / flag off |
| `deploy/motion/library.py` | — | Load meta + index; selective media | **ADD** | Low | CPU I/O on warmup | Flag `AI_MOTION_LIBRARY=0` |
| `deploy/motion/features.py` | SSIM only | MediaPipe/OpenCV pose+vel+accel extract | **ADD** | Med (dep) | Offline CPU; not live path | Skip extract; empty features block match |
| `deploy/motion/build_graph.py` | — | Offline graph + coverage report | **ADD** | Low | Offline only | Ignore `graph.json` |
| `deploy/motion/validate_motion_assets.py` | — | Schema + coverage gates | **ADD** | Low | Offline | N/A |
| `deploy/validate_idle_assets.py` | first≈last SSIM | Keep for legacy QA; not runtime gate | **KEEP** | Low | None | Untouched |
| `AssetBank` / `ClipAsset` | Named MP4 loops | Adapter: MotionLibrary → ClipAsset shim when flag ON | **MODIFY** (thin) | Med | Negligible if flag off | Flag off |
| `ai_worker.py` VSM | Loop/ping-pong/rest/pin | Untouched until P2 | **NO TOUCH P1** | — | — | — |
| `speech_bridge.py` | Preroll gate | Untouched until P3 | **NO TOUCH P1** | — | — | — |
| `StreamBroadcaster` | libx264 force | Untouched until P5 | **NO TOUCH P1** | — | — | — |
| `live-host-orchestrator.ts` | action talk | Untouched until P4 | **NO TOUCH P1** | — | — | — |
| `inference.py` MuseTalk | Face materials | Untouched P1 | **NO TOUCH P1** | — | — | — |
| `.env.example` | Legacy knobs | Add flags default **0** | **MODIFY** | Low | None | Revert env |
| `check_invariants.py` | seamless contract | Add optional motion-lib invariant when flag on | **MODIFY** light | Low | None | Skip new check |
| `MOTION_ENGINE_SPEC.md` | Baseline | Point to this amend | **MODIFY** note | None | None | — |

---

## 5. Revised phase order (performance-first)

| Phase | Scope | Live critical path change? |
|---|---|---|
| **P1** | Motion Library + Graph + feature extract + MVP ~50–60 assets import + flags OFF | **No** (adapter only, default off) |
| **P2** | MotionMatcher (CPU) + TransitionPlanner behind `AI_MOTION_MATCH` | Yes only when flag ON |
| **P3** | BodyClock + Speech/Body decouple (`AI_SPEECH_BODY_DECOUPLE`) | Yes when flag ON |
| **P4** | BehaviorEngine + Scheduler + Timeline + Continuous Idle | Yes when `AI_BEHAVIOR_ENGINE` ON |
| **P5** | VideoRing/AudioRing + buffer profiles A/B/C + optional GPU compositor + NVENC probe | Yes when `AI_FRAME_BUFFER` / `AI_GPU_COMPOSITOR` ON |
| **P6** | Offline generative asset factory | **Never** on live path |

---

## 6. Phase 1 kickoff report (pre-implementation)

### 6.1 Branch

`feature/motion-engine-migration` @ `81be5e12…`

### 6.2 Files that WILL be changed / added (Phase 1 only)

**Add:**
- `deploy/motion/__init__.py`
- `deploy/motion/schemas.py`
- `deploy/motion/library.py`
- `deploy/motion/features.py`
- `deploy/motion/build_graph.py`
- `deploy/motion/validate_motion_assets.py`
- `deploy/motion/README.md` (operator: how to build library/graph)
- `assets/motion/.gitkeep` + example `library.json` / schema samples (media may stay on volume)

**Modify (minimal):**
- `deploy/.env.example` — flags default `0`
- `deploy/MOTION_ENGINE_SPEC.md` — link to this amend + buffer/A-V/pose corrections
- `deploy/check_invariants.py` — optional check if `AI_MOTION_LIBRARY=1` and library present
- `deploy/ai_worker.py` — **only** if needed: 5–20 line adapter hook behind `AI_MOTION_LIBRARY=0` default that **no-ops**; prefer zero hook in P1 and load-test library offline only

**Preferred P1 strategy (safest):**  
Phase 1 = **offline tooling + on-disk library/graph**. No `ai_worker.py` behavior change until a one-line feature-flagged loader smoke test is explicitly approved. Continuity proof starts with validate + graph coverage metrics, not live matcher.

### 6.3 Files that will NOT be touched in Phase 1

- `VideoStateMachine`, rest-gate, pin-talk, ping-pong, soft_loop_wrap (legacy stays)
- `speech_bridge.py`, MuseTalk `inference.py` / `LipSyncEngine`
- `StreamBroadcaster` / NVENC policy
- `frame_fetcher_loop` / queue sizes
- `live-host-orchestrator.ts`
- Frontend LivePortrait
- Generative video services
- Deletion of any legacy path

### 6.4 Expected impact (Phase 1, flags OFF)

| Dimension | Impact | Label |
|---|---|---|
| CPU (live) | **0** — offline scripts only | ENGINEERING TARGET |
| GPU (live) | **0** | ENGINEERING TARGET |
| VRAM (live) | **0** | ENGINEERING TARGET |
| Latency (live) | **0** | ENGINEERING TARGET |
| Disk | Library meta + optional feature `.npz` | Expected |
| Offline CPU | Feature extract ~seconds–minutes per avatar MVP | ENGINEERING TARGET |

### 6.5 MVP asset set (not hundreds)

Target ~50–60 authored/imported clips:

| Bucket | Count |
|---|---|
| Idle | 5–10 |
| Speaking | 10 |
| Explain | 10 |
| Emphasis | 5 |
| Pointing | 5 |
| Reaction | 5 |
| Thinking | 4 |
| Transition | 10 |

Import existing `namira_idle` / `namira_talk*` as first seeds; mark incomplete pose features until extract runs.

### 6.6 Graph acceptance (Phase 1)

Not “avg degree ≥ 2” alone:

- Critical transition coverage **> 95%** (define critical pairs: idle↔speaking, speaking↔explain, explain↔point, *→idle)
- Dead-end **critical** nodes = **0**
- Fallback rate in dry-run matcher sim **< 1%** (offline simulator, no live hook required)

### 6.7 Benchmarks before claiming anything (Phase 1)

Offline only:

1. `validate_motion_assets.py` — schema + feature presence  
2. `build_graph.py --report` — coverage / dead-ends / cost histogram  
3. Dry-run matcher microbench: 1000 queries over MVP library → p50/p95 CPU ms (**target < 10 ms** ENGINEERING TARGET)  
4. No L40S live claim in P1

L40S 1/2/3-session soaks deferred to P3+ when live flags ON.

### 6.8 Buffer profiles (document only in P1; implement P5)

| Profile | Playback | Lookahead | Reserve |
|---|---|---|---|
| A | 2s | 5–10s | 1s |
| B | 3s | 10–15s | 1s |
| C | 5s | 15–20s | 1.5s |

Choose later by: first-response latency, underrun, LLM/TTS spike absorption, MuseTalk backlog, A/V drift, operator feel. Prefer **minimum stable** playback.

Lookahead must **not** mean 18–30s raw GPU BGR resident.

### 6.9 A/V rings (document only in P1; implement P5)

```
VideoRing[pts] + AudioRing[pts] + AVClock
```

Do not treat co-packed `audioPcm` per video frame as long-term SoT (legacy packets may remain during migration).

### 6.10 Feature flags (defaults OFF)

```
AI_MOTION_LIBRARY=0
AI_MOTION_MATCH=0
AI_SPEECH_BODY_DECOUPLE=0
AI_FRAME_BUFFER=0
AI_BEHAVIOR_ENGINE=0
AI_GPU_COMPOSITOR=0
AI_WORKER_OF_TRANSITIONS=0
```

---

## 7. Phase 1 acceptance criteria

1. Schemas validate MVP `MotionAsset` including expanded pose fields.  
2. Existing 3D clips importable to `assets/motion/{avatar}/`.  
3. Graph build produces coverage report meeting §6.6 or documents gaps explicitly.  
4. Dry-run matcher CPU microbench logged.  
5. Live worker with all flags `0` behaves **identically** to `main` (soak smoke optional).  
6. No generative model calls from `deploy/motion/`.  
7. Rollback = delete `deploy/motion/` + revert env; legacy untouched.

---

## 8. What we will NOT do next

- Rewrite `VideoStateMachine` in P1  
- Enable matcher on prod  
- Add optical flow / diffusion / TensorRT / FP8 / vector DB  
- Store multi-10s GPU BGR lookahead  
- Claim L40S multi-session capacity  
- Delete pin-talk / rest-gate / ping-pong code  

---

## 9. Awaiting approval

**Next action after your OK:** implement Phase 1 offline package only (`deploy/motion/*` + `.env.example` flags + spec amend link), default flags OFF, **no** live path behavior change unless you explicitly request the optional one-line smoke adapter.

*End of plan.*
