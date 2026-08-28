import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import fs from "fs";
import path from "path";
import { getWorkerUrl } from "./runpod-manager.js";

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
    name: "Gadis (Friendly & Warm)",
    gender: "female",
    locale: "id-ID",
    style: "Friendly",
    avatarMatch: "Nana",
  },
  {
    id: "id-ID-SitiNeural",
    name: "Siti (Energetic & Lively)",
    gender: "female",
    locale: "id-ID",
    style: "Energetic",
    avatarMatch: "Namira",
  },
  {
    id: "id-ID-ArdiNeural",
    name: "Ardi (Masculine & Confident)",
    gender: "male",
    locale: "id-ID",
    style: "Confident",
    avatarMatch: "Budi",
  },
];

const EDGE_VOICE_ALIASES: Record<string, string> = {
  "id-ID-SitiNeural": "id-ID-GadisNeural",
};

function resolveEdgeVoice(voiceId: string): string {
  return EDGE_VOICE_ALIASES[voiceId] || voiceId;
}

export interface SynthesizeRequest {
  text: string;
  voice?: string;
  avatarName?: string;
  speed?: number;
  pitch?: number;
  tone?: string;
  /** podId RunPod untuk resolve URL Chatterbox TTS (port 8090) sebagai fallback Edge TTS */
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
      .replace(/["']/g, "")
      .replace(/[%]/g, " persen ")
      // Rapikan spasi ganda dan tanda baca ganda
      .replace(/[!]{2,}/g, "!")
      .replace(/[?]{2,}/g, "?")
      .replace(/[.]{2,}/g, ".")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Escapes text and inserts micro-pauses at punctuation to create natural breathing rhythm */
function escapeSSML(text: string): string {
  const clean = sanitizeForLiveTTS(text);
  return (
    clean
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
      // Sisipkan micro-pause alami di koma dan titik koma
      .replace(/,\s*/g, ", ")
      .replace(/;\s*/g, "; ")
      // Rapikan tanda seru agar intonasi berenergi
      .replace(/!\s*/g, "! ")
  );
}

function splitIntoSentences(text: string): string[] {
  const clean = sanitizeForLiveTTS(text);
  return clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function synthesizeSentence(
  sentence: string,
  voiceId: string,
  rate: string,
  pitch: string = "+4Hz",
  volume: string = "+5%",
): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

  // Kirim rate, pitch, dan volume untuk artikulasi suara manusia hidup
  const { audioStream } = tts.toStream(escapeSSML(sentence), {
    rate,
    pitch,
    volume,
  });

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    audioStream.on("close", () => resolve());
    audioStream.on("error", (err) => reject(err));
  });

  return Buffer.concat(chunks);
}

function getToneVoiceSettings(
  tone?: string,
  baseSpeed = 1.0,
): { speed: number; rateStr: string; pitchStr: string; volumeStr: string } {
  const t = (tone || "").toLowerCase();

  // Energetic / Live Shopping Host: Cepat, nada sedikit tinggi (+6Hz), antusias
  if (t.includes("energet") || t.includes("energetic")) {
    const s = Math.max(baseSpeed, 1.12);
    return { speed: s, rateStr: "+12%", pitchStr: "+6Hz", volumeStr: "+10%" };
  }

  // FOMO / Flash Sale: Cepat & mendesak, pitch naik (+8Hz)
  if (t.includes("fomo") || t.includes("flash") || t.includes("promo")) {
    const s = Math.max(baseSpeed, 1.18);
    return { speed: s, rateStr: "+16%", pitchStr: "+8Hz", volumeStr: "+15%" };
  }

  // Professional / Edukasi: Nada tenang, stabil (+2Hz), tempo sedang
  if (
    t.includes("profesion") ||
    t.includes("professional") ||
    t.includes("edukatif")
  ) {
    return {
      speed: baseSpeed,
      rateStr: "+2%",
      pitchStr: "+2Hz",
      volumeStr: "+0%",
    };
  }

  // Friendly / Santai / Persuasif (Default): Ramah, hangat, tempo luwes
  return {
    speed: Math.max(baseSpeed, 1.06),
    rateStr: "+8%",
    pitchStr: "+4Hz",
    volumeStr: "+5%",
  };
}

function getLocalVoiceRefFallback(
  avatarName: string,
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

/** Synthesizes text via the given Edge neural voice and returns MP3 bytes. */
async function synthesizeWithEdgeTTS(
  text: string,
  voiceId: string,
  rateStr: string,
  pitchStr: string = "+4Hz",
  volumeStr: string = "+5%",
): Promise<Buffer> {
  // 8s timeout — RunPod network ke Microsoft Edge TTS butuh lebih dari 3.5s
  return await Promise.race([
    (async () => {
      try {
        return await synthesizeSentence(
          text,
          voiceId,
          rateStr,
          pitchStr,
          volumeStr,
        );
      } catch (singleErr) {
        const sentences = splitIntoSentences(text);
        if (sentences.length <= 1) throw singleErr;
        // Jika teks panjang gagal, sintesis secara sekuensial
        const parts: Buffer[] = [];
        for (const sentence of sentences) {
          parts.push(
            await synthesizeSentence(
              sentence,
              voiceId,
              rateStr,
              pitchStr,
              volumeStr,
            ),
          );
        }
        return Buffer.concat(parts);
      }
    })(),
    new Promise<Buffer>((_, reject) =>
      setTimeout(
        () => reject(new Error("Edge-TTS timed out (8s limit)")),
        8000,
      ),
    ),
  ]);
}

/**
 * Fallback TTS: panggil Chatterbox-TTS-Indonesian microservice di GPU worker (port 8090).
 * Dipakai saat Edge TTS gagal karena network restriction atau timeout.
 */
async function synthesizeWithChatterbox(
  text: string,
  avatarName: string,
  tone: string,
  podId?: string | null,
): Promise<Buffer> {
  // Build URL port 8090 dari podId atau env
  const workerBase = getWorkerUrl(podId);
  // Ganti port 8000 -> 8090 untuk Chatterbox microservice
  const chatterboxUrl = workerBase
    .replace(/:8000(\/|$)/, ":8090$1")
    .replace(/(-8000)(\.proxy\.runpod)/, "-8090$2");

  const controller = new AbortController();
  // Pangkas timeout ke 6 detik untuk mencegah buffer starving di siaran live
  const timeoutId = setTimeout(() => controller.abort(), 6_000);

  try {
    const res = await fetch(`${chatterboxUrl}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        avatar: avatarName.toLowerCase(),
        tone,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Chatterbox HTTP ${res.status}: ${await res.text()}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    console.log(
      `[TTS] ✅ Chatterbox-TTS-Indonesian berhasil (${arrayBuffer.byteLength} bytes, podId=${podId ?? "local"})`,
    );
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Warms up the TTS engine so the first real request doesn't pay connection setup cost. */
export async function warmUpTTS(): Promise<void> {
  try {
    await synthesizeWithEdgeTTS("hai", "id-ID-GadisNeural", "+10%");
  } catch (err) {
    console.warn("[TTS] Edge-TTS warmup notice:", err);
  }
}

export async function synthesizeSpeech(
  req: SynthesizeRequest,
): Promise<SynthesizeResponse> {
  const {
    text,
    avatarName = "Namira",
    speed = 1.0,
    pitch: _pitch = 1.0,
    tone,
    podId,
  } = req;

  let matchedVoice =
    INDONESIAN_VOICES.find(
      (v) => v.avatarMatch.toLowerCase() === avatarName.toLowerCase(),
    ) || INDONESIAN_VOICES[1];

  if (req.voice) {
    const customVoice = INDONESIAN_VOICES.find((v) => v.id === req.voice);
    if (customVoice) matchedVoice = customVoice;
  }

  const toneSettings = getToneVoiceSettings(tone, speed);
  const wordCount = text.trim().split(/\s+/).length;
  const estimatedSeconds = Math.max(
    1.5,
    Math.round((wordCount / ((140 * toneSettings.speed) / 60)) * 10) / 10,
  );

  let audioBuffer: Buffer | undefined;
  let engineUsed = "Fallback Voice Template";

  // ─── Tier 1: Microsoft Edge Neural TTS ───────────────────────────────────
  try {
    audioBuffer = await synthesizeWithEdgeTTS(
      text,
      resolveEdgeVoice(matchedVoice.id),
      toneSettings.rateStr,
      toneSettings.pitchStr,
      toneSettings.volumeStr,
    );
    engineUsed = "Microsoft Edge Neural TTS (id-ID)";
  } catch (edgeErr) {
    console.warn(
      `[TTS] ⚠️  Edge TTS gagal (Tier 1), mencoba Chatterbox-TTS-Indonesian (Tier 2)...`,
      (edgeErr as Error).message,
    );

    // ─── Tier 2: Chatterbox-TTS-Indonesian di RunPod worker port 8090 ────────
    try {
      audioBuffer = await synthesizeWithChatterbox(
        text,
        avatarName,
        tone ?? "Persuasif",
        podId,
      );
      engineUsed = "Chatterbox-TTS-Indonesian (RunPod GPU)";
    } catch (chatterboxErr) {
      console.warn(
        `[TTS] ⚠️  Chatterbox-TTS gagal (Tier 2), menggunakan template lokal (Tier 3):`,
        (chatterboxErr as Error).message,
      );

      // ─── Tier 3: Template audio lokal (static fallback) ─────────────────
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
  }

  return {
    success: true,
    voice: matchedVoice.id,
    avatar: avatarName,
    text,
    durationEstimateSeconds: estimatedSeconds,
    audioFormat: "audio/mpeg",
    engine: engineUsed,
    message: audioBuffer
      ? `TTS synthesis success (${engineUsed})`
      : "TTS synthesis failed — semua tier gagal",
    audioBuffer,
  };
}
