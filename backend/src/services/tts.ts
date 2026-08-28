import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface TTSVoice {
  id: string;
  name: string;
  gender: "female" | "male";
  locale: string;
  style: string;
  avatarMatch: string;
}

export const INDONESIAN_VOICES: TTSVoice[] = [
  {
    id: "id-ID-GadisNeural",
    name: "Gadis (Wanita - Ramah & Warm)",
    gender: "female",
    locale: "id-ID",
    style: "Friendly",
    avatarMatch: "Nana",
  },
  {
    id: "id-ID-SitiNeural",
    name: "Namira (Wanita - Energetik & Live Shopping)",
    gender: "female",
    locale: "id-ID",
    style: "Energetic",
    avatarMatch: "Namira",
  },
  {
    id: "id-ID-ArdiNeural",
    name: "Ardi (Pria - Maskulin & Confident)",
    gender: "male",
    locale: "id-ID",
    style: "Confident",
    avatarMatch: "Budi",
  },
];

export interface SynthesizeRequest {
  text: string;
  voice?: string;
  avatarName?: string;
  speed?: number;
  pitch?: number;
  tone?: string;
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

/** Membersihkan teks dari emoji, simbol aneh, dan format mata uang agar dibacakan lancar oleh TTS */
export function sanitizeForLiveTTS(text: string): string {
  if (!text) return "";
  return (
    text
      // Hapus Action Tags seperti [IDLE], [EXCITED], [POINT_DOWN]
      .replace(/\[[A-Z_]+\]/gi, "")
      // Hapus Emoji Unicode
      .replace(
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
        "",
      )
      // Konversi simbol mata uang dan angka
      .replace(/Rp\s?(\d+(?:\.\d+)?(?:\,\d+)?)/gi, "$1 rupiah")
      .replace(/\$(\d+(?:\.\d+)?)/g, "$1 dollar")
      .replace(/\b(\d+)k\b/gi, "$1 ribu")
      // Ganti karakter XML khusus
      .replace(/&/g, " dan ")
      .replace(/</g, "")
      .replace(/>/g, "")
      .replace(/['"]/g, "")
      .replace(/[%]/g, " persen ")
      // Rapikan spasi ganda dan tanda baca ganda
      .replace(/[!]{2,}/g, "!")
      .replace(/[?]{2,}/g, "?")
      .replace(/[.]{2,}/g, ".")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function getToneSpeedScale(tone?: string, baseSpeed = 1.0): number {
  const t = (tone || "").toLowerCase();

  // Energetic / Live Shopping Host: cepat (+12%) → length_scale lebih kecil = lebih cepat
  if (t.includes("energet")) return Math.min(0.85, 1.0 / Math.max(baseSpeed, 1.12));

  // FOMO / Flash Sale: sangat cepat (+16%)
  if (t.includes("fomo") || t.includes("flash") || t.includes("promo"))
    return Math.min(0.80, 1.0 / Math.max(baseSpeed, 1.18));

  // Professional / Edukasi: tempo normal-sedang
  if (t.includes("profesion") || t.includes("professional") || t.includes("edukatif"))
    return 1.0;

  // Default Friendly / Casual
  return Math.min(0.90, 1.0 / Math.max(baseSpeed, 1.06));
}

/**
 * Resolve path ke Piper voice ONNX file.
 * Prioritas:
 *   1. PIPER_VOICE_MODEL env var
 *   2. ./piper_voices/<avatarName>/<gender>/<tone>.onnx  (custom voice)
 *   3. ./piper_voices/id_ID-google-medium.onnx           (default Indonesian female)
 */
function resolvePiperVoiceModel(voiceId: string, _avatarName?: string): string {
  if (process.env.PIPER_VOICE_MODEL) return process.env.PIPER_VOICE_MODEL;

  const voicesDir = path.join(__dirname, "piper_voices");

  // Map voice ID ke file onnx (bisa dikembangkan dengan lebih banyak suara)
  const voiceMap: Record<string, string> = {
    "id-ID-GadisNeural": "id_ID-google-medium.onnx",
    "id-ID-SitiNeural": "id_ID-google-medium.onnx",
    "id-ID-ArdiNeural": "id_ID-google-medium.onnx",
  };

  const filename = voiceMap[voiceId] || "id_ID-google-medium.onnx";
  return path.join(voicesDir, filename);
}

/** Synthesize teks ke WAV buffer menggunakan Piper-TTS via Python subprocess. */
async function synthesizeWithPiper(
  text: string,
  voiceId: string,
  avatarName?: string,
  lengthScale = 0.9,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cleanText = sanitizeForLiveTTS(text);
    if (!cleanText) {
      reject(new Error("Teks kosong setelah sanitasi"));
      return;
    }

    const scriptPath = path.join(__dirname, "piper_tts.py");
    const modelPath = resolvePiperVoiceModel(voiceId, avatarName);

    const python = process.env.PIPER_PYTHON || "python3";
    const args = [
      scriptPath,
      "--model", modelPath,
      "--length-scale", String(lengthScale),
    ];

    const proc = spawn(python, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));

    // Timeout 15 detik — Piper biasanya selesai dalam <2 detik untuk teks pendek
    const timeoutId = setTimeout(() => {
      proc.kill();
      reject(new Error("Piper-TTS timeout (15s)"));
    }, 15_000);

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      if (code !== 0) {
        const errMsg = Buffer.concat(errChunks).toString().trim();
        reject(new Error(`Piper-TTS gagal (exit ${code}): ${errMsg}`));
        return;
      }
      const audio = Buffer.concat(chunks);
      if (audio.length === 0) {
        reject(new Error("Piper-TTS menghasilkan output kosong"));
        return;
      }
      console.log(`[TTS] ✅ Piper-TTS berhasil (${audio.length} bytes WAV, model: ${path.basename(modelPath)})`);
      resolve(audio);
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(new Error(`Piper-TTS spawn error: ${err.message}. Pastikan python3 dan piper-tts terinstall.`));
    });

    // Tulis teks ke stdin subprocess
    proc.stdin.write(cleanText, "utf8");
    proc.stdin.end();
  });
}

