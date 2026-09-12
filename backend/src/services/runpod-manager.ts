const RUNPOD_GRAPHQL_URL = "https://api.runpod.io/graphql";
export interface PodStatus {
  id: string;
  desiredStatus: string;
}

let lastGpuActivityTimestamp = Date.now();
let idleMonitorInterval: NodeJS.Timeout | null = null;
const activeLiveSessions = new Set<string>();
let activeJobLeases = 0;
const podOwners = new Map<string, string>();

function isProdLike(): boolean {
  return (process.env.NODE_ENV || "").toLowerCase() === "production";
}

function resolveProvider(): string {
  return (process.env.GPU_PROVIDER ?? process.env.AVATAR_PROVIDER ?? "mock").toLowerCase();
}

export function setLiveSessionActive(active: boolean, sessionId = "legacy") {
  if (active) activeLiveSessions.add(sessionId);
  else activeLiveSessions.delete(sessionId);
  if (active) updateGpuActivity();
}

export function isLiveSessionActive(): boolean {
  return activeLiveSessions.size > 0;
}

export async function acquireGpuForJob(ownerId?: string): Promise<string | null> {
  activeJobLeases += 1;
  try {
    const provider = resolveProvider();
    if (isProdLike() && provider === "mock") {
      throw new Error("GPU_PROVIDER=mock tidak diizinkan di production. Set GPU_PROVIDER=runpod.");
    }
    if (provider === "mock") {
      console.log("[RunPodManager] GPU/Avatar provider is mock. Skipping GPU acquisition.");
      activeJobLeases = Math.max(0, activeJobLeases - 1);
      return null;
    }
    return await startPodAndWait(undefined, { sessionId: ownerId });
  } catch (error) {
    activeJobLeases = Math.max(0, activeJobLeases - 1);
    throw error;
  }
}

