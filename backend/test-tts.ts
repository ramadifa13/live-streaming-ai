import { synthesizeSpeech } from "./src/services/tts.js";
import { stopLocalPiper } from "./src/services/piper-local.js";
import fs from "fs";
import path from "path";

async function run() {
  const out = path.resolve("tts-test.wav");
  console.log("Piper lokal (allowOfflineSynth)...");
  const res = await synthesizeSpeech({
    text: "Halo kak, selamat datang di live hari ini. Ini tes suara Piper, bukan Edge.",
    host: "namira",
    voice: "namira",
    allowOfflineSynth: true,
  });
  console.log("engine:", res.engine);
  console.log("message:", res.message);
  if (!res.audioBuffer || res.audioBuffer.length < 44) {
    console.error("Gagal: tidak ada WAV. Pastikan npm run piper:setup sudah jalan.");
    process.exit(1);
  }
  const head = res.audioBuffer.toString("ascii", 0, 4);
  if (head !== "RIFF") {
    console.error("Bukan WAV:", res.audioBuffer.subarray(0, 80).toString("utf8"));
    process.exit(1);
  }
  fs.writeFileSync(out, res.audioBuffer);
  console.log("Saved", out, `(${res.audioBuffer.length} bytes)`);
  stopLocalPiper();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
