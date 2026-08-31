import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";

const GEMINI_MODEL = process.env.GEMINI_MODEL || process.env.LIVE_BRAIN_MODEL || "gemini-3.7-flash";

const GROQ_MODEL = process.env.GROQ_MODEL || process.env.LIVE_BRAIN_MODEL || "openai/gpt-oss-20b";

const GROQ_BASE_URL = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";

const CIRCUIT_BREAKER_MS = Number(process.env.LIVE_BRAIN_CIRCUIT_MS || 45_000);
const VALIDATION_RETRY_COOLDOWN_MS = Number(process.env.LIVE_BRAIN_RETRY_COOLDOWN_MS || 30_000);

let groqBlockedUntil = 0;
let geminiBlockedUntil = 0;
let globalBrainBackoffUntil = 0;
let lastValidationRetryAt = 0;
let geminiClient: GoogleGenAI | null = null;

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|rate.?limit|resource_exhausted|quota|too many requests/i.test(msg);
}

function tripCircuit(provider: "groq" | "gemini", ms = CIRCUIT_BREAKER_MS): void {
  const until = Date.now() + ms;
  if (provider === "groq") groqBlockedUntil = until;
  else geminiBlockedUntil = until;
  globalBrainBackoffUntil = Math.max(globalBrainBackoffUntil, until);
}

/** Remaining ms to wait before next LLM call (0 = ready). Used by live orchestrator. */
export function getBrainBackoffMs(): number {
  return Math.max(0, globalBrainBackoffUntil - Date.now());
}

function canValidationRetry(): boolean {
  return Date.now() - lastValidationRetryAt >= VALIDATION_RETRY_COOLDOWN_MS;
}

function getGeminiClient(): GoogleGenAI {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY tidak tersedia");
  if (!geminiClient) geminiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return geminiClient;
}

export type HostMode =
  | "ENGAGE"
  | "SELL"
  | "QNA"
  | "DEMO"
  | "OBJECTION"
  | "SOCIAL"
  | "ANNOUNCEMENT"
  | "RECOVERY"
  | "CLOSING";

export type HostIntent =
  | "ANSWER"
  | "PRODUCT_INFO"
  | "PRICE"
  | "BUYING_INTENT"
  | "OBJECTION"
  | "SOCIAL"
  | "THANKS"
  | "COMPLAINT"
  | "ANNOUNCEMENT"
  | "SELL"
  | "SPAM"
  | "OTHER";

export const LunaActionEnum = z.enum([
  "IDLE",
  "TALK_EXPRESSIVE",
  "NOD",
  "LAUGH",
  "POINT_UP",
  "POINT_DOWN",
  "WAVE",
  "THINK",
]);
export type LunaAction = z.infer<typeof LunaActionEnum>;

export const LunaEmotionEnum = z.enum(["happy", "neutral", "surprised", "thinking", "warm", "excited", "empathetic"]);
export type LunaEmotion = z.infer<typeof LunaEmotionEnum>;

export const HostModeEnum = z.enum([
  "ENGAGE",
  "SELL",
  "QNA",
  "DEMO",
  "OBJECTION",
  "SOCIAL",
  "ANNOUNCEMENT",
  "RECOVERY",
  "CLOSING",
]);

export const HostIntentEnum = z.enum([
  "ANSWER",
  "PRODUCT_INFO",
  "PRICE",
  "BUYING_INTENT",
  "OBJECTION",
  "SOCIAL",
  "THANKS",
  "COMPLAINT",
  "ANNOUNCEMENT",
  "SELL",
  "SPAM",
  "OTHER",
]);

export const HostResponseSchema = z.object({
  speech: z.string().min(3),
  action: LunaActionEnum,
  emotion: LunaEmotionEnum,
  intent: HostIntentEnum,
  mode: HostModeEnum,
  topic: z.string().min(1).max(80),
  ctaType: z.enum(["NONE", "SOFT", "DIRECT", "PRICE", "PRODUCT", "COMMENT"]).default("NONE"),
  target_product_id: z.string().nullable().default(null),
  interruptible: z.boolean().default(true),
  claims: z.array(z.string()).default([]),
});
export type HostResponse = z.infer<typeof HostResponseSchema>;

export interface SalesBrainOutput {
  replyText: string;
  engineUsed: string;
  intent: string;
  action: string;
}

export interface ProductKnowledge {
  description: string;
  benefits: string;
  usage: string;
  faq: string;
  targetAudience: string;
  copywriting: string;
}

