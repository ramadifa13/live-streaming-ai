# Motion Engine — Production Implementation Specification

**Status:** Implementation-ready (amended)  
**Date:** 2026-09-05  
**Scope:** Incremental migration of the live AI host pipeline from Rest-Pose Loop body to Motion Library + Graph + Matching, while keeping MuseTalk 1.5 as the face/lip-sync engine.

**Non-goals:** Full rewrite of `ai_worker.py` in one PR; skeletal Unity Motion Matching copy-paste; generative video on the live critical path; 20–45s playback latency.

> **Performance & migration lock:** See [`MOTION_ENGINE_PHASE1_PLAN.md`](./MOTION_ENGINE_PHASE1_PLAN.md).  
> Where that plan conflicts with this spec (buffer defaults, A/V rings, pose features, phase order, graph acceptance, VRAM policy), **the plan wins**.  
> Work proceeds only on branch `feature/motion-engine-migration`. All feature flags default **OFF**.

---

## Design invariants (locked)

1. MuseTalk 1.5 = face/lip-sync only. Body never waits on MuseTalk to advance.
2. Rest Pose → First≈Last → Loop is **legacy**, not the body foundation.
3. Motion Matching operates on **2D photoreal video segments**, not skeletal clips.
4. Matcher selects *what*; Transition Planner selects *how*.
5. Live transitions: native clip → pose/velocity overlap → retiming → soft blend. Optical flow rare; diffusion offline/rare only.
6. Playback buffer **3–8s**; lookahead planning/cache **10–30s**. Playback latency ≠ lookahead depth.
7. Speech and Body are **execution-decoupled**, **behavior-coupled**.
8. Continuous Idle always runs (macro assets + non-warp micro-motion).
9. Generative video = asset factory only.
10. No freeze-frame fallback; degrade to continuing idle/motion stream.
11. Design for multiple concurrent sessions on L40S 48GB.

---

## A. Current → Target Migration Map

| Current component | Location | Decision | Target |
|---|---|---|---|
| `AIVisualWorker` | `ai_worker.py` ~3052 | **KEEP** (orchestrator shell) | Owns clocks, wires new modules, session lifecycle |
| `AssetBank` | `ai_worker.py` ~513 | **MODIFY** → becomes loader backend of `MotionLibrary` | Still RAM-decodes frames + MuseTalk materials; schema expands beyond `ClipAsset` |
| `ClipAsset` | `ai_worker.py` ~285 | **MODIFY** then **REPLACE** | Temporary adapter; replaced by `MotionAsset` + frame store |
| `compute_seamless_score` / `is_seamless_loop` | `ai_worker.py` ~312, ~361 | **DELETE** (runtime) | Offline QA metric only, never drives playback |
| `VideoStateMachine` | `ai_worker.py` ~899 | **REPLACE** | Split into `IdleController` + `MotionMatcher` + `TransitionPlanner` + thin `BodyClock` |
| `PlayState` (`IDLE`/`ACTION`/`TALK`) | `ai_worker.py` ~278 | **REPLACE** | `BehaviorState` enum (see §F) |
| `begin_utterance` | `ai_worker.py` ~1120 | **MODIFY** → thin | Emits behavior event only; **no** rest-gate, **no** pin-talk cut |
| `pin_talk_body` / `PIN_TALK_SCENE` | `ai_worker.py` ~84, ~1090 | **DELETE** | Continuous body via matcher, not pinned clip |
| Rest gate (`REST_GATE_*`) | `ai_worker.py` ~91–92, ~1161+ | **DELETE** | TransitionPlanner handles A→B without waiting for rest |
| Soft wrap `soft_loop_wrap` | `_start_talk_loop_wrap` ~1403 | **DELETE** as primary | End-of-asset → matcher picks next (may soft-blend via planner) |
| Talk ping-pong | `_talk_direction` ~939, ~1406 | **DELETE** | Never reverse playback as normal path |
| Hold-talk (`HOLD_TALK_MAX_SEC`) | ~80, ~1325 | **MODIFY** → **DELETE** later | Phase 1–2: keep as safety; Phase 3+: IdleController continuous idle replaces hold-talk |
| `_OverlapTransition` / soft cut | ~503, ~1444 | **KEEP** (primitive) | Moved into `TransitionPlanner` as one strategy |
| `blend_crossfade` / `blend_weighted` | ~406–419 | **KEEP** | Used by TransitionPlanner |
| `_is_allowed_gesture` always False | ~221 | **DELETE** | Gestures scheduled by BehaviorTimeline |
| `get_llm_action` → None | ~273 | **REPLACE** | BehaviorEngine consumes LLM intent |
| `RawFramePacket` | ~371 | **MODIFY** | Add `motion_asset_id`, `behavior_state`, `pts_ms`, `transition_id`, detach lipsync from body clip identity |
| `RenderedPacket` | ~387 | **MODIFY** | Add `pts_ms`, `session_id`, GPU buffer handle when compositor lands |
| `raw_queue` / `render_queue` | ~69–70, ~3081 | **MODIFY** → **REPLACE** (Phase 4) | Become views into `FrameBuffer` (playback + lookahead + reserve) |
| `frame_fetcher_loop` | ~2232 | **MODIFY** | Driven by BodyClock + Matcher, not VSM loop logic |
| `LipSyncEngine` / MuseTalk | ~1737, `inference.py` | **KEEP** | FaceEngine wrapper; materials keyed by `motion_asset_id`+frame, not pinned talk |
| `lipsync_worker_loop` | ~2123 | **KEEP** (modify coupling) | Must not block body clock; mouth-miss → body-only already OK |
| `_talk_body_index` | ~470 | **MODIFY** | Index within current motion asset window, not global talk loop |
| `SpeechBridge` | `speech_bridge.py` | **KEEP** + **MODIFY** | Audio clock independent; notify BehaviorEngine; hard preroll becomes soft preference with timeout degrade |
| `StreamBroadcaster` | ~2369 | **MODIFY** | Enable NVENC with capability probe + libx264 fallback; pull from FrameBuffer |
| NVENC force-disable | ~2437–2446 | **MODIFY** | Probe once per pod; allow `h264_nvenc` when `OpenEncodeSession` works |
| `_IdleFallbackPlayer` | ~2320 | **REPLACE** | Reserve buffer + IdleController continuous stream (no freeze, no “replay last”) |
| `validate_idle_assets.py` | deploy/ | **MODIFY** | Validate pose features / graph connectivity, not first≈last as hard gate |
| `check_invariants.py` `check_seamless_contract` | deploy/ | **REPLACE** | New invariants: graph connectivity, no ping-pong path, FaceEngine isolation |
| `REPRO_MATRIX_CONTINUITY.md` | deploy/ | **MODIFY** | New repro cases for matcher/transition/idle |
| Backend `action: "talk"` force | `live-host-orchestrator.ts` | **MODIFY** | Emit rich `BehaviorIntent` (state, energy, tags), not binary talk |
| Frontend LivePortrait ads path | `RealtimeLivePortraitView.tsx` | **KEEP** | Remains offline/ads; not live body |
| Generative avatar-video services | backend video services | **KEEP** as factory | Wire into Asset Factory (Phase 6), never live loop |

