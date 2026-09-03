import {
  forwardToRunPodGPU,
  getRunPodQueueStatus,
  startRunPodBroadcast,
} from "./runpod-bridge.js";
import {
  generateHostResponse,
  generateScriptBankLines,
  getBrainBackoffMs,
  liveBrainCommentWhenNeeded,
  liveBrainDuringLive,
  liveBrainRefillOnExhaust,
  liveBrainRefillWhenLow,
  normalizeLunaAction,
  splitSpeechIntoGestureSegments,
  type HostIntent,
  type HostMode,
  type HostResponse,
  type SalesBrainInput,
} from "./groq-brain.js";
import {
  buildDefaultFaqPack,
  buildLocalCommentResponse,
  commentNeedsLlm,
  countFreshScriptLines,
  emptyScriptBank,
  FILLER_TOPICS,
  mergeScriptLines,
  nextRhythmTopic,
  phasePreferTopics,
  recycleLocalScriptBank,
  remainingScriptLines,
  RHYTHM_SLOTS,
  seedLocalScriptBank,
  mergeProductKnowledge,
  pickScriptBankCommentLine,
  takeScriptLine,
  shouldUseLlmForComment,
  type FaqPackEntry,
  type ScriptBankState,
  type ScriptProductFacts,
} from "./live-script-bank.js";
import { livePlatformConnector } from "./live-platform-connector.js";
import { synthesizeSpeech } from "./tts.js";


export type StreamPlan = "1H" | "2H" | "8H" | "24H";

export interface HostConfig {
  productId: string;
  avatarName: string;
  voice?: string;
  tone: string;
  rtmpUrl?: string;
  streamKey?: string;
  podId?: string | null;
  sessionId: string;
  plan?: StreamPlan;
  /**
   * Durasi sesi sebenarnya dalam ms. Plan hanya bucket (1H/2H/8H/24H), sehingga
   * sesi 3 jam ter-map ke plan "2H" dan loop generasi berhenti satu jam lebih
   * awal — GPU menganggur tetapi tetap ditagih. Nilai ini dipakai bila ada.
   */
  maxDurationMs?: number;
  product?: ProductSnapshot;
  catalog?: ProductSnapshot[];
}

export interface ProductSnapshot {
  id: string;
  name: string;
  price: number | string;
  category: string;
  benefits: string;
  description: string;
  usage: string;
  faq: string;
  copywriting: string;
  targetAudience?: string;
  stock: number;
  image?: string;
  bannerImage?: string;
  scriptBank?: HostResponse[];
  faqPack?: FaqPackEntry[];
  updatedAt: number;
}

export function normalizeClientProduct(raw: unknown): ProductSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const name = String(p.name || "").trim();
  if (!name) return null;
  const scriptBank = Array.isArray(p.scriptBank)
    ? (p.scriptBank as HostResponse[]).filter(
        (line) => line && typeof line.speech === "string" && line.speech.trim().length >= 8,
      )
    : undefined;
  return {
    id: String(p.id || `local_${Date.now()}`),
    name,
    price: (p.price as string | number) ?? 0,
    category: String(p.tag || p.category || "Umum")
      .replace(/^General$/i, "Umum")
      .replace(/^Lainnya$/i, "Umum"),
    benefits: String(p.benefits || ""),
    description: String(p.description || ""),
    usage: String(p.usage || ""),
    faq: String(p.faq || ""),
    copywriting: String(p.copywriting || ""),
    targetAudience: p.targetAudience ? String(p.targetAudience) : undefined,
    stock: Number(p.stock ?? 0),
    image: p.image ? String(p.image) : undefined,
    bannerImage: p.bannerImage ? String(p.bannerImage) : undefined,
    scriptBank,
    faqPack: Array.isArray(p.faqPack) ? (p.faqPack as FaqPackEntry[]) : undefined,
    updatedAt: Date.now(),
  };
}

export interface PendingComment {
  id: string;
  text: string;
  authorName?: string;
  createdAt: number;
  priority: number;
  intent: HostIntent;
  dedupeKey: string;
}

interface HostMemory {
  utterances: string[];
  topics: string[];
  ctas: string[];
  claims: string[];
  modes: HostMode[];
  commentFingerprints: string[];
  lastResponseAt: number;
  lastCommentResponseAt: number;
  lastSalesAt: number;
}

interface QueueMetrics {
  readyVideos: number;
  queuedVideos: number;
  activeProcessing: number;
  bufferSeconds: number;
  workerOffline: boolean;
  broadcasting: boolean;
  rtmpConnected: boolean;
  rtmpError: string;
  warmedUp: boolean;
  broadcastMode: string;
  utteranceQueueCount: number;
  visualWorkerRunning: boolean;
  visualWorkerInitializing: boolean;
  broadcastBootState: string;
}

interface RuntimeCounters {
  generated: number;
  submitted: number;
  failed: number;
  commentsReceived: number;
  commentsAnswered: number;
  commentsDropped: number;
  duplicateResponsesPrevented: number;
  fallbackResponses: number;
}

interface HostRuntimeState {
  config: HostConfig;
  abortController: AbortController;
  isLive: boolean;
  pipelineReady: boolean;
  generationRunning: boolean;
  preliveRunning: boolean;

  startedAt: number;
  lastActivityAt: number;

  product?: ProductSnapshot;
  catalog: ProductSnapshot[];
  productCacheExpiresAt: number;

  memory: HostMemory;
  pendingComments: PendingComment[];
  processedCommentIds: Set<string>;

  currentMode: HostMode;
  modeStartedAt: number;
  showTurn: number;
  topicCursor: number;
  slotCursor: number;

  counters: RuntimeCounters;
  lastQueue: QueueMetrics;

  // Last known speech queue estimate. Used even if worker API temporarily errors.
  estimatedBufferSeconds: number;
  scriptBank: ScriptBankState;

  rtmpFailedAt: number;
  rtmpFailStopping: boolean;

  /** Timestamp pertama kali worker terdeteksi offline (0 = online). */
  workerOfflineSince: number;
  /** Pesan error terakhir dari worker (502, timeout, dll). */
  lastWorkerError: string;
  workerFailStopping: boolean;
  workerFailedAt: number;

  /** Retry start-broadcast bila visual worker belum jalan (mode ai_worker). */
  broadcastRetryAt: number;
  broadcastRetryCount: number;
}

interface PlanPolicy {
  durationMs: number;
  minBufferSeconds: number;
  targetBufferSeconds: number;
  maxBufferSeconds: number;
  commentTtlMs: number;
  maxPendingComments: number;
  memoryUtterances: number;
  memoryTopics: number;
  memoryCtas: number;
  memoryClaims: number;
  modeMinMs: number;
  modeMaxMs: number;
  /** Trigger recycle/refill lokal saat sisa baris di bawah ini. */
  scriptBankLow: number;
  /** Batas refill LLM live per sesi — marathon lebih rendah (lokal-first). */
  scriptBankLlmRefillMax: number;
  scriptBankLlmRefillCooldownMs: number;
}

const LIVE_MIN_BUFFER = Number(process.env.LIVE_MIN_BUFFER_SECONDS || 6);

const PLAN_POLICIES: Record<StreamPlan, PlanPolicy> = {
  // Buffer realtime ai_worker: default 6s (bukan 10–18) supaya Go confirm lebih cepat.
  "1H": {
    durationMs: 60 * 60 * 1000,
    minBufferSeconds: LIVE_MIN_BUFFER,
    targetBufferSeconds: 22,
    maxBufferSeconds: 40,
    commentTtlMs: 20_000,
    maxPendingComments: 6,
    memoryUtterances: 20,
    memoryTopics: 12,
    memoryCtas: 6,
    memoryClaims: 14,
    modeMinMs: 60_000,
    modeMaxMs: 180_000,
    scriptBankLow: Number(process.env.LIVE_SCRIPT_BANK_LOW_1H || process.env.LIVE_SCRIPT_BANK_LOW || 12),
    scriptBankLlmRefillMax: Number(process.env.LIVE_SCRIPT_BANK_LLM_REFILL_MAX_1H || 14),
    scriptBankLlmRefillCooldownMs: Number(process.env.LIVE_SCRIPT_BANK_LLM_REFILL_COOLDOWN_MS || 90_000),
  },
  "2H": {
    durationMs: 2 * 60 * 60 * 1000,
    minBufferSeconds: LIVE_MIN_BUFFER,
    targetBufferSeconds: 22,
    maxBufferSeconds: 40,
    commentTtlMs: 25_000,
    maxPendingComments: 8,
    memoryUtterances: 30,
    memoryTopics: 18,
    memoryCtas: 8,
    memoryClaims: 20,
    modeMinMs: 90_000,
    modeMaxMs: 270_000,
    scriptBankLow: Number(process.env.LIVE_SCRIPT_BANK_LOW_2H || 16),
    scriptBankLlmRefillMax: Number(process.env.LIVE_SCRIPT_BANK_LLM_REFILL_MAX_2H || 12),
    scriptBankLlmRefillCooldownMs: Number(process.env.LIVE_SCRIPT_BANK_LLM_REFILL_COOLDOWN_MS || 120_000),
  },
  "8H": {
    durationMs: 8 * 60 * 60 * 1000,
    minBufferSeconds: 14,
    targetBufferSeconds: 30,
    maxBufferSeconds: 55,
    commentTtlMs: 35_000,
    maxPendingComments: 10,
    memoryUtterances: 55,
    memoryTopics: 28,
    memoryCtas: 12,
    memoryClaims: 30,
    modeMinMs: 120_000,
    modeMaxMs: 360_000,
    scriptBankLow: Number(process.env.LIVE_SCRIPT_BANK_LOW_8H || 24),
    scriptBankLlmRefillMax: Number(process.env.LIVE_SCRIPT_BANK_LLM_REFILL_MAX_8H || 8),
    scriptBankLlmRefillCooldownMs: Number(process.env.LIVE_SCRIPT_BANK_LLM_REFILL_COOLDOWN_MS_8H || 180_000),
  },
  "24H": {
    durationMs: 24 * 60 * 60 * 1000,
    minBufferSeconds: 18,
    targetBufferSeconds: 38,
    maxBufferSeconds: 70,
    commentTtlMs: 45_000,
    maxPendingComments: 14,
    memoryUtterances: 90,
    memoryTopics: 45,
    memoryCtas: 18,
    memoryClaims: 50,
    modeMinMs: 180_000,
    modeMaxMs: 600_000,
    scriptBankLow: Number(process.env.LIVE_SCRIPT_BANK_LOW_24H || 32),
    scriptBankLlmRefillMax: Number(process.env.LIVE_SCRIPT_BANK_LLM_REFILL_MAX_24H || 5),
    scriptBankLlmRefillCooldownMs: Number(process.env.LIVE_SCRIPT_BANK_LLM_REFILL_COOLDOWN_MS_24H || 240_000),
  },
};

