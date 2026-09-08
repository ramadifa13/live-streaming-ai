import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const serviceDir = path.join(backendRoot, "pocket_tts");
const defaultVoiceRoot = path.resolve(backendRoot, "voices");
const port = Number(process.env.POCKET_TTS_PORT || 8092);
const baseUrl = process.env.POCKET_TTS_URL || `http://127.0.0.1:${port}`;
let processHandle: ChildProcess | null = null;
let startPromise: Promise<void> | null = null;

function pythonCommand(): string {
  return (
    process.env.POCKET_TTS_PYTHON ||
    (process.platform === "win32"
      ? path.join(backendRoot, "pocket_tts", "env", "Scripts", "python.exe")
      : path.join(backendRoot, "pocket_tts", "env", "bin", "python"))
  );
}

async function health(): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilReady(timeoutMs = 600_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await health()) return;
    if (processHandle && processHandle.exitCode !== null) {
      throw new Error(`Pocket TTS berhenti dengan exit code ${processHandle.exitCode}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Pocket TTS belum siap setelah ${timeoutMs}ms`);
}

export async function ensurePocketTtsStarted(): Promise<void> {
  if (await health()) return;
  if (!startPromise) {
    startPromise = (async () => {
      const child = spawn(pythonCommand(), [path.join(serviceDir, "tts_service.py")], {
        cwd: serviceDir,
        env: {
          ...process.env,
          POCKET_TTS_PORT: String(port),
          POCKET_TTS_VOICE_ROOT: process.env.POCKET_TTS_VOICE_ROOT || defaultVoiceRoot,
        },
        stdio: "inherit",
        windowsHide: true,
      });
      processHandle = child;
      child.once("exit", () => {
        processHandle = null;
      });
      await waitUntilReady();
    })().finally(() => {
      startPromise = null;
    });
  }
  await startPromise;
}

export async function synthesizePocketTts(params: {
  text: string;
  voiceId: string;
  requestId?: string;
}): Promise<{ audio: Buffer; latencyMs: number }> {
  await ensurePocketTtsStarted();
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: params.text,
      voice_id: params.voiceId,
      request_id: params.requestId,
    }),
    signal: AbortSignal.timeout(Number(process.env.POCKET_TTS_TIMEOUT_MS || 120_000)),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(`Pocket TTS gagal (${response.status}): ${detail.slice(0, 500)}`);
  }
  return { audio: Buffer.from(await response.arrayBuffer()), latencyMs: Date.now() - startedAt };
}

export async function stopPocketTts(): Promise<void> {
  if (!processHandle || processHandle.exitCode !== null) return;
  processHandle.kill();
  processHandle = null;
}
