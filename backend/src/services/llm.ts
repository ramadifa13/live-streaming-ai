import { z } from "zod";
import { sanitizeForLiveTTS } from "./tts.js";
import {
  BANK_MAX_TOKENS,
  GEMINI_API_KEY,
  GROQ_API_KEY,
  PREP_EXTRA_PASS,
  PREP_LINE_TARGET,
  SCRIPT_BANK_MAX_WORDS,
  SCRIPT_BANK_MIN_WORDS,
  callLlm,
  canValidationRetry,
  getBrainBackoffMs,
  lastValidationRetryAt,
} from "./llm-providers.js";
import {
  HostResponseSchema,
  inferCtaPointAction,
  normalizeLunaAction,
  type HostIntent,
  type HostMode,
  type HostResponse,
  type LiveSalesPitchInput,
  type LiveSalesPitchOutput,
  type LunaAction,
  type LunaEmotion,
  type SalesBrainInput,
  type SalesBrainOutput,
  type VideoSalesScriptInput,
} from "./llm-types.js";

export type {
  HostIntent,
  HostMode,
  HostResponse,
  LiveSalesPitchInput,
  LiveSalesPitchOutput,
  LunaAction,
  LunaEmotion,
  SalesBrainInput,
  SalesBrainOutput,
  SpeechGestureSegment,
  VideoSalesScriptInput,
} from "./llm-types.js";

export {
  HostIntentEnum,
  HostModeEnum,
  HostResponseSchema,
  LunaActionEnum,
  LunaEmotionEnum,
  inferCtaPointAction,
  normalizeLunaAction,
  splitSpeechIntoGestureSegments,
} from "./llm-types.js";

export {
  checkLlmHealth,
  checkGroqHealth,
  checkOllamaHealth,
  getBrainBackoffMs,
  getGroqClient,
  isSelfHostedBrain,
} from "./llm-providers.js";




function cleanOutputText(text: string): string {
  if (!text) return "";
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function cleanAndExtractJson(text: string): unknown {
  const clean = cleanOutputText(text);
  if (!clean) return null;
  const firstBrace = clean.indexOf("{");
  const lastBrace = clean.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(clean.slice(firstBrace, lastBrace + 1));
    } catch {
      /* try salvage below */
    }
  }

  // Salvage truncated {"lines":[...]} — keep complete objects only.
  const linesKey = clean.indexOf('"lines"');
  if (linesKey >= 0) {
    const arrStart = clean.indexOf("[", linesKey);
    if (arrStart >= 0) {
      const objects: unknown[] = [];
      let i = arrStart + 1;
      while (i < clean.length) {
        while (i < clean.length && /[\s,]/.test(clean[i]!)) i++;
        if (clean[i] === "]") break;
        if (clean[i] !== "{") break;
        let depth = 0;
        let inStr = false;
        let esc = false;
        const start = i;
        for (; i < clean.length; i++) {
          const ch = clean[i]!;
          if (inStr) {
            if (esc) esc = false;
            else if (ch === "\\") esc = true;
            else if (ch === '"') inStr = false;
            continue;
          }
          if (ch === '"') inStr = true;
          else if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) {
              i++;
              try {
                objects.push(JSON.parse(clean.slice(start, i)));
              } catch {
                /* skip broken object */
              }
              break;
            }
          }
        }
        if (depth !== 0) break;
      }
      if (objects.length) return { lines: objects };
    }
  }
  return null;
}

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .split(" ")
      .filter((t) => t.length >= 3),
  );
}

function lexicalSimilarity(a: string, b: string): number {
  const aa = tokenSet(a);
  const bb = tokenSet(b);
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection++;
  return intersection / Math.max(1, Math.sqrt(aa.size * bb.size));
}

function hasHighPhraseOverlap(text: string, previous: string[]): boolean {
  const normalized = normalizeText(text);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 7) return false;
  const phrases = new Set<string>();
  for (let i = 0; i < words.length - 2; i++) {
    phrases.add(words.slice(i, i + 3).join(" "));
  }
  for (const prev of previous) {
    const pw = normalizeText(prev).split(" ").filter(Boolean);
    if (pw.length < 3) continue;
    let hits = 0;
    for (let i = 0; i < pw.length - 2; i++) {
      if (phrases.has(pw.slice(i, i + 3).join(" "))) hits++;
    }
    if (hits >= 2) return true;
  }
  return false;
}

function extractActionTag(text: string): { speech: string; action: LunaAction } {
  const match = text.match(/^\s*\[([A-Z_]+)\]\s*/i);
  if (!match) return { speech: text.trim(), action: "IDLE" };
  const tag = String(match[1]).toUpperCase();
  return {
    speech: text.slice(match[0].length).trim(),
    action: normalizeLunaAction(tag),
  };
}

function cleanForTts(text: string): string {
  return sanitizeForLiveTTS(extractActionTag(text).speech);
}

function buildCatalogContext(allProducts: SalesBrainInput["allProducts"]): string {
  if (!allProducts?.length) return "Tidak ada katalog tambahan.";
  return allProducts
    .slice(0, 5)
    .map((p, i) => {
      const price = typeof p.price === "number" ? `Rp${p.price.toLocaleString("id-ID")}` : p.price;
      return `${i + 1}. ${p.name} | ${price} | ${p.category || "General"} | ${p.benefits || ""}`;
    })
    .join("\n");
}

