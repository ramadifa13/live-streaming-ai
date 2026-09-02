/**
 * RunPod GPU Worker Bridge Service
 * Forwards synthesized audio and avatar image to RunPod GPU LivePortrait/MuseTalk worker.
 */

export interface RunPod2DStreamParams {
  avatarImagePath: string;
  text: string;
  voice?: string;
  speed?: number;
  tone?: string;
  rtmpUrl?: string;
  streamKey?: string;
  audioBase64?: string;
  audioUrl?: string;
  requireWorker?: boolean;
  wait?: boolean;
  action?: string;
  /** Tandai sebagai jawaban komentar agar diputar mendahului buffer otonom. */
  priority?: boolean;
}

function stripActionTagsForTts(text: string): string {
  return text.replace(/^\s*\[[A-Z_]+\]\s*/i, "").replace(/\[[A-Z_]+\]/g, "").trim();
}

export interface RunPod2DStreamResult {
  success: boolean;
  videoUrl?: string;
  audioPath?: string;
  status: string;
}

export interface RunPodBroadcastResult {
  success: boolean;
  status: string;
  error?: string;
}

export interface RunPodQueueStatus {
  success: boolean;
  ready_videos_count: number;
  queued_videos_count?: number;
  ready_videos?: string[];
  playable_buffer_seconds?: number;
  queued_videos_duration_seconds?: number;
  in_flight_buffer_seconds?: number;
  buffer_seconds?: number;
  active_processing_count?: number;
  broadcasting?: boolean;
  rtmp_connected?: boolean;
  rtmp_error?: string;
  rtmp_state?: string;
  warmed_up?: boolean;
  utterance_queue_count?: number;
  broadcast_mode?: string;
  visual_worker_running?: boolean;
  visual_worker_initializing?: boolean;
  broadcast_boot_state?: string;
}

import { getWorkerUrl } from "./runpod-manager.js";

function isAiWorkerBroadcastMode(mode: string): boolean {
  const m = (mode || "").trim().toLowerCase();
  return (
    m === "ai_worker" ||
    m === "ai-worker" ||
    m === "realtime" ||
    m === "visual_worker"
  );
}

function isDemoFallbackAllowed() {
  return (process.env.ALLOW_MEDIA_FALLBACK ?? "false").toLowerCase() === "true";
}

async function workerRequest(
  podId: string | null | undefined,
  path: string,
  init?: RequestInit,
) {
  const baseUrl = getWorkerUrl(podId);
  if (!baseUrl) {
    throw new Error(
      "Worker GPU belum siap (podId kosong). Tunggu boot RunPod selesai.",
    );
  }
  const signal = init?.signal || AbortSignal.timeout(60000);
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    signal,
  });
  const data = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    const errorDetail =
      data.detail || data.error || data.message || `HTTP ${response.status}`;
    const errStr =
      typeof errorDetail === "object"
        ? JSON.stringify(errorDetail)
        : String(errorDetail);
    throw new Error(`Worker request failed (${response.status}): ${errStr}`);
  }
  return data;
}

