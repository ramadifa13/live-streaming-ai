import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { createInterface } from "readline";
import { tmpdir } from "os";
import path from "path";
import { randomBytes } from "crypto";
import fs from "fs";

export interface HostVoice {
  id: string;
  name: string;
  gender: "female" | "male";
  locale: string;
  style: string;
}

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

const POCKET_TTS_CONFIG =
  process.env.POCKET_TTS_CONFIG || "hf://anak10thn/pocket-tts-indonesian/indonesian_6l.yaml@635cde7a28301861b120f57ec4dda8525073017c";

type PocketRequest = { id: string; text: string; voice_id: string };
type PocketResponse = { id: string; audio?: string; error?: string };

type PocketPending = {
  resolve: (audio: Buffer) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  workerIndex: number;
};

type PocketWorker = {
  index: number;
  process: ChildProcessWithoutNullStreams | null;
  ready: Promise<void> | null;
  stdout: ReturnType<typeof createInterface> | null;
  pendingCount: number;
  starting: boolean;
};

const POCKET_TTS_WORKERS = Math.max(1, Math.min(4, Number(process.env.POCKET_TTS_WORKERS || 2)));
const pocketWorkers: PocketWorker[] = Array.from({ length: POCKET_TTS_WORKERS }, (_, index) => ({
  index,
  process: null,
  ready: null,
  stdout: null,
  pendingCount: 0,
  starting: false,
}));
const pocketPending = new Map<string, PocketPending>();
const POCKET_REQUEST_TIMEOUT_MS = Math.max(8_000, Number(process.env.POCKET_TTS_TIMEOUT_MS || 45_000));

function pocketPythonScript(): string {
  return path.resolve(process.cwd(), "pocket_tts", "worker.py");
}

function pocketPythonCommand(): string {
  if (process.env.POCKET_TTS_PYTHON) return process.env.POCKET_TTS_PYTHON;
  const envPython =
    process.platform === "win32"
      ? path.resolve(process.cwd(), "pocket_tts", "env", "Scripts", "python.exe")
      : path.resolve(process.cwd(), "pocket_tts", "env", "bin", "python");
  return fs.existsSync(envPython) ? envPython : "python";
}

function failWorkerPending(workerIndex: number, error: Error) {
  for (const [id, pending] of pocketPending.entries()) {
    if (pending.workerIndex !== workerIndex) continue;
    clearTimeout(pending.timer);
    pending.reject(error);
    pocketPending.delete(id);
  }
  const worker = pocketWorkers[workerIndex];
  if (worker) worker.pendingCount = 0;
}

function failAllPocketPending(error: Error) {
  for (const [id, pending] of pocketPending.entries()) {
    clearTimeout(pending.timer);
    pending.reject(error);
    pocketPending.delete(id);
  }
  for (const worker of pocketWorkers) worker.pendingCount = 0;
}

function dispatchPocketLine(workerIndex: number, line: string) {
  let payload: PocketResponse & { ready?: boolean };
  try {
    payload = JSON.parse(line) as PocketResponse & { ready?: boolean };
  } catch {
    return;
  }
  if (payload.ready) return;
  const pending = payload.id ? pocketPending.get(payload.id) : undefined;
  if (!pending || pending.workerIndex !== workerIndex) return;
  clearTimeout(pending.timer);
  pocketPending.delete(payload.id);
  const worker = pocketWorkers[workerIndex];
  if (worker) worker.pendingCount = Math.max(0, worker.pendingCount - 1);
  if (payload.error) pending.reject(new Error(payload.error));
  else if (!payload.audio) pending.reject(new Error("Pocket TTS tidak mengembalikan audio"));
  else pending.resolve(Buffer.from(payload.audio, "base64"));
}

export function isPocketTtsReady(): boolean {
  return pocketWorkers.some((w) => Boolean(w.process && w.ready));
}

export function getPocketTtsWorkerCount(): number {
  return POCKET_TTS_WORKERS;
}

function pocketWorkerEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    POCKET_TTS_CONFIG,
    POCKET_TTS_VOICE_DIR: process.env.POCKET_TTS_VOICE_DIR || path.resolve(process.cwd(), "voices"),
    // Kill vocoder drones: fire EOS earlier + strip residual buzz in audio_post.
    POCKET_TTS_EOS_THRESHOLD: process.env.POCKET_TTS_EOS_THRESHOLD || "-5.0",
    POCKET_TTS_EOS_RETRY_THRESHOLD: process.env.POCKET_TTS_EOS_RETRY_THRESHOLD || "-6.0",
    POCKET_TTS_FRAMES_AFTER_EOS: process.env.POCKET_TTS_FRAMES_AFTER_EOS || "3",
    POCKET_TTS_AUDIO_FILTER: process.env.POCKET_TTS_AUDIO_FILTER || "1",
    KPOCKET_TTS_ERROR_WITHOUT_EOS: process.env.KPOCKET_TTS_ERROR_WITHOUT_EOS || "1",
  };
}