export interface GenerateProductKnowledgeInput {
  name: string;
  description: string;
  category?: string;
  price?: number | string;
  stock?: number;
  sku?: string;
  link?: string;
  benefits?: string;
  usage?: string;
  image?: string;
  bannerImage?: string;
}

export interface SalesBrainInput {
  userQuestion: string;
  authorName?: string;
  avatarName?: string;
  tone?: string;
  productName?: string;
  productPrice?: string;
  productDescription?: string;
  productCategory?: string;
  productBenefits?: string;
  productUsage?: string;
  productFaq?: string;
  productStock?: number;
  allProducts?: Array<{
    id: string;
    name: string;
    price: string | number;
    category?: string;
    benefits?: string;
    description?: string;
  }>;
  recentUtterances?: string[];
  recentTopics?: string[];
  recentCTAs?: string[];
  recentClaims?: string[];
  avoidPhrases?: string[];
  avoidTopics?: string[];
  mode?: HostMode;
  elapsedMinutes?: number;
  requestedIntent?: HostIntent;
  requestedMode?: HostMode;
  audienceCount?: number;
  plan?: "2H" | "8H" | "24H";
}

export interface LiveSalesPitchInput {
  productName: string;
  productPrice?: string;
  productCategory?: string;
  category?: string;
  productDescription?: string;
  productBenefits?: string;
  productUsage?: string;
  productFaq?: string;
  productStock?: number;
  avatarName?: string;
  tone?: string;
  allProducts?: Array<{
    id: string;
    name: string;
    price: string | number;
    category?: string;
    benefits?: string;
  }>;
}

export interface LiveSalesPitchOutput {
  productName: string;
  price: string;
  stock: number;
  category: string;
  avatarName: string;
  tone: string;
  hook: string;
  showcase: string;
  cta: string;
  fullScript: string;
}

export interface VideoSalesScriptInput {
  productName: string;
  productDescription?: string;
  productPrice?: string;
  productCategory?: string;
  durationType?: "15s" | "30s" | "60s";
  style?: string;
}

interface ProviderResult {
  text: string;
  provider: "gemini" | "groq" | "fallback";
  model: string;
}

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
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(clean.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
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
    if (!match) return { speech: text.trim(), action: "TALK_EXPRESSIVE" };
    const tag = String(match[1]).toUpperCase();
    const mapping: Record<string, LunaAction> = {
      IDLE: "IDLE",
      TALK_EXPRESSIVE: "TALK_EXPRESSIVE",
      NOD: "NOD",
      LAUGH: "LAUGH",
      POINT_UP: "POINT_UP",
      POINT_DOWN: "POINT_DOWN",
      RAISE_HAND: "WAVE",
      WAVE: "WAVE",
      EXCITED: "TALK_EXPRESSIVE",
      SMILE: "NOD",
      THINK: "THINK",
    };
    return {
      speech: text.slice(match[0].length).trim(),
      action: mapping[tag] || "TALK_EXPRESSIVE",
    };
  }

