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

export async function acquireGpuForJob(): Promise<string | null> {
  activeJobLeases += 1;
  try {
    const provider = (
      process.env.GPU_PROVIDER ??
      process.env.AVATAR_PROVIDER ??
      "mock"
    ).toLowerCase();
    if (provider === "mock") {
      console.log(
        "[RunPodManager] GPU/Avatar provider is mock. Skipping GPU acquisition.",
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
          console.log(
            `[RunPodManager] Idle monitor skipped (Pods are managed per-session lifecycle now).`,
          );
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
 * GPU compatible dengan MuseTalk worker (PyTorch 2.1 + CUDA 11.8).
 * Blackwell (RTX PRO 4500/4000) sengaja DIEXCLUDE — butuh PyTorch CUDA 12.4+.
 */
const BUDGET_GPU_TIERS = [
  {
    id: "NVIDIA GeForce RTX 4090",
    label: "RTX 4090 (Utama, Fast Lipsync)",
  },
  {
    id: "NVIDIA GeForce RTX 3090",
    label: "RTX 3090 (24GB VRAM)",
  },
  {
    id: "NVIDIA L4",
    label: "L4 (24GB, Datacenter)",
  },
  {
    id: "NVIDIA RTX A5000",
    label: "RTX A5000 (24GB VRAM)",
  },
  {
    id: "NVIDIA RTX 4000 Ada Generation",
    label: "RTX 4000 Ada (20GB VRAM)",
  },
  {
    id: "NVIDIA RTX A4000",
    label: "RTX A4000 (16GB VRAM)",
  },
];

/**
 * Sends a request to create a new Pod on-demand with automatic budget GPU fallback.
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

  let lastGpuError: any = null;

  // Jika user menentukan spesifik GPU di .env via RUNPOD_GPU_TYPE
  const preferredGpu = process.env.RUNPOD_GPU_TYPE;
  const tiersToTry = preferredGpu
    ? [
        { id: preferredGpu, label: preferredGpu },
        ...BUDGET_GPU_TIERS.filter((t) => t.id !== preferredGpu),
      ]
    : BUDGET_GPU_TIERS;

  const cloudType = process.env.RUNPOD_CLOUD_TYPE || "ALL";
  const strictGpu = process.env.RUNPOD_GPU_STRICT === "1";
  const gpuRetries = Math.max(1, Number(process.env.RUNPOD_GPU_RETRY || "3"));
  const dataCenterHint = process.env.RUNPOD_DATACENTER_ID?.trim();

  if (dataCenterHint) {
    console.log(
      `[RunPodManager] Preferred datacenter: ${dataCenterHint} (harus match network volume DC)`,
    );
  }

  for (const gpuTier of tiersToTry) {
    for (let attempt = 1; attempt <= gpuRetries; attempt++) {
      try {
        if (attempt > 1) {
          console.log(
            `[RunPodManager] Retry ${attempt}/${gpuRetries} untuk ${gpuTier.label} (stock Low — coba lagi)...`,
          );
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          console.log(`[RunPodManager] Mencoba alokasi GPU: ${gpuTier.label}...`);
        }

        const input: Record<string, unknown> = {
          cloudType: cloudType,
          gpuCount: 1,
          volumeInGb: 0,
          containerDiskInGb: Number(process.env.RUNPOD_CONTAINER_DISK_GB || "10"),
          // Pipeline ini CPU-bound di luar GPU: blending per frame MuseTalk,
          // libx264 720x1280, master FFmpeg, dan ffprobe berjalan bersamaan.
          // Dengan 2 vCPU throughput jatuh di bawah realtime meski GPU sanggup.
          minVcpuCount: Number(process.env.RUNPOD_MIN_VCPU || "8"),
          minMemoryInGb: Number(process.env.RUNPOD_MIN_MEMORY_GB || "24"),
          gpuTypeId: gpuTier.id,
          name: `LiveWorker-${gpuTier.id.replace(/\s+/g, "_")}`,
          imageName: "runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04",
          dockerArgs:
            "bash -c 'for i in $(seq 1 30); do if [ -f /workspace/ai_live_worker/start.sh ]; then cd /workspace/ai_live_worker && bash start.sh; elif [ -f /workspace/live-streaming-ai/deploy/start.sh ]; then cd /workspace/live-streaming-ai/deploy && bash start.sh; fi; sleep 2; done; sleep infinity'",
          ports: "8000/http",
          networkVolumeId: volumeId,
          volumeMountPath: "/workspace",
        };
        if (dataCenterHint) input.dataCenterId = dataCenterHint;

        const data = await runpodGraphQL(mutation, { input });

        if (data?.podFindAndDeployOnDemand?.id) {
          const createdPodId = data.podFindAndDeployOnDemand.id;
          console.log(
            `[RunPodManager] Sukses membuat Pod ${createdPodId} dengan ${gpuTier.label}!`,
          );
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
          console.warn(
            `[RunPodManager] ${gpuTier.id} sedang penuh (${cloudType}). Beralih ke tier berikutnya...`,
          );
          break;
        }
        throw error;
      }
    }
    if (strictGpu) break;
  }

  console.warn(`[RunPodManager] Semua GPU dalam daftar hemat sedang penuh.`);
  throw new Error("GPU_HOST_FULL");
}

/**
 * Resumes the pod and waits (polls) until it is RUNNING and ready to accept requests.
 */
/**
 * Resumes a stopped pod via RunPod GraphQL mutation
 */
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
    console.log(
      `[RunPodManager] Permintaan RESUME dikirim untuk Pod ${podId} (Status: ${data?.podResume?.desiredStatus || "SENT"})`,
    );
    return true;
  } catch (err: any) {
    console.warn(
      `[RunPodManager] Gagal resume Pod ${podId}:`,
      err?.message || err,
    );
    return false;
  }
}

/**
 * Helper: Polling health check endpoint /health hingga AI Worker siap (200 OK)
 */
async function waitForWorkerHealth(
  currentPodId: string,
  healthTimeout = 300000,
  onProgress?: (message: string) => void,
): Promise<string> {
  const workerUrl = getWorkerUrl(currentPodId);
  const healthStart = Date.now();
  console.log(
    `[RunPodManager] [Pod ${currentPodId}] Menunggu AI Worker di ${workerUrl} siap...`,
  );

  while (Date.now() - healthStart < healthTimeout) {
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
        console.log(
          `[RunPodManager] [Pod ${currentPodId}] ⏳ Booting (${elapsed}s): Container sedang memuat PyTorch CUDA ke GPU...`,
        );
      } else if (res.status === 404) {
        const msg = `Menghubungkan RunPod Proxy Port 8000... (${elapsed}s)`;
        onProgress?.(msg);
        console.log(
          `[RunPodManager] [Pod ${currentPodId}] ⏳ Routing (${elapsed}s): Menghubungkan RunPod Proxy Port 8000...`,
        );
      } else {
        const msg = `Menunggu worker HTTP ${res.status}... (${elapsed}s)`;
        onProgress?.(msg);
        console.log(
          `[RunPodManager] [Pod ${currentPodId}] ⏳ Status HTTP ${res.status} (${elapsed}s)...`,
        );
      }
    } catch (fetchErr: any) {
      const msg = `Menunggu port 8000 terbuka... (${elapsed}s)`;
      onProgress?.(msg);
      console.log(
        `[RunPodManager] [Pod ${currentPodId}] ⏳ Menunggu port 8000 terbuka (${elapsed}s): ${fetchErr.message || "Connecting..."}`,
      );
    }
    await new Promise((r) => setTimeout(r, 4000));
  }

  throw new Error(
    `[RunPodManager] [Pod ${currentPodId}] Timeout: AI Worker belum siap setelah ${Math.round(healthTimeout / 1000)}s.`,
  );
}

