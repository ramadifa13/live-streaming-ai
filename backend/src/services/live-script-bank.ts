import type {
  HostIntent,
  HostMode,
  HostResponse,
  LunaAction,
  LunaEmotion,
} from "./groq-brain.js";

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

/** Sapaan jarang — "Halo/Kak" tiap kalimat terdengar seperti loop robot. */
const RARE_GREETINGS = ["Kak, ", "Guys, "];

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
  const aa = new Set(normalize(a).split(" ").filter((x) => x.length >= 3));
  const bb = new Set(normalize(b).split(" ").filter((x) => x.length >= 3));
  if (!aa.size || !bb.size) return false;
  let hits = 0;
  for (const token of aa) if (bb.has(token)) hits++;
  return hits / Math.sqrt(aa.size * bb.size) >= 0.78;
}

function similarToAny(speech: string, recent: string[]): boolean {
  return recent.some((item) => similar(speech, item));
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
  // ~10% saja pakai sapaan — sisanya langsung ke isi supaya tidak terdengar loop "Halo".
  if (Math.random() > 0.1) return "";
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
  return {
    speech: clampSpeech(speech, maxWords),
    action: (extras?.action as LunaAction) || "TALK_EXPRESSIVE",
    emotion: extras?.emotion || emotions[Math.floor(Math.random() * emotions.length)] || "warm",
    intent: extras?.intent || "SELL",
    mode,
    topic,
    ctaType: extras?.ctaType || "NONE",
    target_product_id: extras?.target_product_id ?? null,
    interruptible: extras?.interruptible ?? true,
    claims: extras?.claims || [],
  };
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
  if (/rumah/.test(c)) return "isi rumah";
  return "kebutuhan kamu";
}

function factChunks(product: ScriptProductFacts): string[] {
  const name = product.name || "produk ini";
  const chunks = [
    ...splitFacts(product.benefits),
    ...splitFacts(product.description),
    ...splitFacts(product.usage),
    ...splitFacts(product.faq),
  ].slice(0, 14);
  if (chunks.length === 0) chunks.push(`detail ${name} sesuai data yang kamu isi`);
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
        `Dari data produk: ${name} siap dicek di etalase.`,
      ];
  return drafts.map((speech) =>
    line(speech, "filler", "ENGAGE", { intent: "SOCIAL", emotion: "warm", ctaType: "NONE" }),
  );
}

function promoPitchLines(product: ScriptProductFacts): HostResponse[] {
  const name = product.name || "produk ini";
  const price = product.price || "harga live";
  const benefit = pickFact(splitFacts(product.benefits), pickFact(splitFacts(product.description), `kelebihan ${name}`));
  const usage = pickFact(splitFacts(product.usage), "ikuti cara pakai di data produk");
  return [
    line(
      `${greet()}yang lagi dicari: ${name}. Plus-nya ${benefit}. Live price ${price} — cek keranjang kalau cocok.`,
      "promo_pitch",
      "SELL",
      { ctaType: "SOFT" },
    ),
    line(
      `Hook singkat: ${name} fokus buat yang butuh ${benefit}. Harganya ${price}. Nggak dipaksa, cek dulu.`,
      "promo_pitch",
      "SELL",
      { ctaType: "SOFT" },
    ),
    line(
      `${greet()}${name} — ${benefit}. Cara pakainya ${usage}. Live ${price}, keranjang siap kalau kamu yakin.`,
      "promo_pitch",
      "SELL",
      { ctaType: "DIRECT" },
    ),
    line(
      `Kalau fokusnya ${benefit}, coba lihat ${name} di live ini ${price}. Soft aja: cek keranjangnya.`,
      "promo_pitch",
      "SELL",
      { ctaType: "SOFT" },
    ),
    line(
      `${greet()}ringkas: ${name}, ${benefit}, harga ${price}. Kalau nyambung, baru klik keranjang.`,
      "promo_pitch",
      "SELL",
      { ctaType: "SOFT" },
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
      `${greet()}kalau ${name} belum pas, bisa cek ${other} juga — tetap dari data katalog.`,
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
        `Info stok: ${name} sisa ${stock}. Itu angka etalase, bukan drama.`,
        "value",
        "ENGAGE",
        { intent: "ANNOUNCEMENT" },
      ),
    );
  }
  return lines;
}

