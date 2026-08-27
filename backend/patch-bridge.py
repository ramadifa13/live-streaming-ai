import sys

with open("backend/src/services/runpod-bridge.ts", "r") as f:
    content = f.read()

content = content.replace("async function workerRequest(path: string, init?: RequestInit) {", "async function workerRequest(podId: string | null | undefined, path: string, init?: RequestInit) {")
content = content.replace("const response = await fetch(`${getWorkerUrl()}${path}`, {", "const response = await fetch(`${getWorkerUrl(podId)}${path}`, {")

content = content.replace("async function workerRequestWithRetry(\n  path: string,\n  init?: RequestInit,\n  retries = 3,\n): Promise<any> {", "async function workerRequestWithRetry(\n  podId: string | null | undefined,\n  path: string,\n  init?: RequestInit,\n  retries = 3,\n): Promise<any> {")
content = content.replace("return await workerRequest(path, init);", "return await workerRequest(podId, path, init);")

content = content.replace("export async function startRunPodBroadcast(params: {", "export async function startRunPodBroadcast(podId: string | null | undefined, params: {")
content = content.replace("return workerRequestWithRetry(\"/stream/start-broadcast\", {", "return workerRequestWithRetry(podId, \"/stream/start-broadcast\", {")

content = content.replace("export async function stopRunPodBroadcast(): Promise<RunPodBroadcastResult> {", "export async function stopRunPodBroadcast(podId: string | null | undefined): Promise<RunPodBroadcastResult> {")
content = content.replace("return workerRequestWithRetry(\"/stream/stop-broadcast\", { method: \"POST\" });", "return workerRequestWithRetry(podId, \"/stream/stop-broadcast\", { method: \"POST\" });")

content = content.replace("export async function getRunPodBroadcastStatus(): Promise<RunPodBroadcastResult> {", "export async function getRunPodBroadcastStatus(podId: string | null | undefined): Promise<RunPodBroadcastResult> {")
content = content.replace("return workerRequestWithRetry(\"/stream/broadcast-status\");", "return workerRequestWithRetry(podId, \"/stream/broadcast-status\");")

content = content.replace("export async function warmupWorker(): Promise<void> {", "export async function warmupWorker(podId: string | null | undefined): Promise<void> {")
content = content.replace("await workerRequestWithRetry(\"/\", undefined, 3);", "await workerRequestWithRetry(podId, \"/\", undefined, 3);")

content = content.replace("export async function forwardToRunPodGPU(", "export async function forwardToRunPodGPU(\n  podId: string | null | undefined,")
content = content.replace("const workerUrl = getWorkerUrl();", "const workerUrl = getWorkerUrl(podId);")

content = content.replace("const data = await workerRequestWithRetry(\n      `/stream/live-utterance`,", "const data = await workerRequestWithRetry(\n      podId,\n      `/stream/live-utterance`,")
content = content.replace("const statusData = await workerRequestWithRetry(\n          `/stream/status/${data.job_id}`,\n          undefined,\n          2,\n        );", "const statusData = await workerRequestWithRetry(\n          podId,\n          `/stream/status/${data.job_id}`,\n          undefined,\n          2,\n        );")


with open("backend/src/services/runpod-bridge.ts", "w") as f:
    f.write(content)