function isPodKeepWarm(): boolean {
  const v = (process.env.RUNPOD_KEEP_POD_WARM ?? "false").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

export { isPodKeepWarm };

export function getStaticPodId(): string {
  const raw = (process.env.RUNPOD_POD_ID || "").trim().replace(/^["']+|["']+$/g, "");
  if (!raw || raw === "---" || raw.toLowerCase() === "none") return "";
  return raw;
}

export function isStaticPodId(podId?: string | null): boolean {
  const staticId = getStaticPodId();
  const id = (podId || "").trim();
  return Boolean(staticId && id && staticId === id);
}

export function rememberPodOwner(podId: string, sessionId: string): void {
  if (podId && sessionId) podOwners.set(podId, sessionId);
}

export function getPodOwner(podId: string): string | undefined {
  return podOwners.get(podId);
}

export function assertPodReleaseAllowed(podId: string, ownerId?: string): void {
  const registeredOwner = podOwners.get(podId);
  if (ownerId && registeredOwner && registeredOwner !== ownerId) {
    throw new Error(`Pod ${podId} dimiliki sesi lain; release ditolak.`);
  }
}

export async function releaseGpuForJob(podId?: string | null, ownerId?: string): Promise<void> {
  activeJobLeases = Math.max(0, activeJobLeases - 1);
  if (podId) {
    assertPodReleaseAllowed(podId, ownerId);
    await stopPod(podId);
    podOwners.delete(podId);
  }
}

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

  idleMonitorInterval = setInterval(
    async () => {
      const elapsedMinutes = (Date.now() - lastGpuActivityTimestamp) / 1000 / 60;

      if (elapsedMinutes >= timeoutMinutes) {
        console.log(`[RunPodManager] GPU has been idle for ${Math.round(elapsedMinutes)} minutes. Initiating auto-shutdown...`);
        try {
          console.log(`[RunPodManager] Idle monitor skipped (Pods are managed per-session lifecycle now).`);
        } catch (err) {
          console.error(`[RunPodManager] Failed to auto-shutdown GPU Pod:`, err);
        }
      }
    },
    5 * 60 * 1000,
  );
}

async function runpodGraphQL(query: string, variables: any) {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) {
    console.warn("[RunPodManager] RUNPOD_API_KEY is not set. Assuming local/mock environment.");
    return null;
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

const PRIMARY_GPU = {
  id: "NVIDIA GeForce RTX 4090",
  label: "RTX 4090 (Utama, Fast Lipsync)",
};
const FALLBACK_GPU = {
  id: "NVIDIA L40S",
  label: "L40S (Cadangan Ada, 48GB)",
};
const BUDGET_GPU_TIERS = [PRIMARY_GPU, FALLBACK_GPU];

export async function createPod(sessionId?: string): Promise<string> {
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

  let lastGpuError: any = null;

  // 4090 selalu dicoba dulu. L40S hanya jika 4090 penuh / tidak ada di DC volume.
  const tiersToTry = BUDGET_GPU_TIERS;

  const cloudType = process.env.RUNPOD_CLOUD_TYPE || "ALL";
  const strictGpu = process.env.RUNPOD_GPU_STRICT === "1";
  const gpuRetries = Math.max(1, Number(process.env.RUNPOD_GPU_RETRY || "3"));
  const dataCenterHint = process.env.RUNPOD_DATACENTER_ID?.trim();

  if (dataCenterHint) {
    console.log(`[RunPodManager] Preferred datacenter: ${dataCenterHint} (harus match network volume DC)`);
  }

  for (const gpuTier of tiersToTry) {
    for (let attempt = 1; attempt <= gpuRetries; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`[RunPodManager] Retry ${attempt}/${gpuRetries} untuk ${gpuTier.label} (stock Low — coba lagi)...`);
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          console.log(`[RunPodManager] Mencoba alokasi GPU: ${gpuTier.label}...`);
        }

        const sessionSlug = (sessionId || "adhoc").replace(/[^a-zA-Z0-9_-]/g, "").slice(-24) || "adhoc";
        const input: Record<string, unknown> = {
          cloudType: cloudType,
          gpuCount: 1,
          volumeInGb: 0,
          containerDiskInGb: Number(process.env.RUNPOD_CONTAINER_DISK_GB || "10"),

          minVcpuCount: Number(process.env.RUNPOD_MIN_VCPU || "8"),
          minMemoryInGb: Number(process.env.RUNPOD_MIN_MEMORY_GB || "24"),
          gpuTypeId: gpuTier.id,
          name: `LiveWorker-${sessionSlug}-${gpuTier.id.replace(/\s+/g, "_")}`.slice(0, 64),
          imageName: "runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04",
          dockerArgs:
            `bash -c 'export LIVE_SESSION_ID=${sessionSlug} WORKER_SHARED_ROOT=/workspace/ai_live_worker ` +
            "WORKER_RUNTIME_ROOT=/tmp/ai_live_worker WORKER_SHARED_IMMUTABLE=1 MUSETALK_SHARED_CACHE_READONLY=1; " +
            "for i in $(seq 1 30); do if [ -f /workspace/ai_live_worker/start.sh ]; then cd /workspace/ai_live_worker && bash start.sh; " +
            "elif [ -f /workspace/live-streaming-ai/deploy/start.sh ]; then cd /workspace/live-streaming-ai/deploy && bash start.sh; fi; sleep 2; done; sleep infinity'",
          ports: "8000/http",
          networkVolumeId: volumeId,
          volumeMountPath: "/workspace",
        };
        if (dataCenterHint) input.dataCenterId = dataCenterHint;

        const data = await runpodGraphQL(mutation, { input });

        if (data?.podFindAndDeployOnDemand?.id) {
          const createdPodId = data.podFindAndDeployOnDemand.id;
          if (sessionId) rememberPodOwner(createdPodId, sessionId);
          console.log(`[RunPodManager] Sukses membuat Pod ${createdPodId} dengan ${gpuTier.label}!`);
          return createdPodId;
        }
      } catch (error: any) {
        lastGpuError = error;
        const errMsg = (error?.message || "").toLowerCase();
        const isFull =
          errMsg.includes("not enough free gpus") ||
          errMsg.includes("no available") ||
          errMsg.includes("out of stock") ||
          errMsg.includes("supply_constraint") ||
          errMsg.includes("no longer any instances available") ||
          errMsg.includes("specifications");

        if (isFull && attempt < gpuRetries) {
          continue;
        }

        if (isFull) {
          console.warn(`[RunPodManager] ${gpuTier.id} sedang penuh (${cloudType}). Beralih ke tier berikutnya...`);
          break;
        }
        throw error;
      }
    }
    if (strictGpu) break;
  }

  console.warn(`[RunPodManager] RTX 4090 dan cadangan L40S sedang penuh.`);
  throw new Error("GPU_HOST_FULL");
}