function buildHostSystemPrompt(input: SalesBrainInput): string {
  const host = input.avatarName || "Namira";
  const mode = input.requestedMode || input.mode || "ENGAGE";
  const plan = input.plan || "2H";
  const elapsed = Math.max(0, Math.round(input.elapsedMinutes || 0));
  const recentUtterances = (input.recentUtterances || []).slice(-5);
  const recentTopics = (input.recentTopics || []).slice(-5);
  const recentCTAs = (input.recentCTAs || []).slice(-4);
  const recentClaims = (input.recentClaims || []).slice(-5);

  return `Kamu adalah ${host}, AI Live Host e-commerce Indonesia yang sedang benar-benar siaran langsung.

TUJUAN:
- Terlihat seperti manusia yang sedang memperhatikan suasana live, bukan generator skrip.
- Percakapan terasa spontan, nyambung, hangat, cerdas, dan tidak looping.
- Jawab komentar terlebih dahulu bila konteksnya membutuhkan jawaban.
- Jangan memaksakan CTA di setiap respons.
- Jangan mengulang ide, opening, CTA, benefit, atau klaim yang baru saja digunakan.

GAYA:
- Bahasa Indonesia percakapan, natural, lisan, santai tapi meyakinkan.
- TANDA BACA & JEDA NAFAS: WAJIB gunakan 2–3 tanda koma (,) di jeda klausa agar ucapan host terdengar tenang, berirama, dan TIDAK TERBURU-BURU.
- Gunakan "aku", "kamu", "kita", partikel seperlunya.
- Variasikan ritme kalimat, jangan satu nafas panjang tanpa tanda baca.
- Jangan terdengar seperti membaca brosur.
- Jangan membuka dengan "Halo kak", "Halo kakak", "Halo semuanya", "Selamat datang di live", kecuali mode memang RECOVERY dan sangat perlu.
- Jangan memakai filler berulang seperti "nah", "nih", "jadi", "oke", "yuk" pada setiap respons.

MODE SESI SEKARANG: ${mode}
PAKET LIVE: ${plan}
WAKTU BERJALAN: ${elapsed} menit

PRODUK UTAMA:
Nama: ${input.productName || "Produk"}
Kategori: ${input.productCategory || "General"}
Harga: ${input.productPrice || "Harga Spesial"}
Stok: ${input.productStock ?? "Tidak diketahui"}
Deskripsi: ${input.productDescription || "Tidak ada"}
Manfaat: ${input.productBenefits || "Tidak ada"}
Cara pakai: ${input.productUsage || "Tidak ada"}
FAQ/keamanan/legalitas: ${input.productFaq || "Tidak ada"}

CATALOG:
${buildCatalogContext(input.allProducts)}

MEMORI TERAKHIR — WAJIB DIHINDARI SECARA SEMANTIK:
UTTERANCES:
${recentUtterances.map((x, i) => `${i + 1}. ${x}`).join("\n") || "-"}
TOPICS:
${recentTopics.join(" | ") || "-"}
CTA TERAKHIR:
${recentCTAs.join(" | ") || "-"}
CLAIMS TERAKHIR:
${recentClaims.join(" | ") || "-"}
PHRASES YANG DIHINDARI:
${(input.avoidPhrases || []).slice(-6).join(" | ") || "-"}
TOPIK YANG DIHINDARI:
${(input.avoidTopics || []).slice(-5).join(" | ") || "-"}

ATURAN FAKTA:
- Hanya nyatakan fakta yang ada di data produk/konteks.
- Jangan mengarang BPOM, halal, teruji klinis, garansi, original, COD, gratis ongkir, stok, jumlah pembeli, viral, repeat order, atau hasil pemakaian.
- Jika fakta tidak tersedia, katakan secara natural bahwa host perlu cek detailnya; jangan mengarang.
- Jangan menyebut kota, nama pembeli, atau aktivitas checkout bila tidak diberikan oleh event system.

ATURAN INTERAKSI:
- Jika komentar berupa pujian/obrolan santai: balas sebagai manusia; CTA opsional dan biasanya NONE.
- Jika pertanyaan produk: jawab inti pertanyaan dulu, CTA hanya bila relevan.
- Jika buying intent: fokus membantu keputusan pembelian.
- Jika objection: akui keraguan, jawab fakta yang tersedia, jangan defensif.
- Jika spam/duplikat: abaikan atau gabungkan, jangan menjawab berulang.
- Jika komentar membutuhkan klarifikasi yang tidak tersedia: minta penonton memberi detail seperlunya.

ANTI-LOOP:
- Jangan mengulang kalimat dengan sinonim tipis.
- Jangan mengulang topik yang sama hanya karena prompt berubah.
- Jangan mengulang CTA yang sama dua kali berturut-turut.
- Jangan menyebut benefit yang baru saja disebut kecuali komentar memang menanyakannya lagi.
- Jangan menggunakan struktur kalimat yang sama seperti 1–2 respons terakhir.

GERAKAN AVATAR (action):
- Hanya IDLE. Body clip dipilih worker dari idle / talk / talk_2 / talk_3.
- Jangan keluarkan POINT_UP, POINT_DOWN, WAVE, RAISE_HAND, NOD, LAUGH, THINK, TALK_EXPRESSIVE.

OUTPUT:
Kembalikan SATU JSON murni, tanpa markdown, dengan schema:
{
  "speech": "kalimat yang benar-benar diucapkan host",
  "action": "IDLE",
  "emotion": "happy|neutral|surprised|thinking|warm|excited|empathetic",
  "intent": "ANSWER|PRODUCT_INFO|PRICE|BUYING_INTENT|OBJECTION|SOCIAL|THANKS|COMPLAINT|ANNOUNCEMENT|SELL|SPAM|OTHER",
  "mode": "ENGAGE|SELL|QNA|DEMO|OBJECTION|SOCIAL|ANNOUNCEMENT|RECOVERY|CLOSING",
  "topic": "label pendek topic respons",
  "ctaType": "NONE|SOFT|DIRECT|PRICE|PRODUCT|COMMENT",
  "target_product_id": null,
  "interruptible": true,
  "claims": []
}

Panjang speech: WAJIB 19–23 kata dengan 2–3 tanda koma (,) agar ritme pas ~9 detik dan tidak terburu-buru untuk klip video 10 detik (audio tidak terpotong dan host tidak ada idle). Komentar balasan 9–14 kata. Kalimat harus utuh, tuntas, ada jeda artikulasi, dan alami. Jangan membuat kalimat tanpa tanda koma atau terlalu panjang/pendek. Jangan menambahkan salam pembuka robotik.`;
}

