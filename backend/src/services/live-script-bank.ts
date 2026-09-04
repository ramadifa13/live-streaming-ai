import type {
  HostIntent,
  HostMode,
  HostResponse,
  LunaEmotion,
} from "./groq-brain.js";
import { inferCtaPointAction, normalizeLunaAction } from "./groq-brain.js";
import {
  BANNER_CTA_COOLDOWN_MS,
  CTA_COOLDOWN_MS,
  PRICE_MENTION_COOLDOWN_MS,
  avoidAnglesFromMemory,
  buildBannerCtaSpeech,
  contentRepeatGuard,
  inferSalesRule,
  inferSemanticKey,
  isExactRepeat,
  isLexicalRepeat,
  marathonCycleId,
  openingPhrase as marathonOpeningPhrase,
  preferFreshTopics,
  preferredAnglesForCycle,
  productReference,
  salesRuleGuard,
  type BannerCTAContext,
  type HostConversationMemory,
  type ProductEntryMode,
  type ProductMemory,
  type SalesRule,
  type SalesRuleMemory,
  type SpeechBehavior,
} from "./live-marathon-memory.js";

export type {
  BannerCTAContext,
  ContentAngle,
  HostConversationMemory,
  ProductEntryMode,
  ProductMemory,
  RepeatScore,
  SalesRule,
  SalesRuleMemory,
  SpeechBehavior,
  UsageRecord,
} from "./live-marathon-memory.js";

export {
  BANNER_CTA_COOLDOWN_MS,
  CTA_COOLDOWN_MS,
  MAX_CYCLE_MINUTES,
  PRICE_MENTION_COOLDOWN_MS,
  RECENT_SPEECH_LIMIT,
  SEMANTIC_DECAY_MS,
  SEMANTIC_MEMORY_LIMIT,
  avoidAnglesFromMemory,
  buildBannerCtaSpeech,
  contentRepeatGuard,
  emptyHostConversationMemory,
  emptyProductMemory,
  emptySalesRuleMemory,
  getOrCreateProductMemory,
  inferContentAngle,
  inferSalesRule,
  inferSemanticKey,
  isExactRepeat,
  isLexicalRepeat,
  isSemanticRepeat,
  marathonCycleId,
  preferFreshTopics,
  preferredAnglesForCycle,
  productReference,
  recordSalesRuleUse,
  recordSpeechUsage,
  salesRuleGuard,
  scoreRepeat,
  touchProductVisit,
} from "./live-marathon-memory.js";

export interface ScriptProductFacts {
  id: string;
  name: string;
  price: string;
  category: string;
  benefits: string;
  description: string;
  usage: string;
  faq: string;
  stock?: number;
  faqPack?: FaqPackEntry[];
  copywriting?: string;
  targetAudience?: string;
  hasBanner?: boolean;
}

export interface FaqPackEntry {
  category: string;
  triggers: string[];
  answers: string[];
}

export interface ScriptBankState {
  productId: string;
  lines: HostResponse[];
  lastRefillAt: number;
  refillInFlight: boolean;
  llmRefillCount: number;
  lastLlmRefillAt: number;
  /** Cursor ritme — dipertahankan antar refill agar topik tidak berulang di awal slot. */
  rhythmCursor: number;
  /** Topik yang sudah dipakai di siklus terakhir — hindari loop berturut-turut. */
  usedTopics: string[];
}

export interface ExtractedProductKnowledge {
  benefits: string;
  usage: string;
  faq: string;
}

const BENEFIT_HINT =
  /\b(manfaat|kelebihan|plus|khasiat|mengurangi|menghilangkan|membantu|mencerahkan|melembapkan|menyamarkan|tahan|awet|lembut|halus|ringan|nyaman|cocok untuk|untuk kulit|untuk rambut|spf|anti|vitamin|formula|kandungan|bahan|material|fitur|kuat di|unggul|hemat|praktis|efektif)\b/i;
const USAGE_HINT =
  /\b(cara pakai|pemakaian|pakai|gunakan|aplikasikan|oleskan|teteskan|minum|konsumsi|step|langkah|sebelum|sesudah|setelah|pagi|malam|rutin|2x|dua kali|sehari|dioles|ditaruh|dilap|dicampur)\b/i;
const FAQ_HINT =
  /\b(berapa|harga|ongkir|kirim|cod|garansi|bpom|halal|expired|ed|ukuran|ml|gram|isi|kemasan|varian|warna|size|sisa|stok|berapa lama|berapa kali)\b/i;

/** Ekstrak benefits/usage/faq HANYA dari teks deskripsi — tanpa mengarang fakta baru. */
export function extractProductKnowledgeFromDescription(
  description: string,
): ExtractedProductKnowledge {
  const sentences = splitFacts(description);
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

  // Kalimat netral dialokasikan ke benefits dulu (paling sering dipakai di live).
  if (benefits.length === 0 && neutral.length > 0) {
    const half = Math.ceil(neutral.length / 2);
    benefits.push(...neutral.splice(0, half));
  }
  if (usage.length === 0 && neutral.length > 0) {
    usage.push(neutral.shift()!);
  }
  if (faq.length === 0 && neutral.length > 0) {
    faq.push(neutral.shift()!);
  }
  if (benefits.length === 0 && neutral.length > 0) {
    benefits.push(...neutral);
  }

  return {
    benefits: benefits.join(". ").trim(),
    usage: usage.join(". ").trim(),
    faq: faq.join(". ").trim(),
  };
}

/** Gabungkan field opsional user + ekstraksi dari deskripsi (tanpa ngarang). */
export function mergeProductKnowledge(
  description: string,
  existing: { benefits?: string; usage?: string; faq?: string },
): { benefits: string; usage: string; faq: string } {
  const extracted = extractProductKnowledgeFromDescription(description);
  return {
    benefits: existing.benefits?.trim() || extracted.benefits,
    usage: existing.usage?.trim() || extracted.usage,
    faq: existing.faq?.trim() || extracted.faq,
  };
}

/** Ritme otonom: slot berurutan supaya CTA/harga tidak numpuk.
 *  Filler/energy_reset sengaja TIDAK masuk ritme — hanya cadangan saat buffer kritis. */
export const RHYTHM_SLOTS: string[] = [
  "problem",
  "benefit",
  "how_to_use",
  "value",
  "social_engagement",
  "micro_tip",
  "objection",
  "use_case",
  "soft_cta",
  "reframe",
  "buyer_fit",
  "faq",
  "promo_pitch",
  "mini_story",
  "banner_callout",
  "catalog_bridge",
  "how_to_use",
  "closing_loop",
];

export const FILLER_TOPICS = new Set(["filler", "energy_reset"]);

/** Kapasitas bank lokal per produk — cukup untuk marathon 8–24 jam tanpa LLM live. */
export const SCRIPT_BANK_CAP = Number(process.env.LIVE_SCRIPT_BANK_CAP || 520);
const RECYCLE_BATCH = Number(process.env.LIVE_SCRIPT_BANK_RECYCLE_BATCH || 160);
const RECYCLE_ROUNDS = Number(process.env.LIVE_SCRIPT_BANK_RECYCLE_ROUNDS || 3);

const PARAPHRASE_OPENERS = [
  "Nah, ",
  "Oke jadi ",
  "Yang penting ",
  "Intinya ",
  "Biar jelas — ",
  "Singkatnya ",
  "Sekadar sharing — ",
  "Yang sering ditanya — ",
  "Aku tekankan lagi — ",
  "Poin ini penting — ",
  "Jadi gini — ",
  "Yang perlu dicatat — ",
];

/** Max fraction of recycle lines that may get a paraphrase opener (anti AI-template). */
const PARAPHRASE_VARIANT_RATE = Number(process.env.LIVE_PARAPHRASE_VARIANT_RATE || 0.18);

const LLM_COMMENT_INTENTS = new Set<HostIntent>([
  "OBJECTION",
  "BUYING_INTENT",
  "COMPLAINT",
  "ANSWER",
  "ANNOUNCEMENT",
]);

const TOPIC_MODES: Record<string, HostMode[]> = {
  problem: ["ENGAGE", "SELL"],
  benefit: ["SELL", "DEMO"],
  how_to_use: ["DEMO", "QNA"],
  buyer_fit: ["ENGAGE", "SELL"],
  objection: ["OBJECTION"],
  comparison: ["QNA", "SELL"],
  value: ["SELL", "ENGAGE"],
  use_case: ["ENGAGE", "DEMO"],
  micro_tip: ["DEMO", "ENGAGE"],
  catalog_bridge: ["SELL", "ENGAGE"],
  soft_cta: ["SELL"],
  social_engagement: ["SOCIAL", "ENGAGE"],
  reframe: ["OBJECTION", "ENGAGE"],
  mini_story: ["ENGAGE", "SOCIAL"],
  price_context: ["SELL", "QNA"],
  faq: ["QNA"],
  energy_reset: ["ENGAGE", "SOCIAL"],
  closing_loop: ["CLOSING"],
  filler: ["ENGAGE", "SOCIAL"],
  promo_pitch: ["SELL"],
  sold_out: ["SELL", "ENGAGE"],
  deflection: ["SOCIAL", "ENGAGE"],
  banner_callout: ["ENGAGE", "SELL"],
};

