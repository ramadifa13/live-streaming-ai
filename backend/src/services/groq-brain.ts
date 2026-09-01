import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { StreamPlan } from "./live-host-orchestrator.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.LIVE_BRAIN_API_KEY || "";

const GEMINI_MODEL_RAW =
  process.env.GEMINI_MODEL || process.env.LIVE_BRAIN_MODEL || "gemini-3.6-flash";
const DEPRECATED_GEMINI_MODELS: Record<string, string> = {
  "gemini-3.7-flash": "gemini-3.6-flash",
  "gemini-2.5-flash": "gemini-3.6-flash",
  "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
  "gemini-2.5-pro": "gemini-3.5-flash",
  "gemini-2.5-flash-preview-05-20": "gemini-3.6-flash",
  "gemini-2.5-flash-preview-09-25": "gemini-3.6-flash",
  "gemini-2.5-flash-lite-preview-09-2025": "gemini-3.5-flash-lite",
  "gemini-3-flash-preview": "gemini-3.6-flash",
  "gemini-1.5-flash": "gemini-3.6-flash",
  "gemini-1.5-flash-latest": "gemini-3.6-flash",
  "gemini-1.5-flash-8b": "gemini-3.5-flash-lite",
  "gemini-1.5-pro": "gemini-3.5-flash",
  "gemini-1.5-pro-latest": "gemini-3.5-flash",
  "gemini-2.0-flash": "gemini-3.6-flash",
  "gemini-2.0-flash-lite": "gemini-3.5-flash-lite",
  "gemini-pro": "gemini-3.6-flash",
  "gemini-1.0-pro": "gemini-3.6-flash",
};

const GEMINI_MODEL_FALLBACKS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-flash-latest",
] as const;

function resolveGeminiModel(requested = GEMINI_MODEL_RAW): string {
  const normalized = requested.trim();
  return DEPRECATED_GEMINI_MODELS[normalized] || normalized;
}

const GEMINI_MODEL = resolveGeminiModel();

if (GEMINI_MODEL !== GEMINI_MODEL_RAW.trim()) {
  console.warn(
    `[LiveBrain] GEMINI_MODEL "${GEMINI_MODEL_RAW}" sudah deprecated → memakai "${GEMINI_MODEL}"`,
  );
}

const GROQ_MODEL_RAW =
  process.env.GROQ_MODEL ||
  process.env.LIVE_BRAIN_MODEL ||
  "openai/gpt-oss-20b";

const DEPRECATED_GROQ_MODELS: Record<string, string> = {
  "llama-3.1-8b-instant": "openai/gpt-oss-20b",
  "llama3-8b-8192": "openai/gpt-oss-20b",
  "gemma2-9b-it": "openai/gpt-oss-20b",
  "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
  "llama3-70b-8192": "openai/gpt-oss-120b",
  "llama-3.3-70b-specdec": "openai/gpt-oss-120b",
  "qwen/qwen3-32b": "openai/gpt-oss-120b",
};

/** Model aktif Groq (developer tier). Primary cepat; fallback lebih kuat. */
const GROQ_MODEL_FALLBACKS = [
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
] as const;

function resolveGroqModel(requested = GROQ_MODEL_RAW): string {
  const normalized = requested.trim();
  return DEPRECATED_GROQ_MODELS[normalized] || normalized;
}

const GROQ_MODEL = resolveGroqModel();

if (GROQ_MODEL !== GROQ_MODEL_RAW.trim()) {
  console.warn(
    `[LiveBrain] GROQ_MODEL "${GROQ_MODEL_RAW}" sudah deprecated → memakai "${GROQ_MODEL}"`,
  );
}

const GROQ_BASE_URL = (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(
  /\/+$/,
  "",
);

const CIRCUIT_BREAKER_MS = Number(process.env.LIVE_BRAIN_CIRCUIT_MS || 45_000);
const SELFHOST_CIRCUIT_MS = Number(process.env.LIVE_BRAIN_SELFHOST_CIRCUIT_MS || 5_000);
const VALIDATION_RETRY_COOLDOWN_MS = Number(process.env.LIVE_BRAIN_RETRY_COOLDOWN_MS || 30_000);
const MAX_INFLIGHT = Math.max(1, Number(process.env.LIVE_BRAIN_MAX_INFLIGHT || 12));
const BANK_MAX_TOKENS = Number(process.env.LIVE_BRAIN_BANK_MAX_TOKENS || 3200);
const PREP_LINE_TARGET = Number(process.env.LIVE_SCRIPT_PREP_LINE_TARGET || 28);
const PREP_EXTRA_PASS = process.env.LIVE_BRAIN_PREP_EXTRA_PASS !== "0";

let groqBlockedUntil = 0;
let geminiBlockedUntil = 0;
let globalBrainBackoffUntil = 0;
const sessionBackoffUntil = new Map<string, number>();
const lastValidationRetryAt = new Map<string, number>();
let geminiClient: GoogleGenAI | null = null;

class BrainSemaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];
  constructor(max: number) {
    this.available = max;
  }
  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.available++;
  }
}

