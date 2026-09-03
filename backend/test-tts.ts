import { synthesizeSpeech } from "./src/services/tts.js";
import fs from "fs";

async function run() {
  console.log("Generating (live/Piper path, allowOfflineSynth)...");
  const res = await synthesizeSpeech({
    text: "Halo kak, selamat datang di live streaming. Jangan lupa checkout ya karena produk ini bagus banget.",
    host: "namira",
    voice: "namira",
    allowOfflineSynth: true,
  });
  if (res.audioBuffer) {
    fs.writeFileSync("test.wav", res.audioBuffer);
    console.log("Saved test.wav", res.engine);
  } else {
    console.log("No audio:", res.message, "sample:", res.sampleAudioUrl);
  }
}

run();
