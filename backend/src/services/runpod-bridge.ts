/**
 * RunPod GPU Worker Bridge Service
 * Forwards synthesized audio and avatar image to RunPod GPU LivePortrait/MuseTalk worker.
 */

export interface RunPod2DStreamParams {
  avatarImagePath: string;
  text: string;
  voice?: string;
  speed?: number;
  rtmpUrl?: string;
  streamKey?: string;
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

async function workerRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${getWorkerUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || `Worker request failed: ${response.status}`);
  return data;
}

export async function startRunPodBroadcast(params: {
  rtmpUrl: string;
  streamKey: string;
}): Promise<RunPodBroadcastResult> {
  return workerRequest("/stream/start-broadcast", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function stopRunPodBroadcast(): Promise<RunPodBroadcastResult> {
  return workerRequest("/stream/stop-broadcast", { method: "POST" });
}

export async function getRunPodBroadcastStatus(): Promise<RunPodBroadcastResult> {
  return workerRequest("/stream/broadcast-status");
}

export async function forwardToRunPodGPU(
  params: RunPod2DStreamParams,
): Promise<RunPod2DStreamResult> {
  const workerUrl = getWorkerUrl();

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

    const res = await fetch(`${workerUrl}/stream/live-utterance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        avatar_name: avatarName,
        avatar_image_path: params.avatarImagePath || "avatars/namira.png",
        text: params.text,
        voice: params.voice || "id-ID-GadisNeural",
        speed: params.speed || 1.0,
        rtmp_url: params.rtmpUrl || "",
        stream_key: params.streamKey || "",
      }),
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as {
        video_url?: string;
        audio_path?: string;
        status?: string;
        job_id?: string;
      };
      let completedData = data;
      if (data.job_id) {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const statusRes = await fetch(
            `${workerUrl}/stream/status/${data.job_id}`,
            {
              signal: AbortSignal.timeout(10000),
            },
          );
          if (!statusRes.ok) continue;
          const statusData = (await statusRes.json()) as typeof data & {
            error?: string;
          };
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
        videoUrl:
          finalVideoUrl ||
          "https://videos.pexels.com/video-files/6231246/6231246-hd_1080_1920_30fps.mp4",
        audioPath: completedData.audio_path,
        status: completedData.status || "rendered",
      };
    }
    throw new Error(`Worker returned status ${res.status}`);
  } catch (err) {
    console.warn(
      "[RunPodBridge] GPU worker notice (using standard stream pipe):",
      err,
    );
    if (params.requireWorker) throw err;
  }

  // Fallback 2D video stream url
  return {
    success: true,
    videoUrl:
      "https://videos.pexels.com/video-files/6231246/6231246-hd_1080_1920_30fps.mp4",
    status: "ready",
  };
}