/**
 * Resumes / Creates the pod and waits (polls) until it is RUNNING and ready to accept requests.
 */
export async function startPodAndWait(
  timeoutMs = 120000,
  onProgress?: (message: string) => void,
): Promise<string | null> {
  updateGpuActivity();

  if (process.env.RUNPOD_POD_ID) {
    const staticPodId = process.env.RUNPOD_POD_ID.trim();
    if (staticPodId.length > 0) {
      console.log(
        `Memeriksa status Pod statis di .env (${staticPodId})...`,
      );

      let status = await getPodStatus(staticPodId).catch(() => null);

      if (!status || status.desiredStatus !== "RUNNING") {
        console.log(
          ` Pod statis ${staticPodId} dalam kondisi mati/berhenti (${status?.desiredStatus || "UNKNOWN"}). Menghidupkan pod otomatis...`,
        );
        await resumePod(staticPodId);

        // Tunggu status desiredStatus menjadi RUNNING
        const resumeStart = Date.now();
        while (Date.now() - resumeStart < timeoutMs) {
          status = await getPodStatus(staticPodId).catch(() => null);
          if (status && status.desiredStatus === "RUNNING") {
            console.log(
              ` Pod statis ${staticPodId} kini RUNNING (dalam ${Math.round((Date.now() - resumeStart) / 1000)}s)!`,
            );
            break;
          }
          await new Promise((r) => setTimeout(r, 3000));
        }
      } else {
        console.log(
          ` Pod statis ${staticPodId} sudah dalam kondisi RUNNING.`,
        );
      }

      onProgress?.("Menghidupkan pod GPU...");
      return await waitForWorkerHealth(staticPodId, timeoutMs, onProgress);
    }
  }

  // ── Skenario 2: PRODUCTION PHASE — Buat Pod Baru On-Demand Otomatis ────────
  if (!process.env.RUNPOD_NETWORK_VOLUME_ID && !process.env.RUNPOD_POD_ID) {
    console.log(
      ` No RUNPOD_NETWORK_VOLUME_ID or RUNPOD_POD_ID. Skipping start.`,
    );
    return null;
  }

  // Skip pod start if using mock provider
  const currentProvider = (
    process.env.GPU_PROVIDER ??
    process.env.AVATAR_PROVIDER ??
    "mock"
  ).toLowerCase();
  if (currentProvider === "mock") {
    console.log(
      ` GPU/Avatar provider is mock. Skipping pod start.`,
    );
    return null;
  }

  let currentPodId: string | null = null;
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
            return null;
          }
          throw new Error(
            "Semua GPU di server sedang penuh. Silakan coba beberapa saat lagi.",
          );
        }
      } else {
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
    await new Promise((r) => setTimeout(r, 3000));
  }

  if (!status || status.desiredStatus !== "RUNNING") {
    throw new Error(
      `[RunPodManager] Timeout waiting for pod ${currentPodId} to start after ${timeoutMs}ms`,
    );
  }

  onProgress?.("Pod RUNNING — menunggu AI Worker siap...");
  return await waitForWorkerHealth(currentPodId, timeoutMs, onProgress);
}
/**
 * Menghentikan pod tanpa menghapusnya (GPU dilepas, disk & volume tetap ada).
 *
 * Dipakai untuk pod statis: terminate akan menghancurkan setup yang dipakai
 * berulang, sementara membiarkannya RUNNING berarti GPU tetap ditagih 24 jam
 * sehari walau tidak ada siaran. `podStop` adalah pasangan dari `podResume`
 * yang sudah dipakai di `startPodAndWait`.
 */
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
      // runpodGraphQL mengembalikan null bila RUNPOD_API_KEY tidak diset.
      console.warn(
        `[RunPodManager] Pod ${podId} TIDAK di-STOP: RUNPOD_API_KEY tidak diset. ` +
          `Bila pod ini nyata, tagihan GPU masih berjalan.`,
      );
      return false;
    }
    console.log(
      `[RunPodManager] Pod ${podId} di-STOP (status: ${data?.podStop?.desiredStatus || "SENT"}). Tagihan GPU berhenti.`,
    );
    return true;
  } catch (err: any) {
    console.error(
      `[RunPodManager] Gagal men-STOP Pod ${podId}:`,
      err?.message || err,
    );
    return false;
  }
}

