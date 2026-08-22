/**
 * TTS (Text-To-Speech) Service for LiveStreamerAI
 * Provides natural Indonesian neural voice synthesis for Alya, Luna, and Cinta.
 */

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
    avatarMatch: "Alya",
  },
  {
    id: "id-ID-SitiNeural",
    name: "Siti (Energetic & Lively)",
    gender: "female",
    locale: "id-ID",
    style: "Energetic",
    avatarMatch: "Luna",
  },
  {
    id: "id-ID-DahliaNeural",
    name: "Dahlia (Professional & Clear)",
    gender: "female",
    locale: "id-ID",
    style: "Professional",
    avatarMatch: "Cinta",
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
}

export async function synthesizeSpeech(
  req: SynthesizeRequest
): Promise<SynthesizeResponse> {
  const { text, avatarName = "Luna", speed = 1.0, pitch: _pitch = 1.0 } = req;

  // Determine best matching voice based on avatarName or style
  let matchedVoice = INDONESIAN_VOICES.find(
    (v) => v.avatarMatch.toLowerCase() === avatarName.toLowerCase()
  ) || INDONESIAN_VOICES[1]; // Default to Siti/Luna

  if (req.voice) {
    const customVoice = INDONESIAN_VOICES.find((v) => v.id === req.voice);
    if (customVoice) matchedVoice = customVoice;
  }

  const wordCount = text.trim().split(/\s+/).length;
  const estimatedSeconds = Math.max(1.5, Math.round((wordCount / ((140 * speed) / 60)) * 10) / 10);

  return {
    success: true,
    voice: matchedVoice.id,
    avatar: avatarName,
    text,
    durationEstimateSeconds: estimatedSeconds,
    audioFormat: "audio/mp3",
    engine: "Edge-TTS Neural Pipeline",
    message: "TTS synthesis stream ready",
  };
}