### Legacy flags to deprecate (env)

| Flag | Fate |
|---|---|
| `AI_WORKER_PIN_TALK` | Remove after Phase 3 |
| `AI_WORKER_REST_GATE_MS` / `REST_GATE_NEAR` | Remove after Phase 2 |
| `AI_WORKER_SEAMLESS_THRESHOLD` | Offline QA only |
| `AI_WORKER_TALK_STREAK` | Replace with repetition memory |
| `AI_WORKER_HOLD_TALK_SEC` | Remove after Phase 3 |
| `AI_WORKER_AMBIENT_GESTURES=off` | Replaced by BehaviorTimeline |

---

## B. Target Service Architecture

Keep one process per session worker initially (`AIVisualWorker`), with modules as classes. Multi-session = N worker processes/containers sharing model residency where safe (see §J).

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Backend (live-host-orchestrator)                                        │
│   LLM / script bank → BehaviorIntent + TTS audio → RunPod bridge        │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────────┐
│ Session Runtime (AIVisualWorker shell)                                  │
│                                                                         │
│  BehaviorEngine ──► BehaviorTimeline                                    │
│       ▲                    │                                            │
│       │                    ▼                                            │
│  ProsodyAnalyzer ◄── SpeechBridge (audio clock)                         │
│       │                    │                                            │
│       ▼                    ▼                                            │
│  MotionMatcher ◄── MotionLibrary / MotionGraph                          │
│       │                                                                 │
│       ▼                                                                 │
│  TransitionPlanner ──► BodyClock ──► IdleController (always on)         │
│       │                                                                 │
│       ▼                                                                 │
│  FaceEngine (MuseTalk 1.5)     ← parallel, mouth crops only             │
│       │                                                                 │
│       ▼                                                                 │
│  GPUCompositor → FrameBuffer → StreamController → NVENC/RTMP            │
└─────────────────────────────────────────────────────────────────────────┘
```

### Module interfaces

```typescript
// Shared clocks (monotonic ms since session start)
type PtsMs = number;
type SessionId = string;
type AvatarId = string;
type MotionAssetId = string;

/** High-level intent from backend / LLM (behavior-coupled input). */
interface BehaviorIntent {
  sessionId: SessionId;
  utteranceId: string;
  stateHint: BehaviorState;          // EXPLAINING, POINTING, ...
  energyHint: number;                // 0..1
  emotionHint?: string;
  productTags?: string[];
  semanticTags?: string[];
  gazeHint?: GazeTarget;
  priority: "normal" | "urgent" | "cta";
  text?: string;                     // for prosody alignment hints
  audioPtsStart?: PtsMs;             // filled when TTS ready
  audioDurationMs?: number;
}

interface ProsodyFrame {
  ptsMs: PtsMs;
  rms: number;
  pitchHz?: number;
  speakingRate?: number;             // syllables/sec estimate
  isPause: boolean;
  stress: number;                    // 0..1 local emphasis
}

interface BehaviorEvent {
  atMs: number;                      // offset from behavior segment t0
  type: "gaze" | "gesture" | "head" | "emotion" | "energy" | "return";
  payload: Record<string, unknown>;
}

interface BehaviorTimeline {
  segmentId: string;
  state: BehaviorState;
  t0PtsMs: PtsMs;
  durationMs: number;
  events: BehaviorEvent[];           // sorted by atMs
}

interface MotionQuery {
  ptsMs: PtsMs;
  currentPose: PoseFeature;
  currentVelocity: VelocityFeature;
  desiredState: BehaviorState;
  desiredGesture?: string;
  energy: number;
  gaze: GazeTarget;
  hand: HandState;
  emotion: string;
  semanticTags: string[];
  excludeAssetIds: MotionAssetId[];  // repetition memory
  maxCandidates: number;
}

interface MotionCandidate {
  assetId: MotionAssetId;
  score: number;
  breakdown: Record<string, number>;
  entryFrame: number;
  suggestedTransition: TransitionKind;
}

type TransitionKind =
  | "native_clip"
  | "overlap"
  | "retime"
  | "crossfade"
  | "optical_flow"
  | "fallback_idle";

interface TransitionPlan {
  kind: TransitionKind;
  fromAssetId: MotionAssetId;
  toAssetId: MotionAssetId;
  fromFrame: number;
  toEntryFrame: number;
  durationFrames: number;
  retimeFactor?: number;             // 0.85..1.15
  nativeTransitionAssetId?: MotionAssetId;
  cost: number;
}

interface BodyFrameRequest {
  ptsMs: PtsMs;
  assetId: MotionAssetId;
  frameIdx: number;
  transition?: TransitionPlan;
  behaviorState: BehaviorState;
}

interface MouthCrop {
  ptsMs: PtsMs;
  bbox: [number, number, number, number];
  imageBgrOrGpu: unknown;            // numpy / cuda buffer
  mask: unknown;
  ok: boolean;
}

interface CompositorInput {
  ptsMs: PtsMs;
  body: unknown;                     // BGR CPU or CUDA surface
  mouth?: MouthCrop;
  overlayPng?: unknown;
}