export async function stopPod(podId: string): Promise<boolean> {
  if (!podId) return true;

  if (process.env.RUNPOD_POD_ID === podId) {
    if ((process.env.RUNPOD_KEEP_POD_WARM ?? "false").toLowerCase() === "true") {
      console.warn(
        `[RunPodManager] Pod statis ${podId} DIBIARKAN MENYALA (RUNPOD_KEEP_POD_WARM=true). ` +
          `GPU tetap ditagih walau tidak ada siaran.`,
      );
      return true;
    }
    // Jangan terminate pod statis (volume & setup-nya dipakai berulang),
    // tapi tetap hentikan agar tagihan GPU tidak jalan tanpa siaran.
    console.log(
      `[RunPodManager] Pod ${podId} statis — mengirim STOP agar tagihan GPU berhenti.`,
    );
    return await pausePod(podId);
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
    console.error(`[RunPodManager] Error terminating Pod ${podId}:`, err);
    return false;
  }
}

export async function getGpuControlStatus(podId: string | null) {
  const pod = podId ? await getPodStatus(podId) : null;
  return {
    configured: Boolean(
      process.env.RUNPOD_NETWORK_VOLUME_ID || process.env.RUNPOD_POD_ID,
    ),
    podId: podId || process.env.RUNPOD_POD_ID || null,
    desiredStatus: pod?.desiredStatus || "UNKNOWN",
    liveSessionActive,
    activeJobLeases,
    workerUrl: getWorkerUrl(podId),
  };
}

/**
 * URL worker GPU. Pod dinamis (on-demand) SELALU pakai proxy RunPod per-podId —
 * jangan override dengan RUNPOD_WORKER_URL=localhost di VPS.
 */
export function getWorkerUrl(podId?: string | null): string | null {
  const resolvedPodId =
    podId?.trim() || process.env.RUNPOD_POD_ID?.trim() || null;

  if (resolvedPodId) {
    return `https://${resolvedPodId}-8000.proxy.runpod.net`;
  }

  const staticUrl = (
    process.env.RUNPOD_WORKER_URL ||
    process.env.AVATAR_WORKER_URL ||
    ""
  ).replace(/\/$/, "");

  if (
    staticUrl &&
    !staticUrl.includes("localhost") &&
    !staticUrl.includes("127.0.0.1")
  ) {
    return staticUrl;
  }

  if (process.env.NODE_ENV !== "production") {
    return staticUrl || "http://localhost:8000";
  }

  return null;
}

/** Verifikasi cepat worker /health (dipakai setelah bootstrap selesai). */
export async function verifyWorkerHealth(
  podId: string,
  maxWaitMs = 15_000,
): Promise<boolean> {
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
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}