/** Sapaan jarang — dikelompokkan supaya "Halo"/"Hai" dihitung satu kelas. */
export const GREETING_CLASSES: Array<{ id: string; pattern: RegExp }> = [
  { id: "halo", pattern: /^(halo|hai|hey|hi)\b/i },
  { id: "guys", pattern: /^(guys|gaste|gas)\b/i },
  { id: "kak", pattern: /^(kak|kakak)\b/i },
  { id: "teman", pattern: /^(teman[- ]?teman|semuanya|semua)\b/i },
  { id: "selamat", pattern: /^(selamat\s+(datang|pagi|siang|sore|malam))\b/i },
];

const RARE_GREETINGS = ["Kak, ", "Guys, "];

/** Deteksi kelas sapaan di awal kalimat (untuk anti-repeat). */
export function detectGreetingClass(speech: string): string | null {
  const head = String(speech || "")
    .replace(/^\s+/, "")
    .slice(0, 48);
  for (const g of GREETING_CLASSES) {
    if (g.pattern.test(head)) return g.id;
  }
  return null;
}

export function hasRecentGreetingClass(
  speech: string,
  recentSpeeches: string[],
  window = 8,
): boolean {
  const cls = detectGreetingClass(speech);
  if (!cls) return false;
  return recentSpeeches.slice(-window).some((item) => detectGreetingClass(item) === cls);
}

export function stripLeadingGreeting(speech: string): string {
  const raw = String(speech || "").trim();
  if (!raw) return raw;
  const stripped = raw
    .replace(
      /^(halo|hai|hey|hi|guys|kak|kakak|teman[- ]?teman|semuanya|semua|selamat\s+(datang|pagi|siang|sore|malam))[,!.\s]+/i,
      "",
    )
    .trim();
  if (!stripped) return raw;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function clampSpeech(text: string, maxWords = 32): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

function splitFacts(text: string): string[] {
  if (!text?.trim()) return [];
  return text
    .split(/[.!?;\n|,]+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 10 && part.length <= 180);
}

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similar(a: string, b: string): boolean {
  return isExactRepeat(a, b) || isLexicalRepeat(a, b);
}

function similarToAny(speech: string, recent: string[]): boolean {
  return recent.some((item) => similar(speech, item));
}

function openingPhrase(speech: string, words = 4): string {
  return marathonOpeningPhrase(speech, words);
}

function sharesOpening(speech: string, recent: string[]): boolean {
  const open = openingPhrase(speech);
  if (!open || open.split(" ").length < 3) return false;
  if (recent.some((item) => openingPhrase(item) === open)) return true;
  return hasRecentGreetingClass(speech, recent, 6);
}

/** Variasi pembuka terbatas — jangan jadi mekanisme naturalness utama. */
function withParaphraseVariants(items: HostResponse[]): HostResponse[] {
  const out: HostResponse[] = [];
  let variantsAdded = 0;
  const maxVariants = Math.max(1, Math.floor(items.length * PARAPHRASE_VARIANT_RATE));
  for (const item of items) {
    out.push(item);
    if (FILLER_TOPICS.has(item.topic || "")) continue;
    if (variantsAdded >= maxVariants) continue;
    if (Math.random() > PARAPHRASE_VARIANT_RATE) continue;
    const speech = item.speech.trim();
    if (!speech || speech.split(" ").length < 8) continue;
    // Skip jika sudah punya opener template.
    if (/^(nah|oke jadi|yang penting|intinya|biar jelas|singkatnya|jadi gini)\b/i.test(speech)) {
      continue;
    }
    const opener = PARAPHRASE_OPENERS[Math.floor(Math.random() * PARAPHRASE_OPENERS.length)] || "";
    if (!opener) continue;
    const body = speech.charAt(0).toLowerCase() + speech.slice(1);
    const variant = `${opener}${body}`;
    if (normalize(variant) === normalize(speech)) continue;
    out.push({
      ...item,
      speech: clampSpeech(variant, FILLER_TOPICS.has(item.topic) ? 16 : 32),
    });
    variantsAdded++;
  }
  return out;
}

/** Hook penjualan product-agnostic (intent-first) — cocok semua kategori. */
function intentAgnosticHooks(
  product: ScriptProductFacts,
  entryMode: ProductEntryMode = "continuing",
): HostResponse[] {
  const name = ref(product, entryMode);
  const price = product.price || "harga live";
  const fact = pickFact(factChunks(product), `kelebihan ${product.name || "produk ini"}`);
  const need = domainNeed(product.category || "");
  const speeches: Array<{
    speech: string;
    topic: string;
    mode: HostMode;
    cta?: HostResponse["ctaType"];
    behavior?: SpeechBehavior;
  }> = [
    {
      speech:
        entryMode === "re_entry"
          ? `Tadi kita sempat bahas ${name}. Sekarang dari sisi kebutuhan ${need}: ${fact}.`
          : `Kalau kamu lagi cari solusi ${need}, ${name} patut dicek — ${fact}.`,
      topic: "problem",
      mode: "ENGAGE",
      behavior: entryMode === "re_entry" ? "transition" : "observation",
    },
    {
      speech: `Poin utamanya: ${fact}. Itu yang bikin ${name} relevan di live ini.`,
      topic: "benefit",
      mode: "SELL",
      behavior: "clarification",
    },
    {
      speech: `Dipakai sehari-hari juga masuk akal: ${fact}.`,
      topic: "use_case",
      mode: "ENGAGE",
      behavior: "scenario",
    },
    {
      speech: `Bandingin value-nya: ${fact} dengan harga live ${price}.`,
      topic: "value",
      mode: "SELL",
      cta: "SOFT",
      behavior: "comparison",
    },
    {
      speech: `Yang masih ragu, fokuskan dulu: ${fact}. Baru putuskan.`,
      topic: "objection",
      mode: "OBJECTION",
      behavior: "thinking",
    },
    {
      speech: `${name} cocok kalau ${need} memang prioritasmu sekarang.`,
      topic: "buyer_fit",
      mode: "ENGAGE",
      behavior: "audience_engagement",
    },
    {
      speech: `Mau lanjut? Cek ${name} di etalase — live ${price}.`,
      topic: "soft_cta",
      mode: "SELL",
      cta: "SOFT",
      behavior: "soft_cta",
    },
  ];
  return speeches.map((s) =>
    line(s.speech, s.topic, s.mode, {
      ctaType: s.cta,
      behavior: s.behavior,
    }),
  );
}

/** Hook kategori = bonus kecil, bukan sumber utama (product-agnostic first). */
function categorySalesHooks(product: ScriptProductFacts): HostResponse[] {
  const name = product.name || "produk ini";
  const price = product.price || "harga live";
  const cat = (product.category || "").toLowerCase();
  const fact = pickFact(factChunks(product), `keunggulan ${name}`);
  const templates: Array<{ match: RegExp; speeches: string[] }> = [
    {
      match: /skincare|beauty|makeup/,
      speeches: [
        `Yang fokus perawatan, ${name} relevan karena ${fact}.`,
        `Rutinitas simple: ${name} — ${fact}. Live ${price}.`,
      ],
    },
    {
      match: /fashion|pakaian|hijab|sepatu|aksesoris/,
      speeches: [
        `Buat tampilan lebih rapi, ${name} — ${fact}. Live ${price}.`,
        `Styling praktis pakai ${name}: ${fact}.`,
      ],
    },
    {
      match: /makanan|minuman|fnb|kuliner/,
      speeches: [
        `Buat stok atau coba rasa baru, ${name} — ${fact}. Harga live ${price}.`,
      ],
    },
    {
      match: /elektronik|gadget/,
      speeches: [
        `Yang cari perangkat praktis, ${name}: ${fact}. Live ${price}.`,
      ],
    },
    {
      match: /kesehatan|herbal|ibu|bayi|rumah|tangga/,
      speeches: [
        `Yang prioritaskan ${domainNeed(cat)}, ${name} — ${fact}.`,
      ],
    },
  ];
  const matched = templates.find((t) => t.match.test(cat));
  if (!matched) return [];
  return matched.speeches.map((speech) =>
    line(speech, "promo_pitch", "SELL", { ctaType: "SOFT" }),
  );
}

/** Kombinasi 2 fakta → variasi ekstra tanpa LLM. */
function crossFactLines(product: ScriptProductFacts): HostResponse[] {
  const name = product.name || "produk ini";
  const price = product.price || "harga live";
  const facts = factChunks(product).slice(0, 12);
  const out: HostResponse[] = [];
  for (let i = 0; i < facts.length - 1; i++) {
    const a = facts[i]!;
    const b = facts[i + 1]!;
    out.push(
      line(`${greet()}${name}: ${a}, ditambah ${b}.`, "benefit", "SELL"),
      line(`Dua alasan coba ${name} — ${a}; lalu ${b}. Live ${price}.`, "value", "SELL", { ctaType: "SOFT" }),
      line(`Kalau ${a} cocok buat kamu, ${b} juga penting di ${name}.`, "use_case", "ENGAGE"),
    );
  }
  return out;
}

function shuffled<T>(items: T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = current;
  }
  return copy;
}

