import { spawn } from "child_process";
import { tmpdir } from "os";
import path from "path";
import { randomBytes } from "crypto";
import fs from "fs";
import { getWorkerUrl } from "./runpod-manager.js";

export interface TTSVoice {
  id: string;
  name: string;
  gender: "female" | "male";
  locale: string;
  style: string;
  avatarMatch: string;
  engine: "piper" | "google";
}

/** Voice list untuk UI — id lama Edge di-map ke Piper ID di server. */
export const INDONESIAN_VOICES: TTSVoice[] = [
  {
    id: "id_ID-news_tts-medium",
    name: "Namira / Gadis (Piper ID — natural, lokal)",
    gender: "female",
    locale: "id-ID",
    style: "Friendly",
    avatarMatch: "Namira",
    engine: "piper",
  },
  {
    id: "id-ID-GadisNeural",
    name: "Gadis (alias → Piper ID)",
    gender: "female",
    locale: "id-ID",
    style: "Friendly",
    avatarMatch: "Namira",
    engine: "piper",
  },
  {
    id: "id-ID-SitiNeural",
    name: "Siti (alias → Piper ID)",
    gender: "female",
    locale: "id-ID",
    style: "Energetic",
    avatarMatch: "Siti",
    engine: "piper",
  },
  {
    id: "id-ID-ArdiNeural",
    name: "Ardi (alias → Piper ID)",
    gender: "male",
    locale: "id-ID",
    style: "Confident",
    avatarMatch: "Ardi",
    engine: "piper",
  },
];

export interface SynthesizeRequest {
  text: string;
  voice?: string;
  avatarName?: string;
  speed?: number;
  pitch?: number;
  tone?: string;
  emotion?: string;
  /** Pod RunPod sesi live — supaya /tts/synthesize kena worker yang benar. */
  podId?: string | null;
}

export interface SynthesizeResponse {
  success: boolean;
  voice: string;
  avatar: string;
  text: string;
  durationEstimateSeconds: number;
  audioFormat: string;
  engine: string;
  message: string;
  audioBuffer?: Buffer;
}

