/**
 * Marathon Host memory + repetition guards.
 * Content anti-repeat ketat; CTA/sales rule repeatable dengan cooldown.
 */

export type ProductEntryMode = "first_intro" | "continuing" | "re_entry" | "new_viewer";

export type SalesRule =
  | "banner_reminder"
  | "check_cart"
  | "soft_cta"
  | "direct_cta"
  | "price_reminder"
  | "variant_reminder"
  | "new_viewer_welcome"
  | "checkout_reminder";

export type SpeechBehavior =
  | "observation"
  | "reaction"
  | "thinking"
  | "transition"
  | "audience_engagement"
  | "micro_story"
  | "self_correction"
  | "comparison"
  | "question"
  | "answer"
  | "clarification"
  | "product_demo"
  | "scenario"
  | "soft_cta"
  | "direct_cta"
  | "casual_comment";

export type ContentAngle =
  | "benefit"
  | "feature"
  | "texture"
  | "usage"
  | "target_audience"
  | "problem_solution"
  | "objection"
  | "comparison"
  | "how_to_choose"
  | "common_mistake"
  | "faq"
  | "story"
  | "observation"
  | "engagement"
  | "catalog"
  | "price_context"
  | "variant"
  | "care"
  | "scenario"
  | "discovery"
  | "cta"
  | "other";

export interface UsageRecord {
  count: number;
  lastUsedAt: number;
  cycleIds: number[];
}

export interface ProductMemory {
  productId: string;
  visitCount: number;
  lastVisitedAt?: number;
  usedFacts: string[];
  usedAngles: string[];
  usedTopics: string[];
  usedStories: string[];
  usedQuestions: string[];
  angleUsage: Record<string, UsageRecord>;
  factUsage: Record<string, UsageRecord>;
  lastSpeechAt?: number;
  entryMode: ProductEntryMode;
}

export interface SalesRuleMemory {
  lastCTAAt: number;
  lastBannerCTAAt: number;
  lastPriceMentionAt: number;
  lastSalesRuleAt: Partial<Record<SalesRule, number>>;
}

export interface HostConversationMemory {
  sessionStartAt: number;
  recentSpeeches: string[];
  recentTopics: string[];
  recentProducts: string[];
  recentCategories: string[];
  currentCycle: number;
  audienceEnergy: "low" | "normal" | "high";
  chatActivity: "dead" | "slow" | "normal" | "busy";
  sales: SalesRuleMemory;
}

export interface RepeatScore {
  exact: number;
  lexical: number;
  semantic: number;
  opening: number;
  topic: number;
  product: number;
  overall: number;
}

export const RECENT_SPEECH_LIMIT = Number(process.env.LIVE_RECENT_SPEECH_LIMIT || 48);
export const SEMANTIC_MEMORY_LIMIT = Number(process.env.LIVE_SEMANTIC_MEMORY_LIMIT || 64);
export const CTA_COOLDOWN_MS = Number(process.env.LIVE_CTA_COOLDOWN_MS || 45_000);
export const BANNER_CTA_COOLDOWN_MS = Number(
  process.env.LIVE_BANNER_CTA_COOLDOWN_MS || 90_000,
);
export const PRICE_MENTION_COOLDOWN_MS = Number(
  process.env.LIVE_PRICE_MENTION_COOLDOWN_MS || 60_000,
);
export const MAX_CYCLE_MINUTES = Number(process.env.LIVE_MAX_CYCLE_MINUTES || 45);
export const SEMANTIC_DECAY_MS = Number(
  process.env.LIVE_SEMANTIC_DECAY_MS || 20 * 60_000,
);
export const REPEAT_OVERALL_REJECT = Number(process.env.LIVE_REPEAT_REJECT_SCORE || 0.72);

const CYCLE_ANGLE_ROTATION: ContentAngle[][] = [
  ["benefit", "feature", "usage", "discovery"],
  ["problem_solution", "target_audience", "common_mistake", "how_to_choose"],
  ["scenario", "comparison", "faq", "objection"],
  ["story", "engagement", "observation", "care"],
  ["variant", "price_context", "catalog", "scenario"],
];

export function emptySalesRuleMemory(): SalesRuleMemory {
  return {
    lastCTAAt: 0,
    lastBannerCTAAt: 0,
    lastPriceMentionAt: 0,
    lastSalesRuleAt: {},
  };
}

