/** Ekstraksi lokal benefits/usage/faq dari deskripsi — tanpa mengarang fakta baru. */

function splitSentences(text: string): string[] {
  if (!text?.trim()) return [];
  return text
    .split(/[.!?;\n|]+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 10 && part.length <= 180);
}

const BENEFIT_HINT =
  /\b(manfaat|kelebihan|plus|khasiat|mengurangi|menghilangkan|membantu|mencerahkan|melembapkan|tahan|awet|lembut|halus|ringan|nyaman|cocok|spf|anti|vitamin|formula|kandungan|bahan|fitur|hemat|praktis|efektif)\b/i;
const USAGE_HINT =
  /\b(cara pakai|pemakaian|pakai|gunakan|aplikasikan|oleskan|teteskan|minum|konsumsi|step|langkah|sebelum|sesudah|pagi|malam|rutin|sehari)\b/i;
const FAQ_HINT =
  /\b(berapa|harga|ongkir|kirim|cod|garansi|bpom|halal|expired|ukuran|ml|gram|isi|kemasan|varian|warna|stok)\b/i;

export function extractProductKnowledgeFromDescription(description: string): {
  benefits: string;
  usage: string;
  faq: string;
} {
  const sentences = splitSentences(description);
  const benefits: string[] = [];
  const usage: string[] = [];
  const faq: string[] = [];
  const neutral: string[] = [];

  for (const sentence of sentences) {
    if (USAGE_HINT.test(sentence)) usage.push(sentence);
    else if (BENEFIT_HINT.test(sentence)) benefits.push(sentence);
    else if (FAQ_HINT.test(sentence) || sentence.includes("?")) faq.push(sentence);
    else neutral.push(sentence);
  }

  if (benefits.length === 0 && neutral.length > 0) {
    const half = Math.ceil(neutral.length / 2);
    benefits.push(...neutral.splice(0, half));
  }
  if (usage.length === 0 && neutral.length > 0) usage.push(neutral.shift()!);
  if (faq.length === 0 && neutral.length > 0) faq.push(neutral.shift()!);
  if (benefits.length === 0 && neutral.length > 0) benefits.push(...neutral);

  return {
    benefits: benefits.join(". ").trim(),
    usage: usage.join(". ").trim(),
    faq: faq.join(". ").trim(),
  };
}

export function mergeProductKnowledge(
  description: string,
  existing: { benefits?: string; usage?: string; faq?: string },
): { benefits?: string; usage?: string; faq?: string } {
  const extracted = extractProductKnowledgeFromDescription(description);
  return {
    benefits: existing.benefits?.trim() || extracted.benefits || undefined,
    usage: existing.usage?.trim() || extracted.usage || undefined,
    faq: existing.faq?.trim() || extracted.faq || undefined,
  };
}