async function workerRequestWithRetry(
  podId: string | null | undefined,
  path: string,
  init?: RequestInit,
  retries = 6,
): Promise<any> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await workerRequest(podId, path, init);
    } catch (err: any) {
      lastError = err;
      const status = Number(err.message?.match(/\d{3}/)?.[0]);
      const isTransient =
        status === 404 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        err.name === "TimeoutError" ||
        err.name === "AbortError" ||
        /timeout|aborted/i.test(String(err.message || ""));
      if (isTransient) {
        const backoff = 1000 * Math.pow(2, attempt);
        console.warn(
          `[RunPodBridge] Worker connection retry in ${backoff}ms (${err.message})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function broadcastBootTimeoutMs(): number {
  const raw = process.env.RUNPOD_BROADCAST_BOOT_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : 300_000;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
}

function isBroadcastWorkerActive(
  status: (RunPodBroadcastResult & {
    boot_state?: string;
    rtmp_connected?: boolean;
    visual_worker_initializing?: boolean;
  }) | null,
  queue: RunPodQueueStatus | null,
): boolean {
  const rtmpReady =
    queue?.rtmp_connected === true ||
    status?.rtmp_connected === true ||
    queue?.rtmp_state === "connected";
  return (
    rtmpReady ||
    queue?.visual_worker_running === true ||
    queue?.broadcasting === true ||
    status?.status === "streaming" ||
    status?.status === "already_running" ||
    status?.boot_state === "running"
  );
}

export async function startRunPodBroadcast(
  podId: string | null | undefined,
  params: {
    rtmpUrl: string;
    streamKey: string;
    productName?: string;
    productPrice?: string;
    productImageUrl?: string;
    bannerImageUrl?: string;
    platform?: string;
    stockCount?: number;
    ctaLabel?: string;
    hostName?: string;
    /** Tunggu visual worker + RTMP siap (default: false — frontend poll pipeline-status). */
    waitForReady?: boolean;
  },
): Promise<RunPodBroadcastResult> {
  const hostSlug = (params.hostName || "namira").trim().toLowerCase() || "namira";
  // ACK cepat dari worker — boot broadcaster berjalan async + polling status.
  const kickoff = (await workerRequestWithRetry(
    podId,
    "/stream/start-broadcast",
    {
      method: "POST",
      body: JSON.stringify({
        rtmp_url: params.rtmpUrl,
        stream_key: params.streamKey,
        rtmpUrl: params.rtmpUrl,
        streamKey: params.streamKey,
        product_name: params.productName,
        product_price: params.productPrice,
        product_image_url: params.productImageUrl,
        banner_image_url: params.bannerImageUrl,
        bannerImageUrl: params.bannerImageUrl,
        platform: params.platform,
        stock_count: params.stockCount,
        cta_label: params.ctaLabel,
        host_name: hostSlug,
        hostName: hostSlug,
        avatar_name: hostSlug,
        avatarName: hostSlug,
      }),
      signal: AbortSignal.timeout(20_000),
    },
    6,
  )) as RunPodBroadcastResult;

  if (!kickoff?.success) {
    return {
      success: false,
      status: kickoff?.status || "error",
      error: kickoff?.error || "Worker menolak start-broadcast",
    };
  }

  if (kickoff.status === "already_running") {
    return { success: true, status: "already_running" };
  }

  if (params.waitForReady !== true) {
    return {
      success: true,
      status: kickoff.status || "starting",
      async: true,
    } as RunPodBroadcastResult & { async?: boolean };
  }

  const bootTimeoutMs = broadcastBootTimeoutMs();
  const deadline = Date.now() + bootTimeoutMs;
  while (Date.now() < deadline) {
    const [status, queue] = await Promise.all([
      workerRequestWithRetry(
        podId,
        "/stream/broadcast-status",
        { signal: AbortSignal.timeout(8_000) },
        2,
      ).catch(() => null) as Promise<
        (RunPodBroadcastResult & {
          boot_state?: string;
          rtmp_connected?: boolean;
          visual_worker_initializing?: boolean;
        }) | null
      >,
      getRunPodQueueStatus(podId),
    ]);

    if (status?.status === "error" || status?.boot_state === "error") {
      throw new Error(
        status?.error || "Broadcast worker gagal start (cek broadcaster.log)",
      );
    }

    if (isBroadcastWorkerActive(status, queue)) {
      return { success: true, status: status?.status || "streaming" };
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  // Kickoff diterima worker — RTMP / visual worker mungkin sudah aktif walau polling lambat.
  const [finalStatus, finalQueue] = await Promise.all([
    workerRequestWithRetry(
      podId,
      "/stream/broadcast-status",
      { signal: AbortSignal.timeout(8_000) },
      2,
    ).catch(() => null) as Promise<
      (RunPodBroadcastResult & {
        boot_state?: string;
        rtmp_connected?: boolean;
      }) | null
    >,
    getRunPodQueueStatus(podId).catch(() => null),
  ]);
  if (isBroadcastWorkerActive(finalStatus, finalQueue)) {
    return { success: true, status: finalStatus?.status || "streaming" };
  }

  const waitedSec = Math.round(bootTimeoutMs / 1000);
  throw new Error(
    `Broadcast worker belum aktif setelah ${waitedSec}s — cek api_server.log di pod (MuseTalk init bisa 2–3 menit pertama kali)`,
  );
}

export async function updateRunPodBroadcastProduct(
  podId: string | null | undefined,
  params: {
    productName?: string;
    productPrice?: string;
    productImageUrl?: string;
    bannerImageUrl?: string;
  },
): Promise<RunPodBroadcastResult> {
  return workerRequestWithRetry(podId, "/stream/update-product", {
    method: "POST",
    body: JSON.stringify({
      product_name: params.productName,
      product_price: params.productPrice,
      product_image_url: params.productImageUrl,
      banner_image_url: params.bannerImageUrl,
    }),
  }).catch(() => ({
    success: false,
    status: "error",
    message: "Failed to update overlay",
  }));
}

export async function stopRunPodBroadcast(
  podId: string | null | undefined,
): Promise<RunPodBroadcastResult> {
  return workerRequestWithRetry(podId, "/stream/stop-broadcast", {
    method: "POST",
  });
}

export async function getRunPodBroadcastStatus(
  podId: string | null | undefined,
): Promise<RunPodBroadcastResult> {
  return workerRequestWithRetry(podId, "/stream/broadcast-status");
}

export async function getRunPodQueueStatus(
  podId: string | null | undefined,
): Promise<RunPodQueueStatus> {
  return workerRequestWithRetry(
    podId,
    "/stream/queue-status",
    undefined,
    2,
  ).catch(() => ({
    success: false,
    ready_videos_count: 0,
    active_processing_count: 0,
    broadcasting: false,
  }));
}

/**
 * Kirim sinyal ke worker RunPod untuk berhenti memutar idle video loop
 * dan mulai memutar video dari GPU queue (dipakai saat go-live-confirm).
 *
 * Graceful fallback: jika worker belum support /stream/start-playback,
 * warning dicatat dan eksekusi tetap berlanjut.
 */
export async function triggerWorkerPlayback(
  podId: string | null | undefined,
): Promise<void> {
  try {
    const queue = await getRunPodQueueStatus(podId).catch(() => null);
    if (queue && isAiWorkerBroadcastMode(String(queue.broadcast_mode || ""))) {
      console.log(
        "[RunPodBridge] ▶️  skip start-playback — mode ai_worker (playback_active otomatis)",
      );
      return;
    }

    await workerRequestWithRetry(
      podId,
      "/stream/start-playback",
      {
        method: "POST",
        body: JSON.stringify({ action: "start_playback" }),
      },
      2,
    );
    console.log(
      "[RunPodBridge] ▶️  Worker playback triggered — idle loop berhenti, queue mulai diputar.",
    );
  } catch (err: any) {
    // Worker mungkin belum support endpoint ini — tidak fatal.
    // Video di queue akan tetap diputar oleh worker.
    console.warn(
      "[RunPodBridge] /stream/start-playback tidak didukung worker (non-fatal):",
      err?.message ?? err,
    );
  }
}

/**
 * Menunggu secara bertahap hingga container AI worker di RunPod (Port 8000) siap merespon.
 */
export async function warmupWorker(
  podId: string | null | undefined,
  maxWaitSeconds = 15,
): Promise<void> {
  if (!podId) {
    throw new Error(
      "Worker GPU belum dialokasikan — broadcast dipanggil sebelum pod siap.",
    );
  }

  const workerUrl = getWorkerUrl(podId);
  if (!workerUrl) {
    throw new Error("URL worker RunPod tidak tersedia.");
  }

  console.log(
    `[RunPodBridge] Memeriksa kesiapan AI Worker di ${workerUrl}...`,
  );
  const start = Date.now();
  const maxAttempts = Math.max(1, Math.ceil(maxWaitSeconds / 1.5));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const health = await workerRequest(podId, "/health", {
        signal: AbortSignal.timeout(5000),
      });
      if (health && (!health.status || health.status === "ok")) {
        console.log(
          `[RunPodBridge] AI Worker online (${Math.round((Date.now() - start) / 1000)}s)`,
        );
        return;
      }
    } catch {
      if (attempt % 3 === 0) {
        console.log(
          `[RunPodBridge] Menunggu AI Worker (${Math.round((Date.now() - start) / 1000)}s)...`,
        );
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(
    `AI Worker belum merespons /health setelah ${maxWaitSeconds}s`,
  );
}

/** Pastikan pod + worker API hidup sebelum broadcast (resume pod statis jika perlu). */
export async function ensureWorkerReachable(
  podId: string | null | undefined,
  maxWaitSeconds = 60,
): Promise<void> {
  try {
    await warmupWorker(podId, maxWaitSeconds);
    return;
  } catch (firstErr) {
    const staticPodId = (process.env.RUNPOD_POD_ID || "").trim();
    if (!staticPodId || staticPodId !== podId?.trim()) {
      throw firstErr;
    }
    console.warn(
      `[RunPodBridge] Worker offline — mencoba resume pod statis ${staticPodId}...`,
    );
    const { startPodAndWait } = await import("./runpod-manager.js");
    await startPodAndWait(180_000);
    await warmupWorker(podId, maxWaitSeconds);
  }
}

export async function forwardToRunPodGPU(
  podId: string | null | undefined,
  params: RunPod2DStreamParams,
): Promise<RunPod2DStreamResult> {
  const workerUrl = getWorkerUrl(podId);

  try {
    let avatarName = "namira";
    if (params.avatarImagePath) {
      const parts = params.avatarImagePath.split("/");
      const filename = parts[parts.length - 1];
      if (filename) {
        avatarName = filename.replace(/\.(png|jpg|jpeg|mp4|webm|webp)$/i, "");
      }
    }

    let audioBase64 = params.audioBase64;
    if (!audioBase64 && !params.audioUrl && params.text) {
      try {
        const { synthesizeSpeech } = await import("./tts.js");
        const ttsRes = await synthesizeSpeech({
          text: stripActionTagsForTts(params.text),
          voice: params.voice,
          avatarName,
          tone: params.tone,
          speed: params.speed,
        });
        if (ttsRes.success && ttsRes.audioBuffer) {
          audioBase64 = ttsRes.audioBuffer.toString("base64");
        }
      } catch (ttsErr) {
        console.warn("[RunPodBridge] TTS synthesis notice:", ttsErr);
      }
    }

    // 1. Kirim task ke worker API (non-blocking)
    const data = await workerRequestWithRetry(
      podId,
      `/stream/live-utterance`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatar_name: avatarName,
          avatar_image_path: params.avatarImagePath || "avatars/namira.png",
          text: params.text,
          voice: params.voice || "EXAVITQu4vr4xnSDxMaL",
          speed: params.speed || 1.0,
          tone: params.tone || "Casual",
          rtmp_url: params.rtmpUrl || "",
          stream_key: params.streamKey || "",
          audio_base64: audioBase64 || "",
          audio_url: params.audioUrl || "",
          action: params.action || "",
          priority: params.priority === true,
          wait: false, // Gunakan polling agar tidak terkena HTTP timeout
          idle_video_loop: true, // Worker memutar idle video saat antrian kosong → tidak ada freeze
        }),
      },
      3,
    );

    let completedData = data;

    // 2. Jika dipanggil dengan mode menunggu (seperti prebuffer 2 video awal)
    const shouldWait = params.wait ?? false;
    if (data.job_id && (shouldWait || data.status === "processing")) {
      const maxAttempts = shouldWait ? 90 : 1; // 90 × polling = maks 180 detik untuk render awal
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        // Adaptive polling: lebih cepat di awal (render pendek), lebih lambat setelah lama
        // Attempt 0–9: poll tiap 1000ms → deteksi render cepat (<10 dtk) segera
        // Attempt 10+: poll tiap 2000ms → hemat request untuk render lama
        const pollInterval = attempt < 10 ? 1000 : 2000;
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        try {
          const statusData = await workerRequest(
            podId,
            `/stream/status/${data.job_id}`,
            { signal: AbortSignal.timeout(10000) },
          );
          if (statusData.status === "error") {
            throw new Error(statusData.error || "RunPod video job gagal");
          }
          if (statusData.status === "done") {
            completedData = statusData;
            break;
          }
        } catch (pollErr: any) {
          console.warn(
            `[RunPodBridge] Polling status check retry (${attempt + 1}):`,
            pollErr.message,
          );
        }
        if (shouldWait && attempt === maxAttempts - 1) {
          throw new Error("RunPod video job timeout (180s limit exceeded)");
        }
      }
    }

    let finalVideoUrl = completedData.video_url;
    if (finalVideoUrl && !finalVideoUrl.startsWith("http")) {
      finalVideoUrl = `${workerUrl}${finalVideoUrl}`;
    }

    return {
      success: true,
      videoUrl: finalVideoUrl,
      audioPath: completedData.audio_path,
      status: completedData.status || "rendered",
    };
  } catch (err) {
    console.warn(
      "[RunPodBridge] GPU worker notice (using standard stream pipe):",
      err,
    );
    if (params.requireWorker || !isDemoFallbackAllowed()) throw err;
  }

  return {
    success: true,
    status: "ready",
  };
}
