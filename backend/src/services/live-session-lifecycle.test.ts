import test from "node:test";
import assert from "node:assert/strict";
import { getWorkerUrl, rememberPodOwner, getPodOwner, assertPodReleaseAllowed } from "./runpod-manager.js";
import { getRunPodBroadcastStatusOnce, isBroadcastPipelineRunning, isBroadcastRtmpReady } from "./runpod-bridge.js";
import { sanitizeForLiveTTS } from "./tts.js";
import { decideOnAirStep, hostResponseDelivered } from "./live-host-orchestrator.js";
import {
  canTransitionPlatformLive,
  exclusivePodClaimWhere,
  reuseExistingLiveStart,
  shouldRehydrateRow,
  shouldTerminateOrphanPod,
} from "./live-session-manager.js";
import { livePlatformConnector } from "./live-platform-connector.js";

test("getWorkerUrl uses the dynamic proxy when podId exists", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  process.env.RUNPOD_WORKER_URL = "https://static.example.invalid";
  process.env.RUNPOD_POD_ID = "";
  try {
    assert.equal(getWorkerUrl("abc123"), "https://abc123-8000.proxy.runpod.net");
    assert.equal(getWorkerUrl(null), null);
  } finally {
    process.env.NODE_ENV = prev;
    delete process.env.RUNPOD_WORKER_URL;
  }
});