interface FrameSlot {
  ptsMs: PtsMs;
  seq: number;
  video: unknown;
  audioPcm: Uint8Array;              // 1 frame @ fps, s16le
  ready: boolean;
  source: "lookahead" | "playback" | "reserve";
}
```

#### BehaviorEngine
- **In:** `BehaviorIntent`, `ProsodyFrame` stream, conversation state, product context.
- **Out:** `BehaviorTimeline`, current `BehaviorState`, energy/gaze/emotion setpoints.
- **Must:** schedule gestures on a timeline; apply repetition avoidance requests to matcher; never drive pixel frames directly.

#### BehaviorTimeline
- Ordered `BehaviorEvent[]` for the next 4–12s segment.
- Consumed by MotionMatcher (gesture/head) and IdleController (gaze micro when idle).

#### MotionLibrary
- CRUD/load of `MotionAsset` metadata + frame blobs (MP4 decode cache, PNG seq, or memmap).
- Levels: `micro` | `gesture` | `behavior_segment`.
- API: `get(id)`, `query(filter)`, `warmup(avatarId, preferTags[])`.

#### MotionGraph
- Precomputed adjacency: `motion_transitions`.
- API: `neighbors(assetId, filters) → TransitionEdge[]`, `isCompatible(a,b) → score`.

#### MotionMatcher
- Periodic (every 100–200ms or on event): build `MotionQuery` → score candidates → pick next asset.
- Does **not** blend frames.

#### TransitionPlanner
- Given current playhead + chosen next asset → `TransitionPlan`.
- Priority order fixed in §E.

#### IdleController
- Always produces a body playhead when no higher-priority timeline event.
- Macro: match idle micro/behavior assets; Micro: blink/saccade/head (face-layer / landmark), not aggressive body warp.

#### ProsodyAnalyzer
- From PCM (+ optional Whisper timings): RMS, pause, stress peaks → ProsodyFrame @ fps or 10ms.

#### FaceEngine
- Wrap existing `LipSyncEngine` + `inference.py` MuseTalk v1.5.
- `prepareMaterials(assetId)` async; `inferMouth(audioWindow, bodyFrameRef) → MouthCrop`.
- On backlog: skip mouth, pass body-only (`MUSETALK_MOUTH_MISS_BODY_ONLY` stay).

#### GPUCompositor
- Body + mouth + overlay → GPU surface; feather mask on GPU when possible.
- Phase 1–3 may stay CPU OpenCV; Phase 4 migrates.

#### FrameBuffer
- Three rings: playback (3–8s), lookahead (10–30s plan/cache), reserve (1–2s idle-safe).
- See §I.

#### StreamController
- A/V clock master for RTMP; pulls playback ring; backpressure into fetcher; NVENC encode.

---

## C. Data Model

### C.1 TypeScript schemas

```typescript
type MotionLevel = "micro" | "gesture" | "behavior_segment";

type BehaviorState =
  | "IDLE"
  | "LISTENING"
  | "THINKING"
  | "SPEAKING"
  | "EXPLAINING"
  | "DEMONSTRATING"
  | "POINTING"
  | "REACTING"
  | "EXCITED"
  | "HAPPY"
  | "WAITING"
  | "TRANSITIONING";

type GazeTarget =
  | "camera"
  | "product"
  | "side_left"
  | "side_right"
  | "down"
  | "away";

type HandState =
  | "neutral"
  | "open"
  | "point"
  | "hold_product"
  | "gesture_active"
  | "occluded";

/** Compact pose descriptor for 2D video matching (not full skeleton). */
interface PoseFeature {
  // Normalized 2D landmarks (MediaPipe Face+Pose subset), length fixed e.g. 33*2
  jointsXy: number[];
  // Optional: upper-body crop histogram / silhouette moments
  silhouetteMoments?: number[];
  headYaw: number;
  headPitch: number;
  shoulderAngle: number;
}

interface VelocityFeature {
  jointsXyDelta: number[];           // per-joint delta over ~100ms
  headYawRate: number;
  energyProxy: number;               // mean |delta|
}

interface MotionAsset {
  id: MotionAssetId;
  avatarId: AvatarId;
  level: MotionLevel;
  state: BehaviorState | BehaviorState[];
  gesture: string;                   // "none" | "open_hand" | "nod" | "point" | ...
  durationMs: number;
  fps: number;
  frameCount: number;
  mediaUri: string;                  // mp4 / frame dir / memmap
  entryPose: PoseFeature;
  exitPose: PoseFeature;
  entryVelocity: VelocityFeature;
  exitVelocity: VelocityFeature;
  energy: number;                    // 0..1 mean
  gaze: GazeTarget;
  hand: HandState;
  emotion: string;
  semanticTags: string[];
  transitionCandidates: MotionAssetId[]; // soft hints; graph is source of truth
  // MuseTalk
  musetalkMaterialKey?: string;
  faceBBoxStable?: boolean;
  // QA
  qualityScore?: number;
  version: number;
}

interface MotionTransition {
  id: string;
  fromAssetId: MotionAssetId;
  toAssetId: MotionAssetId;
  kind: TransitionKind;
  nativeClipId?: MotionAssetId;      // if kind == native_clip
  poseDistance: number;
  velocityDistance: number;
  energyDelta: number;
  semanticOk: boolean;
  gazeOk: boolean;
  handOk: boolean;
  overlapFramesDefault: number;
  cost: number;                      // lower better; precomputed
  avatarId: AvatarId;
}

interface BehaviorStateConfig {
  state: BehaviorState;
  allowedNext: BehaviorState[];
  energyRange: [number, number];
  defaultGaze: GazeTarget;
  gesturePool: string[];
  facialBias: string;                // passed as hint to FaceEngine dampening / expression
  minDwellMs: number;
  maxDwellMs: number;
  fallbackState: BehaviorState;
}

interface BehaviorRule {
  id: string;
  when: {
    state?: BehaviorState;
    prosodyStressAbove?: number;
    productTag?: string;
    intentPriority?: string;
  };
  then: {
    schedule?: BehaviorEvent[];
    preferTags?: string[];
    energyBoost?: number;
  };
  cooldownMs: number;
}

interface BehaviorEventRecord {
  sessionId: SessionId;
  timelineId: string;
  event: BehaviorEvent;
  firedPtsMs: PtsMs;
  chosenAssetId?: MotionAssetId;
}