function greet(): string {
  // ~5% saja pakai sapaan — sisanya langsung ke isi.
  if (Math.random() > 0.05) return "";
  return RARE_GREETINGS[Math.floor(Math.random() * RARE_GREETINGS.length)] || "";
}

function line(
  speech: string,
  topic: string,
  mode: HostMode,
  extras?: Partial<HostResponse>,
): HostResponse {
  const emotions: LunaEmotion[] = ["warm", "neutral", "happy", "excited"];
  const maxWords = FILLER_TOPICS.has(topic) ? 16 : 32;
  const clamped = clampSpeech(speech, maxWords);
  const semanticKey = extras?.semanticKey || inferSemanticKey(clamped, topic);
  const salesRule =
    extras?.salesRule ||
    (extras?.ctaType && extras.ctaType !== "NONE"
      ? inferSalesRule(topic, extras.ctaType) || undefined
      : undefined);
  return {
    speech: clamped,
    action: extras?.action
      ? normalizeLunaAction(extras.action)
      : inferCtaPointAction(speech, topic),
    emotion: extras?.emotion || emotions[Math.floor(Math.random() * emotions.length)] || "warm",
    intent: extras?.intent || "SELL",
    mode,
    topic,
    ctaType: extras?.ctaType || "NONE",
    target_product_id: extras?.target_product_id ?? null,
    interruptible: extras?.interruptible ?? true,
    claims: extras?.claims || [],
    behavior: extras?.behavior,
    semanticKey,
    salesRule: salesRule || undefined,
    cycleId: extras?.cycleId,
  };
}

function ref(
  product: ScriptProductFacts,
  entryMode: ProductEntryMode = "continuing",
  forceName = false,
): string {
  return productReference(product.name || "produk ini", entryMode, { forceName });
}

function pickFact(facts: string[], fallback: string): string {
  if (!facts.length) return fallback;
  return facts[Math.floor(Math.random() * facts.length)] || fallback;
}

function domainNeed(category: string): string {
  const c = category.toLowerCase();
  if (/skincare|beauty|makeup/.test(c)) return "perawatan";
  if (/fashion|pakaian|hijab|sepatu|aksesoris/.test(c)) return "tampilan";
  if (/makanan|minuman|fnb|kuliner/.test(c)) return "selera makan";
  if (/elektronik|gadget/.test(c)) return "kebutuhan perangkat";
  if (/kesehatan|herbal/.test(c)) return "perawatan tubuh";
  if (/ibu|bayi/.test(c)) return "kebutuhan ibu dan bayi";
  if (/rumah|umum/.test(c)) return "isi rumah";
  return "kebutuhan kamu";
}

function factChunks(product: ScriptProductFacts): string[] {
  const name = product.name || "produk ini";
  const merged = mergeProductKnowledge(product.description, {
    benefits: product.benefits,
    usage: product.usage,
    faq: product.faq,
  });
  const chunks = [
    ...splitFacts(merged.benefits),
    ...splitFacts(product.description),
    ...splitFacts(merged.usage),
    ...splitFacts(merged.faq),
    ...splitFacts(product.copywriting || ""),
    ...splitFacts(product.targetAudience || ""),
  ].slice(0, 28);
  if (chunks.length === 0) chunks.push(`yang bikin ${name} beda dari yang lain`);
  return chunks;
}

function fillerLines(product: ScriptProductFacts): HostResponse[] {
  // Cadangan pendek berbasis fakta produk — BUKAN stall "sebentar/pelan-pelan/halo".
  const name = product.name || "produk ini";
  const facts = factChunks(product).slice(0, 6);
  const drafts = facts.length
    ? facts.map((fact) => `Satu poin ${name}: ${fact}.`)
    : [
        `${name} ini yang lagi kita bahas di live.`,
        `Fokus dulu di ${name} biar jelas.`,
        `${name} siap dicek di etalase ya.`,
      ];
  return drafts.map((speech) =>
    line(speech, "filler", "ENGAGE", { intent: "SOCIAL", emotion: "warm", ctaType: "NONE" }),
  );
}

function promoPitchLines(
  product: ScriptProductFacts,
  entryMode: ProductEntryMode = "continuing",
): HostResponse[] {
  const name = ref(product, entryMode);
  const price = product.price || "harga live";
  const benefit = pickFact(
    splitFacts(product.benefits),
    pickFact(splitFacts(product.description), `kelebihan ${product.name || "produk ini"}`),
  );
  const usage = pickFact(splitFacts(product.usage), "ikutin cara pakai di kemasan");
  return [
    line(
      `${greet()}yang lagi dicari: ${name}. Plus-nya ${benefit}. Live price ${price} — cek keranjang kalau cocok.`,
      "promo_pitch",
      "SELL",
      { ctaType: "SOFT", behavior: "soft_cta" },
    ),
    line(
      `Hook singkat: ${name} fokus buat yang butuh ${benefit}. Harganya ${price}. Nggak dipaksa, cek dulu.`,
      "promo_pitch",
      "SELL",
      { ctaType: "SOFT", behavior: "clarification" },
    ),
    line(
      `${greet()}${name} — ${benefit}. Cara pakainya ${usage}. Live ${price}, keranjang siap kalau kamu yakin.`,
      "promo_pitch",
      "SELL",
      { ctaType: "DIRECT", behavior: "direct_cta" },
    ),
    line(
      `Kalau fokusnya ${benefit}, coba lihat ${name} di live ini ${price}. Soft aja: cek keranjangnya.`,
      "promo_pitch",
      "SELL",
      { ctaType: "SOFT", behavior: "soft_cta" },
    ),
    line(
      `${greet()}ringkas: ${name}, ${benefit}, harga ${price}. Kalau nyambung, baru klik keranjang.`,
      "promo_pitch",
      "SELL",
      { ctaType: "SOFT", behavior: "soft_cta" },
    ),
    line(
      `Yang nanya ${name} — ${benefit}, live ${price}.`,
      "promo_pitch",
      "SELL",
      { ctaType: "SOFT", behavior: "answer" },
    ),
    line(
      `${greet()}banyak yang nanya ${name}. ${benefit}. ${price} di live.`,
      "promo_pitch",
      "SELL",
      { ctaType: "DIRECT", behavior: "observation" },
    ),
    line(
      entryMode === "new_viewer" || entryMode === "first_intro"
        ? `Yang baru join, kita bahas ${name}: ${benefit}. Harganya ${price}.`
        : `Sekilas lagi soal ${name}: ${benefit}. Harganya ${price}.`,
      "promo_pitch",
      "SELL",
      { ctaType: "SOFT", behavior: "audience_engagement" },
    ),
  ];
}

function bridgeLines(
  product: ScriptProductFacts,
  catalog: Array<{ name: string }>,
): HostResponse[] {
  const name = product.name || "produk ini";
  const other = catalog.find((item) => item.name && item.name !== name)?.name;
  if (!other) {
    return [
      line(
        `${greet()}fokus dulu di ${name}. Produk lain kita buka kalau emang perlu.`,
        "catalog_bridge",
        "ENGAGE",
      ),
      line(`Kita lag di ${name} dulu biar nggak lompat-lompat.`, "catalog_bridge", "ENGAGE"),
      line(
        `Etalase lain nanti. Sekarang masih soal ${name}.`,
        "catalog_bridge",
        "SELL",
      ),
    ];
  }
  return [
    line(
      `${greet()}kalau ${name} belum pas, bisa cek ${other} juga — masih di etalase live ini.`,
      "catalog_bridge",
      "SELL",
    ),
    line(
      `Bridge singkat: dari ${name} ke ${other}. Bukan hard sell, cuma opsi lain di etalase.`,
      "catalog_bridge",
      "ENGAGE",
    ),
    line(
      `Yang masih ragu sama ${name} boleh stay. Yang mau banding, ${other} juga ada di live ini.`,
      "catalog_bridge",
      "SELL",
    ),
  ];
}

function stockLines(
  product: ScriptProductFacts,
  catalog: Array<{ name: string }>,
): HostResponse[] {
  const name = product.name || "produk ini";
  const stock = Number(product.stock);
  const other = catalog.find((item) => item.name && item.name !== name)?.name;
  const lines: HostResponse[] = [];

  if (Number.isFinite(stock) && stock <= 0) {
    lines.push(
      line(
        `${greet()}${name} lagi kosong di live ini. ${other ? `Cek dulu ${other} di etalase.` : "Nanti kita update kalau stok masuk."}`,
        "sold_out",
        "SELL",
        { intent: "ANNOUNCEMENT", ctaType: other ? "SOFT" : "NONE" },
      ),
      line(
        `Sold out dulu buat ${name}. ${other ? `Yang masih ada: ${other}.` : "Stay di live, jangan buru-buru."}`,
        "sold_out",
        "ENGAGE",
        { intent: "ANNOUNCEMENT" },
      ),
      line(
        `${name} habis ya. Aku nggak maksa. ${other ? `Geser ke ${other} kalau mau.` : "Tanya produk lain aja."}`,
        "sold_out",
        "SELL",
        { intent: "ANNOUNCEMENT", ctaType: "NONE" },
      ),
    );
  } else if (Number.isFinite(stock) && stock > 0 && stock <= 5) {
    lines.push(
      line(
        `${greet()}stok ${name} di live ini tinggal ${stock}. Cek dulu cocok nggak, jangan FOMO palsu.`,
        "price_context",
        "SELL",
        { intent: "ANNOUNCEMENT", ctaType: "SOFT" },
      ),
      line(
        `Info stok: ${name} sisa ${stock}. Itu angka etalase saat ini.`,
        "value",
        "ENGAGE",
        { intent: "ANNOUNCEMENT" },
      ),
    );
  }
  return lines;
}