function bannerLines(product: ScriptProductFacts): HostResponse[] {
  if (!product.hasBanner) return [];
  const name = product.name || "produk ini";
  return [
    line(
      `${greet()}lihat banner atas ya — ringkasan ${name} ada di situ biar gampang dicek.`,
      "banner_callout",
      "ENGAGE",
      { intent: "SOCIAL" },
    ),
    line(
      `Banner bawah juga nunjukin ${name}. Kalau chat rame, banner tetap kebaca.`,
      "banner_callout",
      "SELL",
      { intent: "SOCIAL" },
    ),
    line(
      `${greet()}nggak harus buru-buru. Banner atas-bawah udah nunjukin info ${name}.`,
      "banner_callout",
      "ENGAGE",
    ),
  ];
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
): HostResponse[] {
  const name = product.name || "produk ini";
  const price = product.price || "harga live";
  const need = domainNeed(product.category || "");
  const facts = factChunks(product);
  const other = catalog.find((item) => item.name && item.name !== name)?.name;

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
    { topic: "social_engagement", mode: "ENGAGE", build: () => `Ada yang belum jelas soal ${name}? Tulis di chat, nanti aku jawab dari datanya.`, extras: { intent: "SOCIAL" } },
    { topic: "social_engagement", mode: "SOCIAL", build: (fact) => `Chat spesifik aja — misalnya soal ${fact}.`, extras: { intent: "SOCIAL" } },
    { topic: "energy_reset", mode: "ENGAGE", build: (fact) => `Intinya dari data ${name}: ${fact}.`, extras: { intent: "SOCIAL" } },
    { topic: "energy_reset", mode: "SOCIAL", build: (fact) => `Kita pegang poin ini dulu: ${fact}.`, extras: { intent: "SOCIAL" } },
    { topic: "closing_loop", mode: "CLOSING", build: (fact) => `Jadi ${name}: ${fact}. Live ${price}.`, extras: { ctaType: "SOFT" } },
    { topic: "closing_loop", mode: "CLOSING", build: (fact) => `${greet()}ingat ya — ${fact}. ${name} ${price}.`, extras: { ctaType: "SOFT" } },
    { topic: "mini_story", mode: "ENGAGE", build: (fact) => `Cerita singkatnya: ${fact}.` },
    { topic: "mini_story", mode: "SOCIAL", build: (fact) => `${greet()}singkat aja — ${fact}.` },
    { topic: "comparison", mode: "QNA", build: (fact) => other
      ? `${name} soal ${fact}. Kalau mau opsi lain, ada ${other} di etalase.`
      : `Fokus ${name} dulu: ${fact}.` },
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

/** Preferensi topik berdasarkan fase sesi (menit). */
export function phasePreferTopics(elapsedMinutes: number): string[] {
  if (elapsedMinutes < 8) {
    return ["problem", "benefit", "social_engagement", "buyer_fit", "how_to_use", "micro_tip"];
  }
  if (elapsedMinutes < 45) {
    return ["how_to_use", "value", "faq", "objection", "micro_tip", "use_case", "promo_pitch", "benefit"];
  }
  return ["closing_loop", "soft_cta", "value", "promo_pitch", "catalog_bridge", "social_engagement", "buyer_fit"];
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
}

export function seedLocalScriptBank(
  product: ScriptProductFacts,
  catalog: Array<{ name: string; benefits?: string }>,
): HostResponse[] {
  const name = product.name || "produk ini";
  const price = product.price || "harga live";
  const category = product.category || "kebutuhan sehari-hari";
  const benefits = splitFacts(product.benefits);
  const description = splitFacts(product.description);
  const usage = splitFacts(product.usage);
  const faq = splitFacts(product.faq);
  const anyFact =
    pickFact(benefits, "") ||
    pickFact(description, `detail ${name} sesuai data produk`) ||
    `info resmi ${name}`;

  const drafts: HostResponse[] = [
    line(
      `${greet()}kalau sering ribet soal ${category}, ${name} ngebantu di ${anyFact}.`,
      "problem",
      "ENGAGE",
    ),
    line(
      `Yang paling kepakai dari ${name}: ${pickFact(benefits, anyFact)}. Pilih yang ketemu kebutuhanmu.`,
      "benefit",
      "SELL",
    ),
    line(
      `Cara pakainya jangan dibikin ribet: ${pickFact(usage, "ikuti informasi resmi di data produk")}.`,
      "how_to_use",
      "DEMO",
    ),
    line(
      `${name} lebih nyambung buat yang cari solusi ${category}, bukan yang cuma ikut ramai.`,
      "buyer_fit",
      "ENGAGE",
    ),
    line(
      `Kalau masih ragu, aku nggak ngarang. Dari data: ${pickFact(faq, anyFact)}.`,
      "objection",
      "OBJECTION",
    ),
    line(
      `Soal value, ukur ${pickFact(benefits, anyFact)} versus harga live ${price}.`,
      "value",
      "SELL",
    ),
    ...promoPitchLines(product),
    ...fillerLines(product),
    ...bridgeLines(product, catalog),
    ...stockLines(product, catalog),
    ...deflectionLines(product),
    ...bannerLines(product),
    ...faqAnswerLines(product.faqPack?.length ? product.faqPack : buildDefaultFaqPack(product)),
    ...combinatorialLines(product, catalog),
  ];

  const unique: HostResponse[] = [];
  const seen = new Set<string>();
  for (const item of shuffled(drafts)) {
    const key = normalize(item.speech);
    const minWords = FILLER_TOPICS.has(item.topic) ? 5 : 8;
    if (!key || seen.has(key) || item.speech.split(" ").length < minWords) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= 220) break;
  }
  return unique;
}

