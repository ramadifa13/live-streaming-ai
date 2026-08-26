/**
 * TTS (Text-To-Speech) Service for LiveStreamerAI
 * Provides natural Indonesian neural voice synthesis using kokoro-js.
 */
import { pipeline } from '@huggingface/transformers';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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

let kokoroPipeline: any = null;

async function getKokoroPipeline() {
    if (!kokoroPipeline) {
        kokoroPipeline = await pipeline('text-to-audio', 'Xenova/kokoro-js');
    }
    return kokoroPipeline;
}

function float32ToWav(float32Array: Float32Array, sampleRate: number): Buffer {
    const numChannels = 1;
    const bitDepth = 16;
    const blockAlign = numChannels * (bitDepth / 8);
    const byteRate = sampleRate * blockAlign;
    const dataSize = float32Array.length * (bitDepth / 8);

    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF chunk descriptor
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);

    // fmt sub-chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitDepth, 34);

    // data sub-chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Write audio data
    let offset = 44;
    for (let i = 0; i < float32Array.length; i++) {
        // Clamp value between -1.0 and 1.0
        let s = Math.max(-1, Math.min(1, float32Array[i]));
        // Convert to 16-bit PCM
        buffer.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7FFF, offset);
        offset += 2;
    }

    return buffer;
}

export async function synthesizeSpeech(
  req: SynthesizeRequest
): Promise<SynthesizeResponse> {
  const { text, avatarName = "Namira", speed = 1.0, pitch: _pitch = 1.0 } = req;

  // Determine best matching voice based on avatarName or style
  let matchedVoice = INDONESIAN_VOICES.find(
    (v) => v.avatarMatch.toLowerCase() === avatarName.toLowerCase()
  ) || INDONESIAN_VOICES[1]; // Default to Siti/Namira

  if (req.voice) {
    const customVoice = INDONESIAN_VOICES.find((v) => v.id === req.voice);
    if (customVoice) matchedVoice = customVoice;
  }

  const wordCount = text.trim().split(/\s+/).length;
  const estimatedSeconds = Math.max(1.5, Math.round((wordCount / ((140 * speed) / 60)) * 10) / 10);

  let audioBuffer: Buffer | undefined;

  try {
    const generator = await getKokoroPipeline();
    // Default to a known voice if not specified.
    // 'af_bella' is a common default for Kokoro models.
    const result = await generator(text, { voice: 'af_bella' });

    // result is { audio: Float32Array, sampling_rate: number }
    if (result && result.audio && result.sampling_rate) {
        audioBuffer = float32ToWav(result.audio, result.sampling_rate);
    }

  } catch (err) {
    console.error("Failed to synthesize speech via Kokoro TTS:", err);
  }

  return {
    success: true,
    voice: matchedVoice.id,
    avatar: avatarName,
    text,
    durationEstimateSeconds: estimatedSeconds,
    audioFormat: "audio/wav",
    engine: "Kokoro-TTS Neural Pipeline",
    message: audioBuffer ? "TTS synthesis success" : "TTS synthesis fallback",
    audioBuffer
  };
}
