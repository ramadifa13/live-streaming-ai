
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import fs from "fs";
import path from "path";
import crypto from "crypto";

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

// Microsoft Edge only ships two real Indonesian neural voices (Gadis/female,
// Ardi/male) — "SitiNeural" doesn't exist upstream, so alias it to Gadis.
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

// Note: the free Edge "read aloud" endpoint only accepts <speak>/<voice>/<prosody>
// elements — <break>/<mstts:express-as> etc. get the connection closed early.
// So natural-sounding pauses are added by synthesizing sentence-by-sentence and
// concatenating the resulting MP3s (each utterance already carries Edge's own
// leading/trailing silence padding), instead of via unsupported SSML tags.
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

/** Synthesizes text via the given Edge neural voice and returns MP3 bytes. */
async function synthesizeWithEdgeTTS(
  text: string,
  voiceId: string,
  speed: number,
): Promise<Buffer> {
  // msedge-tts expects rate as a percentage offset, e.g. "+10%" / "-15%"
  const ratePercent = Math.round((speed - 1) * 100);
  const rate = `${ratePercent >= 0 ? "+" : ""}${ratePercent}%`;

  const sentences = splitIntoSentences(text);
  if (sentences.length <= 1) {
    return synthesizeSentence(text, voiceId, rate);
  }

  const parts = await Promise.all(
    sentences.map((sentence) => synthesizeSentence(sentence, voiceId, rate)),
  );
  return Buffer.concat(parts);
}

/** Warms up the TTS engine so the first real request doesn't pay connection setup cost. */
export async function warmUpTTS(): Promise<void> {
  try {
    await synthesizeWithEdgeTTS("hai", "id-ID-GadisNeural", 1.0);
  } catch (err) {
    console.warn("[TTS] Edge-TTS warmup notice:", err);
  }
}

export async function synthesizeSpeech(
  req: SynthesizeRequest,
): Promise<SynthesizeResponse> {
  const { text, avatarName = "Namira", speed = 1.0, pitch: _pitch = 1.0 } = req;

  // Determine best matching voice based on avatarName or style
  let matchedVoice =
    INDONESIAN_VOICES.find(
      (v) => v.avatarMatch.toLowerCase() === avatarName.toLowerCase(),
    ) || INDONESIAN_VOICES[1]; // Default to Siti/Namira

  if (req.voice) {
    const customVoice = INDONESIAN_VOICES.find((v) => v.id === req.voice);
    if (customVoice) matchedVoice = customVoice;
  }

  const wordCount = text.trim().split(/\s+/).length;
  const estimatedSeconds = Math.max(
    1.5,
    Math.round((wordCount / ((140 * speed) / 60)) * 10) / 10,
  );

  let audioBuffer: Buffer | undefined;

  try {
    audioBuffer = await synthesizeWithEdgeTTS(
      text,
      resolveEdgeVoice(matchedVoice.id),
      speed,
    );
  } catch (err) {
    console.error("Failed to synthesize speech via Edge TTS:", err);
  }

  return {
    success: true,
    voice: matchedVoice.id,
    avatar: avatarName,
    text,
    durationEstimateSeconds: estimatedSeconds,
    audioFormat: "audio/mpeg",
    engine: "Microsoft Edge Neural TTS (id-ID)",
    message: audioBuffer ? "TTS synthesis success" : "TTS synthesis fallback",
    audioBuffer,
  };
}