function inferIntentFromText(text: string): HostIntent {
  const q = normalizeText(text);
  if (!q) return "OTHER";
  if (/^(wkwk|haha|hehe|lol|bagus|cantik|ganteng|keren|suka)/i.test(q)) return "SOCIAL";
  if (/harga|berapa|rupiah|diskon|promo/.test(q)) return "PRICE";
  if (/beli|checkout|order|pesan|ambil|ready|stok/.test(q)) return "BUYING_INTENT";
  if (/kenapa|takut|ragu|mahal|beda|cocok|aman|boleh|worth/.test(q)) return "OBJECTION";
  if (/cara|pakai|fungsi|manfaat|buat apa|bedanya|isi|ukuran|warna/.test(q)) return "PRODUCT_INFO";
  return "ANSWER";
}

function fallbackResponse(input: SalesBrainInput): HostResponse {
  const product = input.productName || "produk ini";
  const price = input.productPrice || "harga live";
  const benefits = input.productBenefits || "detail manfaatnya bisa kita lihat dari info produk";
  const intent = input.requestedIntent || inferIntentFromText(input.userQuestion);

  const candidates: HostResponse[] = [
    {
      speech: `Aku tangkep pertanyaannya... soal ${product}, ${benefits.split(/[.!?]/)[0] || "detail produknya"}. Untuk harga saat ini, patokannya ${price}; detail yang belum tertulis di data produk jangan aku tebak-tebak ya.`,
      action: "IDLE",
      emotion: "thinking",
      intent,
      mode: "QNA",
      topic: "klarifikasi produk",
      ctaType: "NONE",
      target_product_id: null,
      interruptible: true,
      claims: [],
    },
    {
      speech: `Yang ini enaknya memang dilihat dari kebutuhannya dulu... kalau kamu lagi cari ${product}, bagian yang paling menonjol itu ${benefits.split(/[.!?]/)[0] || "fiturnya"}. Jadi jangan sekadar ikut ramai, pilih yang memang kepakai buat kamu.`,
      action: "IDLE",
      emotion: "warm",
      intent: intent === "SOCIAL" ? "PRODUCT_INFO" : intent,
      mode: "ENGAGE",
      topic: "value produk",
      ctaType: "SOFT",
      target_product_id: null,
      interruptible: true,
      claims: [],
    },
    {
      speech: `Oke, aku jawab dari info yang memang kita punya ya... ${product} harganya ${price}. Kalau pertanyaannya soal kecocokan atau detail spesifik, kasih konteks sedikit biar aku jawabnya tepat, bukan asal nebak.`,
      action: "IDLE",
      emotion: "empathetic",
      intent: "ANSWER",
      mode: "QNA",
      topic: "jawaban kontekstual",
      ctaType: "NONE",
      target_product_id: null,
      interruptible: true,
      claims: [],
    },
  ];

  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index] || candidates[0]!;
}

function selectSafeParsedResponse(parsed: unknown, input: SalesBrainInput): HostResponse | null {
  const validated = HostResponseSchema.safeParse(parsed);
  if (!validated.success) return null;

  const response = validated.data;
  response.action = "IDLE";
  const knownProductIds = new Set([...(input.allProducts || []).map((p) => String(p.id))]);
  if (response.target_product_id && knownProductIds.size > 0 && !knownProductIds.has(response.target_product_id)) {
    response.target_product_id = null;
  }
  const prior = input.recentUtterances || [];
  const topic = normalizeText(response.topic);
  const avoidTopic = (input.avoidTopics || []).some((x) => normalizeText(x) === topic);

  if (avoidTopic) return null;
  if (lexicalSimilarity(response.speech, prior[prior.length - 1] || "") > 0.84) {
    return null;
  }
  if (hasHighPhraseOverlap(response.speech, prior)) return null;

  const lowerSpeech = normalizeText(response.speech);
  const forbiddenClaimPatterns = [
    /teruji klinis/,
    /bpom/,
    /halal/,
    /100 persen original/,
    /100% original/,
    /garansi resmi/,
    /gratis ongkir/,
    /cod ke seluruh indonesia/,
    /ribuan pembeli/,
    /viral/,
    /repeat order/,
  ];
  const faq = normalizeText(input.productFaq || "");
  const description = normalizeText(input.productDescription || "");
  const known = `${faq} ${description} ${normalizeText(input.productBenefits || "")} ${normalizeText(input.productUsage || "")}`;
  for (const pattern of forbiddenClaimPatterns) {
    const match = pattern.test(lowerSpeech);
    if (match && !pattern.test(known)) return null;
  }

  return {
    ...response,
    speech: cleanForTts(response.speech),
  };
}