function bannerLines(
  product: ScriptProductFacts,
  entryMode: ProductEntryMode = "continuing",
): HostResponse[] {
  if (!product.hasBanner) return [];
  const name = ref(product, entryMode);
  const contexts: BannerCTAContext[] =
    entryMode === "re_entry"
      ? ["product_transition", "soft_reminder", "detail", "checkout"]
      : entryMode === "first_intro" || entryMode === "new_viewer"
        ? ["new_viewer", "info", "detail", "price"]
        : ["info", "price", "variant", "detail", "checkout", "soft_reminder", "confused_buyer", "audience_question"];
  return contexts.map((ctx) => {
    const built = buildBannerCtaSpeech(name, ctx);
    return line(built.speech, "banner_callout", ctx === "checkout" ? "SELL" : "ENGAGE", {
      intent: "SOCIAL",
      ctaType: "SOFT",
      salesRule: built.salesRule,
      behavior: "soft_cta",
    });
  });
}

function deflectionLines(product: ScriptProductFacts): HostResponse[] {
  const name = product.name || "produk ini";
  return [
    line(
      `${greet()}topiknya agak melebar. Kita balik ke ${name} dulu ya.`,
      "deflection",
      "SOCIAL",
      { intent: "SOCIAL" },
    ),
    line(
      `Aku skip yang spam ya. Fokus ke ${name} biar chatnya bermanfaat.`,
      "deflection",
      "ENGAGE",
      { intent: "SPAM" },
    ),
    line(
      `${greet()}santai, nggak perlu debat. Ada pertanyaan spesifik soal ${name}?`,
      "deflection",
      "SOCIAL",
      { intent: "SOCIAL" },
    ),
  ];
}

function combinatorialLines(
  product: ScriptProductFacts,
  catalog: Array<{ name: string }>,
  entryMode: ProductEntryMode = "continuing",
): HostResponse[] {
  const name = ref(product, entryMode);
  const price = product.price || "harga live";
  const need = domainNeed(product.category || "");
  const facts = factChunks(product);
  const other = catalog.find((item) => item.name && item.name !== product.name)?.name;

  const frames: Array<{
    topic: string;
    mode: HostMode;
    build: (fact: string, i: number) => string;
    extras?: Partial<HostResponse>;
  }> = [
    { topic: "benefit", mode: "SELL", build: (fact) => `${greet()}yang aku suka dari ${name}: ${fact}.` },
    { topic: "benefit", mode: "DEMO", build: (fact) => `${name} ini kuat di ${fact} — kelihatan dari info produknya.` },
    { topic: "benefit", mode: "ENGAGE", build: (fact) => `Kalau ditanya plus ${name}, aku bilang ${fact}.` },
    { topic: "problem", mode: "ENGAGE", build: (fact) => `${greet()}lagi ribet soal ${need}? Coba cek ${fact}.` },
    { topic: "problem", mode: "SELL", build: (fact) => `Buat yang butuh ${need}, ${name} nyambung karena ${fact}.` },
    { topic: "how_to_use", mode: "DEMO", build: (fact) => `${greet()}cara pakainya gampang: ${fact}.` },
    { topic: "how_to_use", mode: "QNA", build: (fact) => `Pakai ${name} begini aja: ${fact}.`, extras: { intent: "PRODUCT_INFO" } },
    { topic: "how_to_use", mode: "DEMO", build: (fact) => `Jangan dipersulit — ${fact}.` },
    { topic: "value", mode: "SELL", build: (fact) => `Live ${price}. Worth-nya kalau kamu emang butuh ${fact}.` },
    { topic: "value", mode: "ENGAGE", build: (fact) => `${name} ${price}. Bandingin sama ${fact}, santai aja.` },
    { topic: "value", mode: "SELL", build: (fact) => `${greet()}intinya ${fact}, harganya ${price}.` },
    { topic: "faq", mode: "QNA", build: (fact) => `Yang sering ditanya: ${fact}.`, extras: { intent: "PRODUCT_INFO" } },
    { topic: "faq", mode: "QNA", build: (fact) => `${greet()}${fact} — itu yang aku bisa jawab dari info ${name}.`, extras: { intent: "PRODUCT_INFO" } },
    { topic: "objection", mode: "OBJECTION", build: (fact) => `Ragu? Wajar. Aku pegang yang ini dulu: ${fact}.` },
    { topic: "objection", mode: "OBJECTION", build: (fact) => `${greet()}nggak usah ribut. Kita lihat ${fact} aja.` },
    { topic: "use_case", mode: "DEMO", build: (fact) => `Bayangin pas lagi butuh ${need} — ${fact}.` },
    { topic: "use_case", mode: "ENGAGE", build: (fact) => `${greet()}skenarionya simple: ${fact}.` },
    { topic: "micro_tip", mode: "ENGAGE", build: (fact) => `Tips kecil: ${fact}.` },
    { topic: "micro_tip", mode: "DEMO", build: (fact) => `${greet()}biar hasilnya maksimal, ${fact}.` },
    { topic: "reframe", mode: "ENGAGE", build: (fact) => `Jangan ikut ramai dulu. Cek ${fact}.` },
    { topic: "reframe", mode: "OBJECTION", build: (fact) => `${greet()}sudut lain: ${fact}.` },
    { topic: "buyer_fit", mode: "SELL", build: (fact) => `Cocok buat yang lagi cari ${need} — ${fact}.` },
    { topic: "buyer_fit", mode: "ENGAGE", build: (fact) => `${greet()}${name} lebih pas kalau kamu butuh ${need}: ${fact}.` },
    { topic: "price_context", mode: "SELL", build: (fact) => `${name} sekarang ${price}. ${fact}.`, extras: { ctaType: "PRICE", intent: "PRICE" } },
    { topic: "price_context", mode: "QNA", build: () => `${greet()}harganya ${price} ya. Ongkirnya cek di checkout.`, extras: { ctaType: "NONE", intent: "PRICE" } },
    { topic: "soft_cta", mode: "SELL", build: (fact) => `Kalau ${fact} emang kamu butuhin, boleh cek keranjangnya.`, extras: { ctaType: "SOFT" } },
    { topic: "soft_cta", mode: "SELL", build: (fact) => `${greet()}nggak dipaksa. Kalau ${fact} nyambung, keranjangnya siap.`, extras: { ctaType: "SOFT" } },
    { topic: "social_engagement", mode: "SOCIAL", build: (fact) => `Mau nanya soal ${fact}? Langsung ketik aja.`, extras: { intent: "SOCIAL" } },
    { topic: "social_engagement", mode: "ENGAGE", build: () => `Ada yang belum jelas soal ${name}? Tulis di chat, nanti aku jawab.`, extras: { intent: "SOCIAL" } },
    { topic: "social_engagement", mode: "SOCIAL", build: (fact) => `Chat spesifik aja — misalnya soal ${fact}.`, extras: { intent: "SOCIAL" } },
    { topic: "energy_reset", mode: "ENGAGE", build: (fact) => `Intinya ${name}: ${fact}.`, extras: { intent: "SOCIAL" } },
    { topic: "energy_reset", mode: "SOCIAL", build: (fact) => `Kita pegang poin ini dulu: ${fact}.`, extras: { intent: "SOCIAL" } },
    { topic: "closing_loop", mode: "CLOSING", build: (fact) => `Jadi ${name}: ${fact}. Live ${price}.`, extras: { ctaType: "SOFT" } },
    { topic: "closing_loop", mode: "CLOSING", build: (fact) => `${greet()}ingat ya — ${fact}. ${name} ${price}.`, extras: { ctaType: "SOFT" } },
    { topic: "mini_story", mode: "ENGAGE", build: (fact) => `Cerita singkatnya: ${fact}.` },
    { topic: "mini_story", mode: "SOCIAL", build: (fact) => `${greet()}singkat aja — ${fact}.` },
    { topic: "comparison", mode: "QNA", build: (fact) => other
      ? `${name} soal ${fact}. Kalau mau opsi lain, ada ${other} di etalase.`
      : `Fokus ${name} dulu: ${fact}.` },
    { topic: "promo_pitch", mode: "SELL", build: (fact) => `${greet()}yang lagi scroll, ${name} ${price} — ${fact}.`, extras: { ctaType: "SOFT" } },
    { topic: "promo_pitch", mode: "SELL", build: (fact) => `Kalau ${fact} penting buatmu, ${name} patut dicek.`, extras: { ctaType: "SOFT" } },
    { topic: "benefit", mode: "SELL", build: (fact) => `Ini yang bikin ${name} beda: ${fact}.`, extras: { ctaType: "NONE" } },
    { topic: "benefit", mode: "ENGAGE", build: (fact) => `${greet()}dari info produknya, ${fact} — itu kekuatan ${name}.` },
    { topic: "value", mode: "SELL", build: (fact) => `Harga ${price}, dapat ${fact}. Hitung sendiri apakah masuk.`, extras: { ctaType: "PRICE", intent: "PRICE" } },
    { topic: "objection", mode: "OBJECTION", build: (fact) => `Takut nggak cocok? Cek dulu: ${fact}.`, extras: { intent: "OBJECTION" } },
    { topic: "use_case", mode: "ENGAGE", build: (fact) => `Pas banget ${name} kalau ${fact}.`, extras: { intent: "SOCIAL" } },
    { topic: "micro_tip", mode: "DEMO", build: (fact) => `${greet()}tips pakai ${name}: ${fact}.` },
    { topic: "closing_loop", mode: "CLOSING", build: (fact) => `Udah jelas kan? ${name} — ${fact}. ${price}.`, extras: { ctaType: "SOFT" } },
  ];

  const drafts: HostResponse[] = [];
  for (let i = 0; i < facts.length; i++) {
    const fact = facts[i]!;
    for (const frame of frames) {
      drafts.push(line(frame.build(fact, i), frame.topic, frame.mode, frame.extras));
    }
  }
  return drafts;
}