/** Estimasi durasi clip pendek (speech 20–35 kata ≈ 8–14 detik). */
const FALLBACK_SPEECH_SECONDS = 12;
const IN_FLIGHT_RENDER_SECONDS = 10;

function isAiWorkerBroadcastMode(mode: string): boolean {
  const m = (mode || "").trim().toLowerCase();
  return (
    m === "ai_worker" ||
    m === "ai-worker" ||
    m === "realtime" ||
    m === "visual_worker"
  );
}

function emptyQueueMetrics(
  partial: Partial<QueueMetrics> = {},
): QueueMetrics {
  return {
    readyVideos: 0,
    queuedVideos: 0,
    activeProcessing: 0,
    bufferSeconds: 0,
    workerOffline: false,
    broadcasting: false,
    rtmpConnected: false,
    rtmpError: "",
    warmedUp: false,
    broadcastMode: "segment",
    utteranceQueueCount: 0,
    visualWorkerRunning: false,
    visualWorkerInitializing: false,
    broadcastBootState: "idle",
    ...partial,
  };
}
const PRODUCT_CACHE_TTL_MS = 30_000;
const QUEUE_POLL_MS = 800;
const COMMENT_SCAN_MS = 400;
/** Worker offline berapa lama sebelum dianggap gagal (bukan blip sementara). */
const WORKER_OFFLINE_FAIL_MS = 45_000;
/** Auto-stop sesi jika worker tidak pulih setelah ini. */
const WORKER_FAIL_STOP_MS = 120_000;
const GENERATION_BACKOFF_MS = 800;
/** Batas idle di siaran sebelum orchestrator boost generate (detik). */
export const MAX_ONAIR_IDLE_SECONDS = 5;
const SCRIPT_BANK_LLM_REFILL_COOLDOWN_MS = Number(
  process.env.LIVE_SCRIPT_BANK_LLM_REFILL_COOLDOWN_MS || 90_000,
);
const SCRIPT_BANK_LLM_REFILL_MAX = Number(process.env.LIVE_SCRIPT_BANK_LLM_REFILL_MAX || 16);
const SCRIPT_BANK_LOW = Number(process.env.LIVE_SCRIPT_BANK_LOW || 12);
const SCRIPT_BANK_LLM_EXHAUST_BONUS = Number(process.env.LIVE_SCRIPT_BANK_LLM_EXHAUST_BONUS || 6);
const SCRIPT_BANK_FRESH_LOW = Number(process.env.LIVE_SCRIPT_BANK_FRESH_LOW || 8);
const RHYTHM_SLOT_ATTEMPTS = RHYTHM_SLOTS.length;

function topicModesFor(topic: string): HostMode[] {
  const found = AUTONOMOUS_TOPIC_BANK.find((item) => item.topic === topic);
  if (found) return found.modes;
  if (FILLER_TOPICS.has(topic)) return ["ENGAGE", "SOCIAL"];
  if (topic === "promo_pitch" || topic === "sold_out") return ["SELL", "ENGAGE"];
  if (topic === "banner_callout") return ["ENGAGE", "SELL"];
  if (topic === "deflection") return ["SOCIAL", "ENGAGE"];
  return ["ENGAGE", "SELL"];
}

async function awaitBrainReady(sessionId?: string): Promise<void> {
  const waitMs = getBrainBackoffMs(sessionId);
  if (waitMs > 0) await sleep(waitMs);
}