interface AvatarRuntimeState {
  sessionId: SessionId;
  avatarId: AvatarId;
  behaviorState: BehaviorState;
  energy: number;
  emotion: string;
  gaze: GazeTarget;
  hand: HandState;
  playhead: {
    assetId: MotionAssetId;
    frameIdx: number;
    ptsMs: PtsMs;
  };
  activeTransition?: TransitionPlan;
  timeline?: BehaviorTimeline;
  repetitionMemory: {
    recentAssetIds: MotionAssetId[];     // ring ~64
    recentGestures: string[];
    recentGaze: GazeTarget[];
    windowMs: number;                    // e.g. 120000
  };
  degradation: {
    musetalkBacklog: boolean;
    ttsLate: boolean;
    motionWorkerFail: boolean;
    encoderFallback: "nvenc" | "libx264";
  };
}

interface SessionBuffer {
  sessionId: SessionId;
  fps: number;
  playbackDepthSec: number;          // target 3–8
  lookaheadDepthSec: number;         // target 10–30
  reserveDepthSec: number;           // target 1–2
  playback: FrameSlot[];
  lookahead: FrameSlot[];            // may hold plans + partial renders
  reserve: FrameSlot[];              // pre-rendered idle-safe frames
  avClockPtsMs: PtsMs;
  underrunCount: number;
  lastUnderrunPtsMs?: PtsMs;
}
```

### C.2 On-disk JSON layout (per avatar)

```
assets/motion/{avatar_id}/
  library.json                 # index of MotionAsset
  graph.json                   # MotionTransition[]
  behavior_states.json
  behavior_rules.json
  media/{asset_id}.mp4
  meta/{asset_id}.json         # full MotionAsset sidecar
  features/{asset_id}.npz    # entry/exit pose+vel + per-frame optional
  musetalk/{asset_id}/         # prepared materials cache
```

`meta/{asset_id}.json` **must** include all fields from decision #12.

### C.3 Minimal JSON Schema excerpt (`MotionAsset`)

```json
{
  "$id": "motion_asset.schema.json",
  "type": "object",
  "required": [
    "id", "avatarId", "level", "state", "gesture", "durationMs",
    "entryPose", "exitPose", "entryVelocity", "exitVelocity",
    "energy", "gaze", "hand", "emotion", "semanticTags", "transitionCandidates"
  ],
  "properties": {
    "level": { "enum": ["micro", "gesture", "behavior_segment"] },
    "energy": { "type": "number", "minimum": 0, "maximum": 1 },
    "durationMs": { "type": "number", "minimum": 50 }
  }
}
```

---

## D. Motion Matching Algorithm

Run on body worker thread every `MATCH_PERIOD_MS` (default **150ms**), and immediately on BehaviorEvent fire.

```python
# Pseudocode — production target for MotionMatcher

WEIGHTS = dict(
    pose=1.0,
    velocity=0.75,
    energy=0.5,
    semantic=0.8,
    gaze=0.4,
    hand=0.4,
    state=1.0,
    level=0.3,
    repetition=1.2,
    graph=0.9,
)

def retrieve_candidates(q: MotionQuery, library, graph, limit=32):
    # 1) Hard filters
    pool = library.query(
        avatar_id=q.avatar_id,
        states_contains=q.desiredState,
        energy_range=(q.energy - 0.35, q.energy + 0.35),
    )
    # 2) Prefer graph neighbors of current asset
    neighbors = {e.toAssetId: e for e in graph.neighbors(q.current_asset_id)}
    ranked = []
    for asset in pool:
        if asset.id in q.excludeAssetIds:
            continue
        edge = neighbors.get(asset.id)
        ranked.append((asset, edge))
    # 3) If too few neighbors, allow 1-hop semantic tag search (still scored)
    if len(ranked) < 8:
        ranked += [(a, None) for a in library.query(tags=q.semanticTags)[:24]]
    return ranked[:limit]


def pose_distance(a: PoseFeature, b: PoseFeature) -> float:
    # L2 on joints + weighted head/shoulder
    d = l2(a.jointsXy, b.jointsXy)
    d += 0.5 * abs(a.headYaw - b.headYaw)
    d += 0.35 * abs(a.headPitch - b.headPitch)
    d += 0.25 * abs(a.shoulderAngle - b.shoulderAngle)
    return d


def velocity_distance(a: VelocityFeature, b: VelocityFeature) -> float:
    return l2(a.jointsXyDelta, b.jointsXyDelta) + 0.3 * abs(a.headYawRate - b.headYawRate)


def repetition_penalty(asset_id, gesture, gaze, memory) -> float:
    p = 0.0
    if asset_id in memory.recentAssetIds:
        # denser = worse; exponential on recency rank
        rank = memory.recentAssetIds[::-1].index(asset_id)
        p += 2.0 * (0.85 ** rank)
    gcount = memory.recentGestures[-20:].count(gesture)
    p += 0.4 * gcount
    gzcount = memory.recentGaze[-30:].count(gaze)
    p += 0.25 * gzcount
    return p


def score_candidate(q: MotionQuery, asset, edge) -> MotionCandidate:
    # Compatibility vs CURRENT exit ≈ asset ENTRY
    pose_d = pose_distance(q.currentPose, asset.entryPose)
    vel_d = velocity_distance(q.currentVelocity, asset.entryVelocity)
    energy_d = abs(q.energy - asset.energy)
    semantic = 0.0 if set(q.semanticTags) & set(asset.semanticTags) or not q.semanticTags else 1.0
    gaze_d = 0.0 if q.gaze == asset.gaze else 0.6
    hand_d = 0.0 if q.hand == asset.hand or asset.hand == "neutral" else 0.7
    state_d = 0.0 if q.desiredState in as_list(asset.state) else 1.5
    level_bonus = {"micro": 0.1, "gesture": 0.0, "behavior_segment": -0.05}[asset.level]
    graph_d = edge.cost if edge is not None else 1.0  # unknown edge = expensive

    rep = repetition_penalty(asset.id, asset.gesture, asset.gaze, q.memory)

    cost = (
        WEIGHTS["pose"] * pose_d
        + WEIGHTS["velocity"] * vel_d
        + WEIGHTS["energy"] * energy_d
        + WEIGHTS["semantic"] * semantic
        + WEIGHTS["gaze"] * gaze_d
        + WEIGHTS["hand"] * hand_d
        + WEIGHTS["state"] * state_d
        + WEIGHTS["graph"] * graph_d
        + WEIGHTS["repetition"] * rep
        + level_bonus
    )
    # Event-driven gesture: hard prefer matching gesture tag
    if q.desiredGesture and asset.gesture == q.desiredGesture:
        cost -= 1.5

    return MotionCandidate(
        assetId=asset.id,
        score=cost,
        breakdown={...},
        entryFrame=0,
        suggestedTransition=suggest_kind(pose_d, vel_d, edge),
    )


