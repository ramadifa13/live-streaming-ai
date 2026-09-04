/**
 * TTS service — VoxCPM2 only (AI Worker GPU).
 * Business layer: sanitize short sentences → call worker /tts/synthesize.
 * No Piper / Supertonic / Google fallback.
 */

import { spawn } from "child_process";
import { tmpdir } from "os";
import path from "path";
import { randomBytes } from "crypto";
import fs from "fs";
import { getWorkerUrl } from "./runpod-manager.js";

export interface HostVoice {
  /** voice_id for VoxCPM2 */
  id: string;
  name: string;
  gender: "female" | "male";
  locale: string;
  style: string;
}

/** Female host voices — pre-live filter + live VoxCPM2 voice_id. */
export const HOST_VOICES: HostVoice[] = [
  {
    id: "girl_cute_kids",
    name: "girl - cute kids",
    gender: "female",
    locale: "id-ID",
    style: "Cute Kids",
  },
  {
    id: "girl_warm_youthful",
    name: "girl - warm & youthful",
    gender: "female",
    locale: "id-ID",
    style: "Warm & Youthful",
  },
  {
    id: "girl_warm_friendly",
    name: "girl - warm & friendly",
    gender: "female",
    locale: "id-ID",
    style: "Warm & Friendly",
  },
  {
    id: "girl_calm_professional",
    name: "girl - calm & professional",
    gender: "female",
    locale: "id-ID",
    style: "Calm & Professional",
  },
];

export const DEFAULT_VOICE_ID = "girl_cute_kids";

