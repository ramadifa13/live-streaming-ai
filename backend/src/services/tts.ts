import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

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
    name: "Gadis (Wanita - Paling Natural, Hangat & Ceria)",
    gender: "female",
    locale: "id-ID",
    style: "Friendly",
    avatarMatch: "Namira",
  },
  {
    id: "id-ID-SitiNeural",
    name: "Siti (Wanita - Energetik & Live Shopping)",
    gender: "female",
    locale: "id-ID",
    style: "Energetic",
    avatarMatch: "Siti",
  },
  {
    id: "id-ID-ArdiNeural",
    name: "Ardi (Pria - Tegas, Percaya Diri & Alami)",
    gender: "male",
    locale: "id-ID",
    style: "Confident",
    avatarMatch: "Ardi",
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

  // Casual / Friendly
  const calculatedRate = Math.round((baseSpeed * 1.08 - 1.0) * 100);
  return {
    rate: `${calculatedRate >= 0 ? "+" : ""}${calculatedRate}%`,
    pitch: "+2Hz",
    volume: "+8%",
  };
}

/** Synthesize speech menggunakan Microsoft Edge Neural TTS dengan prosodi natural */
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
      reject(new Error("Edge-TTS request timeout (10s)"));
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
      reject(err);
    });
  });
}

export async function synthesizeSpeech(
  req: SynthesizeRequest,
): Promise<SynthesizeResponse> {
  const { text, avatarName = "Namira", speed = 1.0, tone } = req;

  // Pilih suara Indonesia neural terbaik
  let selectedVoice = "id-ID-GadisNeural"; // Default wanita paling natural & ceria
  if (req.voice && INDONESIAN_VOICES.some((v) => v.id === req.voice)) {
    selectedVoice = req.voice;
  } else if (
    avatarName.toLowerCase().includes("budi") ||
    avatarName.toLowerCase().includes("ardi")
  ) {
    selectedVoice = "id-ID-ArdiNeural";
  }

  const wordCount = text.trim().split(/\s+/).length;
  const estimatedSeconds = Math.max(
    1.5,
    Math.round(((wordCount / ((140 * speed) / 60)) * 10)) / 10,
  );

  let audioBuffer: Buffer | undefined;
  let engineUsed = "Microsoft Edge Neural TTS (Natural Live Prosody)";

  try {
    audioBuffer = await synthesizeWithEdgeTTS(text, selectedVoice, tone, speed);
  } catch (primaryErr) {
    console.warn(
      `[TTS] ⚠️ Edge-TTS primer (${selectedVoice}) notice: ${(primaryErr as Error).message}. Mencoba fallback...`,
    );

    // Fallback ke suara neural alternatif
    try {
      selectedVoice = "id-ID-SitiNeural";
      audioBuffer = await synthesizeWithEdgeTTS(text, selectedVoice, tone, speed);
    } catch (fallbackErr) {
      console.error(
        `[TTS] ❌ Semua tier Edge-TTS gagal:`,
        (fallbackErr as Error).message,
      );
      engineUsed = "Edge-TTS Error";
    }
  }

  return {
    success: !!audioBuffer,
    voice: selectedVoice,
    avatar: avatarName,
    text,
    durationEstimateSeconds: estimatedSeconds,
    audioFormat: "audio/mpeg",
    engine: engineUsed,
    message: audioBuffer
      ? `TTS synthesis success (${engineUsed})`
      : "TTS synthesis failed — periksa koneksi internet ke Microsoft Neural TTS",
    audioBuffer,
  };
}

/** Pre-warmup connection saat backend pertama kali start */
export async function warmUpTTS(): Promise<void> {
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(
      "id-ID-GadisNeural",
      OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
    );
    console.log("[TTS] 🚀 Microsoft Edge Neural TTS engine pre-warmed & ready.");
  } catch (e) {
    console.warn("[TTS] Warmup notice:", (e as Error).message);
  }
}
