import crypto from "crypto";

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

export async function acquireGpuForJob(): Promise<void> {
  activeJobLeases += 1;
  try {
    if ((process.env.GPU_PROVIDER ?? "mock").toLowerCase() === "mock") {
      console.log(
        "[RunPodManager] GPU_PROVIDER=mock. Skipping GPU acquisition.",
      );
      return;
    }
    await startPodAndWait();
  } catch (error) {
    activeJobLeases = Math.max(0, activeJobLeases - 1);
    throw error;
  }
}

export async function releaseGpuForJob(): Promise<void> {
  activeJobLeases = Math.max(0, activeJobLeases - 1);
  // Pod will be stopped by idle monitor, not immediately after job completes
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
          const podId = process.env.RUNPOD_POD_ID;
          if (podId) {
            const status = await getPodStatus();
            // Only stop if it's actually running
            if (status && status.desiredStatus === "RUNNING") {
              await stopPod();
              console.log(
                `[RunPodManager] Auto-shutdown successful for Pod ${podId}`,
              );
            }
          }
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
export async function getPodStatus(): Promise<PodStatus | null> {
  const podId = process.env.RUNPOD_POD_ID;
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
 * Sends a request to start/resume the Pod
 */
/**
 * Sends a request to start/resume the Pod
 */
export async function resumePod(): Promise<boolean> {
  const podId = process.env.RUNPOD_POD_ID;
  if (!podId) return true; // Pretend success if no pod ID

  const mutation = `
    mutation podResume($input: PodResumeInput!) {
      podResume(input: $input) {
        id
        desiredStatus
      }
    }
  `;

  try {
    const data = await runpodGraphQL(mutation, {
      input: { podId, gpuCount: 1 },
    });
    console.log(`[RunPodManager] Resuming Pod ${podId}...`);
    return !!data?.podResume;
  } catch (error: any) {
    // Tangkap error jika GPU di mesin fisik penuh dari respons GraphQL
    if (error.message && error.message.includes("not enough free GPUs")) {
      console.warn(
        `[RunPodManager] Mesin host untuk Pod ${podId} sedang penuh GPU-nya.`,
      );
      throw new Error("GPU_HOST_FULL");
    }
    throw error;
  }
}

/**
 * Resumes the pod and waits (polls) until it is RUNNING and ready to accept requests.
 */
export async function startPodAndWait(timeoutMs = 120000): Promise<boolean> {
  const podId = process.env.RUNPOD_POD_ID;
  if (!podId) {
    console.log("[RunPodManager] No RUNPOD_POD_ID. Skipping startPodAndWait.");
    return true;
  }

  // Skip pod start if using mock provider
  if ((process.env.GPU_PROVIDER ?? "mock").toLowerCase() === "mock") {
    console.log("[RunPodManager] GPU_PROVIDER=mock. Skipping pod start.");
    return true;
  }

  updateGpuActivity();

  let status = await getPodStatus();

  // If it's already running, we're good
  if (status && status.desiredStatus === "RUNNING") {
    console.log("[RunPodManager] Pod is already running.");
  } else {
    // Mekanisme retry untuk menyalakan Pod jika mesin GPU penuh
    let retries = 3;
    let resumeSuccess = false;

    while (retries > 0) {
      try {
        await resumePod();
        resumeSuccess = true;
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
              return true; // Bypass proses tunggu agar backend tidak crash
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

    if (!resumeSuccess) {
      throw new Error("Gagal menyalakan pod setelah beberapa kali percobaan.");
    }

    // Poll until it's running
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      status = await getPodStatus();
      if (status && status.desiredStatus === "RUNNING") {
        console.log(
          `[RunPodManager] Pod is now RUNNING (took ${Math.round((Date.now() - startTime) / 1000)}s)`,
        );
        break;
      }

      // Wait 3 seconds before polling again
      await new Promise((r) => setTimeout(r, 3000));
    }

    if (!status || status.desiredStatus !== "RUNNING") {
      throw new Error(
        `[RunPodManager] Timeout waiting for pod ${podId} to start after ${timeoutMs}ms`,
      );
    }
  }

  const workerUrl = getWorkerUrl();
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
        return true;
      }
    } catch {
      // Worker not ready yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.warn(
    `[RunPodManager] Worker at ${workerUrl} did not respond within ${healthTimeout}ms after pod RUNNING`,
  );
  return true;
}
export async function stopPod(): Promise<boolean> {
  const podId = process.env.RUNPOD_POD_ID;
  if (!podId) return true;

  const mutation = `
    mutation podStop($input: PodStopInput!) {
      podStop(input: $input) {
        id
        desiredStatus
      }
    }
  `;

  const data = await runpodGraphQL(mutation, { input: { podId } });
  console.log(`[RunPodManager] Stopping Pod ${podId}...`);
  return !!data?.podStop;
}

export async function getGpuControlStatus() {
  const pod = await getPodStatus();
  return {
    configured: Boolean(process.env.RUNPOD_POD_ID),
    podId: process.env.RUNPOD_POD_ID || null,
    desiredStatus: pod?.desiredStatus || "UNKNOWN",
    liveSessionActive,
    activeJobLeases,
    workerUrl: getWorkerUrl(),
  };
}

export function getWorkerUrl(): string {
  const workerUrl =
    process.env.RUNPOD_WORKER_URL || process.env.AVATAR_WORKER_URL;
  const podId = process.env.RUNPOD_POD_ID;

  if (workerUrl) return workerUrl.replace(/\/$/, "");
  if (podId) return `https://${podId}-8000.proxy.runpod.net`;

  return "http://localhost:8000";
}