function getLocalVoiceRefFallback(
  _avatarName: string,
  tone?: string,
): Buffer | null {
  const t = (tone || "").toLowerCase();
  let toneFile = "namira_energetik.mp3";
  if (t.includes("fomo")) toneFile = "namira_fomo.mp3";
  else if (t.includes("profesion") || t.includes("professional"))
    toneFile = "namira_professional.mp3";

  const searchDirs = [
    path.join(process.cwd(), "assets", "voice_refs"),
    path.join(process.cwd(), "..", "deploy", "assets", "voice_refs"),
    path.join(process.cwd(), "..", "frontend", "public", "voice-templates"),
  ];

  for (const dir of searchDirs) {
    const filePath = path.join(dir, toneFile);
    if (fs.existsSync(filePath)) {
      try {
        return fs.readFileSync(filePath);
      } catch {}
    }
  }
  return null;
}

export async function synthesizeSpeech(
  req: SynthesizeRequest,
): Promise<SynthesizeResponse> {
  const {
    text,
    avatarName = "Namira",
    speed = 1.0,
    tone,
  } = req;

  let matchedVoice =
    INDONESIAN_VOICES.find(
      (v) => v.avatarMatch.toLowerCase() === avatarName.toLowerCase(),
    ) || INDONESIAN_VOICES[1];

  if (req.voice) {
    const customVoice = INDONESIAN_VOICES.find((v) => v.id === req.voice);
    if (customVoice) matchedVoice = customVoice;
  }

  const lengthScale = getToneSpeedScale(tone, speed);
  const wordCount = text.trim().split(/\s+/).length;
  const estimatedSeconds = Math.max(
    1.5,
    Math.round((wordCount / (140 * (1 / lengthScale) / 60)) * 10) / 10,
  );

  let audioBuffer: Buffer | undefined;
  let engineUsed = "Fallback Voice Template";

  // ─── Tier 1: Piper-TTS (local / offline) ──────────────────────────────────
  try {
    audioBuffer = await synthesizeWithPiper(
      text,
      matchedVoice.id,
      avatarName,
      lengthScale,
    );
    engineUsed = "Piper TTS (id-ID offline)";
  } catch (piperErr) {
    console.warn(
      `[TTS] ⚠️  Piper-TTS gagal (Tier 1), menggunakan persona fallback template...`,
      (piperErr as Error).message,
    );

    // ─── Tier 2: Template audio lokal (static fallback) ───────────────────
    const fallbackBuffer = getLocalVoiceRefFallback(avatarName, tone);
    if (fallbackBuffer) {
      audioBuffer = fallbackBuffer;
      engineUsed = "Persona Template (Static Fallback)";
      console.warn(
        `[TTS] ⚠️  Menggunakan template suara statis — teks tidak akan sesuai audio!`,
      );
    } else {
      console.error(
        `[TTS] ❌ Semua tier TTS gagal dan tidak ada template lokal. audioBuffer=undefined.`,
      );
    }
  }

  return {
    success: true,
    voice: matchedVoice.id,
    avatar: avatarName,
    text,
    durationEstimateSeconds: estimatedSeconds,
    audioFormat: "audio/wav",
    engine: engineUsed,
    message: audioBuffer
      ? `TTS synthesis success (${engineUsed})`
      : "TTS synthesis failed — semua tier gagal",
    audioBuffer,
  };
}