async function generateValidatedHostResponse(
  hostInput: SalesBrainInput,
  userQuestion: string,
  userPromptSuffix: string,
): Promise<HostResponse | null> {
  const systemPrompt = buildHostSystemPrompt(hostInput);
  const userPrompt = `EVENT LIVE TERKINI:\n${userQuestion}\n\n${userPromptSuffix}`;
  const callOpts = { sessionId: hostInput.sessionId };

  const provider = await callLlm(`${systemPrompt}\n\n${userPrompt}`, callOpts);
  const parsed = cleanAndExtractJson(provider.text);
  const response = selectSafeParsedResponse(parsed, hostInput);
  if (response) return response;

  if (!canValidationRetry(hostInput.sessionId)) return null;

  lastValidationRetryAt.set(hostInput.sessionId || "_global", Date.now());
  const retryPrompt = `${systemPrompt}\n\nREGENERATE. RESPONS SEBELUMNYA TIDAK LOLOS VALIDASI.\nEVENT: ${userQuestion}\nBuat pendekatan yang berbeda secara nyata dari memori terakhir.`;
  const retry = await callLlm(retryPrompt, callOpts);
  const retryParsed = cleanAndExtractJson(retry.text);
  return selectSafeParsedResponse(retryParsed, hostInput);
}

export async function generateHostResponse(input: SalesBrainInput): Promise<HostResponse> {
  const hostInput: SalesBrainInput = {
    ...input,
    requestedIntent: input.requestedIntent || inferIntentFromText(input.userQuestion),
    requestedMode: input.requestedMode || input.mode || "ENGAGE",
  };

  try {
    const response = await generateValidatedHostResponse(
      hostInput,
      input.userQuestion,
      "Pilih respons yang paling relevan terhadap event ini. Jangan mengarang fakta.",
    );
    if (response) return response;
  } catch (err: any) {
    console.warn(`[LLM] generateHostResponse error: ${err?.message || err}`);
  }

  return fallbackResponse(hostInput);
}

export async function generateDynamicSalesResponse(input: SalesBrainInput): Promise<SalesBrainOutput> {
  const hostInput: SalesBrainInput = {
    ...input,
    requestedIntent: input.requestedIntent || inferIntentFromText(input.userQuestion),
    requestedMode: input.requestedMode || input.mode || "ENGAGE",
  };

  try {
    const response = await generateValidatedHostResponse(
      hostInput,
      input.userQuestion,
      "Jangan mengulang respons lama. Jawab berdasarkan fakta yang tersedia dan suasana live saat ini.",
    );
    if (response) {
      return {
        replyText: response.speech,
        engineUsed: "live-brain",
        intent: response.intent,
        action: response.action,
      };
    }
  } catch (err: any) {
    console.warn(`[LLM] generation error: ${err?.message || err}`);
  }

  const fallback = fallbackResponse(hostInput);
  return {
    replyText: fallback.speech,
    engineUsed: "stateful-fallback",
    intent: fallback.intent,
    action: fallback.action,
  };
}

export const generateDynamicSalesResponseGroq = generateDynamicSalesResponse;
export const generateDynamicSalesResponseGemini = generateDynamicSalesResponse;

const ScriptBankLineSchema = HostResponseSchema.extend({
  speech: z.string().min(20),
});

export async function generateScriptBankLines(input: SalesBrainInput): Promise<HostResponse[]> {
  const systemPrompt = buildHostSystemPrompt(input);
  const lineTarget = Math.max(1, Number(process.env.LIVE_LLM_BATCH_SIZE || process.env.LIVE_SCRIPT_BANK_LLM_LINES || 30));
  const prompt = `${systemPrompt}

TUGAS: buat tepat ${lineTarget} ucapan host otonom yang BERBEDA dan NATURAL, menggunakan bahasa Indonesia lisan yang jelas dan sopan.
Gunakan tepat ${SCRIPT_BANK_MIN_WORDS}–${SCRIPT_BANK_MAX_WORDS} kata per baris agar durasi bicara tetap ideal sekitar 8,5–9,5 detik pada TTS speed normal.
Setiap baris harus selesai dalam satu napas/utterance; jangan membuat paragraf atau dua kalimat panjang yang perlu dipotong.
HINDARI bahasa gaul berlebihan dan istilah bahasa Inggris; gunakan padanan bahasa Indonesia untuk checkout, live, review, guys, simple, worth, join, stay, budget, dan FOMO.
Tulis harga dengan format rupiah yang mudah dibaca, misalnya "Rp25.000", dan jangan menulis simbol atau singkatan yang sulit diucapkan.
LARANG frasa kaku berulang: "dari data produk", "yang tertulis", "aku nggak nebak", "patokannya".
Jangan mengarang fakta. Campur topik: benefit, how_to_use, value, social, objection, micro_tip, reframe, use_case, promo_pitch, filler.
Setiap baris harus beda angle/pembuka — jangan parafrase ulang baris sebelumnya.
Kembalikan JSON murni:
{"lines":[{ "speech":"", "action":"IDLE", "emotion":"warm", "intent":"SELL", "mode":"ENGAGE", "topic":"", "ctaType":"NONE", "target_product_id":null, "interruptible":true, "claims":[] }]}`;

  try {
    const result = await callLlm(prompt, {
      sessionId: input.sessionId,
      maxTokens: BANK_MAX_TOKENS,
    });
    const parsed = cleanAndExtractJson(result.text) as { lines?: unknown } | unknown[] | null;
    const rawLines = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { lines?: unknown })?.lines)
        ? (parsed as { lines: unknown[] }).lines
        : [];
    const accepted: HostResponse[] = [];
    let rejected = 0;
    for (const item of rawLines) {
      const validated = ScriptBankLineSchema.safeParse(item);
      if (!validated.success) {
        rejected += 1;
        continue;
      }
      const safe = selectSafeParsedResponse(validated.data, input);
      if (!safe) {
        rejected += 1;
        continue;
      }
      safe.speech = sanitizeForLiveTTS(safe.speech);
      let words = safe.speech.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
      // Clamp instead of discard — strict reject was returning empty banks (llm=0).
      if (words.length < SCRIPT_BANK_MIN_WORDS) {
        rejected += 1;
        continue;
      }
      if (words.length > SCRIPT_BANK_MAX_WORDS) {
        words = words.slice(0, SCRIPT_BANK_MAX_WORDS);
      }
      safe.speech = words.join(" ").replace(/[,;:!?-]+$/g, "") + ".";
      accepted.push(safe);
    }
    if (!accepted.length) {
      console.warn(
        `[LLM] generateScriptBankLines empty raw=${rawLines.length} rejected=${rejected} words=${SCRIPT_BANK_MIN_WORDS}-${SCRIPT_BANK_MAX_WORDS} preview=${String(result.text || "").slice(0, 180)}`,
      );
    } else {
      console.log(`[LLM] bank fill count=${accepted.length} rejected=${rejected} target=${lineTarget}`);
    }
    return accepted;
  } catch (err: any) {
    console.warn(`[LLM] generateScriptBankLines: ${err?.message || err}`);
    return [];
  }
}

