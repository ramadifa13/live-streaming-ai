/**
 * videoAvatarService.ts
 *
 * AI Avatar Video Generation Service.
 * Supports multiple providers via AVATAR_PROVIDER env var:
 *   - mock     : Returns a real hosted MP4 URL after a simulated delay (no API key needed)
 *   - replicate: Replicate API    (EchoMimic / SadTalker)
 *   - liveportrait: RunPod GPU Worker (LivePortrait/MuseTalk)
 */

import crypto from "crypto";
import { startPodAndWait, getWorkerUrl, updateGpuActivity } from "./runpod-manager.js";

export type VideoJobStatus = "queued" | "processing" | "done" | "error";

export interface VideoJob {
  jobId: string;
  status: VideoJobStatus;
  progress: number;      // 0–100
  stage: string;         // Human-readable current stage label
  videoUrl?: string;
  proxyVideoUrl?: string; // Backend-proxied URL to avoid CORS
  error?: string;
  createdAt: number;
  providerJobId?: string; // External provider's job ID for polling
}

// In-memory job store (sufficient for demo; replace with Redis/DB for production)
const jobStore = new Map<string, VideoJob>();

export interface GenerateVideoParams {
  avatarImageUrl: string;
  productImageUrl?: string;
  scriptText: string;
  audioBase64?: string;
  audioUrl?: string;
  avatarName: string;
  tone?: string;
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

export async function generateAvatarVideo(params: GenerateVideoParams): Promise<VideoJob> {
  const jobId = crypto.randomUUID();
  const provider = (process.env.AVATAR_PROVIDER ?? "mock").toLowerCase();

  const job: VideoJob = {
    jobId,
    status: "queued",
    progress: 0,
    stage: "Menginisialisasi pipeline AI...",
    createdAt: Date.now(),
  };

  jobStore.set(jobId, job);

  // Start async generation (do NOT await — return immediately)
  runGeneration(jobId, params, provider).catch((err) => {
    const j = jobStore.get(jobId);
    if (j) {
      j.status = "error";
      j.stage = "Error pada pipeline AI";
      j.error = String(err);
    }
    console.error(`[VideoGen] Job ${jobId} failed:`, err);
  });

  return job;
}

export function getVideoJob(jobId: string): VideoJob | undefined {
  return jobStore.get(jobId);
}

/** Fetch video bytes from provider URL and store as a data URI for CORS-free frontend playback */
export async function fetchVideoAsDataUri(videoUrl: string): Promise<string | null> {
  try {
    const res = await fetch(videoUrl);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mime = res.headers.get("content-type") ?? "video/mp4";
    return `data:${mime};base64,${base64}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// INTERNAL: run generation for a given provider
// ---------------------------------------------------------------------------

async function runGeneration(
  jobId: string,
  params: GenerateVideoParams,
  provider: string
): Promise<void> {
  switch (provider) {
    case "liveportrait":
      return runLivePortrait(jobId, params);
    case "replicate":
      return runReplicate(jobId, params);
    default:
      return runMock(jobId, params);
  }
}

// ---------------------------------------------------------------------------
// LIVEPORTRAIT / GPU WORKER PROVIDER (Runs locally on RunPod GPU port 8000)
// ---------------------------------------------------------------------------

async function runLivePortrait(jobId: string, params: GenerateVideoParams): Promise<void> {
  updateJob(jobId, { status: "processing", progress: 5, stage: "Menunggu GPU RunPod siap (bisa 30-60 dtk)..." });

  try {
    await startPodAndWait();
  } catch (err: any) {
    updateJob(jobId, { status: "error", stage: "Gagal menyalakan GPU", error: err.message });
    throw err;
  }

  const workerUrl = getWorkerUrl();

  updateJob(jobId, { progress: 10, stage: "Menginisialisasi SadTalker Neural Engine..." });

  try {
    // Extract avatar name from image path (e.g. "avatars/host_3d_dinamis_namira.png" -> "Namira")
    const avatarName = params.avatarName || "Namira";
    const cleanAvatarName = avatarName.replace(/\.(png|jpg|jpeg|mp4|webm|webp)$/i, "");

    // Convert http://localhost:3000/avatars/x.jpg -> just the path part
    // so the worker can resolve it from its local filesystem
    let avatarImagePath = params.avatarImageUrl || "";
    try {
      if (params.avatarImageUrl) {
        const parsed = new URL(params.avatarImageUrl);
        avatarImagePath = parsed.pathname; // e.g. "/avatars/host_3d_dinamis_namira.png"
      }
    } catch {
      // Not a full URL — use as-is
    }

    // Extract avatar name from the image path to ensure we get the actual filename
    // e.g. "/avatars/host_3d_dinamis_namira.png" -> "host_3d_dinamis_namira"
    let finalAvatarFileName = cleanAvatarName;
    if (avatarImagePath) {
      const parts = avatarImagePath.split('/');
      const filename = parts[parts.length - 1];
      if (filename) {
        finalAvatarFileName = filename.replace(/\.(png|jpg|jpeg|mp4|webm|webp)$/i, "");
      }
    }

    const payload = {
      avatar_name: finalAvatarFileName,
      avatar_image_path: avatarImagePath,
      text: params.scriptText,
      voice: "id-ID-GadisNeural",
      speed: params.tone === "Energetic" || params.tone === "Semangat" ? 1.1 : 1.0,
      tone: params.tone || "Persuasif",
    };

    updateJob(jobId, { progress: 20, stage: "Synthesizing TTS audio (Edge-TTS)..." });

    const res = await fetch(`${workerUrl}/stream/generate-neural-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(200_000), // 200s timeout for SadTalker on GPU
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "No text body");
      throw new Error(`Worker returned status ${res.status}: ${errorText}`);
    }