export function emptyHostConversationMemory(now = Date.now()): HostConversationMemory {
  return {
    sessionStartAt: now,
    recentSpeeches: [],
    recentTopics: [],
    recentProducts: [],
    recentCategories: [],
    currentCycle: 0,
    audienceEnergy: "normal",
    chatActivity: "normal",
    sales: emptySalesRuleMemory(),
  };
}

export function emptyProductMemory(productId: string): ProductMemory {
  return {
    productId,
    visitCount: 0,
    usedFacts: [],
    usedAngles: [],
    usedTopics: [],
    usedStories: [],
    usedQuestions: [],
    angleUsage: {},
    factUsage: {},
    entryMode: "first_intro",
  };
}

export function getOrCreateProductMemory(
  store: Map<string, ProductMemory> | Record<string, ProductMemory>,
  productId: string,
): ProductMemory {
  if (store instanceof Map) {
    let mem = store.get(productId);
    if (!mem) {
      mem = emptyProductMemory(productId);
      store.set(productId, mem);
    }
    return mem;
  }
  if (!store[productId]) store[productId] = emptyProductMemory(productId);
  return store[productId]!;
}

/** Panggil saat produk menjadi aktif (switch / pertama kali). */
export function touchProductVisit(memory: ProductMemory, now = Date.now()): ProductMemory {
  const wasVisited = memory.visitCount > 0;
  memory.visitCount += 1;
  memory.lastVisitedAt = now;
  memory.entryMode = wasVisited ? "re_entry" : "first_intro";
  return memory;
}

export function markProductContinuing(memory: ProductMemory): void {
  if (memory.entryMode === "first_intro" || memory.entryMode === "re_entry") {
    memory.entryMode = "continuing";
  }
}

export function marathonCycleId(elapsedMinutes: number, maxCycleMinutes = MAX_CYCLE_MINUTES): number {
  const mins = Math.max(0, elapsedMinutes);
  const span = Math.max(5, maxCycleMinutes);
  return Math.floor(mins / span);
}

export function preferredAnglesForCycle(cycleId: number): ContentAngle[] {
  const bucket = CYCLE_ANGLE_ROTATION[Math.abs(cycleId) % CYCLE_ANGLE_ROTATION.length];
  return bucket ? bucket.slice() : ["benefit", "usage", "engagement"];
}

export function normalizeSpeechText(text: string): string {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(
    normalizeSpeechText(text)
      .split(" ")
      .filter((x) => x.length >= 3),
  );
}