export function liveBrainDuringLive(): boolean {
  return (process.env.LIVE_LLM_DURING_LIVE || process.env.LIVE_BRAIN_DURING_LIVE) === "1";
}

export function liveBrainCommentWhenNeeded(): boolean {
  return (process.env.LIVE_LLM_COMMENT_WHEN_NEEDED || process.env.LIVE_BRAIN_COMMENT_WHEN_NEEDED) !== "0";
}

export function liveBrainRefillWhenLow(): boolean {
  return (process.env.LIVE_LLM_REFILL_WHEN_LOW || process.env.LIVE_BRAIN_REFILL_WHEN_LOW) !== "0";
}

export function liveBrainRefillOnExhaust(): boolean {
  return (process.env.LIVE_LLM_REFILL_ON_EXHAUST || process.env.LIVE_BRAIN_REFILL_ON_EXHAUST) !== "0";
}

/** Remaining lines at/below this triggers LLM refill (default 8). */
export function liveLlmRefillAt(): number {
  return Math.max(1, Number(process.env.LIVE_LLM_REFILL_AT || 8));
}

export function liveLlmBatchSize(): number {
  return Math.max(1, Number(process.env.LIVE_LLM_BATCH_SIZE || process.env.LIVE_SCRIPT_BANK_LLM_LINES || 30));
}

const StructuredBankSchema = z.object({
  enriched: z
    .object({
      benefits: z.string().optional(),
      usage: z.string().optional(),
      faq: z.string().optional(),
      targetAudience: z.string().optional(),
      copywriting: z.string().optional(),
    })
    .optional(),
  faqPack: z
    .array(
      z.object({
        category: z.string(),
        triggers: z.array(z.string()).min(3),
        answers: z.array(z.string()).min(2),
      }),
    )
    .optional(),
  lines: z
    .array(
      z.object({
        speech: z.string().min(8),
        topic: z.string().optional(),
        mode: z.string().optional(),
        intent: z.string().optional(),
        ctaType: z.string().optional(),
        action: z.string().optional(),
        emotion: z.string().optional(),
      }),
    )
    .optional(),
  promoPitch: z.array(z.string()).optional(),
  filler: z.array(z.string()).optional(),
  productBridge: z.array(z.string()).optional(),
  fallback: z
    .object({
      outOfTopic: z.array(z.string()).optional(),
      soldOut: z.array(z.string()).optional(),
      troll: z.array(z.string()).optional(),
    })
    .optional(),
});

function mapTopicMode(topic: string): { topic: string; mode: HostMode; intent?: HostIntent; ctaType?: string } {
  const t = topic.toLowerCase();
  if (t.includes("promo") || t.includes("pitch")) return { topic: "promo_pitch", mode: "SELL", ctaType: "SOFT" };
  if (t.includes("filler")) return { topic: "filler", mode: "ENGAGE", intent: "SOCIAL" };
  if (t.includes("banner")) return { topic: "banner_callout", mode: "ENGAGE", intent: "SOCIAL" };
  if (t.includes("bridge") || t.includes("transisi")) return { topic: "catalog_bridge", mode: "SELL" };
  if (t.includes("sold")) return { topic: "sold_out", mode: "SELL", intent: "ANNOUNCEMENT" };
  if (t.includes("troll") || t.includes("spam") || t.includes("out")) return { topic: "deflection", mode: "SOCIAL", intent: "SOCIAL" };
  if (t.includes("faq") || t.includes("qna")) return { topic: "faq", mode: "QNA", intent: "PRODUCT_INFO" };
  if (t.includes("usage") || t.includes("pakai")) return { topic: "how_to_use", mode: "DEMO", intent: "PRODUCT_INFO" };
  return { topic: topic || "benefit", mode: "ENGAGE" };
}