function cleanForTts(text: string): string {
  return extractActionTag(text)
    .speech.replace(/\s{2,}/g, " ")
    .trim();
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
  const tone = input.tone || "Persuasif namun hangat";
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
- Bahasa Indonesia percakapan, natural, lisan, pendek-padat.
- Gunakan "aku", "kamu", "kita", partikel seperlunya.
- Variasikan panjang kalimat dan ritme.
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

GERAKAN AVATAR (action) — wajib bervariasi, jangan selalu TALK_EXPRESSIVE:
- WAVE: sapaan, welcome, "halo kak", orang baru masuk.
- NOD: setuju, "benar", "betul", konfirmasi.
- LAUGH: candaan, komentar lucu, reaksi hangat.
- POINT_UP: highlight promo, "ini penting", "perhatikan".
- POINT_DOWN: sebut harga, "cek keranjang", arahkan ke produk.
- THINK: pertanyaan, "hmm", sedang mempertimbangkan.
- TALK_EXPRESSIVE: penjelasan produk default (kepala/tangan bergerak natural).
- IDLE: jeda singkat, transisi, tidak sedang hard-sell.
Pilih action yang MATCH isi speech. Jangan WAVE setiap kalimat.

OUTPUT:
Kembalikan SATU JSON murni, tanpa markdown, dengan schema:
{
  "speech": "kalimat yang benar-benar diucapkan host",
  "action": "IDLE|TALK_EXPRESSIVE|NOD|LAUGH|POINT_UP|POINT_DOWN|WAVE|THINK",
  "emotion": "happy|neutral|surprised|thinking|warm|excited|empathetic",
  "intent": "ANSWER|PRODUCT_INFO|PRICE|BUYING_INTENT|OBJECTION|SOCIAL|THANKS|COMPLAINT|ANNOUNCEMENT|SELL|SPAM|OTHER",
  "mode": "ENGAGE|SELL|QNA|DEMO|OBJECTION|SOCIAL|ANNOUNCEMENT|RECOVERY|CLOSING",
  "topic": "label pendek topic respons",
  "ctaType": "NONE|SOFT|DIRECT|PRICE|PRODUCT|COMMENT",
  "target_product_id": null,
  "interruptible": true,
  "claims": []
}

Panjang speech: MAKSIMAL 20–35 kata (≈8–14 detik audio). Komentar balasan 8–18 kata. Speech pendek = render lebih cepat & siaran lebih hidup. Jangan menambahkan salam pembuka robotik.`;
}

async function callGemini(prompt: string): Promise<ProviderResult> {
  if (Date.now() < geminiBlockedUntil) {
    throw new Error("Gemini circuit open — rate limit cooldown aktif");
  }

  try {
    const client = getGeminiClient();
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: Number(process.env.LIVE_BRAIN_TEMPERATURE || 0.85),
        maxOutputTokens: Number(process.env.LIVE_BRAIN_MAX_TOKENS || 320),
      },
    });
    return {
      text: response.text || "",
      provider: "gemini",
      model: GEMINI_MODEL,
    };
  } catch (err) {
    if (isRateLimitError(err)) tripCircuit("gemini");
    throw err;
  }
}

async function callGroq(prompt: string): Promise<ProviderResult> {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY tidak tersedia");
  if (Date.now() < groqBlockedUntil) {
    throw new Error("Groq circuit open — rate limit cooldown aktif");
  }

  const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content: "Kembalikan JSON valid persis sesuai instruksi. Jangan menambahkan markdown.",
        },
        { role: "user", content: prompt },
      ],
      temperature: Number(process.env.LIVE_BRAIN_TEMPERATURE || 0.85),
      max_tokens: Number(process.env.LIVE_BRAIN_MAX_TOKENS || 320),
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 429) tripCircuit("groq");
    throw new Error(`Groq ${response.status}: ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as any;
  return {
    text: data?.choices?.[0]?.message?.content || "",
    provider: "groq",
    model: GROQ_MODEL,
  };
}

async function callBrain(prompt: string): Promise<ProviderResult> {
  const provider = (process.env.LIVE_BRAIN_PROVIDER || "auto").toLowerCase();

  if (provider === "gemini") return callGemini(prompt);
  if (provider === "groq") return callGroq(prompt);

  // auto: prefer Groq when circuit open skip failed provider immediately
  if (GROQ_API_KEY && Date.now() >= groqBlockedUntil) {
    try {
      return await callGroq(prompt);
    } catch (err) {
      if (!isRateLimitError(err)) {
        console.warn("[LiveBrain] Groq gagal, fallback ke Gemini:", err);
      }
    }
  }

  if (GEMINI_API_KEY && Date.now() >= geminiBlockedUntil) {
    return callGemini(prompt);
  }

  throw new Error("Semua provider LLM sedang cooldown atau tidak tersedia");
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
      action: "THINK",
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
      action: "TALK_EXPRESSIVE",
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
      action: "NOD",
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

  const provider = await callBrain(`${systemPrompt}\n\n${userPrompt}`);
  const parsed = cleanAndExtractJson(provider.text);
  const response = selectSafeParsedResponse(parsed, hostInput);
  if (response) return response;

  if (!canValidationRetry()) return null;

  lastValidationRetryAt = Date.now();
  const retryPrompt = `${systemPrompt}\n\nREGENERATE. RESPONS SEBELUMNYA TIDAK LOLOS VALIDASI.\nEVENT: ${userQuestion}\nBuat pendekatan yang berbeda secara nyata dari memori terakhir.`;
  const retry = await callBrain(retryPrompt);
  const retryParsed = cleanAndExtractJson(retry.text);
  return selectSafeParsedResponse(retryParsed, hostInput);
}

/**
 * Main live response generator. Backward-compatible with old callers.
 */
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
    console.warn(`[LiveBrain] generateHostResponse error: ${err?.message || err}`);
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
    console.warn(`[LiveBrain] generation error: ${err?.message || err}`);
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