function bigramSet(text: string): Set<string> {
  const t = normalizeSpeechText(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(`${t[i]} ${t[i + 1]}`);
  return out;
}

export function openingPhrase(speech: string, words = 4): string {
  return normalizeSpeechText(speech).split(" ").filter(Boolean).slice(0, words).join(" ");
}

export function isExactRepeat(a: string, b: string): boolean {
  const na = normalizeSpeechText(a);
  const nb = normalizeSpeechText(b);
  return Boolean(na && nb && na === nb);
}

export function isLexicalRepeat(a: string, b: string, threshold = 0.72): boolean {
  const na = normalizeSpeechText(a);
  const nb = normalizeSpeechText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const aa = tokenSet(na);
  const bb = tokenSet(nb);
  if (!aa.size || !bb.size) return false;
  let hits = 0;
  for (const token of aa) if (bb.has(token)) hits++;
  const jaccard = hits / Math.sqrt(aa.size * bb.size);
  if (jaccard >= threshold) return true;

  const ba = bigramSet(na);
  const bb2 = bigramSet(nb);
  if (!ba.size || !bb2.size) return false;
  let bHits = 0;
  for (const g of ba) if (bb2.has(g)) bHits++;
  return bHits / Math.min(ba.size, bb2.size) >= 0.55;
}

export function lexicalSimilarity(a: string, b: string): number {
  const aa = tokenSet(a);
  const bb = tokenSet(b);
  if (!aa.size || !bb.size) return 0;
  let hits = 0;
  for (const token of aa) if (bb.has(token)) hits++;
  return hits / Math.sqrt(aa.size * bb.size);
}

const ANGLE_HINTS: Array<{ angle: ContentAngle; pattern: RegExp }> = [
  { angle: "texture", pattern: /\b(tekstur|ringan|berat|lembut|halus|cair|kental|matte|glow)\b/i },
  { angle: "usage", pattern: /\b(cara pakai|pemakaian|oles|pakai|aplikasikan|step|langkah|rutin)\b/i },
  { angle: "target_audience", pattern: /\b(cocok|buat yang|untuk yang|pemula|kulit kering|kulit berminyak)\b/i },
  { angle: "problem_solution", pattern: /\b(masalah|ribet|solusi|bantu|mengatasi|kurang)\b/i },
  { angle: "objection", pattern: /\b(ragu|takut|nggak cocok|keberatan|mahal|worth)\b/i },
  { angle: "comparison", pattern: /\b(banding|dibanding|beda|opsi lain|versus|vs)\b/i },
  { angle: "faq", pattern: /\b(sering ditanya|berapa|ongkir|ukuran|isi|varian)\b/i },
  { angle: "story", pattern: /\b(cerita|bayangin|kalau aku|pengalaman)\b/i },
  { angle: "price_context", pattern: /\b(harga|live price|price|promo|diskon)\b/i },
  { angle: "engagement", pattern: /\b(nanya|chat|ketik|komen|yang baru)\b/i },
  { angle: "catalog", pattern: /\b(etalase|produk lain|catalog|bridge)\b/i },
  { angle: "scenario", pattern: /\b(skenario|pas lagi|sehari-hari|kondisi)\b/i },
  { angle: "observation", pattern: /\b(aku lihat|yang masuk|rame|sepi)\b/i },
  { angle: "benefit", pattern: /\b(manfaat|kelebihan|plus|unggul|khasiat|bikin)\b/i },
];

const TOPIC_TO_ANGLE: Record<string, ContentAngle> = {
  benefit: "benefit",
  how_to_use: "usage",
  buyer_fit: "target_audience",
  problem: "problem_solution",
  objection: "objection",
  comparison: "comparison",
  faq: "faq",
  mini_story: "story",
  price_context: "price_context",
  soft_cta: "cta",
  promo_pitch: "benefit",
  social_engagement: "engagement",
  catalog_bridge: "catalog",
  use_case: "scenario",
  micro_tip: "usage",
  reframe: "objection",
  banner_callout: "cta",
  closing_loop: "cta",
  value: "price_context",
  energy_reset: "observation",
  filler: "other",
};

export function inferContentAngle(speech: string, topic?: string): ContentAngle {
  const topicKey = normalizeSpeechText(topic || "");
  if (topicKey && TOPIC_TO_ANGLE[topicKey]) return TOPIC_TO_ANGLE[topicKey]!;
  for (const hint of ANGLE_HINTS) {
    if (hint.pattern.test(speech)) return hint.angle;
  }
  return "other";
}

/** Compact semantic identity — dua kalimat berbeda bisa share key yang sama. */
export function inferSemanticKey(speech: string, topic?: string): string {
  const angle = inferContentAngle(speech, topic);
  const norm = normalizeSpeechText(speech);
  const tokens = norm.split(" ").filter((t) => t.length >= 4);
  const stop = new Set([
    "yang",
    "ini",
    "itu",
    "dari",
    "untuk",
    "dengan",
    "kalau",
    "kamu",
    "produk",
    "live",
    "banget",
    "juga",
    "bisa",
    "udah",
    "sudah",
    "lebih",
    "karena",
    "jadi",
  ]);
  const content = tokens.filter((t) => !stop.has(t)).slice(0, 4);
  if (content.length >= 2) return `${angle}_${content.slice(0, 3).join("_")}`.slice(0, 64);
  return `${angle}_${topic || "general"}`;
}

export function isSemanticRepeat(
  speech: string,
  topic: string | undefined,
  productMemory: ProductMemory | undefined,
  now = Date.now(),
  decayMs = SEMANTIC_DECAY_MS,
): boolean {
  if (!productMemory) return false;
  const key = inferSemanticKey(speech, topic);
  const rec = productMemory.angleUsage[key];
  if (!rec) return false;
  if (now - rec.lastUsedAt > decayMs) return false;
  // Hot jika baru dipakai atau dipakai berkali-kali dalam cycle dekat.
  return now - rec.lastUsedAt < decayMs && rec.count >= 1;
}

export function scoreRepeat(input: {
  speech: string;
  topic?: string;
  recentSpeeches: string[];
  recentTopics?: string[];
  productMemory?: ProductMemory;
  now?: number;
}): RepeatScore {
  const { speech, topic, recentSpeeches, recentTopics = [], productMemory, now = Date.now() } =
    input;
  let exact = 0;
  let lexical = 0;
  let opening = 0;
  const open = openingPhrase(speech);

  for (const prev of recentSpeeches.slice(-24)) {
    if (isExactRepeat(speech, prev)) exact = Math.max(exact, 1);
    lexical = Math.max(lexical, lexicalSimilarity(speech, prev));
    if (open && openingPhrase(prev) === open) opening = Math.max(opening, 1);
  }

  const semantic =
    productMemory && isSemanticRepeat(speech, topic, productMemory, now) ? 0.9 : 0;
  const topicNorm = normalizeSpeechText(topic || "");
  const topicScore =
    topicNorm && recentTopics.slice(-3).some((t) => normalizeSpeechText(t) === topicNorm)
      ? 0.55
      : 0;

  const overall =
    exact * 1 +
    lexical * 0.55 +
    semantic * 0.7 +
    opening * 0.35 +
    topicScore * 0.25;

  return {
    exact,
    lexical,
    semantic,
    opening,
    topic: topicScore,
    product: 0,
    overall: Math.min(1.5, overall),
  };
}

export function contentRepeatGuard(input: {
  speech: string;
  topic?: string;
  ctaType?: string;
  recentSpeeches: string[];
  recentTopics?: string[];
  productMemory?: ProductMemory;
  now?: number;
  rejectThreshold?: number;
}): { blocked: boolean; score: RepeatScore; reason?: string } {
  const cta = input.ctaType || "NONE";
  // CTA / sales lines: jangan blokir lewat content guard (salesRuleGuard yang urus).
  if (cta !== "NONE") {
    const score = scoreRepeat({
      speech: input.speech,
      topic: input.topic,
      recentSpeeches: input.recentSpeeches,
      recentTopics: input.recentTopics,
      productMemory: input.productMemory,
      now: input.now,
    });
    // Exact full-sentence CTA terlalu dekat tetap diblok.
    if (score.exact >= 1) {
      return { blocked: true, score, reason: "exact-cta" };
    }
    return { blocked: false, score };
  }

  const score = scoreRepeat({
    speech: input.speech,
    topic: input.topic,
    recentSpeeches: input.recentSpeeches,
    recentTopics: input.recentTopics,
    productMemory: input.productMemory,
    now: input.now,
  });
  const threshold = input.rejectThreshold ?? REPEAT_OVERALL_REJECT;
  if (score.exact >= 1) return { blocked: true, score, reason: "exact" };
  if (score.overall >= threshold) return { blocked: true, score, reason: "overall" };
  if (score.semantic >= 0.85) return { blocked: true, score, reason: "semantic" };
  return { blocked: false, score };
}

export function inferSalesRule(topic?: string, ctaType?: string): SalesRule | null {
  const t = normalizeSpeechText(topic || "");
  const c = (ctaType || "NONE").toUpperCase();
  if (t.includes("banner")) return "banner_reminder";
  if (c === "PRICE" || t.includes("price")) return "price_reminder";
  if (c === "DIRECT") return "direct_cta";
  if (c === "SOFT" || t.includes("soft_cta") || t.includes("closing")) return "soft_cta";
  if (t.includes("promo") || t.includes("cart") || t.includes("keranjang")) return "check_cart";
  return null;
}

export function salesRuleGuard(input: {
  salesRule?: SalesRule | null;
  ctaType?: string;
  topic?: string;
  salesMemory?: SalesRuleMemory;
  now?: number;
  ctaCooldownMs?: number;
  bannerCooldownMs?: number;
  priceCooldownMs?: number;
}): { blocked: boolean; reason?: string } {
  const mem = input.salesMemory;
  if (!mem) return { blocked: false };
  const now = input.now ?? Date.now();
  const cta = (input.ctaType || "NONE").toUpperCase();
  if (cta === "NONE" && !input.salesRule) return { blocked: false };

  const rule =
    input.salesRule || inferSalesRule(input.topic, input.ctaType) || ("soft_cta" as SalesRule);
  const ctaCd = input.ctaCooldownMs ?? CTA_COOLDOWN_MS;
  const bannerCd = input.bannerCooldownMs ?? BANNER_CTA_COOLDOWN_MS;
  const priceCd = input.priceCooldownMs ?? PRICE_MENTION_COOLDOWN_MS;

  if (rule === "banner_reminder" && now - mem.lastBannerCTAAt < bannerCd) {
    return { blocked: true, reason: "banner-cooldown" };
  }
  if (rule === "price_reminder" && now - mem.lastPriceMentionAt < priceCd) {
    return { blocked: true, reason: "price-cooldown" };
  }
  if (cta !== "NONE" && now - mem.lastCTAAt < ctaCd) {
    return { blocked: true, reason: "cta-cooldown" };
  }
  const lastRule = mem.lastSalesRuleAt[rule] || 0;
  if (lastRule && now - lastRule < ctaCd) {
    return { blocked: true, reason: "rule-cooldown" };
  }
  return { blocked: false };
}

export function recordSalesRuleUse(
  mem: SalesRuleMemory,
  rule: SalesRule | null | undefined,
  ctaType?: string,
  now = Date.now(),
): void {
  const cta = (ctaType || "NONE").toUpperCase();
  const resolved = rule || inferSalesRule(undefined, ctaType);
  if (cta !== "NONE") mem.lastCTAAt = now;
  if (!resolved) return;
  mem.lastSalesRuleAt[resolved] = now;
  if (resolved === "banner_reminder") mem.lastBannerCTAAt = now;
  if (resolved === "price_reminder") mem.lastPriceMentionAt = now;
}

function pushBounded(list: string[], value: string, limit: number): void {
  if (!value) return;
  list.push(value);
  if (list.length > limit) list.splice(0, list.length - limit);
}

function bumpUsage(
  map: Record<string, UsageRecord>,
  key: string,
  cycleId: number,
  now: number,
  limit: number,
): void {
  const existing = map[key];
  if (existing) {
    existing.count += 1;
    existing.lastUsedAt = now;
    if (!existing.cycleIds.includes(cycleId)) {
      existing.cycleIds.push(cycleId);
      if (existing.cycleIds.length > 8) existing.cycleIds.shift();
    }
  } else {
    map[key] = { count: 1, lastUsedAt: now, cycleIds: [cycleId] };
  }
  const keys = Object.keys(map);
  if (keys.length > limit) {
    keys
      .sort((a, b) => (map[a]!.lastUsedAt || 0) - (map[b]!.lastUsedAt || 0))
      .slice(0, keys.length - limit)
      .forEach((k) => {
        delete map[k];
      });
  }
}

export function recordSpeechUsage(input: {
  productMemory: ProductMemory;
  conversation?: HostConversationMemory;
  speech: string;
  topic?: string;
  semanticKey?: string;
  factId?: string;
  salesRule?: SalesRule | null;
  ctaType?: string;
  productId?: string;
  category?: string;
  cycleId?: number;
  now?: number;
}): void {
  const now = input.now ?? Date.now();
  const cycleId = input.cycleId ?? 0;
  const angle = inferContentAngle(input.speech, input.topic);
  const key = input.semanticKey || inferSemanticKey(input.speech, input.topic);

  const pm = input.productMemory;
  pushBounded(pm.usedAngles, angle, SEMANTIC_MEMORY_LIMIT);
  pushBounded(pm.usedTopics, input.topic || angle, SEMANTIC_MEMORY_LIMIT);
  bumpUsage(pm.angleUsage, key, cycleId, now, SEMANTIC_MEMORY_LIMIT);
  if (input.factId) {
    pushBounded(pm.usedFacts, input.factId, SEMANTIC_MEMORY_LIMIT);
    bumpUsage(pm.factUsage, input.factId, cycleId, now, SEMANTIC_MEMORY_LIMIT);
  }
  if (angle === "story") pushBounded(pm.usedStories, key, 24);
  if (angle === "faq") pushBounded(pm.usedQuestions, key, 24);
  pm.lastSpeechAt = now;
  markProductContinuing(pm);

  if (input.conversation) {
    const conv = input.conversation;
    pushBounded(conv.recentSpeeches, input.speech, RECENT_SPEECH_LIMIT);
    if (input.topic) pushBounded(conv.recentTopics, input.topic, 32);
    if (input.productId) pushBounded(conv.recentProducts, input.productId, 24);
    if (input.category) pushBounded(conv.recentCategories, input.category, 24);
    conv.currentCycle = cycleId;
    recordSalesRuleUse(conv.sales, input.salesRule, input.ctaType, now);
  }
}

export function productReference(
  productName: string,
  context: ProductEntryMode = "continuing",
  opts?: { forceName?: boolean; index?: number },
): string {
  const name = productName?.trim() || "produk ini";
  if (opts?.forceName) return name;

  const pools: Record<ProductEntryMode, string[]> = {
    first_intro: [name, name, "yang ini", "produk ini", "yang lagi aku tunjukin"],
    continuing: [
      "produk ini",
      "yang ini",
      "yang lagi kita bahas",
      "barang ini",
      "yang satu ini",
      name,
    ],
    re_entry: [
      "yang tadi",
      "yang ini lagi",
      "produk ini",
      "yang sempat kita bahas",
      name,
    ],
    new_viewer: [
      "yang lagi aku bahas ini",
      "produk di etalase ini",
      name,
      "yang tampil sekarang",
    ],
  };
  const pool = pools[context] || pools.continuing;
  const idx =
    typeof opts?.index === "number"
      ? Math.abs(opts.index) % pool.length
      : Math.floor(Math.random() * pool.length);
  return pool[idx] || name;
}

export function avoidAnglesFromMemory(
  productMemory: ProductMemory | undefined,
  now = Date.now(),
  decayMs = SEMANTIC_DECAY_MS,
): Set<string> {
  const out = new Set<string>();
  if (!productMemory) return out;
  for (const [key, rec] of Object.entries(productMemory.angleUsage)) {
    if (now - rec.lastUsedAt < decayMs) out.add(key);
  }
  for (const angle of productMemory.usedAngles.slice(-8)) out.add(angle);
  return out;
}

export function preferFreshTopics(
  candidates: string[],
  productMemory: ProductMemory | undefined,
  cycleId: number,
): string[] {
  if (!productMemory) return candidates;
  const preferredAngles = new Set(preferredAnglesForCycle(cycleId));
  const recentTopics = new Set(
    productMemory.usedTopics.slice(-6).map((t) => normalizeSpeechText(t)),
  );
  return candidates.slice().sort((a, b) => {
    const aNorm = normalizeSpeechText(a);
    const bNorm = normalizeSpeechText(b);
    const aAngle = TOPIC_TO_ANGLE[aNorm] || "other";
    const bAngle = TOPIC_TO_ANGLE[bNorm] || "other";
    let scoreA = preferredAngles.has(aAngle) ? 2 : 0;
    let scoreB = preferredAngles.has(bAngle) ? 2 : 0;
    if (recentTopics.has(aNorm)) scoreA -= 3;
    if (recentTopics.has(bNorm)) scoreB -= 3;
    return scoreB - scoreA;
  });
}

export type BannerCTAContext =
  | "info"
  | "price"
  | "variant"
  | "detail"
  | "checkout"
  | "new_viewer"
  | "confused_buyer"
  | "soft_reminder"
  | "product_transition"
  | "audience_question";

export function buildBannerCtaSpeech(
  productRef: string,
  context: BannerCTAContext,
): { speech: string; salesRule: SalesRule } {
  const templates: Record<BannerCTAContext, string> = {
    info: `Detail ${productRef} ada di banner bawah ya, biar gampang dicek.`,
    price: `Kalau mau lihat harga yang sedang tampil, cek banner bawah dulu ya.`,
    variant: `Yang mau lihat pilihan variannya, coba cek banner bawah.`,
    detail: `Detail lengkapnya aku taruh di banner bawah biar lebih gampang dicek.`,
    checkout: `Kalau sudah cocok, sebelum checkout cek detail di banner bawah dulu ya.`,
    new_viewer: `Buat yang baru masuk, detail yang lagi kita bahas ada di banner bawah ya.`,
    confused_buyer: `Kalau masih bingung, ringkasannya ada di banner bawah — pelan aja.`,
    soft_reminder: `Sekadar reminder, info ${productRef} bisa dicek di banner bawah.`,
    product_transition: `Kita pindah bahasan — ringkasan ${productRef} tetap di banner bawah.`,
    audience_question: `Yang nanya detailnya, cek banner bawah dulu biar sinkron ya.`,
  };
  return {
    speech: templates[context],
    salesRule: context === "new_viewer" ? "new_viewer_welcome" : "banner_reminder",
  };
}