const brainSemaphore = new BrainSemaphore(MAX_INFLIGHT);

function liveBrainProvider(): string {
  const raw = (process.env.LIVE_BRAIN_PROVIDER || "auto").toLowerCase();
  // Legacy self-host flags dinonaktifkan — stack hanya Groq + Gemini.
  if (raw === "ollama" || raw === "vllm" || raw === "local") return "auto";
  return raw;
}

/** Tetap diexport untuk kompatibilitas; selalu false setelah Ollama/vLLM dibersihkan. */
export function isSelfHostedBrain(): boolean {
  return false;
}

function groqAuthToken(): string {
  return GROQ_API_KEY || "";
}

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|rate.?limit|resource_exhausted|quota|too many requests|503/i.test(msg);
}

function pruneBackoffMap(map: Map<string, number>): void {
  const now = Date.now();
  for (const [key, until] of map) {
    if (until <= now) map.delete(key);
  }
}

function tripCircuit(
  provider: "groq" | "gemini",
  ms = CIRCUIT_BREAKER_MS,
  sessionId?: string,
): void {
  const selfHostedGroq = provider === "groq" && isSelfHostedBrain();
  const duration = selfHostedGroq ? Math.min(ms, SELFHOST_CIRCUIT_MS) : ms;
  const until = Date.now() + duration;

  if (sessionId) {
    const jitter = 400 + Math.floor(Math.random() * 2_400);
    sessionBackoffUntil.set(sessionId, Date.now() + duration + jitter);
  }

  if (selfHostedGroq) {
    return;
  }

  if (provider === "groq") groqBlockedUntil = until;
  else geminiBlockedUntil = until;
  globalBrainBackoffUntil = Math.max(globalBrainBackoffUntil, until);
}

export function getBrainBackoffMs(sessionId?: string): number {
  pruneBackoffMap(sessionBackoffUntil);
  const sessionWait = sessionId
    ? Math.max(0, (sessionBackoffUntil.get(sessionId) || 0) - Date.now())
    : 0;
  const globalWait = Math.max(0, globalBrainBackoffUntil - Date.now());
  return Math.max(sessionWait, globalWait);
}

function canValidationRetry(sessionId?: string): boolean {
  const key = sessionId || "_global";
  return Date.now() - (lastValidationRetryAt.get(key) || 0) >= VALIDATION_RETRY_COOLDOWN_MS;
}

interface BrainCallOptions {
  sessionId?: string;
  maxTokens?: number;
  /** Jangan fallback ke Gemini (mis. prepare-product — local bank sudah cukup). */
  groqOnly?: boolean;
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
  plan?: StreamPlan;
  sessionId?: string;
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

GERAKAN AVATAR (action) — pakai gesture supaya host terasa hidup:
- TALK_EXPRESSIVE: default bicara (paling sering, ~50%).
- WAVE: sapaan / welcome / "halo kak".
- NOD: setuju, "betul kak", "iya benar".
- LAUGH: candaan / ketawa.
- POINT_UP / POINT_DOWN: tunjuk harga, promo, stok.
- THINK: ragu, "hmm", sedang pikir.
- IDLE: jangan untuk kalimat yang diucapkan.
Variasikan. Jangan WAVE atau POINT setiap kalimat berturut-turut.

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

function isGemini3FamilyModel(model: string): boolean {
  return /^gemini-3(\.|$|-)/.test(model) || model === "gemini-flash-latest";
}

function buildGeminiGenerationConfig(model: string) {
  const config: {
    responseMimeType: string;
    maxOutputTokens: number;
    temperature?: number;
  } = {
    responseMimeType: "application/json",
    maxOutputTokens: Number(process.env.LIVE_BRAIN_MAX_TOKENS || 320),
  };
  // Gemini 3.x: temperature/top_p deprecated — pakai JSON schema saja
  if (!isGemini3FamilyModel(model)) {
    config.temperature = Number(process.env.LIVE_BRAIN_TEMPERATURE || 0.85);
  }
  return config;
}

async function callGeminiWithModel(
  prompt: string,
  model: string,
): Promise<ProviderResult> {
  const client = getGeminiClient();
  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: buildGeminiGenerationConfig(model),
  });
  return {
    text: response.text || "",
    provider: "gemini",
    model,
  };
}