export function emptyScriptBank(productId = ""): ScriptBankState {
  return {
    productId,
    lines: [],
    lastRefillAt: 0,
    refillInFlight: false,
    llmRefillCount: 0,
    lastLlmRefillAt: 0,
    rhythmCursor: 0,
    usedTopics: [],
  };
}

export function remainingScriptLines(bank: ScriptBankState): number {
  return bank.lines.length;
}

export function commentNeedsLlm(intent: HostIntent, text: string): boolean {
  if (intent === "SPAM" || intent === "SOCIAL" || intent === "THANKS") return false;
  if (LLM_COMMENT_INTENTS.has(intent)) return true;
  if (intent === "OTHER" && text.includes("?")) return true;
  return false;
}

/** Baris bank yang belum mirip ucapan terakhir — indikator variasi masih ada. */
export function countFreshScriptLines(bank: ScriptBankState, recent: string[] = []): number {
  return bank.lines.filter(
    (item) => !similarToAny(item.speech, recent) && !sharesOpening(item.speech, recent),
  ).length;
}

function commentKeywordOverlap(commentText: string, corpus: string): number {
  const words = normalize(commentText)
    .split(" ")
    .filter((w) => w.length >= 4);
  if (!words.length) return 0;
  const hay = normalize(corpus);
  let hits = 0;
  for (const w of words) if (hay.includes(w)) hits++;
  return hits;
}

/**
 * LLM untuk komentar hanya bila bank/FAQ lokal belum cukup — bukan tiap komentar.
 * Tetap hemat: harga/ongkir/cara pakai/FAQ pack tetap lokal.
 */
export function shouldUseLlmForComment(
  product: ScriptProductFacts,
  commentText: string,
  intent: HostIntent,
): { needed: boolean; reason: string } {
  const text = commentText.trim();
  if (!text) return { needed: false, reason: "empty" };
  if (intent === "SPAM") return { needed: false, reason: "spam" };

  const packs = product.faqPack?.length ? product.faqPack : buildDefaultFaqPack(product);
  if (matchFaqPack(text, packs)) return { needed: false, reason: "faq-pack" };

  const bucket = detectCommentBucket(text, intent);
  if (bucket === "PRICE" || bucket === "USAGE" || bucket === "SHIPPING") {
    return { needed: false, reason: "known-bucket" };
  }

  if (intent === "THANKS") return { needed: false, reason: "thanks" };
  if (intent === "SOCIAL" && !text.includes("?") && text.length < 48) {
    return { needed: false, reason: "social" };
  }

  const merged = mergeProductKnowledge(product.description, {
    benefits: product.benefits,
    usage: product.usage,
    faq: product.faq,
  });
  const factOverlap =
    commentKeywordOverlap(text, merged.faq) +
    commentKeywordOverlap(text, merged.benefits) +
    commentKeywordOverlap(text, merged.usage);
  if (factOverlap >= 3 && bucket === "PRODUCT_INFO") {
    return { needed: false, reason: "product-facts" };
  }

  if (commentNeedsLlm(intent, text)) return { needed: true, reason: "intent" };

  const openQuestion =
    text.includes("?") ||
    /\b(gimana|gmn|kenapa|kapan|bisa|apakah|berapa|mana|boleh|maksudnya)\b/i.test(text);
  if (openQuestion && (intent === "OTHER" || intent === "ANSWER")) {
    return { needed: true, reason: "open-question" };
  }

  if ((intent === "COMPLAINT" || intent === "OBJECTION") && text.length > 40) {
    return { needed: true, reason: "complex-objection" };
  }

  if (intent === "PRODUCT_INFO" && factOverlap < 2 && openQuestion) {
    return { needed: true, reason: "specific-info" };
  }

  return { needed: false, reason: "local-default" };
}

/** Cari baris QNA/FAQ di bank yang relevan dengan komentar. */
export function pickScriptBankCommentLine(
  bank: ScriptBankState,
  commentText: string,
  recent: string[] = [],
): HostResponse | null {
  const words = normalize(commentText)
    .split(" ")
    .filter((w) => w.length >= 4);
  if (!words.length) return null;

  let best: HostResponse | null = null;
  let bestScore = 0;
  for (const item of bank.lines) {
    const topic = normalize(item.topic || "");
    const mode = item.mode || "";
    const isQna =
      mode === "QNA" ||
      topic === "faq" ||
      item.intent === "PRODUCT_INFO" ||
      item.intent === "PRICE" ||
      item.intent === "ANSWER";
    if (!isQna) continue;
    if (similarToAny(item.speech, recent) || sharesOpening(item.speech, recent)) continue;
    const speechNorm = normalize(item.speech);
    let hits = 0;
    for (const w of words) if (speechNorm.includes(w)) hits++;
    if (hits > bestScore) {
      bestScore = hits;
      best = item;
    }
  }
  return bestScore >= 2 ? best : null;
}

/** Preferensi topik berdasarkan fase sesi (menit) + offset cycle marathon. */
export function phasePreferTopics(elapsedMinutes: number, cycleId?: number): string[] {
  const cycle = cycleId ?? marathonCycleId(elapsedMinutes);
  const cycleTopics = preferredAnglesForCycle(cycle).map((angle) => {
    const map: Record<string, string> = {
      benefit: "benefit",
      feature: "benefit",
      usage: "how_to_use",
      discovery: "micro_tip",
      problem_solution: "problem",
      target_audience: "buyer_fit",
      common_mistake: "reframe",
      how_to_choose: "comparison",
      scenario: "use_case",
      comparison: "comparison",
      faq: "faq",
      objection: "objection",
      story: "mini_story",
      engagement: "social_engagement",
      observation: "social_engagement",
      care: "micro_tip",
      variant: "catalog_bridge",
      price_context: "price_context",
      catalog: "catalog_bridge",
    };
    return map[angle] || "benefit";
  });

  let base: string[];
  if (elapsedMinutes < 8) {
    base = ["problem", "benefit", "social_engagement", "buyer_fit", "how_to_use", "micro_tip"];
  } else if (elapsedMinutes < 45) {
    base = ["how_to_use", "value", "faq", "objection", "micro_tip", "use_case", "promo_pitch", "benefit"];
  } else if (elapsedMinutes < 180) {
    base = [
      "value",
      "faq",
      "objection",
      "use_case",
      "promo_pitch",
      "benefit",
      "micro_tip",
      "reframe",
      "comparison",
      "mini_story",
      "price_context",
      "buyer_fit",
    ];
  } else if (elapsedMinutes < 480) {
    base = [
      "benefit",
      "use_case",
      "value",
      "faq",
      "objection",
      "micro_tip",
      "promo_pitch",
      "soft_cta",
      "social_engagement",
      "catalog_bridge",
      "reframe",
      "mini_story",
    ];
  } else {
    base = [
      "closing_loop",
      "soft_cta",
      "value",
      "promo_pitch",
      "catalog_bridge",
      "social_engagement",
      "buyer_fit",
      "benefit",
      "use_case",
      "micro_tip",
      "reframe",
      "faq",
    ];
  }
  return preferFreshTopics([...cycleTopics, ...base], undefined, cycle);
}

export function nextRhythmTopic(slotCursor: number): { topic: string; nextCursor: number } {
  const topic = RHYTHM_SLOTS[slotCursor % RHYTHM_SLOTS.length] || "benefit";
  return { topic, nextCursor: slotCursor + 1 };
}