def select_next(q, library, graph) -> MotionCandidate:
    cands = [score_candidate(q, a, e) for a, e in retrieve_candidates(q, library, graph)]
    if not cands:
        return library.fallback_idle_micro(q.avatar_id)  # never None
    cands.sort(key=lambda c: c.score)
    # Soft-max exploration: 90% best, 10% 2nd-best if within 15% cost (anti-repetition)
    best, second = cands[0], cands[1] if len(cands) > 1 else None
    if second and second.score <= best.score * 1.15 and random() < 0.10:
        return second
    return best


def suggest_kind(pose_d, vel_d, edge) -> TransitionKind:
    if edge and edge.kind == "native_clip" and edge.nativeClipId:
        return "native_clip"
    if pose_d < POSE_NATIVE and vel_d < VEL_NATIVE:
        return "overlap"
    if pose_d < POSE_SOFT:
        return "retime" if vel_d > VEL_SOFT else "crossfade"
    return "fallback_idle"
```

**Defaults (engineering):**
- `POSE_NATIVE=0.08`, `VEL_NATIVE=0.10`, `POSE_SOFT=0.18`, `VEL_SOFT=0.20` (normalized feature space; calibrate per avatar offline).
- Never return empty; always idle micro fallback.

---

## E. Motion Transition Strategy

### Decision table

| Condition | Kind | Max duration | Notes |
|---|---|---|---|
| Graph edge has `nativeClipId` and pose/vel within native thresholds | `native_clip` | clip length | Best visual quality |
| pose_d < POSE_NATIVE and vel_d < VEL_NATIVE | `overlap` | 6–12 frames | Play exit tail ∥ entry head, ease-in-out alpha |
| pose ok but velocity mismatch | `retime` | 8–16 frames | Scale playback rate 0.85–1.15 toward matching exit vel |
| pose_d < POSE_SOFT | `crossfade` | 8–12 frames | Existing `blend_crossfade`; feather optional |
| Still high pose_d after above | route via `fallback_idle` micro bridge | ≤ 20 frames | Match A→idle_micro→B (2 hops) |
| Optical flow | **only if** `AI_WORKER_OF_TRANSITIONS=1` and pose_d mid-range and GPU budget free | ≤ 8 frames | Not default |
| Diffusion interpolate | **offline graph bake only** | n/a | Never live critical path |

### Preventing teleport / ghosting (2D)

1. **No hard cut** unless SSIM(exit, entry) > 0.95 *and* pose_d < POSE_NATIVE (rare identical frames).
2. Prefer **compatible overlap** over long crossfade (crossfade ghosts limbs when poses diverge).
3. Cap crossfade at **12 frames @ 30fps**; if not converged, insert idle micro bridge instead of longer morph.
4. Disable end→base morph of the *same* clip (legacy soft_loop_wrap). End of asset always goes through matcher.
5. During transition, FaceEngine uses **body frame after blend** for mouth composite (not pre-blend).
6. If transition cost > `TRANSITION_ABORT_COST`, cancel gesture event and stay on current behavior_segment / idle — **do not** teleport to forced gesture.

### TransitionPlanner API

```python
def plan(from_playhead, to_candidate, graph) -> TransitionPlan:
    edge = graph.get(from_playhead.assetId, to_candidate.assetId)
    kind = to_candidate.suggestedTransition
    if edge and edge.nativeClipId:
        kind = "native_clip"
    # ... apply table above ...
    return TransitionPlan(...)
```

---

## F. Behavior Engine

### State machine (high-level only — timeline does the rest)

| State | Allowed next | Energy | Default gaze | Gesture pool | Facial bias | Fallback |
|---|---|---|---|---|---|---|
| IDLE | LISTENING, WAITING, THINKING, HAPPY | 0.15–0.40 | camera | micro only | neutral | IDLE |
| LISTENING | THINKING, SPEAKING, REACTING, IDLE | 0.20–0.45 | camera | nod micro | attentive | IDLE |
| THINKING | SPEAKING, EXPLAINING, WAITING | 0.25–0.50 | away/down short | chin/hand micro | thoughtful | WAITING |
| SPEAKING | EXPLAINING, POINTING, REACTING, HAPPY, IDLE | 0.40–0.70 | camera | open_hand, nod | talk | EXPLAINING |
| EXPLAINING | POINTING, DEMONSTRATING, SPEAKING, HAPPY | 0.45–0.75 | camera/product | open_hand, count | talk | SPEAKING |
| DEMONSTRATING | POINTING, EXPLAINING, SPEAKING | 0.50–0.80 | product | hold/show | talk | EXPLAINING |
| POINTING | EXPLAINING, DEMONSTRATING, SPEAKING | 0.55–0.85 | product | point | talk | EXPLAINING |
| REACTING | SPEAKING, HAPPY, EXCITED, IDLE | 0.50–0.90 | camera | nod, surprise_hand | reactive | SPEAKING |
| EXCITED | HAPPY, SPEAKING, POINTING | 0.75–1.00 | camera | wide_open, pump | bright | HAPPY |
| HAPPY | SPEAKING, IDLE, WAITING | 0.45–0.70 | camera | smile_nod | smile | IDLE |
| WAITING | IDLE, LISTENING, THINKING | 0.15–0.35 | camera | micro | neutral | IDLE |
| TRANSITIONING | (auto) previous target | inherit | inherit | none | neutral | IDLE |

### Entry / exit rules

- **minDwellMs:** IDLE 800; SPEAKING 400; EXPLAINING 600; POINTING 500; EXCITED 700; TRANSITIONING = transition duration.
- **maxDwellMs:** EXCITED 4000; POINTING 3000; THINKING 5000; else soft.
- Enter TRANSITIONING only when TransitionPlanner active; exit when plan completes.
- Interrupt: `priority=cta|urgent` may preempt after minDwell of current.

### Timeline compilation example

Input: intent `EXPLAINING`, TTS duration 3.2s, prosody stress peaks at 0.8s and 1.8s.

```
BehaviorTimeline:
  state: EXPLAINING
  durationMs: 3200
  events:
    - { atMs: 0,    type: "gaze",    payload: { target: "camera" } }
    - { atMs: 800,  type: "gesture", payload: { gesture: "open_hand", energy: 0.6 } }
    - { atMs: 1800, type: "head",    payload: { gesture: "nod" } }
    - { atMs: 3000, type: "return",  payload: { to: "neutral_talk" } }