test("getWorkerUrl allows local URL only outside production", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  process.env.RUNPOD_WORKER_URL = "http://localhost:8000";
  process.env.RUNPOD_POD_ID = "";
  try {
    assert.equal(getWorkerUrl(null), "http://localhost:8000");
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test("two sessions resolve to independent worker URLs and pod owners", () => {
  rememberPodOwner("pod-a", "session-a");
  rememberPodOwner("pod-b", "session-b");
  assert.equal(getWorkerUrl("pod-a"), "https://pod-a-8000.proxy.runpod.net");
  assert.equal(getWorkerUrl("pod-b"), "https://pod-b-8000.proxy.runpod.net");
  assert.equal(getPodOwner("pod-a"), "session-a");
  assert.equal(getPodOwner("pod-b"), "session-b");
  assert.doesNotThrow(() => assertPodReleaseAllowed("pod-a", "session-a"));
  assert.throws(() => assertPodReleaseAllowed("pod-a", "session-b"));
});

test("start is idempotent for an active clientRequestId mapping", () => {
  assert.deepEqual(
    reuseExistingLiveStart({ id: "sess-1" }, { state: "pending" }),
    { sessionId: "sess-1", state: "pending" },
  );
  assert.equal(reuseExistingLiveStart({ id: "sess-1" }, { state: "ended" }), null);
  assert.equal(reuseExistingLiveStart({ id: "sess-1" }, null), null);
});

test("pipeline running is not the same as RTMP connected", () => {
  const queue = { visual_worker_running: true, broadcasting: true, rtmp_connected: false, rtmp_state: "connecting" };
  assert.equal(
    isBroadcastPipelineRunning({ success: true, status: "connecting", boot_state: "running" }, queue as any),
    true,
  );
  assert.equal(isBroadcastRtmpReady({ success: true, status: "connecting" }, queue as any), false);
  assert.equal(isBroadcastRtmpReady({ success: true, status: "streaming", rtmp_connected: true }, { rtmp_connected: true } as any), true);
});

test("readiness gate requires RTMP plus opening buffer", () => {
  assert.equal(canTransitionPlatformLive({ isRtmpConnected: true, playable: 3, minReady: 3 }), true);
  assert.equal(canTransitionPlatformLive({ isRtmpConnected: false, playable: 3, minReady: 3 }), false);
  assert.equal(canTransitionPlatformLive({ isRtmpConnected: true, playable: 2, minReady: 3 }), false);
});

test("Go Live gate requires speech seconds when minSpeechSeconds is set", () => {
  assert.equal(
    canTransitionPlatformLive({
      isRtmpConnected: true,
      playable: 4,
      minReady: 4,
      speechSeconds: 18,
      minSpeechSeconds: 28,
    }),
    false,
  );
  assert.equal(
    canTransitionPlatformLive({
      isRtmpConnected: true,
      playable: 4,
      minReady: 4,
      speechSeconds: 28,
      minSpeechSeconds: 28,
    }),
    true,
  );
  assert.equal(
    canTransitionPlatformLive({
      isRtmpConnected: true,
      playable: 3,
      minReady: 4,
      speechSeconds: 40,
      minSpeechSeconds: 28,
    }),
    false,
  );
});

test("TTS false-success does not count as delivered speech", () => {
  assert.equal(hostResponseDelivered(0), false);
  assert.equal(hostResponseDelivered(1), true);
});

test("on-air refill waits when GPU is slower than realtime unless buffer is critical", () => {
  assert.equal(
    decideOnAirStep({
      readyCount: 4,
      readySpeechSeconds: 24,
      workerPending: 3,
      renderQueue: 0,
      realTimeRatio: 0.7,
      hasComment: false,
    }),
    "wait",
  );
  assert.equal(
    decideOnAirStep({
      readyCount: 1,
      readySpeechSeconds: 8,
      workerPending: 1,
      renderQueue: 0,
      realTimeRatio: 0.7,
      hasComment: false,
    }),
    "generate",
  );
  assert.equal(
    decideOnAirStep({
      readyCount: 4,
      readySpeechSeconds: 24,
      workerPending: 2,
      renderQueue: 0,
      realTimeRatio: 1.2,
      hasComment: true,
      commentPriority: 10,
    }),
    "comment",
  );
  assert.equal(
    decideOnAirStep({
      readyCount: 2,
      readySpeechSeconds: 10,
      workerPending: 1,
      renderQueue: 0,
      realTimeRatio: 1.5,
      hasComment: false,
      generationInFlight: 2,
    }),
    "wait",
  );
  assert.equal(
    decideOnAirStep({
      readyCount: 4,
      readySpeechSeconds: 24,
      workerPending: 2,
      renderQueue: 8,
      realTimeRatio: 1.5,
      hasComment: false,
    }),
    "wait",
  );
});

test("sanitizeForLiveTTS is the single stutter boundary", () => {
  assert.equal(sanitizeForLiveTTS("delivery delivery delivery"), "delivery");
  assert.match(sanitizeForLiveTTS("Terima kasih sama-sama ya"), /sama-sama/);
});

test("metrics skip the worker when production has no pod", async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal(await getRunPodBroadcastStatusOnce(null), null);
    assert.equal(await getRunPodBroadcastStatusOnce(""), null);
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test("live callbacks stay isolated per sessionId", async () => {
  const hits: string[] = [];
  livePlatformConnector.startSession({ sessionId: "sess-a", platform: "test" });
  livePlatformConnector.startSession({ sessionId: "sess-b", platform: "test" });
  livePlatformConnector.setLiveDetectedCallback("sess-a", (id) => {
    hits.push(`a:${id}`);
  });
  livePlatformConnector.setLiveDetectedCallback("sess-b", (id) => {
    hits.push(`b:${id}`);
  });
  assert.equal(livePlatformConnector.hasLiveDetectedCallback("sess-a"), true);
  assert.equal(await livePlatformConnector.notifyLiveDetected("sess-a"), true);
  assert.equal(await livePlatformConnector.notifyLiveDetected("sess-missing"), false);
  assert.deepEqual(hits, ["a:sess-a"]);
  livePlatformConnector.stopSession("sess-a");
  livePlatformConnector.stopSession("sess-b");
  assert.equal(livePlatformConnector.hasLiveDetectedCallback("sess-a"), false);
});

test("rehydration attaches healthy rows and leaves foreign pods alone", () => {
  assert.equal(shouldRehydrateRow({ runpodPodId: "pod-1" }, false), true);
  assert.equal(shouldRehydrateRow({ runpodPodId: "pod-1" }, true), false);
  assert.equal(shouldRehydrateRow({ runpodPodId: null }, false), false);
  assert.equal(shouldTerminateOrphanPod("orphan-1", new Set(["owned-1"])), true);
  assert.equal(shouldTerminateOrphanPod("owned-1", new Set(["owned-1"])), false);
});

test("exclusive pod claim detaches other sessions holding the same runpodPodId", () => {
  assert.deepEqual(exclusivePodClaimWhere("qx940wv0vf0nvu", "sess-new"), {
    runpodPodId: "qx940wv0vf0nvu",
    NOT: { id: "sess-new" },
  });
});