export interface TakeScriptOptions {
  preferMode?: HostMode;
  preferTopic?: string;
  preferTopics?: string[];
  avoidTopics?: string[];
  preferFiller?: boolean;
  avoidCta?: boolean;
  recentTopics?: string[];
  productMemory?: ProductMemory;
  salesMemory?: SalesRuleMemory;
  conversation?: HostConversationMemory;
  now?: number;
  cycleId?: number;
  preferUnusedAngles?: boolean;
}

export interface SeedScriptOptions {
  entryMode?: ProductEntryMode;
  productMemory?: ProductMemory;
  cycleId?: number;
}

export function seedLocalScriptBank(
  product: ScriptProductFacts,
  catalog: Array<{ name: string; benefits?: string }>,
  options?: SeedScriptOptions,
): HostResponse[] {
  const entryMode: ProductEntryMode =
    options?.entryMode ||
    options?.productMemory?.entryMode ||
    "continuing";
  const cycleId = options?.cycleId ?? 0;
  const name =
    entryMode === "first_intro"
      ? ref(product, entryMode, true)
      : ref(product, entryMode);
  const price = product.price || "harga live";
  const category = product.category || "kebutuhan sehari-hari";
  const merged = mergeProductKnowledge(product.description, {
    benefits: product.benefits,
    usage: product.usage,
    faq: product.faq,
  });
  const benefits = splitFacts(merged.benefits);
  const description = splitFacts(product.description);
  const usage = splitFacts(merged.usage);
  const faq = splitFacts(merged.faq);
  const audience = splitFacts(product.targetAudience || "");
  const copyLines = splitFacts(product.copywriting || "");
  const anyFact =
    pickFact(benefits, "") ||
    pickFact(description, "") ||
    pickFact(copyLines, `keunggulan ${product.name || "produk ini"} yang paling kerasa`) ||
    `info resmi ${product.name || "produk ini"}`;

  const audienceLines: HostResponse[] = audience.length
    ? audience.map((fact) =>
        line(
          `${greet()}${name} cocok buat yang ${fact}.`,
          "buyer_fit",
          "ENGAGE",
          { behavior: "audience_engagement", cycleId },
        ),
      )
    : [];

  const copywritingLines: HostResponse[] = copyLines.length
    ? copyLines.map((fact) =>
        line(`${greet()}${fact}`, "benefit", "SELL", { behavior: "clarification", cycleId }),
      )
    : [];

  const reEntryLead: HostResponse[] =
    entryMode === "re_entry"
      ? [
          line(
            `Tadi kita sempat bahas ${name}. Sekarang aku mau lihat dari sisi yang belum sempat dibahas.`,
            "reframe",
            "ENGAGE",
            { behavior: "transition", cycleId },
          ),
          line(
            `Balik lagi ke ${name} — angle-nya beda dari sebelumnya ya.`,
            "reframe",
            "ENGAGE",
            { behavior: "transition", cycleId },
          ),
        ]
      : [];

  const drafts: HostResponse[] = [
    ...reEntryLead,
    line(
      entryMode === "re_entry"
        ? `Kalau dari sisi ${category}, ${name} masih relevan karena ${anyFact}.`
        : `${greet()}kalau sering ribet soal ${category}, ${name} ngebantu di ${anyFact}.`,
      "problem",
      "ENGAGE",
      { behavior: entryMode === "re_entry" ? "transition" : "observation", cycleId },
    ),
    line(
      `Yang paling kepakai dari ${name}: ${pickFact(benefits, anyFact)}. Pilih yang ketemu kebutuhanmu.`,
      "benefit",
      "SELL",
      { behavior: "clarification", cycleId },
    ),
    line(
      `Cara pakainya jangan dibikin ribet: ${pickFact(usage, "ikutin petunjuk di kemasan aja")}.`,
      "how_to_use",
      "DEMO",
      { behavior: "product_demo", cycleId },
    ),
    line(
      `${name} lebih nyambung buat yang cari solusi ${category}, bukan yang cuma ikut ramai.`,
      "buyer_fit",
      "ENGAGE",
      { behavior: "audience_engagement", cycleId },
    ),
    line(
      `Masih ragu? Wajar banget. Yang sering ditanya: ${pickFact(faq, anyFact)}.`,
      "objection",
      "OBJECTION",
      { behavior: "thinking", cycleId },
    ),
    line(
      `Soal value, ukur ${pickFact(benefits, anyFact)} versus harga live ${price}.`,
      "value",
      "SELL",
      { behavior: "comparison", cycleId },
    ),
    ...audienceLines,
    ...copywritingLines,
    ...promoPitchLines(product, entryMode),
    ...fillerLines(product),
    ...bridgeLines(product, catalog),
    ...stockLines(product, catalog),
    ...deflectionLines(product),
    ...bannerLines(product, entryMode),
    ...faqAnswerLines(product.faqPack?.length ? product.faqPack : buildDefaultFaqPack(product)),
    ...intentAgnosticHooks(product, entryMode),
    ...categorySalesHooks(product),
    ...crossFactLines(product),
    ...combinatorialLines(product, catalog, entryMode),
  ].map((item) => ({
    ...item,
    cycleId: item.cycleId ?? cycleId,
    semanticKey: item.semanticKey || inferSemanticKey(item.speech, item.topic),
  }));

  const hotKeys = avoidAnglesFromMemory(options?.productMemory);
  const unique: HostResponse[] = [];
  const seen = new Set<string>();
  const deferred: HostResponse[] = [];

  for (const item of shuffled(drafts)) {
    const key = normalize(item.speech);
    const minWords = FILLER_TOPICS.has(item.topic) ? 5 : 8;
    if (!key || seen.has(key) || item.speech.split(" ").length < minWords) continue;
    const sem = item.semanticKey || inferSemanticKey(item.speech, item.topic);
    if (hotKeys.has(sem) || hotKeys.has(normalize(item.topic || ""))) {
      deferred.push(item);
      continue;
    }
    seen.add(key);
    unique.push(item);
    if (unique.length >= SCRIPT_BANK_CAP) break;
  }
  // Isi sisa kapasitas dengan deferred (angle lama) hanya jika perlu.
  for (const item of deferred) {
    if (unique.length >= SCRIPT_BANK_CAP) break;
    const key = normalize(item.speech);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

/** Isi ulang lokal tanpa LLM — multi-round shuffle + parafrase terbatas, memory-aware. */
export function recycleLocalScriptBank(
  product: ScriptProductFacts,
  catalog: Array<{ name: string; benefits?: string }>,
  recent: string[] = [],
  options?: SeedScriptOptions & { salesMemory?: SalesRuleMemory; now?: number },
): HostResponse[] {
  const merged: HostResponse[] = [];
  const seen = new Set<string>();
  const now = options?.now ?? Date.now();
  for (let round = 0; round < RECYCLE_ROUNDS; round++) {
    const fresh = withParaphraseVariants(
      seedLocalScriptBank(product, catalog, {
        entryMode: options?.entryMode,
        productMemory: options?.productMemory,
        cycleId: options?.cycleId,
      }),
    );
    for (const item of shuffled(fresh)) {
      const key = normalize(item.speech);
      if (!key || seen.has(key)) continue;
      if (similarToAny(item.speech, recent) || sharesOpening(item.speech, recent)) continue;
      const content = contentRepeatGuard({
        speech: item.speech,
        topic: item.topic,
        ctaType: item.ctaType,
        recentSpeeches: recent,
        productMemory: options?.productMemory,
        now,
      });
      if (content.blocked && item.ctaType === "NONE") continue;
      const sales = salesRuleGuard({
        salesRule: (item.salesRule as SalesRule | undefined) || inferSalesRule(item.topic, item.ctaType),
        ctaType: item.ctaType,
        topic: item.topic,
        salesMemory: options?.salesMemory,
        now,
        ctaCooldownMs: CTA_COOLDOWN_MS,
        bannerCooldownMs: BANNER_CTA_COOLDOWN_MS,
        priceCooldownMs: PRICE_MENTION_COOLDOWN_MS,
      });
      if (sales.blocked) continue;
      seen.add(key);
      merged.push(item);
      if (merged.length >= RECYCLE_BATCH) break;
    }
    if (merged.length >= RECYCLE_BATCH) break;
  }
  return merged;
}

export function takeScriptLine(
  bank: ScriptBankState,
  recent: string[],
  preferModeOrOptions?: HostMode | TakeScriptOptions,
  preferTopic?: string,
): HostResponse | null {
  if (!bank.lines.length) return null;

  const options: TakeScriptOptions =
    typeof preferModeOrOptions === "object" && preferModeOrOptions !== null
      ? preferModeOrOptions
      : { preferMode: preferModeOrOptions, preferTopic };

  const now = options.now ?? Date.now();
  const cycleId = options.cycleId ?? 0;
  const avoidTopics = new Set(
    (options.avoidTopics || []).map((t) => normalize(t)).filter(Boolean),
  );
  const recentTopics = new Set(
    (options.recentTopics || []).slice(-3).map((t) => normalize(t)).filter(Boolean),
  );
  const primaryTopic = options.preferTopic
    ? normalize(String(options.preferTopic))
    : "";
  let preferTopicsList = (options.preferTopics || [])
    .map((t) => normalize(String(t)))
    .filter((t) => Boolean(t) && t !== primaryTopic);
  if (options.preferUnusedAngles && options.productMemory) {
    preferTopicsList = preferFreshTopics(
      preferTopicsList.length ? preferTopicsList : RHYTHM_SLOTS.slice(),
      options.productMemory,
      cycleId,
    );
  }
  const preferTopics = new Set(preferTopicsList);
  const cycleAngles = new Set(preferredAnglesForCycle(cycleId));
  const hotSemantic = avoidAnglesFromMemory(options.productMemory, now);

  const rank = (item: HostResponse): number => {
    let score = 0;
    const topicKey = normalize(item.topic || "");
    if (options.preferFiller && FILLER_TOPICS.has(item.topic)) score += 8;
    if (primaryTopic && topicKey === primaryTopic) score += 9;
    else if (preferTopics.has(topicKey)) score += 5;
    if (options.preferMode && item.mode === options.preferMode) score += 2;
    if (!similarToAny(item.speech, recent)) score += 4;
    if (!sharesOpening(item.speech, recent)) score += 3;
    if (!hasRecentGreetingClass(item.speech, recent, 8)) score += 2;
    if (recentTopics.has(topicKey)) score -= 8;
    if (options.avoidCta && item.ctaType && item.ctaType !== "NONE") score -= 5;
    if (avoidTopics.has(topicKey)) score -= 6;
    if (FILLER_TOPICS.has(item.topic) && !options.preferFiller) score -= 6;

    const sem = item.semanticKey || inferSemanticKey(item.speech, item.topic);
    if (hotSemantic.has(sem)) score -= 10;
    if (cycleAngles.size && options.preferUnusedAngles) {
      if (preferTopics.has(topicKey)) score += 2;
    }

    const content = contentRepeatGuard({
      speech: item.speech,
      topic: item.topic,
      ctaType: item.ctaType,
      recentSpeeches: recent,
      recentTopics: options.recentTopics,
      productMemory: options.productMemory,
      now,
    });
    if (content.blocked && item.ctaType === "NONE") score -= 20;
    else score -= Math.round(content.score.overall * 8);

    const sales = salesRuleGuard({
      salesRule: (item.salesRule as SalesRule | undefined) || inferSalesRule(item.topic, item.ctaType),
      ctaType: item.ctaType,
      topic: item.topic,
      salesMemory: options.salesMemory,
      now,
    });
    if (sales.blocked) score -= 15;

    return score;
  };

  let bestIndex = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < bank.lines.length; i++) {
    const item = bank.lines[i]!;
    // Hard reject exact content repeats (non-CTA).
    if (
      item.ctaType === "NONE" &&
      recent.some((r) => isExactRepeat(item.speech, r))
    ) {
      continue;
    }
    const sales = salesRuleGuard({
      salesRule: (item.salesRule as SalesRule | undefined) || inferSalesRule(item.topic, item.ctaType),
      ctaType: item.ctaType,
      topic: item.topic,
      salesMemory: options.salesMemory,
      now,
    });
    if (sales.blocked && !options.preferFiller) continue;

    const score = rank(item);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex < 0) {
    // Fallback: allow any non-exact line.
    for (let i = 0; i < bank.lines.length; i++) {
      const item = bank.lines[i]!;
      if (recent.some((r) => isExactRepeat(item.speech, r))) continue;
      bestIndex = i;
      break;
    }
  }
  if (bestIndex < 0) return null;

  const [picked] = bank.lines.splice(bestIndex, 1);
  return picked || null;
}

export function mergeScriptLines(
  bank: ScriptBankState,
  incoming: HostResponse[],
  recent: string[],
): number {
  const seen = new Set(bank.lines.map((item) => normalize(item.speech)));
  let added = 0;
  for (const item of incoming) {
    const isFiller = FILLER_TOPICS.has(item.topic || "");
    const speech = clampSpeech(item.speech || "", isFiller ? 16 : 32);
    const key = normalize(speech);
    const minWords = isFiller ? 5 : 8;
    if (!key || seen.has(key) || similarToAny(speech, recent)) continue;
    if (speech.split(" ").length < minWords) continue;
    const mode = (TOPIC_MODES[item.topic]?.[0] || item.mode || "ENGAGE") as HostMode;
    bank.lines.push({
      ...item,
      speech,
      action: normalizeLunaAction(item.action) !== "IDLE"
        ? normalizeLunaAction(item.action)
        : inferCtaPointAction(speech, item.topic),
      mode: item.mode || mode,
      ctaType: item.ctaType || "NONE",
      target_product_id: item.target_product_id ?? null,
      interruptible: item.interruptible ?? true,
      claims: item.claims || [],
    });
    seen.add(key);
    added++;
  }
  return added;
}

function detectCommentBucket(text: string, intent: HostIntent): HostIntent | "USAGE" | "SHIPPING" {
  const t = normalize(text);
  if (
    /\b(brp|berapa|harga|price|pricelist|hrga|hrg|duit|cuan|promo|diskon|murah)\b/.test(t) ||
    intent === "PRICE"
  ) {
    return "PRICE";
  }
  if (
    /\b(cara pakai|pemakaian|dipakai|pakai|pakainya|step|langkah|how to|aturan pakai|pakenya|dipake|cara pake)\b/.test(t)
  ) {
    return "USAGE";
  }
  if (
    /\b(kirim|ongkir|pengiriman|resi|cod|ekspedisi|shipping|antar|jne|jnt|sicepat|gratis ongkir)\b/.test(t)
  ) {
    return "SHIPPING";
  }
  if (
    /\b(bahan|isi|kandungan|manfaat|khasiat|ukuran|spesifikasi|detail|info|apa itu|bagus ga|bagus gak|kelebihan|fitur|material)\b/.test(t) ||
    intent === "PRODUCT_INFO"
  ) {
    return "PRODUCT_INFO";
  }
  return intent;
}

/** FAQ pack + 7–10 trigger sinonim per kategori. */
export function buildDefaultFaqPack(product: ScriptProductFacts): FaqPackEntry[] {
  const name = product.name || "produk ini";
  const price = product.price || "harga live";
  const merged = mergeProductKnowledge(product.description, {
    benefits: product.benefits,
    usage: product.usage,
    faq: product.faq,
  });
  const benefit =
    splitFacts(merged.benefits)[0] ||
    splitFacts(product.description)[0] ||
    `kelebihan ${name}`;
  const benefit2 = splitFacts(merged.benefits)[1] || benefit;
  const usage = splitFacts(merged.usage)[0] || "ikuti petunjuk di info produk";
  const usage2 = splitFacts(merged.usage)[1] || usage;
  const faqBit = splitFacts(merged.faq)[0] || benefit;

  return [
    {
      category: "harga",
      triggers: ["brp", "berapa", "harga", "price", "pricelist", "hrg", "hrga", "duit", "cuan", "promo", "diskon", "murah"],
      answers: [
        `${name} di live ini ${price}. Cek dulu cocok nggak sama kebutuhanmu.`,
        `Harganya ${price} ya. Ongkirnya biasanya keliatan di checkout.`,
        `Live price ${name}: ${price}. Worth-nya kalau kamu butuh ${benefit}.`,
      ],
    },
    {
      category: "manfaat",
      triggers: ["manfaat", "khasiat", "kelebihan", "bagus", "bagus ga", "bagus gak", "fitur", "bahan", "material", "detail", "info", "apa itu", "spesifikasi", "kandungan"],
      answers: [
        `Plus ${name}: ${benefit}.`,
        `Yang menonjol: ${benefit2}.`,
        faqBit !== benefit ? `Dari FAQ-nya: ${faqBit}.` : `Singkatnya ${name} soal ${benefit}.`,
      ],
    },
    {
      category: "cara_pakai",
      triggers: ["cara pakai", "pemakaian", "pakai", "pakenya", "dipakai", "dipake", "step", "langkah", "how to", "aturan pakai", "cara pake"],
      answers: [
        `Cara pakainya: ${usage}.`,
        `Gampang kok — ${usage2}.`,
        `Jangan dipersulit: ${usage}.`,
      ],
    },
    {
      category: "pengiriman",
      triggers: ["kirim", "ongkir", "pengiriman", "resi", "cod", "ekspedisi", "shipping", "antar", "jne", "jnt", "sicepat", "gratis ongkir"],
      answers: [
        `Ongkir sama ekspedisi cek di checkout setelah masuk keranjang ya.`,
        `Aku nggak nebak ongkir di sini — liat di halaman bayar platform.`,
        `Untuk COD/kirim, ikuti info platform. Kita fokus ${name} dulu.`,
      ],
    },
  ];
}

export function matchFaqPack(commentText: string, packs: FaqPackEntry[]): FaqPackEntry | null {
  const t = normalize(commentText);
  if (!t) return null;
  let best: FaqPackEntry | null = null;
  let bestHits = 0;
  for (const pack of packs) {
    let hits = 0;
    for (const trigger of pack.triggers) {
      const key = normalize(trigger);
      if (!key) continue;
      if (key.includes(" ")) {
        if (t.includes(key)) hits += 2;
      } else {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(t)) hits += 1;
      }
    }
    if (hits > bestHits) {
      bestHits = hits;
      best = pack;
    }
  }
  return bestHits > 0 ? best : null;
}

