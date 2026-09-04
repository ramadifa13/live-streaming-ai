/**
 * Smoke test VoxCPM2 via AI Worker.
 * Requires RUNPOD_WORKER_URL (or live pod) with VoxCPM2 warm.
 *
 *   cd backend && npx tsx test-tts.ts
 */
import "dotenv/config";
import { synthesizeSpeech } from "./src/services/tts.js";
import fs from "fs";

async function main() {
  const workerHint =
    process.env.RUNPOD_WORKER_URL ||
    (process.env.RUNPOD_POD_ID
      ? `https://${process.env.RUNPOD_POD_ID}-8000.proxy.runpod.net`
      : "(missing RUNPOD_WORKER_URL)");
  console.log("VoxCPM2 via AI Worker (allowOfflineSynth)…");
  console.log("Worker:", workerHint);

  const result = await synthesizeSpeech({
    text: "Halo kak, selamat datang di live hari ini. Ini tes suara VoxCPM2.",
    voiceId: process.env.VOICE_ID || "girl_cute_kids",
    lang: "id",
    allowOfflineSynth: true,
    podId: process.env.RUNPOD_POD_ID || null,
  });

  console.log({
    success: result.success,
    engine: result.engine,
    voice: result.voice,
    message: result.message,
    bytes: result.audioBuffer?.length ?? 0,
    metrics: result.metrics,
  });

  if (result.audioBuffer && result.audioBuffer.length > 44) {
    fs.writeFileSync("tts-test.wav", result.audioBuffer);
    console.log("Wrote tts-test.wav");
  } else {
    console.error("FAIL: no audio — pastikan AI Worker + VoxCPM2 ready");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