function geminiModelCandidates(): string[] {
  const primary = resolveGeminiModel();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [primary, ...GEMINI_MODEL_FALLBACKS]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function isGeminiModelNotFound(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /not found|404|invalid.*model|model.*does not exist|is not supported|NOT_FOUND|no longer available|deprecated|shut down|shutdown|limiting access|not available for/i.test(
    msg,
  );
}

async function callGemini(prompt: string, options: BrainCallOptions = {}): Promise<ProviderResult> {
  if (Date.now() < geminiBlockedUntil) {
    throw new Error("Gemini circuit open — rate limit cooldown aktif");
  }
  if (getBrainBackoffMs(options.sessionId) > 0) {
    throw new Error("Session brain cooldown aktif");
  }

  const candidates = geminiModelCandidates();
  let lastError: Error | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i]!;
    try {
      if (model !== GEMINI_MODEL_RAW.trim() && model !== resolveGeminiModel(GEMINI_MODEL_RAW)) {
        console.warn(`[LiveBrain] Gemini mencoba model alternatif: ${model}`);
      }
      return await callGeminiWithModel(prompt, model);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (isRateLimitError(err)) {
        tripCircuit("gemini", CIRCUIT_BREAKER_MS, options.sessionId);
        throw lastError;
      }
      const canRetry = i < candidates.length - 1 && isGeminiModelNotFound(err);
      if (!canRetry) throw lastError;
      console.warn(
        `[LiveBrain] Gemini model ${model} tidak tersedia, coba berikutnya...`,
      );
    }
  }

  throw lastError || new Error("Gemini gagal — tidak ada model yang tersedia");
}

function groqModelCandidates(): string[] {
  const primary = resolveGroqModel();
  if (isSelfHostedBrain()) return [primary];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [primary, ...GROQ_MODEL_FALLBACKS]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function isGroqModelNotFound(errBody: string): boolean {
  return /model_not_found|does not exist|decommissioned|deprecated/i.test(errBody);
}

function parseRetryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return undefined;
}

async function callGroqWithModel(
  prompt: string,
  model: string,
  options: BrainCallOptions = {},
  useJsonFormat = true,
): Promise<ProviderResult> {
  const maxTokens = options.maxTokens || Number(process.env.LIVE_BRAIN_MAX_TOKENS || 320);
  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "system",
        content: "Kembalikan JSON valid persis sesuai instruksi. Jangan menambahkan markdown.",
      },
      { role: "user", content: prompt },
    ],
    temperature: Number(process.env.LIVE_BRAIN_TEMPERATURE || 0.85),
    max_tokens: maxTokens,
  };
  if (useJsonFormat) body.response_format = { type: "json_object" };

  const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groqAuthToken()}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    if (
      useJsonFormat &&
      (response.status === 400 || response.status === 422) &&
      /response_format|json_object|json schema|json_validate_failed/i.test(errBody)
    ) {
      return callGroqWithModel(prompt, model, options, false);
    }
    if (response.status === 429 || response.status === 503) {
      tripCircuit("groq", parseRetryAfterMs(response) || CIRCUIT_BREAKER_MS, options.sessionId);
    }
    throw new Error(`Groq ${response.status}: ${errBody.slice(0, 500)}`);
  }

  const data = (await response.json()) as any;
  return {
    text: data?.choices?.[0]?.message?.content || "",
    provider: "groq",
    model,
  };
}

async function callGroq(prompt: string, options: BrainCallOptions = {}): Promise<ProviderResult> {
  if (!GROQ_API_KEY && !isSelfHostedBrain()) {
    throw new Error("GROQ_API_KEY tidak tersedia");
  }
  if (Date.now() < groqBlockedUntil) {
    throw new Error("Groq circuit open — rate limit cooldown aktif");
  }
  if (getBrainBackoffMs(options.sessionId) > 0) {
    throw new Error("Session brain cooldown aktif");
  }

  const candidates = groqModelCandidates();
  let lastError: Error | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i]!;
    try {
      if (model !== GROQ_MODEL_RAW && model !== resolveGroqModel(GROQ_MODEL_RAW)) {
        console.warn(`[LiveBrain] Groq mencoba model alternatif: ${model}`);
      }
      return await callGroqWithModel(prompt, model, options);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const canRetry =
        i < candidates.length - 1 && isGroqModelNotFound(lastError.message);
      if (!canRetry) throw lastError;
      console.warn(
        `[LiveBrain] Groq model ${model} tidak tersedia, coba berikutnya...`,
      );
    }
  }

  throw lastError || new Error("Groq gagal — tidak ada model yang tersedia");
}