export function faqAnswerLines(packs: FaqPackEntry[]): HostResponse[] {
  const out: HostResponse[] = [];
  for (const pack of packs) {
    for (const answer of pack.answers) {
      out.push(
        line(answer, "faq", "QNA", {
          intent: pack.category === "harga" ? "PRICE" : "PRODUCT_INFO",
          ctaType: pack.category === "harga" ? "PRICE" : "NONE",
        }),
      );
    }
  }
  return out;
}

export function buildLocalCommentResponse(
  product: ScriptProductFacts,
  commentText: string,
  intent: HostIntent,
  authorName?: string,
  recent: string[] = [],
): HostResponse {
  const name = product.name || "produk ini";
  const price = product.price || "harga live";
  const merged = mergeProductKnowledge(product.description, {
    benefits: product.benefits,
    usage: product.usage,
    faq: product.faq,
  });
  const benefits = splitFacts(merged.benefits);
  const descriptions = splitFacts(product.description);
  const usages = splitFacts(merged.usage);
  const benefit = benefits[0] || descriptions[0] || `kelebihan ${name}`;
  const benefit2 = benefits[1] || descriptions[1] || benefit;
  const usage = usages[0] || "ikuti petunjuk di info produk";
  const usage2 = usages[1] || usage;
  const kak = authorName?.trim() ? `Kak ${authorName.trim().split(" ")[0]}` : "";
  const address = kak ? `${kak}, ` : greet();
  const stock = Number(product.stock);
  const packs = product.faqPack?.length ? product.faqPack : buildDefaultFaqPack(product);
  const faqHit = matchFaqPack(commentText, packs);
  const bucket = faqHit
    ? faqHit.category === "harga"
      ? "PRICE"
      : faqHit.category === "cara_pakai"
        ? "USAGE"
        : faqHit.category === "pengiriman"
          ? "SHIPPING"
          : "PRODUCT_INFO"
    : detectCommentBucket(commentText, intent);

  const variants: HostResponse[] = [];

  if (Number.isFinite(stock) && stock <= 0 && bucket !== "SOCIAL" && bucket !== "THANKS") {
    variants.push(
      line(`${address}${name} lagi kosong di live ini. Tanya produk lain di etalase ya.`, "comment-soldout", "SELL", {
        intent: "ANNOUNCEMENT",
        emotion: "neutral",
      }),
    );
  }

  if (faqHit?.answers?.length) {
    for (const answer of faqHit.answers) {
      variants.push(
        line(`${address}${answer}`, `comment-${faqHit.category}`, "QNA", {
          intent: faqHit.category === "harga" ? "PRICE" : "PRODUCT_INFO",
          emotion: "warm",
        }),
      );
    }
  } else if (bucket === "PRICE") {
    variants.push(
      line(`${address}${name} di live ini ${price}. Cek dulu cocok nggak.`, "comment-price", "QNA", { intent: "PRICE", ctaType: "PRICE", emotion: "neutral" }),
      line(`${address}harganya ${price} ya. Ongkirnya cek di checkout.`, "comment-price", "QNA", { intent: "PRICE", ctaType: "NONE", emotion: "warm" }),
      line(`${address}live ${price}. Worth-nya kalau kamu butuh ${benefit}.`, "comment-price", "QNA", { intent: "PRICE", ctaType: "SOFT", emotion: "excited" }),
    );
  } else if (bucket === "USAGE") {
    variants.push(
      line(`${address}cara pakainya: ${usage}.`, "comment-usage", "QNA", { intent: "PRODUCT_INFO", emotion: "warm" }),
      line(`${address}${usage2}.`, "comment-usage", "DEMO", { intent: "PRODUCT_INFO", emotion: "neutral" }),
      line(`${address}gampang — ${usage}.`, "comment-usage", "QNA", { intent: "PRODUCT_INFO", emotion: "happy" }),
    );
  } else if (bucket === "SHIPPING") {
    variants.push(
      line(`${address}ongkir sama ekspedisi cek di checkout setelah masuk keranjang ya.`, "comment-ship", "QNA", { intent: "ANSWER", emotion: "neutral" }),
      line(`${address}aku nggak nebak ongkir di sini — liat di halaman bayar.`, "comment-ship", "QNA", { intent: "ANSWER", emotion: "warm" }),
      line(`${address}untuk COD/kirim ikut info platform. Kita fokus ${name} dulu.`, "comment-ship", "SOCIAL", { intent: "ANSWER", emotion: "neutral" }),
    );
  } else if (bucket === "PRODUCT_INFO") {
    variants.push(
      line(`${address}plus-nya: ${benefit}.`, "comment-info", "QNA", { intent: "PRODUCT_INFO", emotion: "neutral" }),
      line(`${address}yang menonjol juga ${benefit2}.`, "comment-info", "QNA", { intent: "PRODUCT_INFO", emotion: "warm" }),
      line(`${address}cara pakainya ${usage}.`, "comment-info", "DEMO", { intent: "PRODUCT_INFO", emotion: "happy" }),
    );
  } else if (intent === "THANKS") {
    variants.push(
      line(`${address}makasih ya. Santai aja, kita lanjut.`, "comment-thanks", "SOCIAL", { intent: "THANKS", emotion: "happy" }),
      line(`${address}sama-sama. Mau nanya apa soal ${name}?`, "comment-thanks", "SOCIAL", { intent: "THANKS", emotion: "warm" }),
    );
  } else if (intent === "OBJECTION" || intent === "COMPLAINT") {
    variants.push(
      line(`${address}ragu wajar. Yang aku pegang: ${benefit}.`, "comment-objection", "OBJECTION", { intent: "OBJECTION", emotion: "empathetic" }),
      line(`${address}oke, kita pelan. Intinya ${benefit2}.`, "comment-objection", "OBJECTION", { intent: "OBJECTION", emotion: "warm" }),
      line(`${address}nggak usah ribut — ${benefit}.`, "comment-objection", "OBJECTION", { intent: "OBJECTION", emotion: "neutral" }),
    );
  } else if (intent === "BUYING_INTENT") {
    variants.push(
      line(`${address}${name} ${price}. Kalau ${benefit} emang kamu butuhin, boleh cek keranjang.`, "comment-buy", "SELL", { intent: "BUYING_INTENT", ctaType: "SOFT", emotion: "excited" }),
      line(`${address}siap. Live ${price}. Pastikan cocok dulu ya.`, "comment-buy", "SELL", { intent: "BUYING_INTENT", ctaType: "SOFT", emotion: "happy" }),
      line(`${address}mantap. Keranjang siap — tanpa dipaksa.`, "comment-buy", "SELL", { intent: "BUYING_INTENT", ctaType: "DIRECT", emotion: "excited" }),
    );
  } else if (intent === "ANSWER" || intent === "OTHER") {
    variants.push(
      line(`${address}${benefit}. Kalau belum ketemu jawabannya, kasih detailnya ya.`, "comment-answer", "QNA", { intent: "ANSWER", emotion: "neutral" }),
      line(`${address}cara pakainya ${usage}.`, "comment-answer", "QNA", { intent: "PRODUCT_INFO", emotion: "warm" }),
      line(`${address}kita balik ke ${name}: ${benefit2}.`, "comment-answer", "ENGAGE", { intent: "SOCIAL", emotion: "warm" }),
    );
  } else if (intent === "SPAM") {
    variants.push(...deflectionLines(product));
  } else {
    variants.push(
      line(`${address}makasih udah nimbrung. Ada yang mau ditanyain soal ${name}?`, "comment-social", "SOCIAL", { intent: "SOCIAL", emotion: "warm" }),
      line(`${address}sini aja, aku dengerin. Nggak harus langsung beli.`, "comment-social", "SOCIAL", { intent: "SOCIAL", emotion: "happy" }),
      line(`Siap. Tanya spesifik aja biar jawabnya nyambung.`, "comment-social", "SOCIAL", { intent: "SOCIAL", emotion: "neutral" }),
      line(`${address}mau bahas manfaat, cara pakai, atau harga ${name}?`, "comment-social", "ENGAGE", { intent: "SOCIAL", emotion: "excited" }),
    );
  }

  const unused = variants.find((item) => !similarToAny(item.speech, recent));
  const chosen = unused || variants[0]!;
  const snippet = commentText.replace(/\s+/g, " ").trim().slice(0, 42);
  if (snippet && normalize(chosen.speech).includes(normalize(snippet))) {
    return variants[1] || chosen;
  }
  return {
    ...chosen,
    speech: clampSpeech(chosen.speech, FILLER_TOPICS.has(chosen.topic) ? 14 : 18),
  };
}