const AUTONOMOUS_TOPIC_BANK: Array<{
  topic: string;
  modes: HostMode[];
  prompt: string;
}> = [
  {
    topic: "problem",
    modes: ["ENGAGE", "SELL"],
    prompt:
      "angkat satu masalah nyata yang relevan dengan kategori produk lalu hubungkan ke manfaat yang memang ada di data",
  },
  {
    topic: "benefit",
    modes: ["SELL", "DEMO"],
    prompt:
      "bedah satu manfaat utama dengan contoh penggunaan sehari-hari, jangan mengulang benefit terakhir",
  },
  {
    topic: "how_to_use",
    modes: ["DEMO", "QNA"],
    prompt:
      "jelaskan cara penggunaan berdasarkan data produk, praktis dan tidak seperti membaca manual",
  },
  {
    topic: "buyer_fit",
    modes: ["ENGAGE", "SELL"],
    prompt:
      "jelaskan tipe kebutuhan/orang yang kemungkinan paling cocok dengan produk berdasarkan fakta yang tersedia",
  },
  {
    topic: "objection",
    modes: ["OBJECTION"],
    prompt:
      "angkat satu keraguan pembeli yang umum hanya bila dapat dijawab dari fakta produk; jangan mengarang jaminan",
  },
  {
    topic: "comparison",
    modes: ["QNA", "SELL"],
    prompt:
      "jelaskan perbedaan produk aktif dengan produk lain di katalog jika relevan; gunakan data katalog saja",
  },
  {
    topic: "value",
    modes: ["SELL", "ENGAGE"],
    prompt:
      "bantu penonton menilai value berdasarkan fitur/manfaat yang nyata, tanpa klaim hiperbola",
  },
  {
    topic: "use_case",
    modes: ["ENGAGE", "DEMO"],
    prompt:
      "ceritakan satu skenario penggunaan yang relatable tanpa membuat testimoni palsu",
  },
  {
    topic: "micro_tip",
    modes: ["DEMO", "ENGAGE"],
    prompt:
      "berikan satu tips kecil yang berguna terkait penggunaan produk",
  },
  {
    topic: "catalog_bridge",
    modes: ["SELL", "ENGAGE"],
    prompt:
      "buat jembatan halus ke produk lain di katalog hanya jika ada alasan yang jelas",
  },
  {
    topic: "soft_cta",
    modes: ["SELL"],
    prompt:
      "buat ajakan tindakan yang ringan dan kontekstual; jangan memakai pola CTA terakhir",
  },
  {
    topic: "social_engagement",
    modes: ["SOCIAL", "ENGAGE"],
    prompt:
      "ajak penonton ikut percakapan dengan pertanyaan ringan yang tidak selalu berujung jualan",
  },
  {
    topic: "reframe",
    modes: ["OBJECTION", "ENGAGE"],
    prompt:
      "ubah sudut pandang penonton terhadap satu kebutuhan tanpa mengulang argumen terakhir",
  },
  {
    topic: "mini_story",
    modes: ["ENGAGE", "SOCIAL"],
    prompt:
      "buat mini-story 20-40 detik yang relatable dan terkait manfaat produk, tanpa membuat cerita pelanggan palsu",
  },
  {
    topic: "price_context",
    modes: ["SELL", "QNA"],
    prompt:
      "bahas harga hanya jika relevan dengan konteks; jangan mengulang angka harga tanpa alasan",
  },
  {
    topic: "faq",
    modes: ["QNA"],
    prompt:
      "jawab satu FAQ yang belum dibahas, berdasarkan knowledge produk yang tersedia",
  },
  {
    topic: "energy_reset",
    modes: ["ENGAGE", "SOCIAL"],
    prompt:
      "ubah ritme percakapan supaya sesi terasa hidup, singkat, hangat, dan tidak seperti membaca skrip",
  },
  {
    topic: "closing_loop",
    modes: ["CLOSING"],
    prompt:
      "buat rangkuman singkat dari hal penting yang belum dirangkum, lalu CTA hanya bila memang waktunya tepat",
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprint(text: string): string {
  return normalizeText(text)
    .split(" ")
    .filter((x) => x.length >= 3)
    .slice(0, 16)
    .sort()
    .join("|");
}

function similarity(a: string, b: string): number {
  const aa = new Set(normalizeText(a).split(" ").filter((x) => x.length >= 3));
  const bb = new Set(normalizeText(b).split(" ").filter((x) => x.length >= 3));
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection++;
  return intersection / Math.sqrt(aa.size * bb.size);
}

function inferIntent(text: string): HostIntent {
  const q = normalizeText(text);
  if (!q) return "OTHER";

  if (/spam|follow4follow|follback|link wa|pinjam dulu|dm aku/.test(q)) {
    return "SPAM";
  }
  if (/checkout|beli|order|pesan|ambil|ready|stok|restock|keranjang/.test(q)) {
    return "BUYING_INTENT";
  }
  if (/harga|berapa|diskon|promo|voucher|ongkir|cod|bayar/.test(q)) {
    return "PRICE";
  }
  if (/aman|cocok|beda|mahal|takut|ragu|jamin|asli|ori|bpom|halal|garansi/.test(q)) {
    return "OBJECTION";
  }
  if (/cara|pakai|guna|fungsi|manfaat|ukuran|warna|isi|material|bahan|durasi/.test(q)) {
    return "PRODUCT_INFO";
  }
  if (/makasih|terima kasih|keren|cantik|ganteng|lucu|suka|love|mantap|bagus/.test(q)) {
    return "SOCIAL";
  }
  if (q.includes("?")) return "ANSWER";
  return "OTHER";
}

function personalizeCommentLine(line: HostResponse, authorName?: string): HostResponse {
  const kak = authorName?.trim() ? `Kak ${authorName.trim().split(" ")[0]}, ` : "";
  if (!kak || /^kak\s/i.test(line.speech.trim())) return { ...line, mode: "QNA", interruptible: true };
  const body = line.speech.trim();
  const speech = `${kak}${body.charAt(0).toLowerCase()}${body.slice(1)}`;
  return { ...line, speech, mode: "QNA", interruptible: true };
}

function priorityForComment(text: string, intent: HostIntent): number {
  const q = normalizeText(text);
  let score = 20;
  const intentWeight: Record<HostIntent, number> = {
    BUYING_INTENT: 60,
    COMPLAINT: 58,
    OBJECTION: 52,
    PRICE: 48,
    PRODUCT_INFO: 44,
    ANSWER: 34,
    THANKS: 24,
    SOCIAL: 20,
    ANNOUNCEMENT: 50,
    OTHER: 16,
    SELL: 10,
    SPAM: 0,
  };
  score += intentWeight[intent] || 0;
  if (/\b(admin|min|kak)\b/.test(q)) score += 3;
  if (q.length <= 3) score -= 5;
  return Math.max(0, Math.min(100, score));
}

function parsePlan(value?: StreamPlan): StreamPlan {
  return value && PLAN_POLICIES[value] ? value : "2H";
}

export function durationHoursToPlan(hours: number): StreamPlan {
  if (hours >= 24) return "24H";
  if (hours >= 8) return "8H";
  if (hours >= 2) return "2H";
  return "1H";
}

function estimateDurationSeconds(text: string): number {
  const clean = text.replace(/\s+/g, " ").trim();
  const words = clean ? clean.split(" ").length : 1;
  return Math.max(5, Math.min(18, Math.round(words / 2.8)));
}

class LiveHostOrchestrator {
  private sessions = new Map<string, HostRuntimeState>();
  private onSessionExpired?: (sessionId: string) => void;

  /**
   * Dipanggil saat durasi plan habis. Tanpa handler ini loop generasi hanya
   * berhenti sementara pod tetap menyala dan tertagih sampai dihentikan manual.
   */
  public setSessionExpiredHandler(
    handler: (sessionId: string) => void,
  ): void {
    this.onSessionExpired = handler;
  }

  constructor() {
    livePlatformConnector.setSpeechCallback(
      (text: string, sessionId?: string, authorName?: string, platformCommentId?: string) => {
        if (sessionId && text?.trim()) {
          this.enqueue(sessionId, text, authorName, platformCommentId);
        }
      },
    );
  }

  public start(config: HostConfig): void {
    this.startPipelineBackground(config);
  }

  public stop(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.abortController.abort();
    this.sessions.delete(sessionId);
    console.log(`[LiveHost] 🛑 Session ${sessionId} dihentikan.`);
  }

  public stopAll(): void {
    for (const [sessionId, state] of this.sessions.entries()) {
      state.abortController.abort();
      console.log(`[LiveHost] 🛑 Session ${sessionId} dihentikan (stopAll).`);
    }
    this.sessions.clear();
  }

  public switchProduct(sessionId: string, productId: string, snapshot?: ProductSnapshot): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const found =
      snapshot ||
      state.catalog.find((item) => item.id === productId) ||
      (state.config.product?.id === productId ? state.config.product : undefined);

    state.config.productId = productId;
    if (found) {
      state.config.product = found;
      state.product = { ...found, updatedAt: Date.now() };
    } else {
      state.product = undefined;
    }
    state.productCacheExpiresAt = found ? Date.now() + PRODUCT_CACHE_TTL_MS : 0;
    state.scriptBank = emptyScriptBank(productId);
    if (found?.scriptBank?.length) {
      state.scriptBank.lines = found.scriptBank.slice();
    } else if (state.product) {
      this.seedScriptBank(state, state.product);
    }
    state.memory.topics.push("product_switch");
    state.currentMode = "ENGAGE";
    state.modeStartedAt = Date.now();
    state.slotCursor = 0;

    console.log(
      `[LiveHost] 🔄 Product switched: session=${sessionId}, product=${productId}`,
    );
  }

  public async startLivePipeline(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) throw new Error(`Session ${sessionId} tidak ditemukan.`);

    if (state.isLive) return;

    state.isLive = true;
    state.startedAt = state.startedAt || Date.now();
    state.lastActivityAt = Date.now();

    console.log(
      `[LiveHost] ✅ Session ${sessionId} LIVE — plan=${state.config.plan || "2H"}`,
    );

    if (!state.generationRunning) {
      void this.runLiveGenerationLoop(sessionId);
    }
  }

  /**
   * Compat utility: generate V1/V2 before user presses Go Live.
   */
  public startPipelineBackground(config: HostConfig): void {
    this.stop(config.sessionId);

    const now = Date.now();
    const state: HostRuntimeState = {
      config: {
        ...config,
        plan: parsePlan(config.plan),
      },
      abortController: new AbortController(),
      isLive: false,
      pipelineReady: false,
      generationRunning: false,
      preliveRunning: false,
      startedAt: now,
      lastActivityAt: now,
      catalog: config.catalog?.length ? config.catalog : config.product ? [config.product] : [],
      productCacheExpiresAt: config.product ? Date.now() + PRODUCT_CACHE_TTL_MS : 0,
      product: config.product,
      memory: {
        utterances: [],
        topics: [],
        ctas: [],
        claims: [],
        modes: [],
        commentFingerprints: [],
        lastResponseAt: 0,
        lastCommentResponseAt: 0,
        lastSalesAt: 0,
      },
      pendingComments: [],
      processedCommentIds: new Set(),
      currentMode: "ENGAGE",
      modeStartedAt: now,
      showTurn: 0,
      topicCursor: 0,
      slotCursor: 0,
      counters: {
        generated: 0,
        submitted: 0,
        failed: 0,
        commentsReceived: 0,
        commentsAnswered: 0,
        commentsDropped: 0,
        duplicateResponsesPrevented: 0,
        fallbackResponses: 0,
      },
      lastQueue: emptyQueueMetrics(),
      estimatedBufferSeconds: 0,
      scriptBank: emptyScriptBank(config.productId),
      rtmpFailedAt: 0,
      rtmpFailStopping: false,
      workerOfflineSince: 0,
      lastWorkerError: "",
      workerFailStopping: false,
      workerFailedAt: 0,
      broadcastRetryAt: 0,
      broadcastRetryCount: 0,
    };

    this.sessions.set(config.sessionId, state);

    console.log(
      `[LiveHost] 🎬 Background pipeline start: session=${config.sessionId}, plan=${state.config.plan}`,
    );

    // Warmup GPU job default OFF untuk ai_worker (berebut VRAM dengan init).
    // Aktifkan: LIVE_WORKER_WARMUP=1
    if (process.env.LIVE_WORKER_WARMUP === "1") {
      void this.warmupWorkerModel(config.sessionId);
    }
    void this.runPreLivePipeline(config.sessionId);
  }

  private async warmupWorkerModel(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state?.config.podId) return;

    try {
      const avatarFileName = state.config.avatarName
        ? `${state.config.avatarName.toLowerCase().trim()}.png`
        : "namira.png";

      await forwardToRunPodGPU(state.config.podId, {
        avatarImagePath: `avatars/${avatarFileName}`,
        text: "baik",
        voice: state.config.voice || "id-ID-GadisNeural",
        tone: state.config.tone,
        requireWorker: false,
        wait: false,
      });

      console.log(`[LiveHost] 🔥 Worker warmup submitted: ${sessionId}`);
    } catch (err: any) {
      console.warn(`[LiveHost] Worker warmup non-fatal: ${err?.message || err}`);
    }
  }

  private getPolicy(state: HostRuntimeState): PlanPolicy {
    return PLAN_POLICIES[parsePlan(state.config.plan)];
  }

  private elapsedMs(state: HostRuntimeState): number {
    return Math.max(0, Date.now() - state.startedAt);
  }

  private isSessionExpired(state: HostRuntimeState): boolean {
    const limitMs =
      state.config.maxDurationMs && state.config.maxDurationMs > 0
        ? state.config.maxDurationMs
        : this.getPolicy(state).durationMs;
    return this.elapsedMs(state) >= limitMs;
  }

  private async ensureVisualBroadcast(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state || state.abortController.signal.aborted) return;

    const { rtmpUrl, streamKey, podId } = state.config;
    if (!rtmpUrl?.trim() || !streamKey?.trim() || !podId) return;

    const queue = state.lastQueue;
    if (!isAiWorkerBroadcastMode(queue.broadcastMode)) return;
    if (queue.visualWorkerRunning) return;
    if (queue.broadcastBootState === "starting" || queue.visualWorkerInitializing) {
      return;
    }
    if (queue.broadcastBootState === "error" || queue.rtmpError) {
      return;
    }

    const now = Date.now();
    if (now < state.broadcastRetryAt) return;
    if (state.broadcastRetryCount >= 8) return;

    state.broadcastRetryCount += 1;
    state.broadcastRetryAt = now + 15_000;

    const product = state.product || state.config.product;
    const httpMediaOnly = (url?: string) =>
      url && /^https?:\/\//i.test(url) ? url : undefined;

    console.log(
      `[LiveHost] 🔁 Retry start-broadcast (${state.broadcastRetryCount}/8): ${sessionId}`,
    );

    try {
      const result = await startRunPodBroadcast(podId, {
        rtmpUrl: rtmpUrl.trim(),
        streamKey: streamKey.trim(),
        productName: product?.name,
        productPrice: product?.price
          ? String(product.price).replace(/\D/g, "")
          : undefined,
        productImageUrl: httpMediaOnly(product?.image),
        bannerImageUrl: httpMediaOnly(product?.bannerImage),
        hostName: state.config.avatarName || "namira",
        waitForReady: false,
      });
      if (!result.success) {
        state.lastWorkerError =
          result.error || "Gagal memulai visual worker (start-broadcast)";
        console.warn(
          `[LiveHost] Retry start-broadcast gagal: ${state.lastWorkerError}`,
        );
      }
    } catch (err: any) {
      state.lastWorkerError = err?.message || String(err);
      console.warn(`[LiveHost] Retry start-broadcast error: ${state.lastWorkerError}`);
    }
  }

  private async runPreLivePipeline(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state || state.preliveRunning) return;
    state.preliveRunning = true;

    try {
      // V1 + V2 minimal ready buffer; setelah live akan diambil alih live loop.
      while (true) {
        const s = this.sessions.get(sessionId);
        if (!s || s.abortController.signal.aborted || s.isLive) break;

        const queue = await this.refreshQueueMetrics(sessionId);
        if (queue.broadcastBootState === "error") {
          await sleep(2000);
          continue;
        }
        if (queue.rtmpError) {
          await sleep(2000);
          continue;
        }
        if (queue.workerOffline) {
          await sleep(2000);
          continue;
        }
        if (
          isAiWorkerBroadcastMode(queue.broadcastMode) &&
          !queue.visualWorkerRunning
        ) {
          await this.ensureVisualBroadcast(sessionId);
          await sleep(2000);
          continue;
        }

        const policy = this.getPolicy(s);
        if (
          queue.bufferSeconds >= policy.minBufferSeconds &&
          queue.queuedVideos >= 1
        ) {
          await sleep(1200);
          continue;
        }

        try {
          await this.generateAndQueueNext(sessionId, "prelive");
          await sleep(450);
        } catch (err: any) {
          const current = this.sessions.get(sessionId);
          if (!current || current.abortController.signal.aborted) break;
          current.counters.failed++;
          console.warn(`[LiveHost] Pre-live generation: ${err?.message || err}`);
          await sleep(2500);
        }
      }
    } finally {
      const s = this.sessions.get(sessionId);
      if (s) s.preliveRunning = false;
    }
  }

  /** Main runtime supervisor. */
  private async runLiveGenerationLoop(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state || state.generationRunning) return;
    state.generationRunning = true;

    console.log(`[LiveHost] 🎙️ Runtime supervisor ACTIVE: ${sessionId}`);

    try {
      while (true) {
        const s = this.sessions.get(sessionId);
        if (!s || s.abortController.signal.aborted || !s.isLive) break;
        if (this.isSessionExpired(s)) {
          console.log(`[LiveHost] ⏹️ Plan ${s.config.plan} selesai: ${sessionId}`);
          try {
            this.onSessionExpired?.(sessionId);
          } catch (err: any) {
            console.warn(
              `[LiveHost] Session expiry handler notice: ${err?.message || err}`,
            );
          }
          break;
        }

        await this.refreshQueueMetrics(sessionId);
        if (s.lastQueue.rtmpError) {
          console.log(
            `[LiveHost] RTMP fatal saat live — menghentikan generasi: ${sessionId}`,
          );
          this.onSessionExpired?.(sessionId);
          break;
        }
        const policy = this.getPolicy(s);

        this.pruneCommentQueue(s);

        const comment = this.takeBestComment(s);
        const urgentComment =
          comment &&
          (comment.priority >= 45 ||
            s.lastQueue.bufferSeconds <= MAX_ONAIR_IDLE_SECONDS);

        if (comment && (urgentComment || s.lastQueue.bufferSeconds < policy.maxBufferSeconds)) {
          await this.generateAndQueueCommentResponse(sessionId, comment);
          continue;
        }

        if (
          s.lastQueue.bufferSeconds > policy.maxBufferSeconds &&
          s.lastQueue.bufferSeconds >= policy.minBufferSeconds
        ) {
          await sleep(COMMENT_SCAN_MS);
          continue;
        }

        const needsRefill =
          s.lastQueue.bufferSeconds < policy.targetBufferSeconds ||
          s.lastQueue.bufferSeconds < policy.minBufferSeconds ||
          s.lastQueue.queuedVideos === 0;

        if (needsRefill) {
          await this.generateAndQueueNext(sessionId, "live");
          continue;
        }

        await sleep(COMMENT_SCAN_MS);
      }
    } catch (err: any) {
      const s = this.sessions.get(sessionId);
      if (s && !s.abortController.signal.aborted) {
        console.error(`[LiveHost] Runtime supervisor crash: ${err?.message || err}`);
        // Recovery loop agar satu exception tidak mematikan sesi.
        await sleep(2500);
        if (s.isLive && !s.abortController.signal.aborted) {
          s.generationRunning = false;
          void this.runLiveGenerationLoop(sessionId);
          return;
        }
      }
    } finally {
      const s = this.sessions.get(sessionId);
      if (s) s.generationRunning = false;
      console.log(`[LiveHost] Runtime supervisor stopped: ${sessionId}`);
    }
  }

  private formatProductPrice(product: ProductSnapshot): string {
    const numeric = Number(product.price);
    if (Number.isFinite(numeric)) return `Rp${numeric.toLocaleString("id-ID")}`;
    return String(product.price || "harga live");
  }

  private toScriptFacts(product: ProductSnapshot): ScriptProductFacts {
    const knowledge = mergeProductKnowledge(product.description, {
      benefits: product.benefits,
      usage: product.usage,
      faq: product.faq,
    });
    return {
      id: product.id,
      name: product.name,
      price: this.formatProductPrice(product),
      category: product.category,
      benefits: knowledge.benefits,
      description: product.description,
      usage: knowledge.usage,
      faq: knowledge.faq,
      stock: product.stock,
      copywriting: product.copywriting,
      targetAudience: product.targetAudience,
      faqPack: product.faqPack?.length ? product.faqPack : buildDefaultFaqPack({
        id: product.id,
        name: product.name,
        price: this.formatProductPrice(product),
        category: product.category,
        benefits: knowledge.benefits,
        description: product.description,
        usage: knowledge.usage,
        faq: knowledge.faq,
        stock: product.stock,
      }),
      hasBanner: Boolean(product.bannerImage),
    };
  }

  private toBrainInput(
    state: HostRuntimeState,
    product: ProductSnapshot,
    extra: Pick<SalesBrainInput, "userQuestion"> & Partial<SalesBrainInput>,
  ): SalesBrainInput {
    return {
      avatarName: state.config.avatarName,
      tone: state.config.tone,
      productName: product.name,
      productPrice: this.formatProductPrice(product),
      productDescription: product.description,
      productCategory: product.category,
      productBenefits: product.benefits,
      productUsage: product.usage,
      productFaq: product.faq,
      productStock: product.stock,
      allProducts: state.catalog,
      recentUtterances: state.memory.utterances.slice(-18),
      recentTopics: state.memory.topics.slice(-12),
      recentCTAs: state.memory.ctas.slice(-8),
      recentClaims: state.memory.claims.slice(-20),
      avoidPhrases: this.buildAvoidPhrases(state),
      avoidTopics: state.memory.topics.slice(-10),
      elapsedMinutes: Math.round(this.elapsedMs(state) / 60_000),
      plan: parsePlan(state.config.plan),
      sessionId: state.config.sessionId,
      ...extra,
    };
  }

  private seedScriptBank(state: HostRuntimeState, product: ProductSnapshot): void {
    if (state.scriptBank.productId !== product.id) {
      state.scriptBank = emptyScriptBank(product.id);
    }
    if (remainingScriptLines(state.scriptBank) > 0) return;

    if (product.scriptBank && product.scriptBank.length > 0) {
      state.scriptBank.lines = product.scriptBank.slice();
      // Pastikan selalu ada filler lokal agar buffer rendah tidak idle.
      mergeScriptLines(
        state.scriptBank,
        recycleLocalScriptBank(this.toScriptFacts(product), state.catalog).filter((l) =>
          FILLER_TOPICS.has(l.topic),
        ),
        state.memory.utterances.slice(-12),
      );
    } else {
      state.scriptBank.lines = seedLocalScriptBank(this.toScriptFacts(product), state.catalog);
    }
    console.log(
      `[LiveHost] Script bank seeded: session=${state.config.sessionId} lines=${state.scriptBank.lines.length} source=${product.scriptBank?.length ? "payload+local-filler" : "local"}`,
    );
  }

  private maybeRefillScriptBank(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state || !state.product || state.scriptBank.refillInFlight) return;

    const policy = this.getPolicy(state);
    const scriptBankLow = policy.scriptBankLow || SCRIPT_BANK_LOW;
    const llmRefillMax = policy.scriptBankLlmRefillMax || SCRIPT_BANK_LLM_REFILL_MAX;
    const llmRefillCooldownMs =
      policy.scriptBankLlmRefillCooldownMs || SCRIPT_BANK_LLM_REFILL_COOLDOWN_MS;

    const recentWindow = policy.memoryUtterances >= 55 ? 36 : 24;
    const recent = state.memory.utterances.slice(-recentWindow);

    const remaining = remainingScriptLines(state.scriptBank);
    const freshCount = countFreshScriptLines(state.scriptBank, recent);
    // Keluar awal hanya jika buffer cukup DAN masih ada variasi segar.
    if (remaining > scriptBankLow && freshCount > SCRIPT_BANK_FRESH_LOW + 4) return;

    // 1) Selalu recycle lokal dulu — anti-idle tanpa rate limit.
    const recycled = recycleLocalScriptBank(
      this.toScriptFacts(state.product),
      state.catalog,
      recent,
    );
    const addedLocal = mergeScriptLines(state.scriptBank, recycled, recent);
    state.scriptBank.lastRefillAt = Date.now();
    if (addedLocal > 0) {
      console.log(
        `[LiveHost] Script bank local recycle +${addedLocal} (now ${remainingScriptLines(state.scriptBank)}) session=${sessionId}`,
      );
    } else if (remaining === 0) {
      this.seedScriptBank(state, state.product);
    }

    const stillLow =
      remainingScriptLines(state.scriptBank) <= Math.max(4, Math.floor(scriptBankLow / 2));
    const localExhausted =
      freshCount <= SCRIPT_BANK_FRESH_LOW ||
      (addedLocal === 0 && recycled.length === 0 && remaining <= scriptBankLow * 2);
    const allowLlm =
      liveBrainDuringLive() ||
      (liveBrainRefillWhenLow() && stillLow) ||
      (liveBrainRefillOnExhaust() && localExhausted);
    if (!allowLlm) return;

    const bank = state.scriptBank;
    const cooled = Date.now() - (bank.lastLlmRefillAt || 0) >= llmRefillCooldownMs;
    const effectiveMax =
      localExhausted ? llmRefillMax + SCRIPT_BANK_LLM_EXHAUST_BONUS : llmRefillMax;
    const underCap = (bank.llmRefillCount || 0) < effectiveMax;
    if (!cooled || !underCap) return;

    state.scriptBank.refillInFlight = true;
    void this.refillScriptBank(sessionId).finally(() => {
      const current = this.sessions.get(sessionId);
      if (current) current.scriptBank.refillInFlight = false;
    });
  }

  private async refillScriptBank(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    const product = state.product || (await this.ensureProductSnapshot(state));
    if (!product) return;

    const policy = this.getPolicy(state);
    const scriptBankLow = policy.scriptBankLow || SCRIPT_BANK_LOW;
    const recent = state.memory.utterances.slice(-24);
    const freshCount = countFreshScriptLines(state.scriptBank, recent);
    const remaining = remainingScriptLines(state.scriptBank);
    const localExhausted =
      freshCount <= SCRIPT_BANK_FRESH_LOW ||
      remaining <= Math.max(4, Math.floor(scriptBankLow / 2));

    await awaitBrainReady(sessionId);
    const lines = await generateScriptBankLines(
      this.toBrainInput(state, product, {
        userQuestion: localExhausted
          ? "Variasi bank ucapan hampir habis — buat baris BARU dengan angle/topik berbeda. Jangan ulang pembuka atau poin yang sama. Bahasa natural host live, jangan mengarang fakta."
          : "Isi ulang bank ucapan otonom. Bahasa natural host live, jangan kaku/robot, jangan mengarang fakta.",
        requestedMode: state.currentMode,
        requestedIntent: "SELL",
        mode: state.currentMode,
        avoidTopics: state.memory.topics.slice(-8),
        recentUtterances: state.memory.utterances.slice(-20),
      }),
    );
    const localBoost = recycleLocalScriptBank(
      this.toScriptFacts(product),
      state.catalog,
      state.memory.utterances.slice(-24),
    );
    const added = mergeScriptLines(
      state.scriptBank,
      [...lines, ...localBoost],
      state.memory.utterances.slice(-24),
    );
    state.scriptBank.lastRefillAt = Date.now();
    if (lines.length > 0) {
      state.scriptBank.llmRefillCount = (state.scriptBank.llmRefillCount || 0) + 1;
      state.scriptBank.lastLlmRefillAt = Date.now();
    }
    if (added > 0) {
      console.log(
        `[LiveHost] Script bank refill +${added} llm=${lines.length} exhausted=${localExhausted} (now ${remainingScriptLines(state.scriptBank)}) session=${sessionId}`,
      );
    }
  }

  private async generateAndQueueNext(
    sessionId: string,
    source: "prelive" | "live",
  ): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const product = await this.ensureProductSnapshot(state);
    if (!product) throw new Error("Product aktif tidak ditemukan");

    this.seedScriptBank(state, product);
    this.maybeRefillScriptBank(sessionId);

    const topic = this.chooseAutonomousTopic(state);
    const requestedMode = this.resolveModeForTopic(state, topic.modes);
    const policy = this.getPolicy(state);
    const recentWindow = policy.memoryUtterances >= 55 ? 30 : policy.memoryUtterances >= 30 ? 24 : 18;
    const recentTopicWindow = policy.memoryTopics >= 45 ? 6 : policy.memoryTopics >= 28 ? 5 : 3;
    const recent = state.memory.utterances.slice(-recentWindow);
    const recentTopics = state.memory.topics.slice(-recentTopicWindow);
    const recentCtas = state.memory.ctas.slice(-3);
    const avoidCta = recentCtas.filter((c) => c && c !== "NONE").length >= 1;
    const bufferCritical =
      state.lastQueue.queuedVideos === 0 ||
      (state.lastQueue.bufferSeconds > 0 && state.lastQueue.bufferSeconds <= 4);
    // Filler hanya saat kritis — jangan prefer hanya karena ritme/slot filler.
    const preferFiller = bufferCritical;

    const elapsedMinutes = Math.round(this.elapsedMs(state) / 60_000);
    const phaseTopics = phasePreferTopics(elapsedMinutes);

    let hostResponse =
      takeScriptLine(state.scriptBank, recent, {
        preferMode: requestedMode,
        preferTopic: topic.topic,
        preferTopics: [topic.topic, ...phaseTopics],
        avoidTopics: recentTopics,
        preferFiller,
        avoidCta,
        recentTopics,
      }) ||
      takeScriptLine(state.scriptBank, recent, {
        preferMode: requestedMode,
        preferFiller: false,
        avoidCta,
        recentTopics,
      }) ||
      takeScriptLine(state.scriptBank, recent, {}) ||
      recycleLocalScriptBank(this.toScriptFacts(product), state.catalog, recent)[0];

    if (!hostResponse) {
      state.counters.failed++;
      await sleep(GENERATION_BACKOFF_MS);
      return;
    }

    hostResponse = {
      ...hostResponse,
      topic: hostResponse.topic || topic.topic,
    };

    const accepted = await this.processHostResponse(
      sessionId,
      hostResponse,
      source,
      topic.topic,
    );

    if (!accepted) {
      state.counters.duplicateResponsesPrevented++;
      const retry =
        takeScriptLine(state.scriptBank, recent, {
          preferMode: requestedMode,
          avoidTopics: [hostResponse.topic, ...recentTopics],
          avoidCta: true,
        }) ||
        takeScriptLine(state.scriptBank, recent, {
          avoidTopics: [hostResponse.topic, ...recentTopics],
        }) ||
        takeScriptLine(state.scriptBank, recent, { preferFiller: true });
      if (retry) {
        const retryAccepted = await this.processHostResponse(
          sessionId,
          retry,
          source,
          retry.topic || topic.topic,
        );
        if (retryAccepted) return;
        state.counters.duplicateResponsesPrevented++;
      }
      await sleep(150);
    }
  }

  private async generateAndQueueCommentResponse(
    sessionId: string,
    comment: PendingComment,
  ): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const product = await this.ensureProductSnapshot(state);
    if (!product) return;

    const author = comment.authorName?.trim();
    const facts = this.toScriptFacts(product);
    const recent = state.memory.utterances.slice(-24);
    const llmDecision = shouldUseLlmForComment(facts, comment.text, comment.intent);
    const useLlm = liveBrainDuringLive()
      ? commentNeedsLlm(comment.intent, comment.text) || llmDecision.needed
      : liveBrainCommentWhenNeeded() && llmDecision.needed;

    if (useLlm) {
      console.log(
        `[LiveHost] comment LLM reason=${llmDecision.reason} intent=${comment.intent} from=${author || "Audience"}`,
      );
    } else {
      console.log(
        `[LiveHost] comment local intent=${comment.intent} from=${author || "Audience"}`,
      );
    }

    let response: HostResponse | null = null;
    if (!useLlm) {
      const bankHit = pickScriptBankCommentLine(state.scriptBank, comment.text, recent);
      if (bankHit) {
        const idx = state.scriptBank.lines.findIndex((item) => item === bankHit);
        if (idx >= 0) state.scriptBank.lines.splice(idx, 1);
        response = personalizeCommentLine(bankHit, author);
      } else {
        response = buildLocalCommentResponse(facts, comment.text, comment.intent, author, recent);
      }
    } else {
      const userQuestion = [
        `Ada komentar baru dari ${author ? `Kak ${author}` : "penonton"}.`,
        `Komentar: "${comment.text}".`,
        "Jawab spesifik pertanyaan penonton — jangan mengulang isi komentar panjang-panjang.",
        "Pakai fakta produk yang ada; jika tidak ada di data, jujur bilang cek detail di etalase.",
        "CTA hanya jika benar-benar relevan.",
      ].join(" ");

      await awaitBrainReady(sessionId);
      try {
        response = await generateHostResponse(
          this.toBrainInput(state, product, {
            userQuestion,
            authorName: author,
            mode: "QNA",
            requestedMode: "QNA",
            requestedIntent: comment.intent,
            recentUtterances: recent,
            recentTopics: state.memory.topics.slice(-15),
          }),
        );
      } catch (err: any) {
        state.counters.failed++;
        console.warn(`[LiveHost] Comment generation error: ${err?.message || err}`);
        response = buildLocalCommentResponse(facts, comment.text, comment.intent, author, recent);
        await sleep(GENERATION_BACKOFF_MS);
      }
    }

    if (!response) return;

    const accepted = await this.processHostResponse(
      sessionId,
      response,
      "comment",
      `comment:${comment.intent}`,
    );

    if (accepted) {
      state.counters.commentsAnswered++;
      state.memory.lastCommentResponseAt = Date.now();
      livePlatformConnector.recordCommentReply(sessionId, comment.id, response.speech);
    }
  }

  private async processHostResponse(
    sessionId: string,
    response: HostResponse,
    source: "prelive" | "live" | "comment",
    fallbackTopic: string,
  ): Promise<boolean> {
    const state = this.sessions.get(sessionId);
    if (!state) return false;

    const speech = response.speech.trim();
    if (!speech || speech.length < 3) return false;

    const normalized = normalizeText(speech);
    const recent = state.memory.utterances.slice(-18);

    // Semantic-ish anti-repeat gate tanpa additional embedding API.
    const maxSimilarity = recent.reduce(
      (max, previous) => Math.max(max, similarity(speech, previous)),
      0,
    );

    if (maxSimilarity >= 0.88 || this.hasRepeatedStructure(speech, recent)) {
      return false;
    }

    // Jangan dua CTA identik berturut-turut.
    if (
      response.ctaType !== "NONE" &&
      state.memory.ctas.length > 0 &&
      normalizeText(state.memory.ctas[state.memory.ctas.length - 1] || "") ===
        normalizeText(response.ctaType)
    ) {
      return false;
    }

    // Pecah CTA jadi segmen pendek: IDLE … → POINT di frasa CTA → IDLE …
    // supaya gesture natural (bukan nunggu audio panjang selesai).
    const segments = splitSpeechIntoGestureSegments(speech, response.action);
    const priority = source === "comment";

    for (const seg of segments) {
      let audioBase64: string | undefined;
      try {
        const ttsResult = await synthesizeSpeech({
          text: seg.text,
          voice: state.config.voice || "id-ID-GadisNeural",
          avatarName: state.config.avatarName,
          tone: state.config.tone,
          emotion: response.emotion,
        });
        if (ttsResult.success && ttsResult.audioBuffer) {
          audioBase64 = ttsResult.audioBuffer.toString("base64");
        }
      } catch (err: any) {
        console.warn(
          `[LiveHost] TTS error (seg action=${seg.action}): ${err?.message || err}`,
        );
      }

      // TTS gagal: tetap submit text — worker/bridge bisa fallback.
      // Semua segmen jawaban komentar tetap priority agar tidak terpotong buffer otonom.
      await this.submitToGPU(
        sessionId,
        seg.text,
        audioBase64,
        seg.action,
        priority,
      );
    }

    state.counters.generated++;
    state.lastActivityAt = Date.now();
    state.showTurn++;
    state.currentMode = response.mode;
    state.modeStartedAt = Date.now();
    state.memory.lastResponseAt = Date.now();
    if (source !== "comment") state.memory.lastSalesAt = response.ctaType === "NONE" ? state.memory.lastSalesAt : Date.now();

    this.recordMemory(state, {
      ...response,
      speech: normalized,
      action: normalizeLunaAction(response.action),
      topic: response.topic || fallbackTopic,
    });

    console.log(
      `[LiveHost] 🗣️ queued source=${source} mode=${response.mode} topic=${response.topic || fallbackTopic} action=${response.action} segments=${segments.map((s) => s.action).join(">")}`,
    );

    return true;
  }

  private recordMemory(state: HostRuntimeState, response: HostResponse): void {
    const policy = this.getPolicy(state);
    const memory = state.memory;

    memory.utterances.push(response.speech);
    if (response.topic) memory.topics.push(normalizeText(response.topic));
    if (response.ctaType && response.ctaType !== "NONE") {
      memory.ctas.push(response.ctaType);
    }
    for (const claim of response.claims || []) {
      if (claim?.trim()) memory.claims.push(claim.trim());
    }
    memory.modes.push(response.mode);

    memory.utterances = memory.utterances.slice(-policy.memoryUtterances);
    memory.topics = memory.topics.slice(-policy.memoryTopics);
    memory.ctas = memory.ctas.slice(-policy.memoryCtas);
    memory.claims = memory.claims.slice(-policy.memoryClaims);
    memory.modes = memory.modes.slice(-20);
  }

  private hasRepeatedStructure(speech: string, recent: string[]): boolean {
    const tokens = normalizeText(speech).split(" ").filter(Boolean);
    if (tokens.length < 8) return false;

    const firstFive = tokens.slice(0, 5).join(" ");
    const lastFive = tokens.slice(-5).join(" ");

    for (const previous of recent.slice(-4)) {
      const p = normalizeText(previous).split(" ").filter(Boolean);
      if (p.slice(0, 5).join(" ") === firstFive) return true;
      if (p.slice(-5).join(" ") === lastFive) return true;
    }
    return false;
  }

  private buildAvoidPhrases(state: HostRuntimeState): string[] {
    const recent = state.memory.utterances.slice(-8);
    const phrases: string[] = [];
    for (const utterance of recent) {
      const tokens = normalizeText(utterance).split(" ").filter(Boolean);
      if (tokens.length >= 4) phrases.push(tokens.slice(0, 4).join(" "));
    }
    return phrases;
  }

  private chooseAutonomousTopic(state: HostRuntimeState) {
    const recent = new Set(state.memory.topics.slice(-3));
    const elapsedMinutes = Math.round(this.elapsedMs(state) / 60_000);
    const phaseBoost = new Set(phasePreferTopics(elapsedMinutes));
    const bufferCritical =
      state.lastQueue.queuedVideos === 0 ||
      (state.lastQueue.bufferSeconds > 0 && state.lastQueue.bufferSeconds <= 4);

    // Buffer kritis → topik pendek berbasis fakta, bukan stall filler.
    if (bufferCritical) {
      const shortTopics = ["micro_tip", "benefit", "how_to_use", "value", "faq"];
      for (const topic of shortTopics) {
        if (recent.has(topic)) continue;
        return {
          topic,
          modes: topicModesFor(topic),
          prompt: "buffer kritis: isi pendek berbasis fakta produk",
        };
      }
    }

    // Ritme slot: putar fungsi, skip yang baru dipakai.
    for (let attempt = 0; attempt < RHYTHM_SLOT_ATTEMPTS; attempt++) {
      const { topic, nextCursor } = nextRhythmTopic(state.slotCursor);
      state.slotCursor = nextCursor;
      if (recent.has(topic)) continue;
      if (FILLER_TOPICS.has(topic)) continue;
      const modes = topicModesFor(topic);
      return {
        topic,
        modes,
        prompt: phaseBoost.has(topic)
          ? `fase sesi menit ${elapsedMinutes}: prefer ${topic}`
          : `ikuti ritme slot: ${topic}`,
      };
    }

    const mode = this.chooseNextMode(state);
    const candidates = AUTONOMOUS_TOPIC_BANK.filter((item) => item.modes.includes(mode));
    for (let offset = 0; offset < AUTONOMOUS_TOPIC_BANK.length; offset++) {
      const index = (state.topicCursor + offset) % AUTONOMOUS_TOPIC_BANK.length;
      const candidate = AUTONOMOUS_TOPIC_BANK[index]!;
      if (candidate.modes.includes(mode) && !recent.has(candidate.topic)) {
        state.topicCursor = (index + 1) % AUTONOMOUS_TOPIC_BANK.length;
        return candidate;
      }
    }

    const fallback = candidates[0] || AUTONOMOUS_TOPIC_BANK[state.topicCursor % AUTONOMOUS_TOPIC_BANK.length]!;
    state.topicCursor = (state.topicCursor + 1) % AUTONOMOUS_TOPIC_BANK.length;
    return fallback;
  }

  private chooseNextMode(state: HostRuntimeState): HostMode {
    const policy = this.getPolicy(state);
    const elapsed = this.elapsedMs(state);
    const currentAge = Date.now() - state.modeStartedAt;

    if (elapsed < 180_000) return "ENGAGE";
    if (currentAge < policy.modeMinMs) return state.currentMode;

    const modeOrder: HostMode[] = [
      "ENGAGE",
      "DEMO",
      "QNA",
      "SELL",
      "SOCIAL",
      "OBJECTION",
      "ENGAGE",
      "SELL",
      "QNA",
      "DEMO",
      "CLOSING",
    ];

    const recentModes = state.memory.modes.slice(-3);
    for (const candidate of modeOrder) {
      if (candidate === state.currentMode && currentAge < policy.modeMaxMs) continue;
      if (recentModes.filter((m) => m === candidate).length >= 2) continue;
      return candidate;
    }
    return "ENGAGE";
  }

  private resolveModeForTopic(state: HostRuntimeState, allowed: HostMode[]): HostMode {
    const preferred = this.chooseNextMode(state);
    if (allowed.includes(preferred)) return preferred;
    return allowed[0] || preferred;
  }

  /**
   * Comment ingress:
   * - dedupe semantic-ish via normalized fingerprint;
   * - classify local untuk menentukan priority tanpa menunggu LLM;
   * - queue tetap kecil agar komentar tidak basi;
   * - pertanyaan mirip disatukan dengan drop duplicate.
   */
  public enqueue(
    sessionId: string,
    text: string,
    authorName?: string,
    platformCommentId?: string,
  ): void {
    const state = this.sessions.get(sessionId);
    if (!state || !state.isLive) return;

    const clean = text.trim();
    if (!clean) return;

    state.counters.commentsReceived++;

    const intent = inferIntent(clean);
    if (intent === "SPAM") {
      state.counters.commentsDropped++;
      return;
    }

    const now = Date.now();
    this.pruneCommentQueue(state);

    const dedupeKey = fingerprint(clean);
    const duplicateActive = state.pendingComments.some(
      (comment) =>
        comment.dedupeKey === dedupeKey ||
        similarity(comment.text, clean) >= 0.82,
    );

    if (duplicateActive) {
      state.counters.commentsDropped++;
      return;
    }

    const comment: PendingComment = {
      id: platformCommentId || `${now}-${Math.random().toString(36).slice(2, 9)}`,
      text: clean.slice(0, 500),
      authorName: authorName?.trim().slice(0, 80),
      createdAt: now,
      priority: priorityForComment(clean, intent),
      intent,
      dedupeKey,
    };

    state.pendingComments.push(comment);
    state.pendingComments.sort((a, b) => {
      const scoreA = a.priority * 10_000 - (now - a.createdAt);
      const scoreB = b.priority * 10_000 - (now - b.createdAt);
      return scoreB - scoreA;
    });

    const policy = this.getPolicy(state);
    while (state.pendingComments.length > policy.maxPendingComments) {
      // Buang priority terendah/terlama, bukan elemen terakhir secara buta.
      const dropIndex = state.pendingComments.reduce(
        (lowest, item, index, list) => {
          if (lowest === -1) return index;
          const current = list[lowest]!;
          if (item.priority < current.priority) return index;
          if (item.priority === current.priority && item.createdAt < current.createdAt) return index;
          return lowest;
        },
        -1,
      );
      if (dropIndex >= 0) {
        state.pendingComments.splice(dropIndex, 1);
        state.counters.commentsDropped++;
      } else {
        break;
      }
    }

    console.log(
      `[LiveHost] 💬 comment priority=${comment.priority} intent=${comment.intent} from=${comment.authorName || "Audience"}`,
    );
  }

  private pruneCommentQueue(state: HostRuntimeState): void {
    const cutoff = Date.now() - this.getPolicy(state).commentTtlMs;
    const before = state.pendingComments.length;
    state.pendingComments = state.pendingComments.filter((c) => c.createdAt >= cutoff);
    state.counters.commentsDropped += Math.max(0, before - state.pendingComments.length);
  }

  private takeBestComment(state: HostRuntimeState): PendingComment | null {
    this.pruneCommentQueue(state);
    if (!state.pendingComments.length) return null;

    state.pendingComments.sort((a, b) => {
      const now = Date.now();
      const ageBoostA = Math.min(20, (now - a.createdAt) / 1000);
      const ageBoostB = Math.min(20, (now - b.createdAt) / 1000);
      return b.priority + ageBoostB - (a.priority + ageBoostA);
    });

    return state.pendingComments.shift() || null;
  }

  private async ensureProductSnapshot(
    state: HostRuntimeState,
  ): Promise<ProductSnapshot | null> {
    if (state.product && Date.now() < state.productCacheExpiresAt) return state.product;

    const found =
      (state.config.product?.id === state.config.productId ? state.config.product : undefined) ||
      state.catalog.find((item) => item.id === state.config.productId) ||
      state.config.product ||
      state.catalog[0];

    if (!found) return state.product || null;

    state.product = { ...found, updatedAt: Date.now() };
    state.productCacheExpiresAt = Date.now() + PRODUCT_CACHE_TTL_MS;
    if (!state.catalog.some((item) => item.id === found.id)) {
      state.catalog = [found, ...state.catalog];
    }
    return state.product;
  }

  private async refreshQueueMetrics(sessionId: string): Promise<QueueMetrics> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return emptyQueueMetrics({ workerOffline: true });
    }

    const podId = state.config.podId || process.env.RUNPOD_POD_ID;
    if (!podId) {
      state.lastQueue = emptyQueueMetrics({
        bufferSeconds: state.estimatedBufferSeconds,
      });
      return state.lastQueue;
    }

    try {
      const raw: any = await getRunPodQueueStatus(podId);
      if (!raw?.success) {
        if (!state.workerOfflineSince) state.workerOfflineSince = Date.now();
        state.lastQueue = {
          ...state.lastQueue,
          workerOffline: true,
        };
        return state.lastQueue;
      }

      state.workerOfflineSince = 0;

      const broadcastMode = String(raw.broadcast_mode || "segment");
      const aiWorker = isAiWorkerBroadcastMode(broadcastMode);
      const utteranceQueueCount = Number(raw.utterance_queue_count ?? 0);
      const readyVideos = Number(raw.ready_videos_count || 0);
      const activeProcessing = Number(raw.active_processing_count || 0);
      const visualWorkerRunning = Boolean(raw.visual_worker_running);
      const visualWorkerInitializing = Boolean(raw.visual_worker_initializing);
      const broadcastBootState = String(raw.broadcast_boot_state || "idle");
      const bootError = String(raw.broadcast_boot_error || "");
      let rtmpError = String(raw.rtmp_error || "");
      if (!rtmpError && broadcastBootState === "error" && bootError) {
        rtmpError = bootError;
      }

      let queuedVideos = Number(raw.queued_videos_count || 0);
      if (aiWorker) {
        queuedVideos = Math.max(
          utteranceQueueCount,
          readyVideos,
          state.counters.generated,
          state.counters.submitted > 0 ? 1 : 0,
        );
      } else {
        queuedVideos = Math.max(queuedVideos, readyVideos);
      }

      const playableSeconds = Number(
        raw.playable_buffer_seconds ??
          raw.queued_videos_duration_seconds ??
          NaN,
      );
      const inFlightSeconds = Number(raw.in_flight_buffer_seconds ?? NaN);
      const explicitTotal = Number(raw.buffer_seconds ?? NaN);

      let bufferSeconds: number;
      if (Number.isFinite(explicitTotal) && explicitTotal > 0) {
        bufferSeconds = Math.max(0, explicitTotal);
      } else if (Number.isFinite(playableSeconds)) {
        bufferSeconds = Math.max(
          0,
          playableSeconds +
            (Number.isFinite(inFlightSeconds)
              ? inFlightSeconds
              : activeProcessing * IN_FLIGHT_RENDER_SECONDS),
        );
      } else if (aiWorker) {
        bufferSeconds = Math.max(
          0,
          utteranceQueueCount * FALLBACK_SPEECH_SECONDS +
            activeProcessing * 3 +
            state.counters.generated * FALLBACK_SPEECH_SECONDS,
        );
      } else {
        bufferSeconds = Math.max(
          0,
          queuedVideos * FALLBACK_SPEECH_SECONDS +
            activeProcessing * IN_FLIGHT_RENDER_SECONDS,
        );
      }

      state.estimatedBufferSeconds = bufferSeconds;
      state.lastQueue = {
        readyVideos,
        queuedVideos,
        activeProcessing,
        bufferSeconds,
        workerOffline: false,
        broadcasting: Boolean(raw.broadcasting),
        rtmpConnected: Boolean(raw.rtmp_connected),
        rtmpError,
        warmedUp: Boolean(
          raw.warmed_up ||
            visualWorkerRunning ||
            bufferSeconds > 0 ||
            queuedVideos > 0 ||
            state.counters.submitted > 0,
        ),
        broadcastMode,
        utteranceQueueCount,
        visualWorkerRunning,
        visualWorkerInitializing,
        broadcastBootState,
      };

      if (
        state.isLive &&
        state.lastQueue.bufferSeconds > this.getPolicy(state).minBufferSeconds
      ) {
        state.lastActivityAt = Date.now();
      }

      return state.lastQueue;
    } catch (err: any) {
      if (!state.workerOfflineSince) state.workerOfflineSince = Date.now();
      const msg = err?.message || String(err);
      if (msg) state.lastWorkerError = msg;
      state.lastQueue = {
        ...state.lastQueue,
        workerOffline: true,
      };
      console.warn(`[LiveHost] Queue status error: ${msg}`);
      return state.lastQueue;
    }
  }

  private async submitToGPU(
    sessionId: string,
    text: string,
    audioBase64?: string,
    action?: string,
    priority = false,
  ): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const avatarFileName = state.config.avatarName
      ? `${state.config.avatarName.toLowerCase().trim()}.png`
      : "namira.png";

    const allowed = new Set(["IDLE", "POINT_UP", "POINT_DOWN"]);
    const raw = String(action || "IDLE")
      .toUpperCase()
      .replace(/[^A-Z_]/g, "");
    const gesture = allowed.has(raw) ? raw : "IDLE";
    // Action dikirim di field `action` — tidak wajib tag di text.
    // Tag hanya untuk POINT_* (legacy parser). IDLE = text polos.
    const cleanText = String(text || "").replace(/^\s*\[[A-Z_]+\]\s*/i, "").trim();
    const taggedText =
      gesture === "IDLE" ? cleanText : `[${gesture}] ${cleanText}`.trim();

    try {
      await forwardToRunPodGPU(state.config.podId || process.env.RUNPOD_POD_ID, {
        avatarImagePath: `avatars/${avatarFileName}`,
        text: taggedText,
        voice: state.config.voice || "id-ID-GadisNeural",
        tone: state.config.tone,
        audioBase64,
        rtmpUrl: state.config.rtmpUrl,
        streamKey: state.config.streamKey,
        requireWorker: true,
        wait: false,
        action: gesture,
        priority,
      });

      state.counters.submitted++;
      state.estimatedBufferSeconds = Math.min(
        this.getPolicy(state).maxBufferSeconds,
        state.estimatedBufferSeconds + estimateDurationSeconds(text),
      );
    } catch (err: any) {
      state.counters.failed++;
      const msg = err?.message || String(err);
      if (msg) state.lastWorkerError = msg;
      if (!state.workerOfflineSince) state.workerOfflineSince = Date.now();
      throw err;
    }
  }

  public async waitForPipelineReady(
    sessionId: string,
    timeoutMs = 180_000,
  ): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const state = this.sessions.get(sessionId);
      if (!state || state.abortController.signal.aborted) return false;

      const status = await this.getPipelineStatus(sessionId);
      if (status.ready) return true;
      await sleep(1000);
    }
    return false;
  }

  public async getPipelineStatus(sessionId: string) {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return {
        ready: false,
        generationCount: 0,
        videosQueued: 0,
        pendingCount: 0,
        pendingCommentCount: 0,
        isLive: false,
        isBroadcasting: false,
        isRtmpConnected: false,
        rtmpError: "",
        bufferSeconds: 0,
        workerOffline: true,
        stageIndex: 0,
        stageText: "Session tidak ditemukan.",
      };
    }

    const queue = await this.refreshQueueMetrics(sessionId);
    const policy = this.getPolicy(state);
    const rtmpRequired = Boolean(state.config.rtmpUrl);
    const rtmpOk = !rtmpRequired || queue.rtmpConnected;
    const bufferReady =
      queue.bufferSeconds >= policy.minBufferSeconds && queue.queuedVideos >= 1;
    if (bufferReady && rtmpOk) {
      state.pipelineReady = true;
    }
    const ready =
      Boolean(state.pipelineReady) && rtmpOk && !queue.rtmpError;

    if (queue.rtmpError) {
      if (!state.rtmpFailedAt) state.rtmpFailedAt = Date.now();
      const waitMs = state.isLive ? 5_000 : 90_000;
      if (
        !state.rtmpFailStopping &&
        Date.now() - state.rtmpFailedAt >= waitMs
      ) {
        state.rtmpFailStopping = true;
        console.log(
          `[LiveHost] RTMP gagal — menghentikan sesi ${sessionId} setelah ${Math.round(waitMs / 1000)}s.`,
        );
        this.onSessionExpired?.(sessionId);
      }
    }

    let stageIndex = 0;
    let stageText = "Menyiapkan AI Host...";

    const offlineMs =
      state.workerOfflineSince > 0 ? Date.now() - state.workerOfflineSince : 0;
    const workerStuck =
      queue.workerOffline &&
      offlineMs >= WORKER_OFFLINE_FAIL_MS &&
      (state.counters.failed > 0 ||
        state.counters.submitted > 0 ||
        (state.counters.generated === 0 && offlineMs >= 90_000));
    const workerError = workerStuck
      ? state.lastWorkerError?.includes("502")
        ? "Worker GPU crash atau tidak merespons (HTTP 502). Bukan masalah Stream Key — coba mulai ulang sesi."
        : state.lastWorkerError ||
          "Worker GPU tidak merespons. Coba mulai ulang sesi live."
      : "";

    if (workerError) {
      if (!state.workerFailedAt) state.workerFailedAt = Date.now();
      if (
        !state.workerFailStopping &&
        Date.now() - state.workerFailedAt >= WORKER_FAIL_STOP_MS
      ) {
        state.workerFailStopping = true;
        console.log(
          `[LiveHost] Worker offline — menghentikan sesi ${sessionId} setelah ${Math.round(WORKER_FAIL_STOP_MS / 1000)}s.`,
        );
        this.onSessionExpired?.(sessionId);
      }
      stageIndex = 2;
      stageText = workerError;
    } else if (queue.rtmpError) {
      stageIndex = 3;
      stageText = queue.rtmpError;
    } else if (
      queue.broadcastBootState === "error" &&
      !queue.visualWorkerRunning
    ) {
      stageIndex = 2;
      stageText =
        workerError ||
        "Visual worker gagal start — coba putuskan dan hubungkan ulang sesi.";
    } else if (
      !queue.visualWorkerRunning &&
      (queue.broadcastBootState === "starting" || queue.visualWorkerInitializing)
    ) {
      stageIndex = 1;
      stageText =
        "Memuat model MuseTalk ke GPU (1–3 menit pada broadcast pertama)...";
    } else if (!queue.warmedUp && queue.queuedVideos === 0 && state.counters.submitted === 0) {
      stageIndex = 1;
      stageText = "Memuat model AI Host ke Cloud GPU...";
    } else if (
      queue.bufferSeconds < policy.minBufferSeconds &&
      queue.queuedVideos < 2 &&
      state.counters.generated < 2 &&
      !state.pipelineReady
    ) {
      stageIndex = 2;
      stageText = isAiWorkerBroadcastMode(queue.broadcastMode)
        ? "Menyiapkan buffer ucapan AI Host (realtime)..."
        : "Menyiapkan segmen pembuka AI Host...";
    } else if (rtmpRequired && !queue.rtmpConnected) {
      stageIndex = 3;
      const connectingHint =
        queue.rtmpError ||
        (Math.round(this.elapsedMs(state) / 1000) >= 90 && queue.broadcasting
          ? "RTMP masih handshake — pastikan sudah klik 'Siarkan Langsung' di Instagram/Facebook."
          : "");
      stageText =
        connectingHint ||
        (queue.broadcastBootState === "starting" || queue.visualWorkerInitializing
          ? "Menghubungkan RTMP ke platform..."
          : queue.broadcasting
            ? "Menghubungkan RTMP ke platform..."
            : "Menunggu koneksi RTMP...");
    } else if (!state.isLive) {
      stageIndex = 4;
      stageText = "AI Host siap. Silakan konfirmasi Go Live.";
    } else {
      stageIndex = 5;
      stageText = `AI Host LIVE — buffer ${Math.round(queue.bufferSeconds)} detik.`;
    }

    return {
      ready,
      generationCount: state.counters.generated,
      videosQueued: queue.queuedVideos,
      utteranceQueueCount: queue.utteranceQueueCount,
      broadcastMode: queue.broadcastMode,
      visualWorkerRunning: queue.visualWorkerRunning,
      visualWorkerInitializing: queue.visualWorkerInitializing,
      broadcastBootState: queue.broadcastBootState,
      pendingCount: queue.utteranceQueueCount,
      pendingCommentCount: state.pendingComments.length,
      isLive: state.isLive,
      isBroadcasting: queue.broadcasting,
      isRtmpConnected: queue.rtmpConnected,
      rtmpError: queue.rtmpError || "",
      workerError,
      bufferSeconds: Math.round(queue.bufferSeconds),
      workerOffline: queue.workerOffline,
      workerOfflineSeconds:
        state.workerOfflineSince > 0
          ? Math.round((Date.now() - state.workerOfflineSince) / 1000)
          : 0,
      warmedUp: queue.warmedUp,
      currentMode: state.currentMode,
      elapsedSeconds: Math.round(this.elapsedMs(state) / 1000),
      plan: parsePlan(state.config.plan),
      commentsReceived: state.counters.commentsReceived,
      commentsAnswered: state.counters.commentsAnswered,
      commentsDropped: state.counters.commentsDropped,
      duplicateResponsesPrevented: state.counters.duplicateResponsesPrevented,
      scriptBankRemaining: remainingScriptLines(state.scriptBank),
      scriptBankLlmRefillCount: state.scriptBank.llmRefillCount || 0,
      scriptBankSource: state.product?.scriptBank?.length
        ? state.scriptBank.llmRefillCount > 0
          ? "mixed"
          : "payload"
        : "local",
      stageIndex,
      stageText,
    };
  }
}

export const liveHostOrchestrator = new LiveHostOrchestrator();