export async function prepareProductScriptPack(input: {
  name: string;
  price?: string | number;
  category?: string;
  description?: string;
  benefits?: string;
  usage?: string;
  faq?: string;
  stock?: number;
  sku?: string;
  link?: string;
  targetAudience?: string;
  copywriting?: string;
  bannerImage?: string;
  avatarName?: string;
  tone?: string;
}): Promise<{
  lines: HostResponse[];
  engine: "local" | "live-brain";
  count: number;
  enriched: {
    benefits?: string;
    usage?: string;
    faq?: string;
    targetAudience?: string;
    copywriting?: string;
  };
  faqPack: Array<{ category: string; triggers: string[]; answers: string[] }>;
}> {
  const priceDisplay =
    input.price == null ? "Harga live" : typeof input.price === "number" ? `Rp${input.price.toLocaleString("id-ID")}` : String(input.price);

  const { seedLocalScriptBank, emptyScriptBank, mergeScriptLines, buildDefaultFaqPack, faqAnswerLines, mergeProductKnowledge } =
    await import("./live-script-bank.js");

  const category =
    input.category && input.category !== "Lainnya" && input.category !== "General" && input.category !== "Umum" ? input.category : "Umum";

  const knowledge = mergeProductKnowledge(input.description || "", {
    benefits: input.benefits,
    usage: input.usage,
    faq: input.faq,
  });

  const factsBase = {
    id: "prepare",
    name: input.name,
    price: priceDisplay,
    category,
    benefits: knowledge.benefits,
    description: input.description || "",
    usage: knowledge.usage,
    faq: knowledge.faq,
    stock: input.stock,
    copywriting: input.copywriting || "",
    targetAudience: input.targetAudience || "",
    hasBanner: Boolean(input.bannerImage?.trim()),
  };

  const needOptional =
    !input.benefits?.trim() || !input.usage?.trim() || !input.faq?.trim() || !input.targetAudience?.trim() || !input.copywriting?.trim();

  let enriched: {
    benefits?: string;
    usage?: string;
    faq?: string;
    targetAudience?: string;
    copywriting?: string;
  } = {};
  let faqPack = buildDefaultFaqPack(factsBase);
  let llmLines: HostResponse[] = [];
  let engine: "local" | "live-brain" = "local";

  const systemRules = `Kamu penulis naskah host live TikTok/Shopee (Bahasa Indonesia kasual, natural, antusias).
Wajib:
- Sapaan natural (Kak/Guys/Bestie) TIDAK di setiap baris; campur tanpa sapaan.
- Speech 6.5–9.0 detik (14–20 kata, SELALU di bawah 10 detik pas dengan durasi 10 detik video host), kalimat utuh dan lengkap tanpa terpotong, suara natural 1.0x, JANGAN kaku/robot dan JANGAN kepanjangan.
- LARANG frasa robotik berulang seperti "dari data produk", "yang tertulis", "aku nggak nebak", "patokannya".
- JANGAN mengarang klaim medis/legal/garansi/testimoni palsu.
- Field enriched HANYA diisi bila input kosong; isi HANYA dengan memparafrase/mengekstrak dari Deskripsi (+Manfaat/Cara pakai jika ada). DILARANG menambah fakta baru di luar input.
- Jika ada banner overlay di siaran, boleh sebutkan banner atas/bawah secara natural (1-2 baris), jangan berulang.`;

  const prompt = `${systemRules}

INPUT PRODUK:
Nama: ${input.name}
Kategori: ${category}
Harga: ${priceDisplay}
Stok: ${input.stock ?? 0}
Deskripsi: ${input.description || "-"}
Manfaat (opsional): ${input.benefits || "(kosong — isi enriched.benefits dari deskripsi saja)"}
Cara pakai (opsional): ${input.usage || "(kosong — isi enriched.usage dari deskripsi saja bila masuk akal)"}
FAQ seller (opsional): ${input.faq || "(kosong)"}
Target audience (opsional): ${input.targetAudience || "(kosong)"}
Copywriting (opsional): ${input.copywriting || "(kosong)"}
Banner overlay di live: ${factsBase.hasBanner ? "ADA (atas + bawah host, opsional disebut)" : "TIDAK ADA"}

Kembalikan JSON murni:
{
  "enriched": { "benefits": "", "usage": "", "faq": "", "targetAudience": "", "copywriting": "" },
  "faqPack": [
    { "category": "harga|manfaat|cara_pakai|pengiriman", "triggers": ["7-10 sinonim"], "answers": ["3 jawaban natural"] }
  ],
  "promoPitch": ["5 pitch Hook+USP+harga+CTA lembut — tiap pitch beda angle"],
  "filler": ["5 kalimat filler 3-5 detik — beda nada"],
  "productBridge": ["3 jembatan multi-produk"],
  "fallback": { "outOfTopic": ["2"], "soldOut": ["2"], "troll": ["2"] },
  "lines": [{ "speech":"", "topic":"benefit|how_to_use|value|social_engagement|objection|faq|promo_pitch|filler|banner_callout|micro_tip|use_case|reframe|mini_story|price_context", "mode":"ENGAGE|SELL|DEMO|QNA|SOCIAL|OBJECTION", "intent":"SELL|PRODUCT_INFO|SOCIAL|PRICE", "ctaType":"NONE|SOFT|PRICE" }]
}
Minimal ${PREP_LINE_TARGET} item di lines (variasi topik & pembuka, jangan mirip). promoPitch 5, filler 5, productBridge 3. ${needOptional ? "Isi enriched untuk field yang kosong." : "enriched boleh string kosong."}
${factsBase.hasBanner ? 'Sertakan 1 baris topic "banner_callout".' : "Jangan sebut banner."}`;

  const llmEnabled = process.env.LIVE_BRAIN_PREPARE_PRODUCT_LLM !== "0";
  const brainReady = getBrainBackoffMs() === 0 && (GROQ_API_KEY || GEMINI_API_KEY);

  try {
    if (!llmEnabled || !brainReady) {
      throw new Error("LLM prepare-product dilewati (cooldown atau LIVE_BRAIN_PREPARE_PRODUCT_LLM=0)");
    }
    const result = await callLlm(prompt, {
      maxTokens: BANK_MAX_TOKENS,
      groqOnly: true,
    });
    const parsedRaw = cleanAndExtractJson(result.text);
    const parsed = StructuredBankSchema.safeParse(parsedRaw);
    if (parsed.success) {
      engine = "live-brain";
      const data = parsed.data;
      if (data.enriched) {
        enriched = {
          benefits: !input.benefits?.trim() && (data.enriched as any).benefits?.trim?.() ? String((data.enriched as any).benefits).trim() : undefined,
          usage: !input.usage?.trim() && (data.enriched as any).usage?.trim?.() ? String((data.enriched as any).usage).trim() : undefined,
          faq: !input.faq?.trim() && data.enriched.faq?.trim() ? data.enriched.faq.trim() : undefined,
          targetAudience: !input.targetAudience?.trim() && data.enriched.targetAudience?.trim() ? data.enriched.targetAudience.trim() : undefined,
          copywriting: !input.copywriting?.trim() && data.enriched.copywriting?.trim() ? data.enriched.copywriting.trim() : undefined,
        };
      }
      if (data.faqPack?.length) {
        faqPack = data.faqPack.map((item) => ({
          category: item.category,
          triggers: item.triggers.slice(0, 12),
          answers: item.answers.slice(0, 5),
        }));
      }

      const pushSpeech = (speech: string, topic: string) => {
        const meta = mapTopicMode(topic);
        llmLines.push({
          speech,
          action: inferCtaPointAction(speech, meta.topic),
          emotion: "warm",
          intent: (meta.intent as HostIntent) || "SELL",
          mode: meta.mode,
          topic: meta.topic,
          ctaType: (meta.ctaType as any) || "NONE",
          target_product_id: null,
          interruptible: true,
          claims: [],
        });
      };

      for (const speech of data.promoPitch || []) pushSpeech(speech, "promo_pitch");
      for (const speech of data.filler || []) pushSpeech(speech, "filler");
      for (const speech of data.productBridge || []) pushSpeech(speech, "catalog_bridge");
      for (const speech of data.fallback?.outOfTopic || []) pushSpeech(speech, "deflection");
      for (const speech of data.fallback?.soldOut || []) pushSpeech(speech, "sold_out");
      for (const speech of data.fallback?.troll || []) pushSpeech(speech, "deflection");
      for (const item of data.lines || []) {
        const meta = mapTopicMode(item.topic || "benefit");
        const fromItem = normalizeLunaAction(item.action);
        llmLines.push({
          speech: item.speech,
          action: fromItem !== "IDLE" ? fromItem : inferCtaPointAction(item.speech, meta.topic),
          emotion: (item.emotion as any) || "warm",
          intent: (item.intent as HostIntent) || meta.intent || "SELL",
          mode: (item.mode as HostMode) || meta.mode,
          topic: meta.topic,
          ctaType: (item.ctaType as any) || meta.ctaType || "NONE",
          target_product_id: null,
          interruptible: true,
          claims: [],
        });
      }

      if (PREP_EXTRA_PASS && llmLines.length >= 10) {
        const existingTopics = [...new Set(llmLines.map((l) => l.topic).filter(Boolean))].join(", ");
        const extraPrompt = `${systemRules}

PRODUK: ${input.name} (${category}) — ${priceDisplay}
Sudah ada ${llmLines.length} baris dengan topik: ${existingTopics}.
Buat 14–18 baris TAMBAHAN yang BEDA angle, pembuka, dan topik — jangan parafrase ulang.
Fokus topik yang belum banyak: micro_tip, use_case, reframe, mini_story, price_context, comparison, buyer_fit.
Kembalikan JSON murni: {"lines":[{ "speech":"", "topic":"", "mode":"ENGAGE|SELL|DEMO|QNA|SOCIAL|OBJECTION", "intent":"SELL|PRODUCT_INFO|SOCIAL|PRICE", "ctaType":"NONE|SOFT|PRICE" }]}`;

        try {
          const extraResult = await callLlm(extraPrompt, {
            maxTokens: BANK_MAX_TOKENS,
            groqOnly: true,
          });
          const extraRaw = cleanAndExtractJson(extraResult.text) as { lines?: unknown } | null;
          const extraLines = Array.isArray(extraRaw?.lines) ? extraRaw.lines : [];
          for (const item of extraLines) {
            const row = item as {
              speech?: string;
              topic?: string;
              mode?: string;
              intent?: string;
              ctaType?: string;
              emotion?: string;
            };
            if (!row.speech || row.speech.length < 8) continue;
            const meta = mapTopicMode(row.topic || "benefit");
            llmLines.push({
              speech: row.speech,
              action: inferCtaPointAction(row.speech, meta.topic),
              emotion: (row.emotion as any) || "warm",
              intent: (row.intent as HostIntent) || meta.intent || "SELL",
              mode: (row.mode as HostMode) || meta.mode,
              topic: meta.topic,
              ctaType: (row.ctaType as any) || meta.ctaType || "NONE",
              target_product_id: null,
              interruptible: true,
              claims: [],
            });
          }
        } catch (extraErr: any) {
          console.warn(`[LLM] prepareProductScriptPack extra pass: ${extraErr?.message || extraErr}`);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[LLM] prepareProductScriptPack LLM: ${err?.message || err}`);
  }

  const facts = {
    ...factsBase,
    benefits: enriched.benefits || knowledge.benefits || input.benefits || "",
    usage: enriched.usage || knowledge.usage || input.usage || "",
    faq: enriched.faq || knowledge.faq || input.faq || "",
    copywriting: enriched.copywriting || input.copywriting || "",
    targetAudience: enriched.targetAudience || input.targetAudience || "",
    faqPack,
  };

  const bank = emptyScriptBank("prepare");
  mergeScriptLines(bank, seedLocalScriptBank(facts, []), []);
  mergeScriptLines(bank, faqAnswerLines(faqPack), []);
  mergeScriptLines(bank, llmLines, []);

  return {
    lines: bank.lines,
    engine: llmLines.length > 0 || engine === "live-brain" ? "live-brain" : "local",
    count: bank.lines.length,
    enriched: {
      benefits: enriched.benefits || knowledge.benefits || input.benefits || undefined,
      usage: enriched.usage || knowledge.usage || input.usage || undefined,
      faq: enriched.faq || knowledge.faq || input.faq || undefined,
      targetAudience: enriched.targetAudience || input.targetAudience || undefined,
      copywriting: enriched.copywriting || input.copywriting || undefined,
    },
    faqPack,
  };
}



export async function generateLiveSalesPitchFromAI(input: LiveSalesPitchInput): Promise<LiveSalesPitchOutput> {
  const price = input.productPrice || "Harga Spesial";
  const stock = input.productStock ?? 0;
  const category = input.productCategory || input.category || "General";

  const result = await generateDynamicSalesResponse({
    userQuestion: `Buat satu segmen selling yang terdiri dari hook singkat, showcase manfaat, lalu CTA ringan untuk ${input.productName}. Jangan memakai salam kaku.`,
    avatarName: input.avatarName,
    tone: input.tone,
    productName: input.productName,
    productPrice: price,
    productCategory: category,
    productDescription: input.productDescription,
    productBenefits: input.productBenefits,
    productUsage: input.productUsage,
    productFaq: input.productFaq,
    productStock: stock,
    allProducts: input.allProducts,
    requestedIntent: "SELL",
    requestedMode: "SELL",
  });

  const script = cleanForTts(result.replyText);
  const sentences = script
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const hook = sentences.slice(0, 1).join(" ") || script;
  const cta = sentences.slice(-1).join(" ") || script;
  const showcase = sentences.slice(1, -1).join(" ") || script;

  return {
    productName: input.productName,
    price,
    stock,
    category,
    avatarName: input.avatarName || "Namira",
    tone: input.tone || "Persuasif",
    hook,
    showcase,
    cta,
    fullScript: [hook, showcase, cta].filter(Boolean).join("\n\n"),
  };
}

export const generateLiveSalesPitchFromAIGroq = generateLiveSalesPitchFromAI;
export const generateLiveSalesPitchFromAIGemini = generateLiveSalesPitchFromAI;

export async function generateVideoSalesScript(params: VideoSalesScriptInput): Promise<string> {
  const result = await generateDynamicSalesResponse({
    userQuestion: `Buat script video ${params.durationType || "30s"} untuk produk ${params.productName}. Style: ${params.style || "Viral TikTok"}.`,
    productName: params.productName,
    productDescription: params.productDescription,
    productPrice: params.productPrice,
    productCategory: params.productCategory,
    requestedIntent: "SELL",
    requestedMode: "SELL",
  });
  return result.replyText;
}

export const generateVideoSalesScriptGroq = generateVideoSalesScript;
export const generateVideoSalesScriptGemini = generateVideoSalesScript;

export async function generateLunaResponse(
  userComment: string,
  product?: {
    id: string;
    name: string;
    price: number | string;
    stock: number;
    description?: string;
  } | null,
  avatarName = "Namira",
  tone = "Persuasif",
): Promise<{
  speech: string;
  action: LunaAction;
  emotion: LunaEmotion;
  target_product_id: string | null;
}> {
  try {
    const result = await generateDynamicSalesResponse({
      userQuestion: `Komentar penonton: ${userComment}`,
      avatarName,
      tone,
      productName: product?.name,
      productPrice:
        product && typeof product.price === "number"
          ? `Rp${product.price.toLocaleString("id-ID")}`
          : product?.price != null
            ? String(product.price)
            : undefined,
      productStock: product?.stock,
      productDescription: product?.description,
      requestedIntent: inferIntentFromText(userComment),
      requestedMode: "QNA",
    });
    return {
      speech: result.replyText,
      action: normalizeLunaAction(result.action),
      emotion: "warm",
      target_product_id: product?.id || null,
    };
  } catch {
    return {
      speech: `Aku lihat komentarnya... ${product ? `Untuk ${product.name}, ` : ""}aku jawab dari info yang memang tersedia ya.`,
      action: "IDLE",
      emotion: "thinking",
      target_product_id: product?.id || null,
    };
  }
}

export const generateLunaResponseGroq = generateLunaResponse;