export async function resumePod(podId: string): Promise<boolean> {
  if (!podId) return false;
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
    console.log(`[RunPodManager] Permintaan RESUME dikirim untuk Pod ${podId} (Status: ${data?.podResume?.desiredStatus || "SENT"})`);
    return true;
  } catch (err: any) {
    console.warn(`[RunPodManager] Gagal resume Pod ${podId}:`, err?.message || err);
    return false;
  }
}

export type StartPodOptions = {
  onProgress?: (message: string) => void;

  onPodCreated?: (podId: string) => void;
  shouldAbort?: () => boolean;
  sessionId?: string;
};

function resolveStartPodOptions(onProgressOrOptions?: ((message: string) => void) | StartPodOptions): StartPodOptions {
  if (typeof onProgressOrOptions === "function") {
    return { onProgress: onProgressOrOptions };
  }
  return onProgressOrOptions ?? {};
}

async function throwIfBootAborted(podId: string | null | undefined, shouldAbort?: () => boolean): Promise<void> {
  if (!shouldAbort?.() || !podId) return;
  if (isStaticPodId(podId)) {
    throw new Error("Pod bootstrap dibatalkan (sesi dihentikan)");
  }
  console.log(`[RunPodManager] [Pod ${podId}] Bootstrap dibatalkan — terminate pod...`);
  await stopPod(podId);
  throw new Error("Pod bootstrap dibatalkan (sesi dihentikan)");
}

