import sys

with open("backend/src/services/runpod-manager.ts", "r") as f:
    content = f.read()

content = content.replace("export async function acquireGpuForJob(): Promise<void> {", "export async function acquireGpuForJob(): Promise<string | null> {")
content = content.replace("return;\n    }\n    await startPodAndWait();", "return null;\n    }\n    return await startPodAndWait();")

content = content.replace("export async function releaseGpuForJob(): Promise<void> {", "export async function releaseGpuForJob(podId?: string | null): Promise<void> {")
content = content.replace("activeJobLeases = Math.max(0, activeJobLeases - 1);\n  // Pod will be stopped by idle monitor, not immediately after job completes", "activeJobLeases = Math.max(0, activeJobLeases - 1);\n  if (podId) {\n      await stopPod(podId);\n  }")

content = content.replace("export async function getPodStatus(): Promise<PodStatus | null> {", "export async function getPodStatus(podId: string): Promise<PodStatus | null> {")
content = content.replace("const podId = activePodId || process.env.RUNPOD_POD_ID;", "")

content = content.replace("export async function createPod(): Promise<boolean> {", "export async function createPod(): Promise<string> {")
content = content.replace("if (data?.podFindAndDeployOnDemand?.id) {\n      activePodId = data.podFindAndDeployOnDemand.id;\n      console.log(`[RunPodManager] Created new on-demand Pod ${activePodId}...`);\n      return true;\n    }\n    return false;", "if (data?.podFindAndDeployOnDemand?.id) {\n      const createdPodId = data.podFindAndDeployOnDemand.id;\n      console.log(`[RunPodManager] Created new on-demand Pod ${createdPodId}...`);\n      return createdPodId;\n    }\n    throw new Error(\"Failed to create pod: No ID returned.\");")

content = content.replace("export async function startPodAndWait(timeoutMs = 120000): Promise<boolean> {", "export async function startPodAndWait(timeoutMs = 120000): Promise<string | null> {")
content = content.replace("console.log(\"[RunPodManager] No RUNPOD_NETWORK_VOLUME_ID or RUNPOD_POD_ID. Skipping start.\");\n    return true;", "console.log(\"[RunPodManager] No RUNPOD_NETWORK_VOLUME_ID or RUNPOD_POD_ID. Skipping start.\");\n    return null;")
content = content.replace("console.log(\"[RunPodManager] GPU_PROVIDER=mock. Skipping pod start.\");\n    return true;", "console.log(\"[RunPodManager] GPU_PROVIDER=mock. Skipping pod start.\");\n    return null;")

content = content.replace("let status = await getPodStatus();", """let currentPodId = process.env.RUNPOD_POD_ID || null;

  // If it's already running, we're good
  if (currentPodId) {
     let status = await getPodStatus(currentPodId);
     if (status && status.desiredStatus === "RUNNING") {
        console.log("[RunPodManager] Pod is already running.");
        return currentPodId;
     }
  }""")

content = content.replace("""  // If it's already running, we're good
  if (status && status.desiredStatus === "RUNNING") {
    console.log("[RunPodManager] Pod is already running.");
  } else {""", "")

content = content.replace("await createPod();", "currentPodId = await createPod();")
content = content.replace("return true; // Bypass proses tunggu agar backend tidak crash", "return null; // Bypass proses tunggu agar backend tidak crash")

content = content.replace("if (!createSuccess) {\n      throw new Error(\"Gagal menyalakan pod setelah beberapa kali percobaan.\");\n    }", "if (!createSuccess || !currentPodId) {\n      throw new Error(\"Gagal menyalakan pod setelah beberapa kali percobaan.\");\n    }")

content = content.replace("status = await getPodStatus();", "status = await getPodStatus(currentPodId);")
content = content.replace("`[RunPodManager] Pod ${activePodId} is now RUNNING", "`[RunPodManager] Pod ${currentPodId} is now RUNNING")

content = content.replace("`[RunPodManager] Timeout waiting for pod ${activePodId} to start after ${timeoutMs}ms`,", "`[RunPodManager] Timeout waiting for pod ${currentPodId} to start after ${timeoutMs}ms`,")

content = content.replace("const workerUrl = getWorkerUrl();", "const workerUrl = getWorkerUrl(currentPodId);")
content = content.replace("return true;", "return currentPodId;")

content = content.replace("export async function stopPod(): Promise<boolean> {", "export async function stopPod(podId: string): Promise<boolean> {")
content = content.replace("const podId = activePodId || process.env.RUNPOD_POD_ID;", "")
content = content.replace("activePodId = null;", "")

content = content.replace("export async function getGpuControlStatus() {", "export async function getGpuControlStatus(podId: string | null) {")
content = content.replace("const pod = await getPodStatus();", "const pod = podId ? await getPodStatus(podId) : null;")
content = content.replace("podId: activePodId || process.env.RUNPOD_POD_ID || null,", "podId: podId || process.env.RUNPOD_POD_ID || null,")
content = content.replace("workerUrl: getWorkerUrl(),", "workerUrl: getWorkerUrl(podId),")

content = content.replace("export function getWorkerUrl(): string {", "export function getWorkerUrl(podId?: string | null): string {")
content = content.replace("const podId = activePodId || process.env.RUNPOD_POD_ID;", "")


with open("backend/src/services/runpod-manager.ts", "w") as f:
    f.write(content)
