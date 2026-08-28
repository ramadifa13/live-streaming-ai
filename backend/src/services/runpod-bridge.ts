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

import { getWorkerUrl } from "./runpod-manager.js";

function isDemoFallbackAllowed() {
  return (process.env.ALLOW_MEDIA_FALLBACK ?? "false").toLowerCase() === "true";
}

async function workerRequest(
  podId: string | null | undefined,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(`${getWorkerUrl(podId)}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || `Worker request failed: ${response.status}`);
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
      if (status === 502 || status === 503 || status === 504) {
        const backoff = 1000 * Math.pow(2, attempt);
        console.warn(
          `[RunPodBridge] Worker returned ${status}, retrying in ${backoff}ms...`,
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
  },
): Promise<RunPodBroadcastResult> {
  return workerRequestWithRetry(podId, "/stream/start-broadcast", {
    method: "POST",
    body: JSON.stringify({
      rtmp_url: params.rtmpUrl,
      stream_key: params.streamKey,
      rtmpUrl: params.rtmpUrl,
      streamKey: params.streamKey,
    }),
  });
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

export async function warmupWorker(
  podId: string | null | undefined,
): Promise<void> {
  await workerRequestWithRetry(podId, "/", undefined, 3);
}

export async function forwardToRunPodGPU(
  podId: string | null | undefined,
  params: RunPod2DStreamParams,
): Promise<RunPod2DStreamResult> {
  const workerUrl = getWorkerUrl(podId);

  try {
    const controller = new AbortController();
    // Tingkatkan timeout menjadi 60 detik (60000ms) agar Backend sabar menunggu RunPod
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    let avatarName = "namira";
    if (params.avatarImagePath) {
      const parts = params.avatarImagePath.split("/");
      const filename = parts[parts.length - 1];
      if (filename) {
        avatarName = filename.replace(/\.(png|jpg|jpeg|mp4|webm|webp)$/i, "");
      }
    }

    const data = await workerRequestWithRetry(
      podId,
      `/stream/live-utterance`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          avatar_name: avatarName,
          avatar_image_path: params.avatarImagePath || "avatars/namira.png",
          text: params.text,
          voice: params.voice || "id-ID-GadisNeural",
          speed: params.speed || 1.0,
          tone: params.tone || "Casual",
          rtmp_url: params.rtmpUrl || "",
          stream_key: params.streamKey || "",
          audio_base64: params.audioBase64 || "",
          audio_url: params.audioUrl || "",
        }),
      },
      3,
    );

    clearTimeout(timeoutId);
    let completedData = data;
    if (data.job_id) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const statusData = await workerRequestWithRetry(
          podId,
          `/stream/status/${data.job_id}`,
          undefined,
          2,
        );
        if (statusData.status === "error")
          throw new Error(statusData.error || "RunPod video job gagal");
        if (statusData.status === "done") {
          completedData = statusData;
          break;
        }
        if (attempt === 99) throw new Error("RunPod video job timeout");
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