async function waitForWorkerHealth(currentPodId: string, healthTimeout = 300000, options: StartPodOptions = {}): Promise<string> {
  const onProgress = options.onProgress;
  const shouldAbort = options.shouldAbort;
  const workerUrl = getWorkerUrl(currentPodId);
  if (!workerUrl) {
    throw new Error(`[RunPodManager] [Pod ${currentPodId}] Worker URL tidak tersedia.`);
  }
  const healthStart = Date.now();
  console.log(`[RunPodManager] [Pod ${currentPodId}] Menunggu AI Worker di ${workerUrl} siap...`);

  while (Date.now() - healthStart < healthTimeout) {
    await throwIfBootAborted(currentPodId, shouldAbort);
    const elapsed = Math.round((Date.now() - healthStart) / 1000);
    try {
      const res = await fetch(`${workerUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 200) {
        const body = (await res.json().catch(() => ({}))) as any;
        console.log(
          `[RunPodManager] [Pod ${currentPodId}] ✅ SUKSES: AI Worker AKTIF (200 OK) dalam ${elapsed}s! (warmed_up: ${body.warmed_up ?? true})`,
        );
        return currentPodId;
      } else if (res.status === 502) {
        const msg = `Memuat PyTorch CUDA ke GPU... (${elapsed}s)`;
        onProgress?.(msg);
        console.log(`[RunPodManager] [Pod ${currentPodId}] ⏳ Booting (${elapsed}s): Container sedang memuat PyTorch CUDA ke GPU...`);
      } else if (res.status === 404) {
        const msg = `Menghubungkan RunPod Proxy Port 8000... (${elapsed}s)`;
        onProgress?.(msg);
        console.log(`[RunPodManager] [Pod ${currentPodId}] ⏳ Routing (${elapsed}s): Menghubungkan RunPod Proxy Port 8000...`);
      } else {
        const msg = `Menunggu worker HTTP ${res.status}... (${elapsed}s)`;
        onProgress?.(msg);
        console.log(`[RunPodManager] [Pod ${currentPodId}] ⏳ Status HTTP ${res.status} (${elapsed}s)...`);
      }
    } catch (fetchErr: any) {
      const msg = `Menunggu port 8000 terbuka... (${elapsed}s)`;
      onProgress?.(msg);
      console.log(`[RunPodManager] [Pod ${currentPodId}] ⏳ Menunggu port 8000 terbuka (${elapsed}s): ${fetchErr.message || "Connecting..."}`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }

  throw new Error(`[RunPodManager] [Pod ${currentPodId}] Timeout: AI Worker belum siap setelah ${Math.round(healthTimeout / 1000)}s.`);
}

export async function startPodAndWait(
  timeoutMs = 120000,
  onProgressOrOptions?: ((message: string) => void) | StartPodOptions,
): Promise<string | null> {
  const options = resolveStartPodOptions(onProgressOrOptions);
  const onProgress = options.onProgress;
  const shouldAbort = options.shouldAbort;
  updateGpuActivity();

  const staticPodId = getStaticPodId();
  if (staticPodId) {
    console.log(`[RunPodManager] Mode pod statis — pakai ${staticPodId} langsung (tanpa find/create).`);
    options.onPodCreated?.(staticPodId);
    onProgress?.("Menghubungkan ke pod GPU statis...");

    const quickHealthMs = Math.min(24_000, timeoutMs);
    try {
      return await waitForWorkerHealth(staticPodId, quickHealthMs, options);
    } catch {
      console.log(`[RunPodManager] Worker ${staticPodId} belum merespons — kirim resume, lalu health lagi.`);
      await resumePod(staticPodId);
    }
    return await waitForWorkerHealth(staticPodId, timeoutMs, options);
  }

  if (!process.env.RUNPOD_NETWORK_VOLUME_ID && !getStaticPodId()) {
    console.log(` No RUNPOD_NETWORK_VOLUME_ID or RUNPOD_POD_ID. Skipping start.`);
    return null;
  }

  const currentProvider = resolveProvider();
  if (isProdLike() && currentProvider === "mock") {
    throw new Error("GPU_PROVIDER=mock tidak diizinkan di production. Set GPU_PROVIDER=runpod.");
  }
  if (currentProvider === "mock") {
    console.log(` GPU/Avatar provider is mock. Skipping pod start.`);
    return null;
  }

  let currentPodId: string | null = null;
  let retries = 3;
  let createSuccess = false;

  while (retries > 0) {
    try {
      if (process.env.RUNPOD_NETWORK_VOLUME_ID) {
        currentPodId = await createPod(options.sessionId);
      }
      createSuccess = true;
      break;
    } catch (err: any) {
      if (err.message === "GPU_HOST_FULL") {
        if (retries > 1) {
          console.log(`[RunPodManager] GPU penuh, mencoba lagi dalam 10 detik... (${retries - 1} percobaan tersisa)`);
          await new Promise((r) => setTimeout(r, 10000));
          retries--;
        } else {
          const allowFallback = (process.env.ALLOW_MEDIA_FALLBACK ?? "false").toLowerCase() === "true";
          if (allowFallback) {
            console.warn("[RunPodManager] Semua GPU penuh. Beralih ke fallback (tanpa GPU).");
            return null;
          }
          throw new Error("Semua GPU di server sedang penuh. Silakan coba beberapa saat lagi.");
        }
      } else {
        throw err;
      }
    }
  }

  if (!createSuccess || !currentPodId) {
    throw new Error("Gagal menyalakan pod setelah beberapa kali percobaan.");
  }

  options.onPodCreated?.(currentPodId);

  const startTime = Date.now();
  let status: PodStatus | null = null;
  while (Date.now() - startTime < timeoutMs) {
    await throwIfBootAborted(currentPodId, shouldAbort);
    status = await getPodStatus(currentPodId);
    if (status && status.desiredStatus === "RUNNING") {
      console.log(`[RunPodManager] Pod ${currentPodId} is now RUNNING (took ${Math.round((Date.now() - startTime) / 1000)}s)`);
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  if (!status || status.desiredStatus !== "RUNNING") {
    throw new Error(`[RunPodManager] Timeout waiting for pod ${currentPodId} to start after ${timeoutMs}ms`);
  }

  onProgress?.("Pod RUNNING — menunggu AI Worker siap...");
  return await waitForWorkerHealth(currentPodId, timeoutMs, options);
}

export async function pausePod(podId: string): Promise<boolean> {
  if (!podId) return false;
  const mutation = `
    mutation podStop($input: PodStopInput!) {
      podStop(input: $input) {
        id
        desiredStatus
      }
    }
  `;
  try {
    const data = await runpodGraphQL(mutation, { input: { podId } });
    if (data === null) {
      console.warn(`[RunPodManager] Pod ${podId} TIDAK di-STOP: RUNPOD_API_KEY tidak diset. ` + `Bila pod ini nyata, tagihan GPU masih berjalan.`);
      return false;
    }
    console.log(`[RunPodManager] Pod ${podId} di-STOP (status: ${data?.podStop?.desiredStatus || "SENT"}). Tagihan GPU berhenti.`);
    return true;
  } catch (err: any) {
    console.error(`[RunPodManager] Gagal men-STOP Pod ${podId}:`, err?.message || err);
    return false;
  }
}

export async function stopPod(podId: string): Promise<boolean> {
  if (!podId) return true;

  if (isStaticPodId(podId) && isPodKeepWarm()) {
    console.warn(
      `[RunPodManager] Pod statis ${podId} DIBIARKAN MENYALA (RUNPOD_KEEP_POD_WARM=${process.env.RUNPOD_KEEP_POD_WARM}). ` +
        `Hanya untuk tes lokal. Sesi production harus RUNPOD_POD_ID kosong agar pod di-terminate.`,
    );
    return true;
  }

  const mutation = `
    mutation podTerminate($input: PodTerminateInput!) {
      podTerminate(input: $input)
    }
  `;

  try {
    const data = await runpodGraphQL(mutation, { input: { podId } });
    console.log(`[RunPodManager] Terminating Pod ${podId}...`);
    return !!data;
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/pod not found|POD_NOT_FOUND/i.test(msg)) {
      console.log(`[RunPodManager] Pod ${podId} sudah tidak ada — dianggap berhenti.`);
      return true;
    }
    console.error(`[RunPodManager] Error terminating Pod ${podId}:`, err);
    return false;
  }
}

export async function listManagedLivePods(): Promise<Array<{ id: string; name: string; desiredStatus?: string }>> {
  const query = `
    query myself {
      myself {
        pods {
          id
          name
          desiredStatus
        }
      }
    }
  `;
  try {
    const data = await runpodGraphQL(query, {});
    const pods = Array.isArray(data?.myself?.pods) ? data.myself.pods : [];
    return pods
      .filter((pod: { name?: string }) => String(pod?.name || "").startsWith("LiveWorker-"))
      .map((pod: { id: string; name: string; desiredStatus?: string }) => ({
        id: pod.id,
        name: pod.name,
        desiredStatus: pod.desiredStatus,
      }));
  } catch (err) {
    console.warn("[RunPodManager] Gagal list pod LiveWorker:", err);
    return [];
  }
}

export async function getGpuControlStatus(podId: string | null) {
  const pod = podId ? await getPodStatus(podId) : null;
  return {
    configured: Boolean(process.env.RUNPOD_NETWORK_VOLUME_ID || getStaticPodId()),
    podId: podId || getStaticPodId() || null,
    desiredStatus: pod?.desiredStatus || "UNKNOWN",
    liveSessionActive: activeLiveSessions.size > 0,
    activeLiveSessionCount: activeLiveSessions.size,
    activeJobLeases,
    workerUrl: getWorkerUrl(podId),
  };
}

export function getWorkerUrl(podId?: string | null): string | null {
  const staticPodId = getStaticPodId();
  const resolvedPodId = podId?.trim() || staticPodId || null;
  const configuredUrl = (process.env.RUNPOD_WORKER_URL || process.env.AVATAR_WORKER_URL || "").replace(/\/$/, "");

  if (resolvedPodId) {
    return `https://${resolvedPodId}-8000.proxy.runpod.net`;
  }

  if (process.env.NODE_ENV !== "production") {
    return configuredUrl || "http://localhost:8000";
  }

  return null;
}

export async function verifyWorkerHealth(podId: string, maxWaitMs = 15_000): Promise<boolean> {
  const workerUrl = getWorkerUrl(podId);
  if (!workerUrl) return false;

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${workerUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { status?: string };
        if (!body.status || body.status === "ok") return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}