export interface SynthesizeRequest {
  text: string;
  /** voice_id (preferred) or legacy host slug */
  voiceId?: string;
  host?: string;
  voice?: string;
  avatarName?: string;
  speed?: number;
  pitch?: number;
  tone?: string;
  emotion?: string;
  style?: string;
  lang?: string;
  podId?: string | null;
  sessionId?: string;
  requestId?: string;
  /**
   * true = boleh synth tanpa sesi live (studio preview) jika worker URL ada.
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
  metrics?: {
    requestId?: string;
    queueMs?: number;
    inferenceMs?: number;
    latencyMs?: number;
    audioDuration?: number;
    rtf?: number;
    gpuMemoryMb?: number;
  };
}

/**
 * Normalize text for live TTS — jangan ubah data produk mentah.
 * Pipeline: Raw Product → Script → sanitizeForLiveTTS → VoxCPM2
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
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    return Number(s.replace(/\./g, "").replace(",", "."));
  }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    return Number(s.replace(/,/g, ""));
  }
  if (/^\d+,\d+$/.test(s) && !s.includes(".")) {
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

/** Resolve ke voice_id VoxCPM2. Legacy host slug → suara perempuan default. */
export function resolveVoiceId(
  voiceOrHost?: string,
  avatarName?: string,
): string {
  const defaultVoice =
    (process.env.VOICE_ID || DEFAULT_VOICE_ID).trim() || DEFAULT_VOICE_ID;
  const raw = String(voiceOrHost || avatarName || defaultVoice)
    .trim()
    .toLowerCase()
    .replace(/\.(png|jpg|jpeg|mp4|onnx|wav|mp3)$/i, "")
    .replace(/\s+/g, "_")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const base = raw.includes("/") ? raw.split("/").pop()! : raw;

  if (!base || base.startsWith("id-id-") || base.startsWith("id_id_")) {
    return defaultVoice;
  }
  if (HOST_VOICES.some((h) => h.id === base)) return base;
  // Alias lama
  if (
    base === "default_host" ||
    base === "namira" ||
    base.includes("namira") ||
    base.includes("siti") ||
    base.includes("default")
  ) {
    return defaultVoice;
  }
  if (HOST_VOICES.some((h) => h.id === base)) return base;
  return defaultVoice;
}

/** @deprecated Gunakan resolveVoiceId */
export function resolveHostId(
  voiceOrHost?: string,
  avatarName?: string,
): string {
  return resolveVoiceId(voiceOrHost, avatarName);
}

export function getHostSampleUrl(_hostId: string): string {
  return "";
}

function headerNum(headers: Headers, name: string): number | undefined {
  const v = headers.get(name);
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

async function synthesizeWithVoxCPM2(
  text: string,
  voiceId: string,
  opts: {
    lang?: string;
    style?: string;
    emotion?: string;
    tone?: string;
    podId?: string | null;
    sessionId?: string;
    requestId?: string;
  },
): Promise<{ buffer: Buffer; metrics: SynthesizeResponse["metrics"] }> {
  const cleanText = sanitizeForLiveTTS(text);
  if (!cleanText) throw new Error("Teks kosong setelah sanitasi");

  const workerUrl = getWorkerUrl(opts.podId);
  if (!workerUrl) {
    throw new Error(
      "VoxCPM2 membutuhkan AI Worker GPU (RUNPOD_WORKER_URL / podId). Tidak ada fallback TTS.",
    );
  }

  const style =
    (opts.style || opts.tone || "").trim() || undefined;
  const t0 = Date.now();
  const res = await fetch(`${workerUrl.replace(/\/$/, "")}/tts/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: cleanText,
      voice_id: voiceId,
      language: (opts.lang || process.env.TTS_LANGUAGE || "id").trim() || "id",
      style,
      emotion: opts.emotion,
      request_id: opts.requestId,
      live_session_id: opts.sessionId,
    }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: string; error?: string };
      detail = j.detail || j.error || detail;
    } catch {
      detail = (await res.text().catch(() => detail)).slice(0, 400);
    }
    throw new Error(`VoxCPM2 gagal: ${detail}`);
  }

  const ab = Buffer.from(await res.arrayBuffer());
  if (ab.length < 44) throw new Error("VoxCPM2 WAV kosong/pendek");
  const buffer = await ensureWav16kMono(ab);

  const metrics = {
    requestId: res.headers.get("x-tts-request-id") || undefined,
    queueMs: headerNum(res.headers, "x-tts-queue-ms"),
    inferenceMs: headerNum(res.headers, "x-tts-inference-ms"),
    latencyMs: headerNum(res.headers, "x-tts-latency-ms") ?? Date.now() - t0,
    audioDuration: headerNum(res.headers, "x-tts-audio-duration"),
    rtf: headerNum(res.headers, "x-tts-rtf"),
    gpuMemoryMb: headerNum(res.headers, "x-tts-gpu-memory-mb"),
  };

  console.log(
    `[TTS] voxcpm2 ok voice_id=${voiceId} latency_ms=${metrics.latencyMs} ` +
      `audio_dur=${metrics.audioDuration} rtf=${metrics.rtf} gpu_mb=${metrics.gpuMemoryMb}`,
  );

  return { buffer, metrics };
}

export async function synthesizeSpeech(
  req: SynthesizeRequest,
): Promise<SynthesizeResponse> {
  const {
    text,
    avatarName = "Namira",
    speed = 1.0,
    tone,
    emotion,
    style,
    lang,
  } = req;
  const voiceId = resolveVoiceId(
    req.voiceId || req.host || req.voice,
    avatarName || req.avatarName,
  );

  const wordCount = text.trim().split(/\s+/).length;
  const estimatedSeconds = Math.max(
    1.5,
    Math.round((wordCount / ((140 * speed) / 60)) * 10) / 10,
  );

  const liveOk = Boolean(req.podId) || req.allowOfflineSynth === true;
  if (!liveOk) {
    return {
      success: false,
      voice: voiceId,
      host: voiceId,
      avatar: avatarName,
      text,
      durationEstimateSeconds: estimatedSeconds,
      audioFormat: "audio/wav",
      engine: "voxcpm2",
      message:
        "Pra-live: panggil /api/tts/synthesize dengan allowOfflineSynth + worker GPU, atau Go Live.",
    };
  }

  try {
    const { buffer, metrics } = await synthesizeWithVoxCPM2(text, voiceId, {
      lang,
      style: style || tone,
      emotion,
      tone,
      podId: req.podId,
      sessionId: req.sessionId,
      requestId: req.requestId,
    });

    return {
      success: true,
      voice: voiceId,
      host: voiceId,
      avatar: avatarName,
      text,
      durationEstimateSeconds: metrics?.audioDuration ?? estimatedSeconds,
      audioFormat: "audio/wav",
      engine: "voxcpm2",
      message: "TTS synthesis success (VoxCPM2)",
      audioBuffer: buffer,
      metrics,
    };
  } catch (err) {
    const msg = (err as Error).message || String(err);
    console.error(`[TTS] VoxCPM2 failed (no fallback): ${msg}`);
    return {
      success: false,
      voice: voiceId,
      host: voiceId,
      avatar: avatarName,
      text,
      durationEstimateSeconds: estimatedSeconds,
      audioFormat: "audio/wav",
      engine: "voxcpm2",
      message: msg,
    };
  }
}

export async function warmUpTTS(): Promise<void> {
  console.log(
    `[TTS] Engine=VoxCPM2 voice_id=${process.env.VOICE_ID || DEFAULT_VOICE_ID} — inference di AI Worker GPU`,
  );
}
