import crypto from "crypto";

const RUNPOD_GRAPHQL_URL = "https://api.runpod.io/graphql";

export interface PodStatus {
  id: string;
  lastStatus: string;
  desiredStatus: string;
}

let lastGpuActivityTimestamp = Date.now();
let idleMonitorInterval: NodeJS.Timeout | null = null;

export function updateGpuActivity() {
  lastGpuActivityTimestamp = Date.now();
}

export function startIdleMonitor() {
  if (idleMonitorInterval) return;
  
  const timeoutMinutes = parseInt(process.env.GPU_IDLE_TIMEOUT_MINUTES || "30", 10);
  if (timeoutMinutes <= 0) {
    console.log("[RunPodManager] GPU_IDLE_TIMEOUT_MINUTES is 0 or invalid, auto-shutdown disabled.");
    return;
  }
  
  console.log(`[RunPodManager] Starting GPU Idle Monitor (Timeout: ${timeoutMinutes} minutes)`);
  
  // Check every 5 minutes
  idleMonitorInterval = setInterval(async () => {
    const elapsedMinutes = (Date.now() - lastGpuActivityTimestamp) / 1000 / 60;
    
    if (elapsedMinutes >= timeoutMinutes) {
      console.log(`[RunPodManager] GPU has been idle for ${Math.round(elapsedMinutes)} minutes. Initiating auto-shutdown...`);
      try {
        const podId = process.env.RUNPOD_POD_ID;
        if (podId) {
          const status = await getPodStatus();
          // Only stop if it's actually running
          if (status && status.lastStatus === "RUNNING") {
            await stopPod();
            console.log(`[RunPodManager] Auto-shutdown successful for Pod ${podId}`);
          }
        }
      } catch (err) {
        console.error(`[RunPodManager] Failed to auto-shutdown GPU Pod:`, err);
      }
    }
  }, 5 * 60 * 1000); // 5 minutes interval
}

/**
 * Executes a GraphQL query against the RunPod API
 */
async function runpodGraphQL(query: string, variables: any) {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) {
    console.warn("[RunPodManager] RUNPOD_API_KEY is not set. Assuming local/mock environment.");
    return null; // Gracefully fail if no API key is provided
  }

  const response = await fetch(RUNPOD_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      query,
      variables
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`RunPod API Error: ${response.status} - ${err}`);
  }

  const result = await response.json() as any;
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
        lastStatus
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

  const data = await runpodGraphQL(mutation, { input: { podId, gpuCount: 1 } });
  console.log(`[RunPodManager] Resuming Pod ${podId}...`);
  return !!data?.podResume;
}

/**
 * Sends a request to stop the Pod
 */
export async function stopPod(): Promise<boolean> {
  const podId = process.env.RUNPOD_POD_ID;
  if (!podId) return true; // Pretend success if no pod ID

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

/**
 * Resumes the pod and waits (polls) until it is RUNNING and ready to accept requests.
 */
export async function startPodAndWait(timeoutMs = 120000): Promise<boolean> {
  const podId = process.env.RUNPOD_POD_ID;
  if (!podId) {
    console.log("[RunPodManager] No RUNPOD_POD_ID. Skipping startPodAndWait.");
    return true;
  }

  updateGpuActivity();
  
  let status = await getPodStatus();
  
  // If it's already running, we're good
  if (status && status.lastStatus === "RUNNING") {
    console.log("[RunPodManager] Pod is already running.");
    return true;
  }

  // Resume the pod
  await resumePod();

  // Poll until it's running
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    status = await getPodStatus();
    if (status && status.lastStatus === "RUNNING") {
      console.log(`[RunPodManager] Pod is now RUNNING (took ${Math.round((Date.now() - startTime)/1000)}s)`);
      
      // Wait a few extra seconds for the internal Fastapi/PM2 services to actually boot up
      // after the container is marked as running by RunPod
      await new Promise(r => setTimeout(r, 10000));
      return true;
    }
    
    // Wait 3 seconds before polling again
    await new Promise(r => setTimeout(r, 3000));
  }

  throw new Error(`[RunPodManager] Timeout waiting for pod ${podId} to start after ${timeoutMs}ms`);
}

/**
 * Gets the worker URL, prioritizing the proxy URL based on the POD_ID
 */
export function getWorkerUrl(): string {
  const workerUrl = process.env.RUNPOD_WORKER_URL || process.env.AVATAR_WORKER_URL;
  const podId = process.env.RUNPOD_POD_ID;
  
  if (workerUrl) return workerUrl.replace(/\/$/, "");
  if (podId) return `https://${podId}-8000.proxy.runpod.net`;
  
  return "http://localhost:8000";
}
