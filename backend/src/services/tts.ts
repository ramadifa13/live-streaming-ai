import { spawn } from "child_process";
import { tmpdir } from "os";
import path from "path";
import { randomBytes } from "crypto";
import fs from "fs";
import { synthesizeWithLocalPiper } from "./piper-local.js";

export interface HostVoice {
  /** Host id (= Piper host), e.g. namira */
  id: string;
  name: string;
  gender: "female" | "male";
  locale: string;
  style: string;
  /** Sample pra-live (static / CDN). */
  sampleAudioUrl: string;
}

/** Host voices — id = host slug untuk Piper live. */
export const HOST_VOICES: HostVoice[] = [
  {
    id: "namira",
    name: "Namira",
    gender: "female",
    locale: "id-ID",
    style: "Energetic",
    sampleAudioUrl: "/avatars/namira_voice_sample.mp3",
  },
];


export interface SynthesizeRequest {
  text: string;
  /** Host id (namira). Field voice/avatarName juga diterima sebagai alias. */
  host?: string;
  voice?: string;
  avatarName?: string;
  speed?: number;
  pitch?: number;
  tone?: string;
  emotion?: string;
  podId?: string | null;
  /**
   * true = boleh synth tanpa sesi live (tool internal).
   * false = API publik default live-only.
   */
  allowOfflineSynth?: boolean;
}

export interface SynthesizeResponse {
  success: boolean;
  voice: string;
  host: string;
  avatar: string;
  text: string;
  durationEstimateSeconds: number;
  audioFormat: string;
  engine: string;
  message: string;
  audioBuffer?: Buffer;
  sampleAudioUrl?: string;
}

/**
 * Normalize text for Piper TTS only — jangan ubah data produk mentah.
 * Pipeline: Raw Product → Script → sanitizeForLiveTTS → Piper
 */
export function sanitizeForLiveTTS(text: string): string {
  if (!text) return "";
  let out = text
    .replace(/\[[A-Z_]+\]/gi, "")
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
      "",
    );

  out = normalizeCurrencyForTts(out);
  out = normalizePercentsAndUnits(out);
  out = normalizeAbbreviations(out);

  return out
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
    .trim();
}

/** Rp / Rp. / $ + format ID (25.000) atau US (25,000) → bacaan natural. */
export function normalizeCurrencyForTts(text: string): string {
  return text
    .replace(
      /\bRp\.?\s*([\d.,]+)\b/gi,
      (_m, raw: string) => `${idNumberToSpoken(parseIdAmount(raw))} rupiah`,
    )
    .replace(
      /\$\s*([\d.,]+)\b/g,
      (_m, raw: string) => `${idNumberToSpoken(parseIdAmount(raw))} dollar`,
    )
    .replace(/\b(\d+)k\b/gi, (_m, n: string) => `${idNumberToSpoken(Number(n) * 1000)}`);
}

function parseIdAmount(raw: string): number {
  const s = String(raw || "").trim();
  if (!s) return NaN;
  // 25.000 / 1.250.000 (ID) vs 25,000 / 1,250.50 (mixed)
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    return Number(s.replace(/\./g, "").replace(",", "."));
  }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    return Number(s.replace(/,/g, ""));
  }
  if (/^\d+,\d+$/.test(s) && !s.includes(".")) {
    // 25,5 → 25.5
    return Number(s.replace(",", "."));
  }
  return Number(s.replace(/[^\d.]/g, ""));
}

const ID_ONES = [
  "",
  "satu",
  "dua",
  "tiga",
  "empat",
  "lima",
  "enam",
  "tujuh",
  "delapan",
  "sembilan",
  "sepuluh",
  "sebelas",
  "dua belas",
  "tiga belas",
  "empat belas",
  "lima belas",
  "enam belas",
  "tujuh belas",
  "delapan belas",
  "sembilan belas",
];