export function sanitizeForLiveTTS(text: string): string {
  if (!text) return "";
  return (
    text
      .replace(/\[[A-Z_]+\]/gi, "")
      .replace(
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
        "",
      )
      .replace(/Rp\s?(\d+(?:\.\d+)?(?:\,\d+)?)/gi, "$1 rupiah ")
      .replace(/\$(\d+(?:\.\d+)?)/g, "$1 dollar ")
      .replace(/\b(\d+)k\b/gi, "$1 ribu ")
      .replace(/(\d+)%/g, "$1 persen")
      .replace(/\bBPOM\b/g, "B P O M")
      .replace(/\bORI\b/gi, "original")
      .replace(/\bCO\b/g, "check out")
      .replace(/\bCOD\b/g, "C O D")
      .replace(/\bFYP\b/g, "F Y P")
      .replace(/\bDM\b/g, "D M")
      .replace(/&/g, " dan ")
      .replace(/</g, "")
      .replace(/>/g, "")
      .replace(/['"]/g, "")
      .replace(
        /\b(yuk|nah|khusus hari ini|mumpung lagi promo|jangan sampai kehabisan)\b/gi,
        ", $1",
      )
      .replace(/[!]{2,}/g, "!")
      .replace(/[?]{2,}/g, "?")
      .replace(/[.]{4,}/g, "...")
      .replace(/,{2,}/g, ",")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Piper length_scale: >1 lebih lambat. Map tone/emotion → scale. */
export function getPiperLengthScale(
  tone?: string,
  baseSpeed = 1.0,
  emotion?: string,
): number {
  const t = (tone || "").toLowerCase();
  const e = (emotion || "neutral").toLowerCase();
  let speed = Math.max(0.7, Math.min(1.35, baseSpeed || 1.0));

  if (e === "excited" || e === "surprised") speed *= 1.08;
  else if (e === "happy") speed *= 1.04;
  else if (e === "thinking" || e === "empathetic") speed *= 0.94;
  else if (e === "warm") speed *= 0.98;

  if (t.includes("fomo") || t.includes("flash") || t.includes("promo")) {
    speed *= 1.1;
  } else if (
    t.includes("profesion") ||
    t.includes("professional") ||
    t.includes("edukatif")
  ) {
    speed *= 0.96;
  }

  // Piper: length_scale 1.0 = normal; lebih besar = lebih lambat
  const lengthScale = 1.0 / speed;
  return Math.max(0.75, Math.min(1.45, lengthScale));
}

/** Legacy Edge prosody — tetap diekspor jika ada caller lama. */
export function getProsodyOptions(
  tone?: string,
  baseSpeed = 1.0,
  emotion?: string,
): { rate: string; pitch: string; volume: string } {
  const length = getPiperLengthScale(tone, baseSpeed, emotion);
  const ratePct = Math.round((1 / length - 1) * 100);
  return {
    rate: `${ratePct >= 0 ? "+" : ""}${ratePct}%`,
    pitch: "+2Hz",
    volume: "+8%",
  };
}

function resolveFfmpegBinary(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  for (const candidate of ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "ffmpeg";
}

const FFMPEG_BIN = resolveFfmpegBinary();

async function ensureWav16kMono(input: Buffer): Promise<Buffer> {
  if (
    input.length >= 44 &&
    input.toString("ascii", 0, 4) === "RIFF" &&
    input.toString("ascii", 8, 12) === "WAVE"
  ) {
    // Cek sample rate di header (byte 24-27 little-endian)
    const rate = input.readUInt32LE(24);
    const channels = input.readUInt16LE(22);
    if (rate === 16000 && channels === 1) return input;
  }

  return new Promise((resolve, reject) => {
    const inFile = path.join(tmpdir(), `tts_in_${randomBytes(4).toString("hex")}.wav`);
    const outFile = path.join(tmpdir(), `tts_out_${randomBytes(4).toString("hex")}.wav`);
    fs.writeFileSync(inFile, input);

    const proc = spawn(FFMPEG_BIN, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inFile,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      "-y",
      outFile,
    ]);

    const errors: Buffer[] = [];
    proc.stderr.on("data", (c: Buffer) => errors.push(c));
    proc.on("error", reject);
    proc.on("close", (code) => {
      try {
        fs.unlinkSync(inFile);
      } catch {
        /* ignore */
      }
      if (code !== 0) {
        try {
          fs.unlinkSync(outFile);
        } catch {
          /* ignore */
        }
        reject(new Error(`FFmpeg error (${code}): ${Buffer.concat(errors).toString()}`));
        return;
      }
      try {
        const output = fs.readFileSync(outFile);
        fs.unlinkSync(outFile);
        if (output.length < 44) {
          reject(new Error("Invalid WAV output"));
          return;
        }
        resolve(output);
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function convertMp3ToWav(mp3Buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tempFile = path.join(tmpdir(), `tts_${randomBytes(4).toString("hex")}.wav`);
    const proc = spawn(FFMPEG_BIN, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "mp3",
      "-i",
      "pipe:0",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      "-f",
      "wav",
      tempFile,
    ]);
    const errors: Buffer[] = [];
    proc.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg error (${code}): ${Buffer.concat(errors).toString()}`));
        return;
      }
      try {
        const output = fs.readFileSync(tempFile);
        fs.unlinkSync(tempFile);
        if (output.length < 44) {
          reject(new Error("Invalid WAV output"));
          return;
        }
        resolve(output);
      } catch (err) {
        reject(err);
      }
    });
    proc.stdin.write(mp3Buffer);
    proc.stdin.end();
  });
}

export function resolvePiperVoiceId(voice?: string, avatarName?: string): string {
  const defaultVoice =
    (process.env.PIPER_VOICE || "id_ID-news_tts-medium").trim() ||
    "id_ID-news_tts-medium";
  if (voice && /^id_ID[-_]/i.test(voice)) return voice.replace(/-/g, "_");
  if (voice && INDONESIAN_VOICES.some((v) => v.id === voice)) {
    // Legacy Edge ids → default Piper ID voice
    return defaultVoice;
  }
  const av = (avatarName || "").toLowerCase();
  if (av.includes("budi") || av.includes("ardi") || av.includes("siti") || av.includes("namira")) {
    return defaultVoice;
  }
  return defaultVoice;
}

/** Alias lama untuk caller yang masih pakai resolveEdgeVoiceId. */
export function resolveEdgeVoiceId(voice?: string, avatarName?: string): string {
  return resolvePiperVoiceId(voice, avatarName);
}

function resolvePiperEndpoints(podId?: string | null): string[] {
  const endpoints: string[] = [];
  const explicit = (process.env.PIPER_TTS_URL || "").trim().replace(/\/$/, "");
  // PIPER_TTS_URL=http://127.0.0.1:8090 hanya valid di dalam pod.
  // Di VPS production jangan set ke localhost — biarkan lewat worker proxy.
  const explicitIsLocal =
    explicit.includes("127.0.0.1") || explicit.includes("localhost");
  const onVpsProduction =
    process.env.NODE_ENV === "production" &&
    !(process.env.GPU_PROVIDER || "").toLowerCase().includes("mock");

  if (explicit && !(onVpsProduction && explicitIsLocal)) {
    endpoints.push(
      explicit.endsWith("/synthesize") ? explicit : `${explicit}/synthesize`,
    );
  }

  const worker =
    getWorkerUrl(podId || process.env.RUNPOD_POD_ID || null) ||
    (process.env.RUNPOD_WORKER_URL || "").trim().replace(/\/$/, "");
  if (worker) {
    endpoints.push(`${worker}/tts/synthesize`);
  }

  if (!onVpsProduction) {
    endpoints.push("http://127.0.0.1:8090/synthesize");
  }

  return [...new Set(endpoints)];
}

async function synthesizeWithPiper(
  text: string,
  voice: string,
  tone?: string,
  speed = 1.0,
  emotion?: string,
  podId?: string | null,
): Promise<Buffer> {
  const cleanText = sanitizeForLiveTTS(text);
  if (!cleanText) throw new Error("Teks kosong setelah sanitasi");

  const lengthScale = getPiperLengthScale(tone, speed, emotion);
  const body = JSON.stringify({
    text: cleanText,
    voice,
    length_scale: lengthScale,
    sample_rate: 16000,
  });

  const endpoints = resolvePiperEndpoints(podId);
  let lastErr: Error | null = null;

  for (const url of endpoints) {
    try {
      const ctrl = AbortSignal.timeout(90_000);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: ctrl,
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 240);
        throw new Error(`HTTP ${res.status} ${detail}`);
      }
      const ab = await res.arrayBuffer();
      const buf = Buffer.from(ab);
      if (buf.length < 44) throw new Error("Piper WAV kosong/pendek");
      return await ensureWav16kMono(buf);
    } catch (err) {
      lastErr = err as Error;
      console.warn(`[TTS] Piper endpoint gagal (${url}): ${lastErr.message}`);
    }
  }

  throw lastErr || new Error("Semua endpoint Piper gagal");
}

/** Fail-safe gratis (bukan Edge): Google Indonesia Speech API */
async function synthesizeWithGoogleTTS(text: string): Promise<Buffer> {
  const cleanText = sanitizeForLiveTTS(text);
  if (!cleanText) throw new Error("Teks kosong");

  const chunks: string[] = [];
  const words = cleanText.split(" ");
  let currentChunk = "";
  for (const word of words) {
    if ((currentChunk + " " + word).trim().length > 180) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = word;
    } else {
      currentChunk = currentChunk ? `${currentChunk} ${word}` : word;
    }
  }
  if (currentChunk) chunks.push(currentChunk.trim());

  const audioBuffers: Buffer[] = [];
  for (const chunk of chunks) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=id&client=tw-ob`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!res.ok) throw new Error(`Google TTS request failed: ${res.status}`);
    audioBuffers.push(Buffer.from(await res.arrayBuffer()));
  }
  return await convertMp3ToWav(Buffer.concat(audioBuffers));
}

export async function synthesizeSpeech(
  req: SynthesizeRequest,
): Promise<SynthesizeResponse> {
  const { text, avatarName = "Namira", speed = 1.0, tone, emotion } = req;
  const selectedVoice = resolvePiperVoiceId(req.voice, avatarName);

  const wordCount = text.trim().split(/\s+/).length;
  const estimatedSeconds = Math.max(
    1.5,
    Math.round((wordCount / ((140 * speed) / 60)) * 10) / 10,
  );

  let audioBuffer: Buffer | undefined;
  let engineUsed = "Piper TTS (id_ID, open-source, CPU)";

  try {
    audioBuffer = await synthesizeWithPiper(
      text,
      selectedVoice,
      tone,
      speed,
      emotion,
      req.podId,
    );
  } catch (primaryErr) {
    console.warn(
      `[TTS] Piper gagal: ${(primaryErr as Error).message}. Fail-safe Google TTS...`,
    );
    try {
      audioBuffer = await synthesizeWithGoogleTTS(text);
      engineUsed = "Google Indonesia TTS (Fail-Safe)";
    } catch (tier2Err) {
      console.error(`[TTS] Semua engine gagal:`, (tier2Err as Error).message);
      engineUsed = "TTS Error";
    }
  }

  return {
    success: !!audioBuffer && audioBuffer.length > 0,
    voice: selectedVoice,
    avatar: avatarName,
    text,
    durationEstimateSeconds: estimatedSeconds,
    audioFormat: "audio/wav",
    engine: engineUsed,
    message: audioBuffer
      ? `TTS synthesis success (${engineUsed})`
      : "TTS synthesis failed — pastikan Piper :8090 jalan di pod",
    audioBuffer,
  };
}

export async function warmUpTTS(): Promise<void> {
  try {
    const endpoints = resolvePiperEndpoints().map((u) =>
      u.replace(/\/synthesize$/, "/health").replace(/\/tts\/synthesize$/, "/tts/health"),
    );
    for (const url of endpoints) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        if (res.ok) {
          console.log(`[TTS] Piper ready via ${url}`);
          return;
        }
      } catch {
        /* try next */
      }
    }
    console.warn(
      "[TTS] Piper belum siap — jalankan bash /workspace/piper_tts/setup.sh && start.sh di pod",
    );
  } catch (e) {
    console.warn("[TTS] Warmup notice:", (e as Error).message);
  }
}
