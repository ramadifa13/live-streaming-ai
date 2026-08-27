import sys
import re

content = """import crypto from "crypto";

const RUNPOD_GRAPHQL_URL = "https://api.runpod.io/graphql";

export interface PodStatus {
  id: string;
  desiredStatus: string;
}

let lastGpuActivityTimestamp = Date.now();
let idleMonitorInterval: NodeJS.Timeout | null = null;
let liveSessionActive = false;
let activeJobLeases = 0;

export function setLiveSessionActive(active: boolean) {
  liveSessionActive = active;
  if (active) updateGpuActivity();
}

export function isLiveSessionActive(): boolean {
  return liveSessionActive;
}

export async function acquireGpuForJob(): Promise<string | null> {
  activeJobLeases += 1;
  try {
    if ((process.env.GPU_PROVIDER ?? "mock").toLowerCase() === "mock") {
      console.log(
        "[RunPodManager] GPU_PROVIDER=mock. Skipping GPU acquisition.",
      );
      return null;
    }
    return await startPodAndWait();
  } catch (error) {
    activeJobLeases = Math.max(0, activeJobLeases - 1);
    throw error;
  }
}

export async function releaseGpuForJob(podId?: string | null): Promise<void> {
  activeJobLeases = Math.max(0, activeJobLeases - 1);
  if (podId) {
      await stopPod(podId);
  }
}

export function updateGpuActivity() {
  lastGpuActivityTimestamp = Date.now();
}

export function startIdleMonitor() {
  if (idleMonitorInterval) return;

  const timeoutMinutes = parseInt(
    process.env.GPU_IDLE_TIMEOUT_MINUTES || "30",
    10,
  );
  if (timeoutMinutes <= 0) {
    console.log(
      "[RunPodManager] GPU_IDLE_TIMEOUT_MINUTES is 0 or invalid, auto-shutdown disabled.",
    );
    return;
  }

  console.log(
    `[RunPodManager] Starting GPU Idle Monitor (Timeout: ${timeoutMinutes} minutes)`,
  );

  // Check every 5 minutes
  idleMonitorInterval = setInterval(
    async () => {
      const elapsedMinutes =
        (Date.now() - lastGpuActivityTimestamp) / 1000 / 60;

      if (elapsedMinutes >= timeoutMinutes) {
        console.log(
          `[RunPodManager] GPU has been idle for ${Math.round(elapsedMinutes)} minutes. Initiating auto-shutdown...`,
        );
        try {
          console.log(`[RunPodManager] Idle monitor skipped (Pods are managed per-session lifecycle now).`);
        } catch (err) {
          console.error(
            `[RunPodManager] Failed to auto-shutdown GPU Pod:`,
            err,
          );
        }
      }
    },
    5 * 60 * 1000,
  ); // 5 minutes interval
}

/**
 * Executes a GraphQL query against the RunPod API
 */
async function runpodGraphQL(query: string, variables: any) {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) {
    console.warn(
      "[RunPodManager] RUNPOD_API_KEY is not set. Assuming local/mock environment.",
    );
    return null; // Gracefully fail if no API key is provided
  }

  const response = await fetch(RUNPOD_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`RunPod API Error: ${response.status} - ${err}`);
  }

  const result = (await response.json()) as any;
  if (result.errors) {
    throw new Error(`RunPod GraphQL Error: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}

/**
 * Gets the current status of the configured Pod
 */
export async function getPodStatus(podId: string): Promise<PodStatus | null> {
  if (!podId) return null;

  const query = `
    query pod($input: PodFilter!) {
      pod(input: $input) {
        id
        desiredStatus
      }
    }
  `;

  const data = await runpodGraphQL(query, { input: { podId } });
  return data?.pod || null;
}

/**
 * Sends a request to create a new Pod on-demand
 */
export async function createPod(): Promise<string> {
  const volumeId = process.env.RUNPOD_NETWORK_VOLUME_ID;
  if (!volumeId) {
    throw new Error("RUNPOD_NETWORK_VOLUME_ID is not configured");
  }

  const mutation = `
    mutation podFindAndDeployOnDemand($input: PodFindAndDeployOnDemandInput!) {
      podFindAndDeployOnDemand(input: $input) {
        id
        desiredStatus
      }
    }
  `;

  try {
    const data = await runpodGraphQL(mutation, {
      input: {
        cloudType: "SECURE",
        gpuCount: 1,
        volumeInGb: 0,
        containerDiskInGb: 5,
        minVcpuCount: 2,
        minMemoryInGb: 15,
        gpuTypeId: "NVIDIA GeForce RTX 4090",
        name: "LiveStreamingWorker",
        imageName: "runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04",
        dockerArgs: "bash -c 'cd /workspace/live-streaming-ai/deploy && bash start.sh'",
        ports: "8000/http,8090/http",
        networkVolumeId: volumeId
      },
    });

    if (data?.podFindAndDeployOnDemand?.id) {
      const createdPodId = data.podFindAndDeployOnDemand.id;
      console.log(`[RunPodManager] Created new on-demand Pod ${createdPodId}...`);
      return createdPodId;
    }
    throw new Error("Failed to create pod: No ID returned.");
  } catch (error: any) {
    if (error.message && error.message.includes("not enough free GPUs")) {
      console.warn(`[RunPodManager] RunPod has no free GPUs available.`);
      throw new Error("GPU_HOST_FULL");
    }
    throw error;
  }
}

/**
 * Resumes the pod and waits (polls) until it is RUNNING and ready to accept requests.
 */
export async function startPodAndWait(timeoutMs = 120000): Promise<string | null> {
  // We no longer rely on static RUNPOD_POD_ID, we check if we have volume ID configured
  if (!process.env.RUNPOD_NETWORK_VOLUME_ID && !process.env.RUNPOD_POD_ID) {
    console.log("[RunPodManager] No RUNPOD_NETWORK_VOLUME_ID or RUNPOD_POD_ID. Skipping start.");
    return null;
  }

  // Skip pod start if using mock provider
  if ((process.env.GPU_PROVIDER ?? "mock").toLowerCase() === "mock") {
    console.log("[RunPodManager] GPU_PROVIDER=mock. Skipping pod start.");
    return null;
  }

  updateGpuActivity();

  let currentPodId = process.env.RUNPOD_POD_ID || null;

  // If it's already running, we're good
  if (currentPodId) {
     let status = await getPodStatus(currentPodId);
     if (status && status.desiredStatus === "RUNNING") {
        console.log("[RunPodManager] Pod is already running.");
        return currentPodId;
     }
  }

  // Mekanisme retry untuk membuat Pod jika mesin GPU penuh
  let retries = 3;
  let createSuccess = false;

  while (retries > 0) {
    try {
      if (process.env.RUNPOD_NETWORK_VOLUME_ID) {
          currentPodId = await createPod();
      }
      createSuccess = true;
      break;
    } catch (err: any) {
        if (err.message === "GPU_HOST_FULL") {
          if (retries > 1) {
            console.log(
              `[RunPodManager] GPU penuh, mencoba lagi dalam 10 detik... (${retries - 1} percobaan tersisa)`,
            );
            await new Promise((r) => setTimeout(r, 10000));
            retries--;
          } else {
            const allowFallback =
              (process.env.ALLOW_MEDIA_FALLBACK ?? "false").toLowerCase() ===
              "true";
            if (allowFallback) {
              console.warn(
                "[RunPodManager] Semua GPU penuh. Beralih ke fallback (tanpa GPU).",
              );
              return null; // Bypass proses tunggu agar backend tidak crash
            }
            // Jika tidak boleh fallback, hentikan dengan melempar pesan error untuk Frontend
            throw new Error(
              "Semua GPU di server sedang penuh. Silakan coba beberapa saat lagi.",
            );
          }
        } else {
          // Lemparkan error jika disebabkan oleh hal lain (misal: koneksi terputus/API key salah)
          throw err;
        }
      }
  }

  if (!createSuccess || !currentPodId) {
    throw new Error("Gagal menyalakan pod setelah beberapa kali percobaan.");
  }

  // Poll until it's running
  const startTime = Date.now();
  let status: PodStatus | null = null;
  while (Date.now() - startTime < timeoutMs) {
    status = await getPodStatus(currentPodId);
    if (status && status.desiredStatus === "RUNNING") {
      console.log(
        `[RunPodManager] Pod ${currentPodId} is now RUNNING (took ${Math.round((Date.now() - startTime) / 1000)}s)`,
      );
      break;
    }

    // Wait 3 seconds before polling again
    await new Promise((r) => setTimeout(r, 3000));
  }

  if (!status || status.desiredStatus !== "RUNNING") {
    throw new Error(
      `[RunPodManager] Timeout waiting for pod ${currentPodId} to start after ${timeoutMs}ms`,
    );
  }

  const workerUrl = getWorkerUrl(currentPodId);
  const healthStart = Date.now();
  const healthTimeout = Math.min(timeoutMs, 180000);
  while (Date.now() - healthStart < healthTimeout) {
    try {
      const res = await fetch(`${workerUrl}/`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        console.log(
          `[RunPodManager] Worker is ready at ${workerUrl} (${Math.round((Date.now() - healthStart) / 1000)}s after pod RUNNING)`,
        );
        return currentPodId;
      }
    } catch {
      // Worker not ready yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.warn(
    `[RunPodManager] Worker at ${workerUrl} did not respond within ${healthTimeout}ms after pod RUNNING`,
  );
  return currentPodId;
}
export async function stopPod(podId: string): Promise<boolean> {
  if (!podId) return true;

  const mutation = `
    mutation podTerminate($input: PodTerminateInput!) {
      podTerminate(input: $input)
    }
  `;

  const data = await runpodGraphQL(mutation, { input: { podId } });
  console.log(`[RunPodManager] Terminating Pod ${podId}...`);
  return !!data;
}

export async function getGpuControlStatus(podId: string | null) {
  const pod = podId ? await getPodStatus(podId) : null;
  return {
    configured: Boolean(process.env.RUNPOD_NETWORK_VOLUME_ID || process.env.RUNPOD_POD_ID),
    podId: podId || process.env.RUNPOD_POD_ID || null,
    desiredStatus: pod?.desiredStatus || "UNKNOWN",
    liveSessionActive,
    activeJobLeases,
    workerUrl: getWorkerUrl(podId),
  };
}

export function getWorkerUrl(podId?: string | null): string {
  const workerUrl =
    process.env.RUNPOD_WORKER_URL || process.env.AVATAR_WORKER_URL;

  if (workerUrl) return workerUrl.replace(/\/$/, "");
  if (podId) return `https://${podId}-8000.proxy.runpod.net`;

  return "http://localhost:8000";
}
"""

with open("backend/src/services/runpod-manager.ts", "w") as f:
    f.write(content)