/** Konversi angka ke bacaan ID untuk TTS (hingga ratusan juta). */
export function idNumberToSpoken(n: number): string {
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n);
  if (rounded === 0) return "nol";
  if (rounded < 0) return `minus ${idNumberToSpoken(-rounded)}`;
  if (rounded < 20) return ID_ONES[rounded] || String(rounded);
  if (rounded < 100) {
    const tens = Math.floor(rounded / 10);
    const ones = rounded % 10;
    const tensWord =
      tens === 1 ? "sepuluh" : tens === 2 ? "dua puluh" : `${ID_ONES[tens]} puluh`;
    return ones ? `${tensWord} ${ID_ONES[ones]}` : tens === 1 ? "sepuluh" : tensWord;
  }
  if (rounded < 200) {
    const rest = rounded - 100;
    return rest ? `seratus ${idNumberToSpoken(rest)}` : "seratus";
  }
  if (rounded < 1000) {
    const hundreds = Math.floor(rounded / 100);
    const rest = rounded % 100;
    const head = `${ID_ONES[hundreds]} ratus`;
    return rest ? `${head} ${idNumberToSpoken(rest)}` : head;
  }
  if (rounded < 1_000_000) {
    const thousands = Math.floor(rounded / 1000);
    const rest = rounded % 1000;
    const head =
      thousands === 1 ? "seribu" : `${idNumberToSpoken(thousands)} ribu`;
    return rest ? `${head} ${idNumberToSpoken(rest)}` : head;
  }
  if (rounded < 1_000_000_000) {
    const millions = Math.floor(rounded / 1_000_000);
    const rest = rounded % 1_000_000;
    const head = `${idNumberToSpoken(millions)} juta`;
    return rest ? `${head} ${idNumberToSpoken(rest)}` : head;
  }
  // Fallback besar: biarkan digit tanpa pemisah agar Piper tidak baca "titik"
  return String(rounded);
}

function normalizePercentsAndUnits(text: string): string {
  return text
    .replace(/(\d+(?:[.,]\d+)?)\s*%/g, (_m, n: string) => {
      const num = parseIdAmount(n);
      return Number.isFinite(num) ? `${idNumberToSpoken(num)} persen` : `${n} persen`;
    })
    .replace(/\b(\d+(?:[.,]\d+)?)\s*ml\b/gi, "$1 mililiter")
    .replace(/\b(\d+(?:[.,]\d+)?)\s*mg\b/gi, "$1 miligram")
    .replace(/\b(\d+(?:[.,]\d+)?)\s*gr\b/gi, "$1 gram")
    .replace(/\b(\d+(?:[.,]\d+)?)\s*g\b/gi, "$1 gram")
    .replace(/\b(\d+(?:[.,]\d+)?)\s*kg\b/gi, "$1 kilogram")
    .replace(/\b(\d+(?:[.,]\d+)?)\s*cm\b/gi, "$1 sentimeter")
    .replace(/\b(\d+)\s*[x×]\s*(\d+)\b/gi, "$1 kali $2")
    .replace(/\+/g, " plus ");
}

function normalizeAbbreviations(text: string): string {
  return text
    .replace(/\bBPOM\b/g, "B P O M")
    .replace(/\bORI\b/gi, "original")
    .replace(/\bCO\b/g, "check out")
    .replace(/\bCOD\b/g, "C O D")
    .replace(/\bFYP\b/g, "F Y P")
    .replace(/\bDM\b/g, "D M")
    .replace(/\bSKU\b/gi, "S K U")
    .replace(/\bFAQ\b/gi, "F A Q")
    .replace(/\bONGKIR\b/gi, "ongkos kirim");
}

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

  return Math.max(0.75, Math.min(1.45, 1.0 / speed));
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

/** Resolve ke host id (namira). Edge Neural ids diabaikan. */
export function resolveHostId(
  voiceOrHost?: string,
  avatarName?: string,
): string {
  const defaultHost = (process.env.PIPER_DEFAULT_HOST || "namira").trim() || "namira";
  const raw = String(voiceOrHost || avatarName || defaultHost)
    .trim()
    .toLowerCase()
    .replace(/\.(png|jpg|jpeg|mp4|onnx)$/i, "");
  const base = raw.includes("/") ? raw.split("/").pop()! : raw;

  if (!base || base.startsWith("id-id-") || base.startsWith("id_id_")) {
    return defaultHost;
  }
  if (HOST_VOICES.some((h) => h.id === base)) return base;
  if (base.includes("namira")) return "namira";
  if (base.includes("siti")) return "namira"; // single host for now
  if (base.includes("ardi") || base.includes("budi")) return "namira";
  return defaultHost;
}