function startPocketWorker(workerIndex: number): Promise<void> {
  const worker = pocketWorkers[workerIndex];
  if (!worker) return Promise.reject(new Error(`Pocket TTS lane ${workerIndex} tidak ada`));
  if (worker.ready) return worker.ready;

  worker.ready = new Promise((resolve, reject) => {
    worker.starting = true;
    const python = pocketPythonCommand();
    const child = spawn(python, [pocketPythonScript()], {
      cwd: path.resolve(process.cwd(), "pocket_tts"),
      env: pocketWorkerEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    worker.process = child;
    worker.stdout = createInterface({ input: child.stdout });
    worker.stdout.on("line", (line) => dispatchPocketLine(workerIndex, line));
    const onReady = (line: string) => {
      try {
        if (JSON.parse(line).ready) {
          worker.stdout?.off("line", onReady);
          worker.starting = false;
          console.log(`[PocketTTS] lane=${workerIndex} ready pid=${child.pid}`);
          resolve();
        }
      } catch {}
    };
    worker.stdout.on("line", onReady);
    child.stderr.on("data", (chunk) =>
      console.warn(`[PocketTTS:${workerIndex}] ${chunk.toString().trim()}`),
    );
    child.once("error", (error) => {
      worker.ready = null;
      worker.process = null;
      worker.stdout = null;
      worker.starting = false;
      failWorkerPending(workerIndex, error);
      reject(error);
    });
    child.once("exit", (code) => {
      worker.process = null;
      worker.ready = null;
      worker.stdout = null;
      worker.starting = false;
      const err = new Error(`Pocket TTS lane ${workerIndex} berhenti (${code ?? "unknown"})`);
      failWorkerPending(workerIndex, err);
      if (code !== 0) reject(err);
    });
  });
  return worker.ready;
}

function startPocketTts(): Promise<void> {
  return Promise.all(pocketWorkers.map((_, index) => startPocketWorker(index))).then(() => undefined);
}

function pickLeastPendingWorker(): PocketWorker {
  const ready = pocketWorkers.filter((w) => Boolean(w.process?.stdin));
  const pool = ready.length > 0 ? ready : pocketWorkers;
  let best = pool[0]!;
  for (let i = 1; i < pool.length; i++) {
    const candidate = pool[i]!;
    if (candidate.pendingCount < best.pendingCount) best = candidate;
  }
  return best;
}

export function stopTTS() {
  failAllPocketPending(new Error("Pocket TTS dihentikan"));
  for (const worker of pocketWorkers) {
    try {
      worker.stdout?.close();
    } catch {}
    worker.stdout = null;
    if (worker.process && !worker.process.killed) {
      worker.process.kill();
    }
    worker.process = null;
    worker.ready = null;
    worker.pendingCount = 0;
    worker.starting = false;
  }
}

function synthesizeWithPocketTts(text: string, voiceId: string): Promise<Buffer> {
  return (async () => {
    await startPocketTts();
    const worker = pickLeastPendingWorker();
    if (!worker.process?.stdin) throw new Error("Pocket TTS runner tidak tersedia");
    const id = randomBytes(8).toString("hex");
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = pocketPending.get(id);
        if (pending) {
          pocketPending.delete(id);
          worker.pendingCount = Math.max(0, worker.pendingCount - 1);
        }
        reject(new Error(`Pocket TTS timeout setelah ${POCKET_REQUEST_TIMEOUT_MS}ms`));
      }, POCKET_REQUEST_TIMEOUT_MS);
      worker.pendingCount += 1;
      pocketPending.set(id, { resolve, reject, timer, workerIndex: worker.index });
      const ok = worker.process!.stdin!.write(
        `${JSON.stringify({ id, text, voice_id: voiceId } satisfies PocketRequest)}\n`,
      );
      if (!ok) {
        worker.process!.stdin!.once("drain", () => undefined);
      }
    });
  })();
}

export interface SynthesizeRequest {
  text: string;

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
  targetDurationSeconds?: number;

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
  out = normalizeConversationalTerms(out);
  out = normalizeAbbreviations(out);