    updateGpuActivity(); // Reset idle timer since GPU just processed successfully

    updateJob(jobId, { progress: 60, stage: "SadTalker generating lip-sync video..." });

    const data = await res.json() as {
      success?: boolean;
      video_url?: string;
      job_id?: string;
      lip_sync_active?: boolean;
      engine?: string;
    };

    const rawUrl = data.video_url;
    if (!rawUrl) {
      throw new Error("Worker did not return a video_url");
    }

    // Build absolute URL: if relative path (/live_videos/xxx.mp4), prepend worker base
    const finalVideoUrl = rawUrl.startsWith("http")
      ? rawUrl
      : `${workerUrl}${rawUrl}`;

    const engineLabel = data.engine || (data.lip_sync_active ? "SadTalker Neural Lip-Sync" : "FFmpeg Motion");

    updateJob(jobId, {
      status: "done",
      progress: 100,
      stage: `${engineLabel} — Video siap!`,
      videoUrl: finalVideoUrl,
    });
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[Worker Catch Error]:`, errMsg);
    updateJob(jobId, { status: "error", stage: "Error pada AI Worker", error: errMsg });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// MOCK PROVIDER — realistic simulation, no API key needed
// ---------------------------------------------------------------------------

async function runMock(jobId: string, params: GenerateVideoParams): Promise<void> {
  const stages = [
    { progress: 5,   stage: "Menganalisis foto avatar...",               delay: 800  },
    { progress: 15,  stage: "Menjalankan Face Detection & Landmark...",  delay: 1200 },
    { progress: 28,  stage: "Synthesizing audio TTS...",                 delay: 1000 },
    { progress: 42,  stage: "Menjalankan Lip-sync (EchoMimic)...",       delay: 1500 },
    { progress: 58,  stage: "Generating head motion & eye blinks...",    delay: 1200 },
    { progress: 72,  stage: "Compositing product overlay...",            delay: 1000 },
    { progress: 85,  stage: "Encoding video H.264 @ 30fps...",           delay: 1000 },
    { progress: 95,  stage: "Uploading ke CDN...",                       delay: 800  },
    { progress: 100, stage: "Video siap!",                               delay: 400  },
  ];

  updateJob(jobId, { status: "processing", progress: 0, stage: "Memulai render..." });

  for (const step of stages) {
    await sleep(step.delay);
    updateJob(jobId, { progress: step.progress, stage: step.stage });
  }

  // Accurate avatar matching videos based on selected 2D / 3D character
  let videoUrl = "https://videos.pexels.com/video-files/6231246/6231246-hd_1080_1920_30fps.mp4";
  const nameLow = (params.avatarName || "").toLowerCase();

  if (nameLow.includes("nana") || nameLow.includes("2d")) {
    videoUrl = "https://assets.mixkit.co/videos/preview/mixkit-woman-talking-on-a-video-call-42898-large.mp4";
  } else {
    // Namira (3D Energetic)
    videoUrl = "https://videos.pexels.com/video-files/6231246/6231246-hd_1080_1920_30fps.mp4";
  }

  updateJob(jobId, {
    status: "done",
    progress: 100,
    stage: "Video AI " + (params.avatarName || "Avatar") + " siap!",
    videoUrl,
  });
}



// ---------------------------------------------------------------------------
// REPLICATE PROVIDER (EchoMimic)
// ---------------------------------------------------------------------------

async function runReplicate(jobId: string, params: GenerateVideoParams): Promise<void> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not set in .env");

  updateJob(jobId, { status: "processing", progress: 10, stage: "Mengirim ke Replicate EchoMimic..." });

  const createRes = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      version: "75e71f10cd1e7a6b1c2e7d2b09afdb86e1f18571f4c7da35eef7d6fa3d783a63",
      input: {
        ref_image_path: params.avatarImageUrl,
        audio_path: params.audioUrl ?? params.avatarImageUrl,
        width: 512,
        height: 512,
        steps: 20,
        cfg: 2.5,
        fps: 24,
      },
    }),
  });

  if (!createRes.ok) throw new Error(`Replicate create failed: ${await createRes.text()}`);

  const prediction = await createRes.json() as { id: string; urls: { get: string } };
  const pollUrl = prediction.urls.get;
  updateJob(jobId, { providerJobId: prediction.id, progress: 15, stage: "Replicate: Model loading..." });

  for (let attempt = 0; attempt < 90; attempt++) {
    await sleep(4000);
    const statusRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const pred = await statusRes.json() as { status: string; output?: string; error?: string };

    if (pred.status === "succeeded" && pred.output) {
      updateJob(jobId, { status: "done", progress: 100, stage: "Video Replicate siap!", videoUrl: pred.output });
      return;
    }
    if (pred.status === "failed") throw new Error(`Replicate: ${pred.error}`);

    const pct = Math.min(15 + attempt * 1, 90);
    updateJob(jobId, { progress: Math.round(pct), stage: `Replicate: ${pred.status}...` });
  }

  throw new Error("Replicate timeout");
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function updateJob(jobId: string, patch: Partial<VideoJob>): void {
  const job = jobStore.get(jobId);
  if (job) Object.assign(job, patch);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