export function getHostSampleUrl(hostId: string): string {
  const host = HOST_VOICES.find((h) => h.id === resolveHostId(hostId));
  return host?.sampleAudioUrl || `/avatars/${resolveHostId(hostId)}_voice_sample.mp3`;
}

function piperSynthesizeUrl(base: string): string {
  const url = base.replace(/\/$/, "");
  return url.endsWith("/synthesize") ? url : `${url}/synthesize`;
}

/** Cadangan HTTP opsional (PIPER_TTS_URL). Default: spawn lokal tanpa port. */
function resolvePiperEndpoints(): string[] {
  const endpoints: string[] = [];
  const explicit = (process.env.PIPER_TTS_URL || "").trim().replace(/\/$/, "");
  if (explicit) {
    endpoints.push(piperSynthesizeUrl(explicit));
  }
  return [...new Set(endpoints)];
}

async function synthesizeWithPiper(
  text: string,
  hostId: string,
  tone?: string,
  speed = 1.0,
  emotion?: string,
  podId?: string | null,
): Promise<Buffer> {
  const cleanText = sanitizeForLiveTTS(text);
  if (!cleanText) throw new Error("Teks kosong setelah sanitasi");

  const lengthScale = getPiperLengthScale(tone, speed, emotion);
  let localErr: Error | null = null;

  try {
    const local = await synthesizeWithLocalPiper({
      text: cleanText,
      host: hostId,
      length_scale: lengthScale,
      sample_rate: 16000,
    });
    if (local.length >= 44) return await ensureWav16kMono(local);
  } catch (err) {
    localErr = err as Error;
    console.warn(`[TTS] Piper lokal (tanpa port): ${localErr.message}`);
  }

  const body = JSON.stringify({
    text: cleanText,
    host: hostId,
    avatar: hostId,
    length_scale: lengthScale,
    sample_rate: 16000,
  });

  const endpoints = resolvePiperEndpoints();
  let lastErr: Error | null = null;

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 240);
        throw new Error(`HTTP ${res.status} ${detail}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 44) throw new Error("Piper WAV kosong/pendek");
      return await ensureWav16kMono(buf);
    } catch (err) {
      lastErr = err as Error;
      console.warn(`[TTS] Piper gagal (${url}): ${lastErr.message}`);
    }
  }

  throw lastErr || localErr || new Error("Piper gagal");
}

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
  const hostId = resolveHostId(req.host || req.voice, avatarName || req.avatarName);
  const sampleAudioUrl = getHostSampleUrl(hostId);

  const wordCount = text.trim().split(/\s+/).length;
  const estimatedSeconds = Math.max(
    1.5,
    Math.round((wordCount / ((140 * speed) / 60)) * 10) / 10,
  );

  // Live-only: tanpa podId / allowOffline, jangan panggil Piper (preview pakai sample).
  const liveOk = Boolean(req.podId) || req.allowOfflineSynth === true;
  if (!liveOk) {
    return {
      success: false,
      voice: hostId,
      host: hostId,
      avatar: avatarName,
      text,
      durationEstimateSeconds: estimatedSeconds,
      audioFormat: "audio/mpeg",
      engine: "sample",
      message:
        "Pra-live: gunakan sampleAudioUrl. Piper hanya saat live (butuh podId).",
      sampleAudioUrl,
    };
  }

  let audioBuffer: Buffer | undefined;
  let engineUsed = "Piper TTS (CPU backend)";

  try {
    audioBuffer = await synthesizeWithPiper(
      text,
      hostId,
      tone,
      speed,
      emotion,
      req.podId,
    );
  } catch (primaryErr) {
    console.warn(
      `[TTS] Piper gagal: ${(primaryErr as Error).message}. Fail-safe Google...`,
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
    voice: hostId,
    host: hostId,
    avatar: avatarName,
    text,
    durationEstimateSeconds: estimatedSeconds,
    audioFormat: "audio/wav",
    engine: engineUsed,
    message: audioBuffer
      ? `TTS synthesis success (${engineUsed})`
      : "TTS synthesis failed — jalankan npm run piper:setup di backend",
    audioBuffer,
    sampleAudioUrl,
  };
}

export async function warmUpTTS(): Promise<void> {
  console.log(
    `[TTS] Host voices: ${HOST_VOICES.map((h) => h.id).join(", ")} — Piper CPU di-spawn backend (tanpa port)`,
  );
}