  out = out
    .replace(/&/g, " dan ")
    .replace(/</g, "")
    .replace(/>/g, "")
    .replace(/['"]/g, "");

  // Sisipkan jeda nafas koma sebelum kata transisi agar intonasi rileks dan tidak terburu-buru
  const pauseMarkers = [
    "nah",
    "jadi",
    "selain itu",
    "menariknya",
    "buat kamu",
    "makanya",
    "karena",
    "sehingga",
    "supaya",
    "kebetulan",
    "tentunya",
    "apalagi",
    "khusus hari ini",
    "mumpung lagi promo",
    "jangan sampai kehabisan",
    "yuk",
    "langsung saja",
  ];

  for (const marker of pauseMarkers) {
    const regex = new RegExp(`([^,!?.\\s;—])\\s+(${marker}\\b)`, "gi");
    out = out.replace(regex, "$1, $2");
  }

  out = collapseRepeatedSpeech(out);

  return out
    .replace(/[!]{2,}/g, "!")
    .replace(/[?]{2,}/g, "?")
    .replace(/[.]{4,}/g, "...")
    .replace(/\s*,\s*,+/g, ",")
    .replace(/\s*,\s*\./g, ".")
    .replace(/\s*,\s*\?/g, "?")
    .replace(/\s*,\s*!/g, "!")
    .replace(/,\s*,/g, ", ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/([,.!?])([a-zA-Z0-9])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function collapseRepeatedSpeech(text: string): string {
  const placeholders: string[] = [];
  let out = String(text || "").replace(/\b[\p{L}]+-[\p{L}]+\b/giu, (match) => {
    const [left, right] = match.split("-");
    if (left && right && left.toLowerCase() === right.toLowerCase()) {
      placeholders.push(match);
      return `\u0000R${placeholders.length - 1}\u0000`;
    }
    return match;
  });
  for (let i = 0; i < 3; i++) {
    const next = out
      .replace(/\b([\p{L}\p{N}']+)(?:\s+\1){1,}/giu, "$1")
      .replace(
        /\b((?:[\p{L}\p{N}']+\s+){0,3}[\p{L}\p{N}']+)(?:(?:\s*[,.;:!?—–]+\s*|\s+)\1)+\b/giu,
        "$1",
      );
    if (next === out) break;
    out = next;
  }
  out = out.replace(/\u0000R(\d+)\u0000/g, (_m, idx: string) => placeholders[Number(idx)] || "");
  return out.replace(/\s+/g, " ").trim();
}

function normalizeConversationalTerms(text: string): string {
  return text
    .replace(/\b(check\s*out|checkout)\b/gi, "pesan")
    .replace(/\b(ready\s*stock)\b/gi, "stok tersedia")
    .replace(/\b(best\s*seller)\b/gi, "produk terlaris")
    .replace(/\b(sold\s*out)\b/gi, "stok habis")
    .replace(/\b(soft\s*sell)\b/gi, "ajakan ringan")
    .replace(/\b(review)\b/gi, "ulasan")
    .replace(/\b(guys)\b/gi, "teman-teman")
    .replace(/\b(join)\b/gi, "bergabung")
    .replace(/\b(stay)\b/gi, "tetap")
    .replace(/\b(simple)\b/gi, "sederhana")
    .replace(/\b(worth)\b/gi, "sepadan")
    .replace(/\b(hook)\b/gi, "pembuka")
    .replace(/\b(price)\b/gi, "harga")
    .replace(/\b(budget)\b/gi, "anggaran")
    .replace(/\b(fomo)\b/gi, "terburu-buru")
    .replace(/\b(live)\b/gi, "siaran")
    .replace(/\b(nggak|gak|ga)\b/gi, "tidak")
    .replace(/\b(emang)\b/gi, "memang")
    .replace(/\b(aja)\b/gi, "saja")
    .replace(/\b(banget)\b/gi, "sekali")
    .replace(/\b(nah|oke)\b/gi, "baik");
}

export function normalizeCurrencyForTts(text: string): string {
  return text
    .replace(/\bRp\.?\s*([\d.,]+)\b/gi, (_m, raw: string) => `${idNumberToSpoken(parseIdAmount(raw))} rupiah`)
    .replace(/\$\s*([\d.,]+)\b/g, (_m, raw: string) => `${idNumberToSpoken(parseIdAmount(raw))} dollar`)
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

export function idNumberToSpoken(n: number): string {
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n);
  if (rounded === 0) return "nol";
  if (rounded < 0) return `minus ${idNumberToSpoken(-rounded)}`;
  if (rounded < 20) return ID_ONES[rounded] || String(rounded);
  if (rounded < 100) {
    const tens = Math.floor(rounded / 10);
    const ones = rounded % 10;
    const tensWord = tens === 1 ? "sepuluh" : tens === 2 ? "dua puluh" : `${ID_ONES[tens]} puluh`;
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
    const head = thousands === 1 ? "seribu" : `${idNumberToSpoken(thousands)} ribu`;
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

async function ensureWavPcm(input: Buffer): Promise<Buffer> {
  if (input.length >= 44 && input.toString("ascii", 0, 4) === "RIFF" && input.toString("ascii", 8, 12) === "WAVE") {
    const rate = input.readUInt32LE(24);
    const channels = input.readUInt16LE(22);
    if (channels === 1 && (rate === 24000 || rate === 48000 || rate === 16000)) return input;
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
      "24000",
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
      } catch {}
      if (code !== 0) {
        try {
          fs.unlinkSync(outFile);
        } catch {}
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

export function wavDurationSeconds(input: Buffer): number | undefined {
  if (input.length < 44 || input.toString("ascii", 0, 4) !== "RIFF") return undefined;
  if (input.toString("ascii", 8, 12) !== "WAVE") return undefined;
  const sampleRate = input.readUInt32LE(24);
  const channels = input.readUInt16LE(22);
  const bitsPerSample = input.readUInt16LE(34);
  let dataBytes: number | undefined;
  let offset = 12;
  while (offset + 8 <= input.length) {
    const chunkId = input.toString("ascii", offset, offset + 4);
    const chunkSize = input.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      dataBytes = Math.min(chunkSize, input.length - offset - 8);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (dataBytes == null) return undefined;
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return undefined;
  return dataBytes / bytesPerSecond;
}

export function resolveVoiceId(voiceOrHost?: string, avatarName?: string): string {
  const defaultVoice = (process.env.VOICE_ID || DEFAULT_VOICE_ID).trim() || DEFAULT_VOICE_ID;
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

  if (base === "default_host" || base === "namira" || base.includes("namira") || base.includes("siti") || base.includes("default")) {
    return defaultVoice;
  }
  if (HOST_VOICES.some((h) => h.id === base)) return base;
  return defaultVoice;
}

export function resolveHostId(voiceOrHost?: string, avatarName?: string): string {
  return resolveVoiceId(voiceOrHost, avatarName);
}

export function getHostSampleUrl(_hostId: string): string {
  return "";
}

export async function calibrateAudioDuration(
  inputWav: Buffer,
  targetSeconds = 8.8,
  options?: { minDurationForCalibration?: number },
): Promise<Buffer> {
  if ((process.env.LIVE_TTS_AUDIO_CALIBRATION ?? "0").trim() !== "1") {
    const dur = wavDurationSeconds(inputWav);
    if (dur && dur > 0) {
      console.log(`[TTS] Audio duration kept natural: ${dur.toFixed(2)}s (target=${targetSeconds.toFixed(2)}s, calibration=off)`);
    }
    return inputWav;
  }

  const dur = wavDurationSeconds(inputWav);
  if (!dur || dur <= 0) return inputWav;

  // Jika durasi sudah dalam toleransi presisi (8.85s – 9.15s), langsung kembalikan
  if (dur >= targetSeconds - 0.15 && dur <= targetSeconds + 0.15) {
    return inputWav;
  }

  // Jika audio sangat pendek (< 3.5s untuk ping/warmup singkat), jangan stretch
  const minThreshold = options?.minDurationForCalibration ?? 3.5;
  if (dur < minThreshold) {
    return inputWav;
  }

  return new Promise<Buffer>((resolve) => {
    const inFile = path.join(tmpdir(), `tts_calib_in_${randomBytes(4).toString("hex")}.wav`);
    const outFile = path.join(tmpdir(), `tts_calib_out_${randomBytes(4).toString("hex")}.wav`);
    fs.writeFileSync(inFile, inputWav);

    // Hitung faktor tempo (tempo = dur / targetSeconds)
    // Audio kepanjangan (misal 10.8s) -> tempo dipercepat (1.20) agar muat dalam video 10s tanpa kepotong
    // Audio kependekan (misal 7.2s) -> tempo diperlambat (0.80) agar lebih rileks dan pas 9s
    const rawTempo = dur / targetSeconds;
    const tempo = Math.min(1.22, Math.max(0.78, rawTempo));
    const filter = `atempo=${tempo.toFixed(4)}`;

    const proc = spawn(FFMPEG_BIN, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inFile,
      "-filter:a",
      filter,
      "-ar",
      "24000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      "-y",
      outFile,
    ]);

    proc.on("error", (err) => {
      try {
        if (fs.existsSync(inFile)) fs.unlinkSync(inFile);
      } catch {}
      console.warn(`[TTS] FFmpeg calibrate spawn error: ${err.message}`);
      resolve(inputWav);
    });

    proc.on("close", (code) => {
      try {
        if (fs.existsSync(inFile)) fs.unlinkSync(inFile);
      } catch {}
      if (code !== 0) {
        try {
          if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
        } catch {}
        console.warn(`[TTS] FFmpeg calibrate exited with code ${code}`);
        resolve(inputWav);
        return;
      }
      try {
        const out = fs.readFileSync(outFile);
        fs.unlinkSync(outFile);
        if (out.length >= 44) {
          const newDur = wavDurationSeconds(out);
          console.log(
            `[TTS] Audio duration calibrated for 10s video: ${dur.toFixed(2)}s -> ${(newDur || 0).toFixed(2)}s (tempo=${tempo.toFixed(2)})`,
          );
          resolve(out);
        } else {
          resolve(inputWav);
        }
      } catch (err) {
        console.warn(`[TTS] Read calibrated audio error: ${err}`);
        resolve(inputWav);
      }
    });
  });
}

async function synthesizeWithPocket(
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
    targetDurationSeconds?: number;
  },
): Promise<{ buffer: Buffer; metrics: SynthesizeResponse["metrics"] }> {
  const cleanText = sanitizeForLiveTTS(text);
  if (!cleanText) throw new Error("Teks kosong setelah sanitasi");

  const t0 = Date.now();
  const audio = await synthesizeWithPocketTts(cleanText, voiceId);
  if (audio.length < 44) throw new Error("Pocket TTS WAV kosong/pendek");
  const monoBuffer = await ensureWavPcm(audio);
  const targetDur = opts.targetDurationSeconds ?? 8.8;
  const buffer = await calibrateAudioDuration(monoBuffer, targetDur);
  const metrics = {
    requestId: opts.requestId,
    latencyMs: Date.now() - t0,
    audioDuration: wavDurationSeconds(buffer),
  };

  console.log(`[TTS] pocket-tts ok voice_id=${voiceId} latency_ms=${metrics.latencyMs} duration=${(metrics.audioDuration || 0).toFixed(2)}s`);

  return { buffer, metrics };
}

export async function synthesizeSpeech(req: SynthesizeRequest): Promise<SynthesizeResponse> {
  const { text, avatarName = "Namira", speed = 1.0, tone, emotion, style, lang, targetDurationSeconds } = req;
  const voiceId = resolveVoiceId(req.voiceId || req.host || req.voice, avatarName || req.avatarName);

  const wordCount = text.trim().split(/\s+/).length;
  const estimatedSeconds = Math.max(1.5, Math.round((wordCount / ((140 * speed) / 60)) * 10) / 10);

  try {
    const { buffer, metrics } = await synthesizeWithPocket(text, voiceId, {
      lang,
      style: style || tone,
      emotion,
      tone,
      podId: req.podId,
      sessionId: req.sessionId,
      requestId: req.requestId,
      targetDurationSeconds: targetDurationSeconds ?? 8.8,
    });

    return {
      success: true,
      voice: voiceId,
      host: voiceId,
      avatar: avatarName,
      text,
      durationEstimateSeconds: metrics?.audioDuration ?? estimatedSeconds,
      audioFormat: "audio/wav",
      engine: "pocket-tts-indonesian",
      message: "TTS synthesis success (Pocket TTS Indonesian)",
      audioBuffer: buffer,
      metrics,
    };
  } catch (err) {
    const msg = (err as Error).message || String(err);
    console.error(`[TTS] Pocket TTS failed: ${msg}`);
    return {
      success: false,
      voice: voiceId,
      host: voiceId,
      avatar: avatarName,
      text,
      durationEstimateSeconds: estimatedSeconds,
      audioFormat: "audio/wav",
      engine: "pocket-tts-indonesian",
      message: msg,
    };
  }
}

export async function warmUpTTS(): Promise<void> {
  await startPocketTts();
  console.log(
    `[TTS] Engine=Pocket TTS Indonesian workers=${POCKET_TTS_WORKERS} voice_id=${DEFAULT_VOICE_ID}`,
  );
}
