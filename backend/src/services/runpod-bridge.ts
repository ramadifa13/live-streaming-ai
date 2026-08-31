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
  warmed_up?: boolean;
}

import { getWorkerUrl } from "./runpod-manager.js";

function isDemoFallbackAllowed() {
  return (process.env.ALLOW_MEDIA_FALLBACK ?? "false").toLowerCase() === "true";
}

async function workerRequest(
  podId: string | null | undefined,
  path: string,
  init?: RequestInit,
) {
  const signal = init?.signal || AbortSignal.timeout(60000);
  const response = await fetch(`${getWorkerUrl(podId)}${path}`, {
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
      if (
        status === 502 ||
        status === 503 ||
        status === 504 ||
        err.name === "TimeoutError"
      ) {
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
  },
): Promise<RunPodBroadcastResult> {
  return workerRequestWithRetry(podId, "/stream/start-broadcast", {
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
    }),
  });
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
  maxWaitSeconds = 60,
): Promise<void> {
  console.log(`[RunPodBridge] Memeriksa kesiapan AI Worker di RunPod...`);
  const start = Date.now();
  for (let attempt = 0; attempt < maxWaitSeconds; attempt++) {
    try {
      const health = await workerRequest(podId, "/health", {
        signal: AbortSignal.timeout(5000),
      });
      if (health && health.status === "ok") {
        console.log(
          `[RunPodBridge] AI Worker online dan siap melayani render video! (${Math.round((Date.now() - start) / 1000)}s)`,
        );
        return;
      }
    } catch (err) {
      if (attempt % 5 === 0) {
        console.log(
          `[RunPodBridge] Menunggu AI Worker inisialisasi (${attempt + 1}s)...`,
        );
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.warn(`[RunPodBridge] Selesai menunggu inisialisasi.`);
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
