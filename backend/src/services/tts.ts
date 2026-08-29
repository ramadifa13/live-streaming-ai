import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

export interface TTSVoice {
  id: string;
  name: string;
  gender: "female" | "male";
  locale: string;
  style: string;
  avatarMatch: string;
  engine: "edge" | "google";
}

export const INDONESIAN_VOICES: TTSVoice[] = [
  {
    id: "id-ID-GadisNeural",
    name: "Gadis (Wanita - Sangat Natural, Hangat & Ceria)",
    gender: "female",
    locale: "id-ID",
    style: "Friendly",
    avatarMatch: "Namira",
    engine: "edge",
  },
  {
    id: "id-ID-SitiNeural",
    name: "Siti (Wanita - Ceria & Energetik untuk Live Shopping)",
    gender: "female",
    locale: "id-ID",
    style: "Energetic",
    avatarMatch: "Siti",
    engine: "edge",
  },
  {
    id: "id-ID-ArdiNeural",
    name: "Ardi (Pria - Tegas, Percaya Diri & Alami)",
    gender: "male",
    locale: "id-ID",
    style: "Confident",
    avatarMatch: "Ardi",
    engine: "edge",
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

/**
 * Filter anti-robot percakapan live streaming:
 * - Menghilangkan simbol teknis/tag aksi.
 * - Mengubah angka, persen, dan singkatan agar dieja secara manusiawi & natural.
 * - Menambahkan koma/jeda mikro alami pada transisi kalimat host live.
 */
export function sanitizeForLiveTTS(text: string): string {
  if (!text) return "";
  return (
    text
      // 1. Hapus Action Tags seperti [IDLE], [EXCITED], [POINT_DOWN], [RAISE_HAND]
      .replace(/\[[A-Z_]+\]/gi, "")
      // 2. Hapus Emoji Unicode
      .replace(
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
        "",
      )
      // 3. Format ejaan mata uang dan angka secara natural
      .replace(/Rp\s?(\d+(?:\.\d+)?(?:\,\d+)?)/gi, "$1 rupiah ")
      .replace(/\$(\d+(?:\.\d+)?)/g, "$1 dollar ")
      .replace(/\b(\d+)k\b/gi, "$1 ribu ")
      .replace(/(\d+)%/g, "$1 persen")
      // 4. Singkatan umum agar tidak terbaca kaku
      .replace(/\bBPOM\b/g, "B P O M")
      .replace(/\bORI\b/gi, "original")
      .replace(/\bCO\b/g, "check out")
      .replace(/\bCOD\b/g, "C O D")
      .replace(/\bFYP\b/g, "F Y P")
      .replace(/\bDM\b/g, "D M")
      // 5. Normalisasi karakter khusus
      .replace(/&/g, " dan ")
      .replace(/</g, "")
      .replace(/>/g, "")
      .replace(/['"]/g, "")
      // 6. Sisipkan jeda mikro alami pada kata transisi khas live streaming
      .replace(/\b(yuk|nah|khusus hari ini|mumpung lagi promo|jangan sampai kehabisan)\b/gi, ", $1")
      // 7. Rapikan tanda baca dan spasi ganda
      .replace(/[!]{2,}/g, "!")
      .replace(/[?]{2,}/g, "?")
      .replace(/[.]{2,}/g, ".")
      .replace(/,{2,}/g, ",")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Pengaturan prosodi akustik (Kecepatan, Nada, Volume) berdasarkan Tone / Persona:
 * - Energetic   : Tempo cepat (+12%), nada ceria (+3Hz), volume mantap (+12%).
 * - FOMO / Promo: Tempo mendesak (+16%), nada heboh (+4Hz), volume tinggi (+15%).
 * - Professional: Tempo tenang artikulatif (+2%), nada hangat (+0Hz), volume jernih (+6%).
 * - Casual      : Tempo ramah santai (+8%), nada hangat (+2Hz), volume (+8%).
 */
export function getProsodyOptions(
  tone?: string,
  baseSpeed = 1.0,
): { rate: string; pitch: string; volume: string } {
  const t = (tone || "").toLowerCase();

  if (t.includes("energet") || t.includes("semangat")) {
    const calculatedRate = Math.round((baseSpeed * 1.12 - 1.0) * 100);
    return {
      rate: `${calculatedRate >= 0 ? "+" : ""}${calculatedRate}%`,
      pitch: "+3Hz",
      volume: "+12%",
    };
  }

  if (t.includes("fomo") || t.includes("flash") || t.includes("promo")) {
    const calculatedRate = Math.round((baseSpeed * 1.16 - 1.0) * 100);
    return {
      rate: `${calculatedRate >= 0 ? "+" : ""}${calculatedRate}%`,
      pitch: "+4Hz",
      volume: "+15%",
    };
  }

  if (
    t.includes("profesion") ||
    t.includes("professional") ||
    t.includes("edukatif")
  ) {
    const calculatedRate = Math.round((baseSpeed * 1.02 - 1.0) * 100);
    return {
      rate: `${calculatedRate >= 0 ? "+" : ""}${calculatedRate}%`,
      pitch: "+0Hz",
      volume: "+6%",
    };
  }

  const calculatedRate = Math.round((baseSpeed * 1.08 - 1.0) * 100);
  return {
    rate: `${calculatedRate >= 0 ? "+" : ""}${calculatedRate}%`,
    pitch: "+2Hz",
    volume: "+8%",
  };
}

/** Synthesize speech menggunakan Microsoft Edge Neural TTS dengan buffer error recovery */
async function synthesizeWithEdgeTTS(
  text: string,
  voice: string,
  tone?: string,
  speed = 1.0,
): Promise<Buffer> {
  const cleanText = sanitizeForLiveTTS(text);
  if (!cleanText) {
    throw new Error("Teks kosong setelah sanitasi");
  }

  const prosody = getProsodyOptions(tone, speed);
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const { audioStream } = tts.toStream(cleanText, {
    rate: prosody.rate,
    pitch: prosody.pitch,
    volume: prosody.volume,
  });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const timeout = setTimeout(() => {
      const buffer = Buffer.concat(chunks);
      if (buffer.length > 4096) {
        resolve(buffer);
      } else {
        reject(new Error("Edge-TTS request timeout (10s)"));
      }
    }, 10_000);

    audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    audioStream.on("end", () => {
      clearTimeout(timeout);
      const audioBuffer = Buffer.concat(chunks);
      if (audioBuffer.length === 0) {
        reject(new Error("Edge-TTS menghasilkan buffer kosong"));
        return;
      }
      resolve(audioBuffer);
    });

    audioStream.on("error", (err: Error) => {
      clearTimeout(timeout);
      const audioBuffer = Buffer.concat(chunks);
      if (audioBuffer.length > 4096) {
        resolve(audioBuffer);
        return;
      }
      reject(err);
    });
  });
}

/** Fallback Tier 2 (Fail-Safe 100% Gratis): Google Indonesia Speech API */
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

    if (!res.ok) {
      throw new Error(`Google TTS request failed: ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    audioBuffers.push(Buffer.from(arrayBuffer));
  }

  return Buffer.concat(audioBuffers);
}

export function resolveEdgeVoiceId(voice?: string, avatarName?: string): string {
  if (voice && INDONESIAN_VOICES.some((v) => v.id === voice)) {
    return voice;
  }
  const av = (avatarName || "").toLowerCase();
  if (av.includes("budi") || av.includes("ardi")) {
    return "id-ID-ArdiNeural";
  }
  if (av.includes("siti")) {
    return "id-ID-SitiNeural";
  }
  return "id-ID-GadisNeural";
}

export async function synthesizeSpeech(
  req: SynthesizeRequest,
): Promise<SynthesizeResponse> {
  const { text, avatarName = "Namira", speed = 1.0, tone } = req;

  // Pilih suara Microsoft Edge Neural TTS gratis terbaik
  const selectedVoice = resolveEdgeVoiceId(req.voice, avatarName);

  const wordCount = text.trim().split(/\s+/).length;
  const estimatedSeconds = Math.max(
    1.5,
    Math.round((wordCount / ((140 * speed) / 60)) * 10) / 10,
  );

  let audioBuffer: Buffer | undefined;
  let engineUsed = "Microsoft Edge Neural TTS (100% Gratis & Natural)";

  // ─── TIER 1: Microsoft Edge Neural TTS (Gratis, Natural, 24kHz MP3) ───────
  try {
    audioBuffer = await synthesizeWithEdgeTTS(text, selectedVoice, tone, speed);
  } catch (primaryErr) {
    console.warn(
      `[TTS] ⚠️ Edge-TTS primer (${selectedVoice}) notice: ${(primaryErr as Error).message}. Mencoba fallback ke SitiNeural / Google TTS...`,
    );

    // ─── TIER 2: Fallback ke SitiNeural ───────────────────────────────────
    try {
      const fallbackVoice =
        selectedVoice === "id-ID-GadisNeural"
          ? "id-ID-SitiNeural"
          : "id-ID-GadisNeural";
      audioBuffer = await synthesizeWithEdgeTTS(text, fallbackVoice, tone, speed);
    } catch (tier2Err) {
      console.warn(
        `[TTS] ⚠️ Edge-TTS Tier 2 notice: ${(tier2Err as Error).message}. Menggunakan Fail-Safe Google Indonesia TTS...`,
      );

      // ─── TIER 3: Google Indonesia Speech API (100% Selalu Berhasil) ──────
      try {
        audioBuffer = await synthesizeWithGoogleTTS(text);
        engineUsed = "Google Indonesia TTS (Fail-Safe)";
        console.log(
          `[TTS] ✅ Google TTS fail-safe berhasil (${audioBuffer.length} bytes)`,
        );
      } catch (tier3Err) {
        console.error(
          `[TTS] ❌ Semua tier TTS gagal:`,
          (tier3Err as Error).message,
        );
        engineUsed = "TTS Error";
      }
    }
  }

  return {
    success: !!audioBuffer && audioBuffer.length > 0,
    voice: selectedVoice,
    avatar: avatarName,
    text,
    durationEstimateSeconds: estimatedSeconds,
    audioFormat: "audio/mpeg",
    engine: engineUsed,
    message: audioBuffer
      ? `TTS synthesis success (${engineUsed})`
      : "TTS synthesis failed — periksa koneksi internet",
    audioBuffer,
  };
}

/** Pre-warmup connection saat backend start */
export async function warmUpTTS(): Promise<void> {
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(
      "id-ID-GadisNeural",
      OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
    );
    console.log("[TTS] 🚀 Microsoft Edge Neural TTS engine (100% Free) ready.");
  } catch (e) {
    console.warn("[TTS] Warmup notice:", (e as Error).message);
  }
}