/** Isi ulang lokal tanpa LLM — kombinasi ulang + filler agar tidak idle. */
export function recycleLocalScriptBank(
  product: ScriptProductFacts,
  catalog: Array<{ name: string; benefits?: string }>,
  recent: string[] = [],
): HostResponse[] {
  const fresh = seedLocalScriptBank(product, catalog);
  return fresh.filter((item) => !similarToAny(item.speech, recent)).slice(0, 80);
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

  const avoidTopics = new Set(
    (options.avoidTopics || []).map((t) => normalize(t)).filter(Boolean),
  );
  const recentTopics = new Set(
    (options.recentTopics || []).slice(-3).map((t) => normalize(t)).filter(Boolean),
  );
  const primaryTopic = options.preferTopic
    ? normalize(String(options.preferTopic))
    : "";
  const preferTopics = new Set(
    (options.preferTopics || [])
      .map((t) => normalize(String(t)))
      .filter((t) => Boolean(t) && t !== primaryTopic),
  );

  const rank = (item: HostResponse): number => {
    let score = 0;
    const topicKey = normalize(item.topic || "");
    if (options.preferFiller && FILLER_TOPICS.has(item.topic)) score += 8;
    // Slot ritme (+9) di atas topik fase (+5) — tanpa double-count preferTopic.
    if (primaryTopic && topicKey === primaryTopic) score += 9;
    else if (preferTopics.has(topicKey)) score += 5;
    if (options.preferMode && item.mode === options.preferMode) score += 2;
    if (!similarToAny(item.speech, recent)) score += 4;
    if (avoidTopics.has(topicKey) || recentTopics.has(topicKey)) score -= 6;
    if (options.avoidCta && item.ctaType && item.ctaType !== "NONE") score -= 5;
    if (FILLER_TOPICS.has(item.topic) && !options.preferFiller) score -= 6;
    return score;
  };

  let bestIndex = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < bank.lines.length; i++) {
    const score = rank(bank.lines[i]!);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

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
      action: "TALK_EXPRESSIVE",
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
  const benefit =
    splitFacts(product.benefits)[0] ||
    splitFacts(product.description)[0] ||
    `kelebihan ${name}`;
  const benefit2 = splitFacts(product.benefits)[1] || benefit;
  const usage = splitFacts(product.usage)[0] || "ikuti petunjuk di info produk";
  const usage2 = splitFacts(product.usage)[1] || usage;
  const faqBit = splitFacts(product.faq)[0] || benefit;

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
  const benefits = splitFacts(product.benefits);
  const descriptions = splitFacts(product.description);
  const usages = splitFacts(product.usage);
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
