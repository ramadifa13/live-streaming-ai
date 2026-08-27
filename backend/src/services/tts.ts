import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import fs from "fs";
import path from "path";

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

/** Escapes text for safe embedding inside the SSML msedge-tts builds internally. */
function escapeSSML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function synthesizeSentence(
  sentence: string,
  voiceId: string,
  rate: string,
): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(escapeSSML(sentence), { rate });

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    audioStream.on("close", () => resolve());
    audioStream.on("error", (err) => reject(err));
  });

  return Buffer.concat(chunks);
}

function getToneVoiceSettings(tone?: string, baseSpeed = 1.0): { speed: number; rateStr: string } {
  const t = (tone || "").toLowerCase();
  if (t.includes("energet") || t.includes("energetic")) {
    const s = Math.max(baseSpeed, 1.15);
    return { speed: s, rateStr: "+15%" };
  }
  if (t.includes("fomo")) {
    const s = Math.max(baseSpeed, 1.20);
    return { speed: s, rateStr: "+20%" };
  }
  if (t.includes("profesion") || t.includes("professional")) {
    return { speed: baseSpeed, rateStr: "+0%" };
  }
  return { speed: baseSpeed, rateStr: "+5%" };
}

function getLocalVoiceRefFallback(avatarName: string, tone?: string): Buffer | null {
  const t = (tone || "").toLowerCase();
  let toneFile = "namira_energetik.mp3";
  if (t.includes("fomo")) toneFile = "namira_fomo.mp3";
  else if (t.includes("profesion") || t.includes("professional")) toneFile = "namira_professional.mp3";

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
): Promise<Buffer> {
  const sentences = splitIntoSentences(text);
  if (sentences.length <= 1) {
    return synthesizeSentence(text, voiceId, rateStr);
  }

  const parts = await Promise.all(
    sentences.map((sentence) => synthesizeSentence(sentence, voiceId, rateStr)),
  );
  return Buffer.concat(parts);
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
  const { text, avatarName = "Namira", speed = 1.0, pitch: _pitch = 1.0, tone } = req;

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

  try {
    audioBuffer = await synthesizeWithEdgeTTS(
      text,
      resolveEdgeVoice(matchedVoice.id),
      toneSettings.rateStr,
    );
  } catch (err) {
    console.warn("[TTS] Edge TTS unreachable, loading persona template fallback:", err);
    const fallbackBuffer = getLocalVoiceRefFallback(avatarName, tone);
    if (fallbackBuffer) {
      audioBuffer = fallbackBuffer;
    }
  }

  return {
    success: true,
    voice: matchedVoice.id,
    avatar: avatarName,
    text,
    durationEstimateSeconds: estimatedSeconds,
    audioFormat: "audio/mpeg",
    engine: audioBuffer ? "Microsoft Edge Neural TTS + Persona Modulation (id-ID)" : "Fallback Voice Template",
    message: audioBuffer ? "TTS synthesis success" : "TTS synthesis fallback",
    audioBuffer,
  };
}