export async function checkGroqHealth(): Promise<{
  online: boolean;
  model: string;
  provider: string;
  latencyMs?: number;
  error?: string;
}> {
  const started = Date.now();
  const provider = (process.env.LIVE_BRAIN_PROVIDER || "auto").toLowerCase();

  try {
    if (provider === "groq" || (provider === "auto" && GROQ_API_KEY)) {
      const response = await fetch(`${GROQ_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      });
      if (!response.ok) {
        return {
          online: false,
          model: GROQ_MODEL,
          provider: "groq",
          latencyMs: Date.now() - started,
          error: `HTTP ${response.status}`,
        };
      }
      return {
        online: true,
        model: GROQ_MODEL,
        provider: "groq",
        latencyMs: Date.now() - started,
      };
    }

    if (GEMINI_API_KEY) {
      // Lightweight check — no full generation on boot (saves quota).
      getGeminiClient();
      return {
        online: true,
        model: GEMINI_MODEL,
        provider: "gemini",
        latencyMs: Date.now() - started,
      };
    }

    return {
      online: false,
      model: "none",
      provider: "none",
      latencyMs: Date.now() - started,
      error: "GROQ_API_KEY dan GEMINI_API_KEY tidak tersedia",
    };
  } catch (err: any) {
    return {
      online: false,
      model: provider === "groq" ? GROQ_MODEL : GEMINI_MODEL,
      provider: provider === "groq" ? "groq" : "gemini",
      latencyMs: Date.now() - started,
      error: err?.message || String(err),
    };
  }
}

export const checkOllamaHealth = checkGroqHealth;

// Deprecated compatibility API. Jangan gunakan untuk request baru.
export function getGroqClient() {
  if (!GEMINI_API_KEY) {
    console.warn(
      "[LiveBrain] getGroqClient() dipertahankan hanya untuk kompatibilitas lama. Request baru lewat generateDynamicSalesResponse().",
    );
  }
  return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
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
      action: (result.action as LunaAction) || "TALK_EXPRESSIVE",
      emotion: "warm",
      target_product_id: product?.id || null,
    };
  } catch {
    return {
      speech: `Aku lihat komentarnya... ${product ? `Untuk ${product.name}, ` : ""}aku jawab dari info yang memang tersedia ya.`,
      action: "THINK",
      emotion: "thinking",
      target_product_id: product?.id || null,
    };
  }
}

export const generateLunaResponseGroq = generateLunaResponse;

export async function generateProductKnowledge(input: GenerateProductKnowledgeInput): Promise<ProductKnowledge> {
  const priceDisplay =
    input.price == null
      ? "Harga Spesial"
      : typeof input.price === "number"
        ? `Rp${input.price.toLocaleString("id-ID")}`
        : String(input.price);

  const prompt = `Kamu adalah product knowledge editor.
Buat JSON murni dengan field: description, benefits, usage, faq, targetAudience, copywriting.
Jangan menambahkan klaim legal/medis/commercial yang tidak ada pada data input.

DATA:
Nama: ${input.name}
Kategori: ${input.category || "General"}
Harga: ${priceDisplay}
Stok: ${input.stock ?? 0}
SKU: ${input.sku || "-"}
Link: ${input.link || "-"}
Deskripsi: ${input.description}
Manfaat: ${input.benefits || ""}
Cara pakai: ${input.usage || ""}`;

  try {
    const provider = await callBrain(prompt);
    const parsed = cleanAndExtractJson(provider.text) as any;
    if (
      parsed &&
      typeof parsed.description === "string" &&
      typeof parsed.benefits === "string" &&
      typeof parsed.usage === "string" &&
      typeof parsed.faq === "string" &&
      typeof parsed.targetAudience === "string" &&
      typeof parsed.copywriting === "string"
    ) {
      return parsed as ProductKnowledge;
    }
  } catch (err: any) {
    console.warn(`[LiveBrain] generateProductKnowledge: ${err?.message || err}`);
  }

  return {
    description: input.description,
    benefits: input.benefits || `Keunggulan ${input.name} berdasarkan data penjual.`,
    usage: input.usage || `Gunakan ${input.name} sesuai petunjuk pada kemasan atau informasi resmi produk.`,
    faq: "Gunakan hanya informasi resmi produk untuk menjawab legalitas, keamanan, garansi, dan keaslian.",
    targetAudience: `Konsumen yang membutuhkan ${input.name}.`,
    copywriting: `Untuk kamu yang sedang mempertimbangkan ${input.name}, cek detail produk dan manfaat yang memang tersedia di informasi resminya.`,
  };
}