```

Matcher schedules gesture assets at those marks; between marks continues behavior_segment / talk-sway micros.

### Facial behavior

- FaceEngine remains audio-driven for lips.
- Emotion/energy only adjusts mouth strength dampening / upper-face overlay **if** such assets exist; do not invent emotion via MuseTalk prompts.

---

## G. Speech ∥ Body Synchronization

### Pipeline & clocks

| Stage | Clock | Owner |
|---|---|---|
| LLM / script | Wall / backend | `live-host-orchestrator` |
| BehaviorIntent | `intent_t0` | Backend → worker |
| BehaviorTimeline | `behavior_pts` (= intent_t0) | BehaviorEngine |
| TTS audio file | `audio_pts` (0 at file start) | SpeechBridge |
| Prosody | `audio_pts` | ProsodyAnalyzer |
| Body playhead | `body_pts` | BodyClock (always advancing @ fps) |
| MuseTalk mouths | `face_pts` ≈ `audio_pts` | FaceEngine |
| Compositor out | `media_pts` | GPUCompositor |
| Playback ring / RTMP | `av_clock` | StreamController |

### Sequencing (non-blocking)

```
LLM text
  ├─► BehaviorEngine.compile(timeline)     # immediate, no audio needed
  └─► TTS synth (async)
         └─► SpeechBridge.enqueue
                ├─► ProsodyAnalyzer
                ├─► FaceEngine.prewarm(preroll)   # async; soft wait ≤ PREROLL_TIMEOUT
                └─► schedule audio attach at av_clock + playback_target

BodyClock always: IdleController || Matcher(timeline, prosody)
FaceEngine: parallel; if late → body-only frames still flow
Compositor: zip by media_pts (body required, mouth optional)
```

### Sync rules

1. **Body does not pause** for TTS or MuseTalk.
2. Audio starts when: (a) mouth preroll ready **or** (b) `MUSETALK_PREROLL_TIMEOUT_SEC` elapsed (degrade body-only), and playback ring has ≥ `PLAYBACK_MIN_SEC`.
3. Timeline event `atMs` is relative to **audio start** once known; before audio ready, BehaviorEngine may run a “pre-speak” WAITING/THINKING timeline on body.
4. A/V drift correction: StreamController drops/duplicates **audio silence frames** or trims 1 video frame from reserve — never freeze on last image.
5. Remove rest-gate from `begin_utterance`. Replace with: `BehaviorEngine.on_utterance_ready(job)` + optional energy bump.

### Changes to existing hooks

- `SpeechBridge.on_utterance_start` → BehaviorEngine + FaceEngine only.
- `VideoStateMachine.begin_utterance` → delete rest-gate/pin; optional `MotionMatcher.nudge(state=SPEAKING)`.
- Backend: send `BehaviorIntent` JSON alongside audio; keep `action` string as deprecated alias mapped to stateHint.

---

## H. Continuous Idle — IdleController

### Layers

1. **Macro idle:** MotionMatcher restricted to `level=micro|behavior_segment` with `state=IDLE|WAITING`, energy low.
2. **Micro procedural (non-warp body):**
   - **Blink / eye saccade / brow:** landmark overlays or preauthored eye texture swaps on face region only (or MuseTalk-idle materials), not full-frame mesh warp.
   - **Head micro:** prefer short `micro` assets (4–30 frames), not pixel warp.
   - **Breathing / shoulder / weight shift:** **only via authored micro motion assets**, never aggressive optical-flow breathing on full body (jelly risk).

### Non-deterministic scheduling

```python
def tick_idle(rng, now_ms, memory):
    # Ornstein-Uhlenbeck-like energy wander
    energy = clamp(energy + rng.normal(0, 0.02), 0.15, 0.40)
    if now_ms >= next_saccade_at:
        schedule_gaze(random_choice(GAZE_WEIGHTS, avoid=memory.recentGaze))
        next_saccade_at = now_ms + rng.uniform(900, 2800)
    if now_ms >= next_blink_at:
        schedule_blink()
        next_blink_at = now_ms + rng.uniform(2200, 6100)
    if now_ms >= next_macro_at:
        matcher.select_next(idle_query(energy))
        next_macro_at = now_ms + rng.uniform(3000, 9000)