async function callBrain(prompt: string, options: BrainCallOptions = {}): Promise<ProviderResult> {
  await brainSemaphore.acquire();
  try {
    const provider = liveBrainProvider();

    if (provider === "gemini") return callGemini(prompt, options);
    if (provider === "groq") return callGroq(prompt, options);

    // auto: Groq dulu, Gemini cadangan (kecuali groqOnly)
    if (GROQ_API_KEY && Date.now() >= groqBlockedUntil) {
      try {
        return await callGroq(prompt, options);
      } catch (err) {
        if (options.groqOnly) throw err;
        if (!isRateLimitError(err)) {
          console.warn("[LiveBrain] Groq gagal, fallback ke Gemini:", err);
        } else {
          console.warn("[LiveBrain] Groq rate limit, fallback ke Gemini");
        }
      }
    }

    if (!options.groqOnly && GEMINI_API_KEY && Date.now() >= geminiBlockedUntil) {
      return callGemini(prompt, options);
    }

    throw new Error("Semua provider LLM sedang cooldown atau tidak tersedia");
  } finally {
    brainSemaphore.release();
  }
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
  const callOpts = { sessionId: hostInput.sessionId };

  const provider = await callBrain(`${systemPrompt}\n\n${userPrompt}`, callOpts);
  const parsed = cleanAndExtractJson(provider.text);
  const response = selectSafeParsedResponse(parsed, hostInput);
  if (response) return response;

  if (!canValidationRetry(hostInput.sessionId)) return null;

  lastValidationRetryAt.set(hostInput.sessionId || "_global", Date.now());
  const retryPrompt = `${systemPrompt}\n\nREGENERATE. RESPONS SEBELUMNYA TIDAK LOLOS VALIDASI.\nEVENT: ${userQuestion}\nBuat pendekatan yang berbeda secara nyata dari memori terakhir.`;
  const retry = await callBrain(retryPrompt, callOpts);
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

const ScriptBankLineSchema = HostResponseSchema.extend({
  speech: z.string().min(8),
});

export async function generateScriptBankLines(input: SalesBrainInput): Promise<HostResponse[]> {
  const systemPrompt = buildHostSystemPrompt(input);
  const prompt = `${systemPrompt}

TUGAS: buat 20–24 ucapan host otonom yang BERBEDA dan NATURAL (bukan robot).
Gaya TikTok/Shopee host: kasual, hidup, 12–32 kata.
LARANG frasa kaku berulang: "dari data produk", "yang tertulis", "aku nggak nebak", "patokannya".
Jangan mengarang fakta. Campur topik: benefit, how_to_use, value, social, objection, micro_tip, reframe, use_case, promo_pitch, filler.
Setiap baris harus beda angle/pembuka — jangan parafrase ulang baris sebelumnya.
Kembalikan JSON murni:
{"lines":[{ "speech":"", "action":"TALK_EXPRESSIVE", "emotion":"warm", "intent":"SELL", "mode":"ENGAGE", "topic":"", "ctaType":"NONE", "target_product_id":null, "interruptible":true, "claims":[] }]}`;

  try {
    const result = await callBrain(prompt, {
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
    for (const item of rawLines) {
      const validated = ScriptBankLineSchema.safeParse(item);
      if (!validated.success) continue;
      const safe = selectSafeParsedResponse(validated.data, input);
      if (safe) accepted.push(safe);
    }
    return accepted;
  } catch (err: any) {
    console.warn(`[LiveBrain] generateScriptBankLines: ${err?.message || err}`);
    return [];
  }
}

export function liveBrainDuringLive(): boolean {
  return process.env.LIVE_BRAIN_DURING_LIVE === "1";
}

/** LLM untuk komentar yang belum bisa dijawab bank/FAQ lokal (default on). */
export function liveBrainCommentWhenNeeded(): boolean {
  return process.env.LIVE_BRAIN_COMMENT_WHEN_NEEDED !== "0";
}

export function liveBrainRefillWhenLow(): boolean {
  return process.env.LIVE_BRAIN_REFILL_WHEN_LOW !== "0";
}

/** LLM isi ulang bank saat variasi habis, bukan hanya saat count rendah (default on). */
export function liveBrainRefillOnExhaust(): boolean {
  return process.env.LIVE_BRAIN_REFILL_ON_EXHAUST !== "0";
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
    input.price == null
      ? "Harga live"
      : typeof input.price === "number"
        ? `Rp${input.price.toLocaleString("id-ID")}`
        : String(input.price);

  const {
    seedLocalScriptBank,
    emptyScriptBank,
    mergeScriptLines,
    buildDefaultFaqPack,
    faqAnswerLines,
    mergeProductKnowledge,
  } = await import("./live-script-bank.js");

  const category =
    input.category && input.category !== "Lainnya" && input.category !== "General" && input.category !== "Umum"
      ? input.category
      : "Umum";

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
    !input.benefits?.trim() ||
    !input.usage?.trim() ||
    !input.faq?.trim() ||
    !input.targetAudience?.trim() ||
    !input.copywriting?.trim();

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
- Speech 5–15 detik (12–32 kata), terdengar manusia, JANGAN kaku/robot.
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
    const result = await callBrain(prompt, {
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
          benefits:
            !input.benefits?.trim() && (data.enriched as any).benefits?.trim?.()
              ? String((data.enriched as any).benefits).trim()
              : undefined,
          usage:
            !input.usage?.trim() && (data.enriched as any).usage?.trim?.()
              ? String((data.enriched as any).usage).trim()
              : undefined,
          faq: !input.faq?.trim() && data.enriched.faq?.trim() ? data.enriched.faq.trim() : undefined,
          targetAudience:
            !input.targetAudience?.trim() && data.enriched.targetAudience?.trim()
              ? data.enriched.targetAudience.trim()
              : undefined,
          copywriting:
            !input.copywriting?.trim() && data.enriched.copywriting?.trim()
              ? data.enriched.copywriting.trim()
              : undefined,
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
          action: "TALK_EXPRESSIVE",
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
        llmLines.push({
          speech: item.speech,
          action: "TALK_EXPRESSIVE",
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

      // Pass kedua: variasi tambahan agar bank prep cukup untuk marathon tanpa LLM live.
      if (PREP_EXTRA_PASS && llmLines.length >= 10) {
        const existingTopics = [...new Set(llmLines.map((l) => l.topic).filter(Boolean))].join(", ");
        const extraPrompt = `${systemRules}

PRODUK: ${input.name} (${category}) — ${priceDisplay}
Sudah ada ${llmLines.length} baris dengan topik: ${existingTopics}.
Buat 14–18 baris TAMBAHAN yang BEDA angle, pembuka, dan topik — jangan parafrase ulang.
Fokus topik yang belum banyak: micro_tip, use_case, reframe, mini_story, price_context, comparison, buyer_fit.
Kembalikan JSON murni: {"lines":[{ "speech":"", "topic":"", "mode":"ENGAGE|SELL|DEMO|QNA|SOCIAL|OBJECTION", "intent":"SELL|PRODUCT_INFO|SOCIAL|PRICE", "ctaType":"NONE|SOFT|PRICE" }]}`;

        try {
          const extraResult = await callBrain(extraPrompt, {
            maxTokens: BANK_MAX_TOKENS,
            groqOnly: true,
          });
          const extraRaw = cleanAndExtractJson(extraResult.text) as { lines?: unknown } | null;
          const extraLines = Array.isArray(extraRaw?.lines) ? extraRaw.lines : [];
          for (const item of extraLines) {
            const row = item as { speech?: string; topic?: string; mode?: string; intent?: string; ctaType?: string; emotion?: string };
            if (!row.speech || row.speech.length < 8) continue;
            const meta = mapTopicMode(row.topic || "benefit");
            llmLines.push({
              speech: row.speech,
              action: "TALK_EXPRESSIVE",
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
          console.warn(`[LiveBrain] prepareProductScriptPack extra pass: ${extraErr?.message || extraErr}`);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[LiveBrain] prepareProductScriptPack LLM: ${err?.message || err}`);
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

export async function checkGroqHealth(): Promise<{
  online: boolean;
  model: string;
  provider: string;
  latencyMs?: number;
  error?: string;
}> {
  const started = Date.now();
  const provider = liveBrainProvider();

  try {
    if ((provider === "groq" || provider === "auto") && GROQ_API_KEY) {
      const response = await fetch(`${GROQ_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${groqAuthToken()}` },
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
      error: "Tidak ada endpoint LLM yang tersedia",
    };
  } catch (err: any) {
    return {
      online: false,
      model: provider === "gemini" ? GEMINI_MODEL : GROQ_MODEL,
      provider: provider === "gemini" ? "gemini" : "groq",
      latencyMs: Date.now() - started,
      error: err?.message || String(err),
    };
  }
}

/** @deprecated gunakan checkGroqHealth — Ollama sudah dihapus. */
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

