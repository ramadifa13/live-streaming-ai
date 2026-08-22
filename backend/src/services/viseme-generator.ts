/**
 * Viseme Generator Service
 * Converts Indonesian spoken text into VRM/Three.js-compatible mouth blendshape viseme sequences (aa, ih, ou, ee, oh).
 */

export interface VisemeFrame {
  timeMs: number;
  viseme: "aa" | "ih" | "ou" | "ee" | "oh" | "sil";
  weight: number;
}

export interface VisemeResult {
  durationMs: number;
  visemes: VisemeFrame[];
}

/**
 * Phoneme mapping table for Indonesian vowels and consonants
 */
function charToViseme(char: string): "aa" | "ih" | "ou" | "ee" | "oh" | "sil" {
  switch (char.toLowerCase()) {
    case "a":
      return "aa";
    case "i":
      return "ih";
    case "u":
      return "ou";
    case "e":
      return "ee";
    case "o":
      return "oh";
    case "m":
    case "b":
    case "p":
      return "sil"; // Closed lips for bilabials
    case "f":
    case "v":
      return "ee";
    default:
      return "aa";
  }
}

/**
 * Generates timed viseme frames for VRM / Three.js Morph Targets from Indonesian speech text.
 */
export function generateVisemesFromText(
  text: string,
  estimatedDurationMs?: number
): VisemeResult {
  const cleanText = text.replace(/[^a-zA-Z0-9\s]/g, " ").trim();
  const words = cleanText.split(/\s+/).filter(Boolean);

  // Estimate duration if not provided (avg ~140ms per syllable)
  const totalChars = cleanText.replace(/\s+/g, "").length;
  const durationMs = estimatedDurationMs || Math.max(1200, totalChars * 75);

  const visemes: VisemeFrame[] = [];
  visemes.push({ timeMs: 0, viseme: "sil", weight: 0.0 });

  if (words.length === 0) {
    return { durationMs, visemes };
  }

  const timePerWord = durationMs / words.length;
  let currentTime = 50;

  for (const word of words) {
    const chars = word.toLowerCase().split("");
    const timePerChar = (timePerWord * 0.85) / Math.max(1, chars.length);

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      if (/[aiueo]/.test(char)) {
        const viseme = charToViseme(char);
        visemes.push({
          timeMs: Math.round(currentTime),
          viseme,
          weight: 0.85 + Math.random() * 0.15,
        });
        currentTime += timePerChar;
        // Natural transition back
        visemes.push({
          timeMs: Math.round(currentTime + timePerChar * 0.3),
          viseme,
          weight: 0.3,
        });
      } else {
        currentTime += timePerChar * 0.5;
      }
    }

    // Brief inter-word pause
    visemes.push({
      timeMs: Math.round(currentTime),
      viseme: "sil",
      weight: 0.0,
    });
    currentTime += timePerWord * 0.15;
  }

  // End with closed mouth
  visemes.push({
    timeMs: Math.round(durationMs),
    viseme: "sil",
    weight: 0.0,
  });

  return {
    durationMs,
    visemes,
  };
}