```

No fixed period loops (no “blink every 3.0s exactly”).

### Fallback

If MotionLibrary empty for idle: play last good **decoded idle asset** forward with matcher disabled until library recovers — still advancing frames from reserve ring. **Forbidden:** hold last single frame.

---

## I. Buffer Architecture

### Rings

| Ring | Depth | Content | Consumer |
|---|---|---|---|
| **Playback** | **5s default** (cfg 3–8) | Fully composited A/V frames | StreamController / NVENC |
| **Lookahead** | **18s default** (cfg 10–30) | Plans + partial body; mouths filled as ready | Body/Face workers fill ahead of av_clock |
| **Reserve** | **1.5s default** | Precomposed idle-safe frames | Underrun only |

### Recommended live commerce defaults

```
AI_BUFFER_PLAYBACK_SEC=5
AI_BUFFER_LOOKAHEAD_SEC=18
AI_BUFFER_RESERVE_SEC=1.5
AI_BUFFER_PLAYBACK_MIN_SEC=3        # don't start RTMP pump below this after go-live warm
AI_BUFFER_UNDERUN_POLICY=reserve_then_idle_extend
```

Why not 20–45s playback: conversational / host reaction latency stays ~5s media delay, while 18s lookahead absorbs LLM/TTS/MuseTalk spikes.

### Underrun handling

1. If playback < 0.5s: pull from reserve (idle-safe).
2. Refill reserve asynchronously from IdleController.
3. Metric `buffer_underrun`; never `cv2` last-frame freeze.
4. If MuseTalk late: commit body-only into lookahead (already policy).

### Backpressure

- Lookahead full → pause LLM refill / delay TTS enqueue (backend already has max buffer) AND slow BehaviorTimeline gesture density; **do not** stop BodyClock.
- raw/render queues replaced by FrameBuffer watermarks:
  - `playback_high` = 8s → pause compositor fill
  - `playback_low` = 3s → prioritize compose over matching search complexity

### A/V clock

- Master: `av_clock` advances at realtime fps.
- Audio PCM per video frame (existing `BYTES_PER_AUDIO_FRAME` pattern).
- Drift > 80ms over 10s → correct with silence insert or 1-frame video skip from reserve.

### Mapping from today

| Today | Target |
|---|---|
| `AI_WORKER_RAW_QUEUE=24` (~0.8s) | Lookahead body staging subset |
| `AI_WORKER_RENDER_QUEUE=48` (~1.6s) | Playback ring (expanded) |
| BE utterance buffer 6–40s | Stays as **content** lookahead; not frame playback latency |

---

## J. L40S Deployment

> **Legend:** *Official / published* = vendor or MuseTalk claims. *Estimate* = engineering budget for this stack — validate on pod.

### VRAM budget per session (estimate)

| Component | Precision | VRAM estimate | Notes |
|---|---|---|---|
| MuseTalk 1.5 UNet+VAE+Whisper tiny | FP16 | **3.5–6 GB** | *Estimate*; scales with batch |
| VoxCPM2 TTS | FP16 | **4–8 GB** | *Estimate*; currently separate venv/process |
| Face materials cache (active assets) | FP16 latents | **0.5–2 GB** | *Estimate*; cap N assets warm |
| GPU compositor + NVENC surfaces | — | **0.3–0.8 GB** | *Estimate* |
| FrameBuffer (if GPU-resident 5s 720×1280 BGR) | — | **~0.4 GB** | *Calc:* 5×30×720×1280×3 ≈ 415 MB |
| Lookahead plans CPU RAM | CPU | **1–3 GB** | Prefer CPU for deep lookahead |
| CUDA context / fragmentation slack | — | **2 GB** | *Estimate* |

**Single session comfortable target:** ~12–18 GB used → headroom on 48 GB.  
**Concurrent sessions (estimate):**

| Mode | Sessions / L40S | Condition |
|---|---|---|
| Shared MuseTalk weights + per-session KV/materials | **2** | Preferred |
| Aggressive (small batch, shared TTS process queue) | **3** | Needs TensorRT or smaller batch; *stretch estimate* |
| Isolated full stack each | **1–2** | Safest |

*Not an official NVIDIA benchmark — measure with `nvidia-smi` + session soak.*

### Model residency

- 1× MuseTalk weights resident per GPU (shared).
- 1× TTS worker process per GPU (queue multi-session requests) — already separate venv pattern.
- Per-session: MotionLibrary CPU, materials subset, FrameBuffer, BehaviorEngine state.

### CUDA streams (per session)

1. `stream_body` — decode/upload/transition blend  
2. `stream_face` — MuseTalk batch  
3. `stream_compose` — mouth composite  
4. Encoder uses NVENC queue (separate HW)

### Batching

- Keep `MUSETALK_BATCH_SIZE=16` for 1 session (*current prod default*).
- Multi-session: batch 8×2 or time-slice batches; don't sum to 32 without measuring.

### Precision

- MuseTalk: FP16 (`MUSETALK_USE_FLOAT16=1`) — **keep**.
- TTS: follow VoxCPM2 default; BF16 if stable on L40S.
- FP8 / TensorRT: **Phase 4+ optional** for MuseTalk UNet only after parity tests; not blocking.

### Process / container layout

```
Container A: api_server + ai_worker sessions (body+face+compositor+NVENC)
Container B: voxcpm2_tts worker (GPU slice / MPS or time-share)
Network volume: models + motion library
```

Optional: NVIDIA MPS for 2 sessions; if unstable, 2 pods.

### NVENC

- Probe `h264_nvenc` once; on failure keep libx264 (*current reason for disable*).
- Live commerce settings *estimate*: `-preset ll -tune ll -delay 0 -bf 0 -rc cbr`.

---

## K. Migration Plan

### Phase 1 — Motion Library + Graph (offline + load path)

**Files:**  
`deploy/motion/` (new: `library.py`, `graph.py`, `schemas.py`, `build_graph.py`), `validate_idle_assets.py` → `validate_motion_assets.py`, `AssetBank` adapter, `assets/motion/{avatar}/`, docs update.

**Output:** Avatar library with ≥ micro + gesture + behavior_segment assets; `graph.json` built from pose/velocity; old MP4s imported as assets with computed features.

**Acceptance:**
- Loader returns `MotionAsset` with all required metadata fields.
- Graph has avg degree ≥ 2 for talk/idle nodes.
- Existing live path still runs via adapter (`ClipAsset` shim).

**Rollback:** Feature flag `AI_MOTION_LIBRARY=0`; use legacy `assets/3d/*.mp4` only.

---

### Phase 2 — Runtime Matcher + TransitionPlanner

**Files:**  
`deploy/motion/matcher.py`, `transition.py`, replace loop/ping-pong branches in `VideoStateMachine` (or new `BodyClock`), delete runtime dependency on `is_seamless_loop` for control flow, update `check_invariants.py`.

**Output:** Body advances by match+transition; ping-pong code path unreachable; soft_loop_wrap not used.

**Acceptance:**
- 10 min soak: 0 `talk_ping_pong` metrics; transition failure < 1%.
- Visual: no reverse playback; no long morph ghosts.
- Flag `AI_WORKER_PIN_TALK` ignored when `AI_MOTION_MATCH=1`.

**Rollback:** `AI_MOTION_MATCH=0` restores VSM loop logic (keep code one release).

---

### Phase 3 — Speech / Body decoupling

**Files:**  
`ai_worker.py` (`begin_utterance`, pin/rest-gate), `speech_bridge.py`, `live-host-orchestrator.ts` (BehaviorIntent), `LipSyncEngine` material indexing.

**Output:** BodyClock independent; utterance starts without rest-gate; hold-talk optional/off; FaceEngine soft preroll.

**Acceptance:**
- Body motion continuous when TTS delayed 15s (idle/matcher keeps moving).
- A/V onset ≤ 150ms when preroll warm; body-only degrade if timeout.
- No pin to single talk clip.

**Rollback:** `AI_SPEECH_BODY_DECOUPLE=0` re-enables pin+rest-gate.

---

### Phase 4 — GPU Compositor + FrameBuffer + NVENC

**Files:**  
`deploy/motion/frame_buffer.py`, `gpu_compositor.py`, `StreamBroadcaster` NVENC probe, replace queue sizes with buffer sec configs, `.env.example`.

**Output:** Playback 5s / lookahead 18s / reserve 1.5s; NVENC when available; no freeze fallback.

**Acceptance:**
- Underrun uses reserve; `frames_duplicated` freeze path removed.
- Encoder latency p95 < 80ms (*estimate target*).
- 30 min soak stable RTMP.

**Rollback:** `AI_FRAME_BUFFER=0` + force `RTMP_VIDEO_CODEC=libx264` + legacy queues.

---

### Phase 5 — Behavior Engine

**Files:**  
`deploy/motion/behavior_engine.py`, `timeline.py`, `prosody.py`, `idle_controller.py`, backend intent payload, enable gestures.

**Output:** States §F + timelines; repetition memory; continuous idle two-layer.

**Acceptance:**
- Timeline events fire within ±100ms of plan under load.
- Gesture repetition score drops vs Phase 2 baseline.
- States transition per allowed graph.

**Rollback:** `AI_BEHAVIOR_ENGINE=0` → matcher uses SPEAKING/IDLE only.

---

### Phase 6 — Generative Asset Factory

**Files:**  
`backend` jobs for EchoMimicV3 / Wan2.2-Animate / MimicMotion, ingest → `build_graph.py`, QA gate.

**Output:** New gestures/hero clips enter library offline; graph gaps filled.

**Acceptance:**
- Zero generative calls from `ai_worker` live loop (grep CI).
- New assets pass validate + increase graph connectivity.

**Rollback:** Stop factory jobs; library immutable.

---

## L. Test Plan

### Automated soak harness

New: `deploy/tests/test_motion_soak.py` (+ CI nightly for 30m; manual/scheduled 1h/3h).

| Duration | Must pass |
|---|---|
| 30 min | All metrics green |
| 1 h | + VRAM leak < 5% growth |
| 3 h | + RTMP reconnect ≤ 1; no fatal |

### Metrics (export Prometheus or existing `worker_telemetry`)

| Metric | 30m budget | Notes |
|---|---|---|
| `buffer_underrun` | ≤ 3 | Reserve hits OK |
| `freeze_duration_ms` | **= 0** | Hard fail if > 0 |
| `gesture_repetition_rate` | < 0.25 | Same gesture / 60s window |
| `transition_failure` | < 1% | Aborts to idle bridge |
| `fps` | 29–30 p50; >28 p95 | |
| `av_drift_ms` | < 80 p95 | |
| `gpu_utilization` | logged | no hard fail |
| `vram_bytes` | < session budget | |
| `encoder_latency_ms` | < 80 p95 *target* | |
| `rtmp_reconnects` | 0 (30m), ≤1 (3h) | |
| `talk_ping_pong` | **0** | Legacy must stay zero |
| `rest_gate_wait_ms` | **0** after Phase 3 | |

### Scenario tests (extend REPRO matrix)

1. TTS stall 15s mid-live → body continues; audio resumes without freeze.  
2. MuseTalk backlog → body-only, then mouths catch up.  
3. Forced gesture with incompatible pose → idle bridge, no teleport.  
4. Go-live with playback warm 5s, lookahead filling.  
5. Two sessions on one L40S (Phase 4+).  

---

## M. Critical Decisions — Runtime MUST NOT

Effective as modules land (enforce with flags + invariants CI):

1. **No** first≈last / SSIM seamless requirement as a condition for playback.
2. **No** rest-gate delaying speech or body cuts.
3. **No** pinning a single talk clip for the session.
4. **No** ping-pong / reverse playback as normal behavior.
5. **No** end→base soft morph of the same clip as the continuity foundation.
6. **No** blocking BodyClock on LLM, TTS, MuseTalk, or generative video.
7. **No** generative video (EchoMimic / Wan / MimicMotion) on the live critical path.
8. **No** freeze-frame / last-frame sticky fallback.
9. **No** optical flow or diffusion interpolation as default live transitions.
10. **No** aggressive full-body pixel warp for breathing/sway.
11. **No** treating lookahead depth (10–30s) as playback delay (keep playback 3–8s).
12. **No** FaceEngine driving body pose.
13. **No** empty matcher result — always idle micro / reserve.
14. **No** multi-hour demo assumptions that break multi-session VRAM isolation.

---

## Appendix — Feature flags (rollout)

```
AI_MOTION_LIBRARY=0|1
AI_MOTION_MATCH=0|1
AI_SPEECH_BODY_DECOUPLE=0|1
AI_FRAME_BUFFER=0|1
AI_BEHAVIOR_ENGINE=0|1
AI_WORKER_OF_TRANSITIONS=0          # keep 0 in prod
RTMP_VIDEO_CODEC=h264_nvenc|libx264 # probe; fallback x264
AI_BUFFER_PLAYBACK_SEC=5
AI_BUFFER_LOOKAHEAD_SEC=18
AI_BUFFER_RESERVE_SEC=1.5
```

## Appendix — First engineering ticket (suggested)

1. Add `deploy/motion/schemas.py` + JSON schema validation.  
2. Import existing `namira_idle` / `namira_talk*` into `MotionAsset` with MediaPipe feature extract.  
3. `build_graph.py` offline.  
4. Shim `AssetBank.get` → MotionLibrary without changing broadcast path.  
5. Land Phase 1 flag off-by-default on prod pod; enable on staging.

---

*End of specification.*
