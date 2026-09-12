import { forwardToRunPodGPU, getRunPodQueueStatus, startRunPodBroadcast, resolveMediaAsDataUrl } from "./runpod-bridge.js";
import {
  generateHostResponse,
  generateScriptBankLines,
  getBrainBackoffMs,
  liveBrainCommentWhenNeeded,
  liveBrainDuringLive,
  liveLlmRefillAt,
  normalizeLunaAction,
  splitSpeechIntoGestureSegments,
  type HostIntent,
  type HostMode,
  type HostResponse,
  type SalesBrainInput,
} from "./llm.js";
import {
  buildDefaultFaqPack,
  buildLocalCommentResponse,
  commentNeedsLlm,
  detectGreetingClass,
  emptyHostConversationMemory,
  emptyScriptBank,
  emergencyScriptLines,
  FILLER_TOPICS,
  getOrCreateProductMemory,
  hasRecentGreetingClass,
  marathonCycleId,
  mergeScriptLines,
  trimScriptBankToCap,
  SCRIPT_BANK_ACTIVE_CAP,
  nextRhythmTopic,
  phasePreferTopics,
  recordSpeechUsage,
  remainingScriptLines,
  RHYTHM_SLOTS,
  mergeProductKnowledge,
  pickScriptBankCommentLine,
  stripLeadingGreeting,
  takeScriptLine,
  touchProductVisit,
  shouldUseLlmForComment,
  type FaqPackEntry,
  type HostConversationMemory,
  type ProductMemory,
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
  voiceId?: string;
  style?: string;
  ttsLang?: string;
  speechSpeed?: number;
  tone: string;
  rtmpUrl?: string;
  streamKey?: string;
  podId?: string | null;
  sessionId: string;
  plan?: StreamPlan;
  maxDurationMs?: number;
  product?: ProductSnapshot;
  catalog?: ProductSnapshot[];
  backgroundImage?: string;
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
    ? (p.scriptBank as HostResponse[]).filter((line) => line && typeof line.speech === "string" && line.speech.trim().length >= 8)
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
  attempts?: number;
}

interface HostMemory {
  utterances: string[];
  topics: string[];
  ctas: string[];
  claims: string[];
  modes: HostMode[];
  greetings: string[];
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
  rtmpHint: string;
  rtmpState: string;
  rtmpConnectingSeconds: number;
  warmedUp: boolean;
  broadcastMode: string;
  utteranceQueueCount: number;
    readyUtteranceCount: number;
    renderQueueSize?: number;
    readySpeechSeconds?: number;
    renderTimeSec?: number;
    speechDurationSec?: number;
    realTimeRatio?: number;
    gpuThroughputBound?: boolean;
    playbackArmed: boolean;
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
  isPaused: boolean;
  generationRunning: boolean;
  generationLoopId: number;
  preliveRunning: boolean;
  startedAt: number;
  lastActivityAt: number;
  product?: ProductSnapshot;
  catalog: ProductSnapshot[];
  productCacheExpiresAt: number;
  memory: HostMemory;
  conversation: HostConversationMemory;
  productMemories: Map<string, ProductMemory>;
  pendingComments: PendingComment[];
  processedCommentIds: Set<string>;
  currentMode: HostMode;
  modeStartedAt: number;
  showTurn: number;
  topicCursor: number;
  slotCursor: number;
  counters: RuntimeCounters;
  lastQueue: QueueMetrics;
  estimatedBufferSeconds: number;
  /** Per-product LLM script banks; `scriptBank` is the active product view. */
  productBanks: Map<string, ScriptBankState>;
  scriptBank: ScriptBankState;
  rtmpFailedAt: number;
  rtmpFailStopping: boolean;
  workerOfflineSince: number;
  lastWorkerError: string;
  lastTtsError: string;
  workerFailStopping: boolean;
  workerFailedAt: number;
  broadcastRetryAt: number;
  broadcastRetryCount: number;
  /** Concurrent generateAndQueueNext jobs (TTS+submit). Caps keep MuseTalk ahead of realtime. */
  generationInFlight: number;
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
  scriptBankLow: number;
  scriptBankLlmRefillMax: number;
  scriptBankLlmRefillCooldownMs: number;
}

const LIVE_MIN_BUFFER = Number(process.env.LIVE_MIN_BUFFER_SECONDS || 6);
const LIVE_MAX_UTTERANCE_SECONDS = Number(process.env.LIVE_MAX_UTTERANCE_SECONDS || 10);
const LIVE_TTS_MAX_SPEED = 1.0;
const GO_LIVE_MIN_UTTERANCES = Number(process.env.GO_LIVE_MIN_UTTERANCES || 1);
// Opening buffer only (overlay / first arm). Live loop still queues 1-by-1.
const AI_WORKER_GO_LIVE_MIN_UTTERANCES = Math.max(
  1,
  Number(process.env.AI_WORKER_GO_LIVE_MIN_UTTERANCES || 4),
);
/** Go Live requires ready speech seconds (thicker than count-only gate). */
export const LIVE_GO_LIVE_MIN_SPEECH_SECONDS = Math.max(
  16,
  Number(process.env.LIVE_GO_LIVE_MIN_SPEECH_SECONDS || 28),
);

const PLAN_POLICIES: Record<StreamPlan, PlanPolicy> = {
  "1H": {
    durationMs: 60 * 60 * 1000,
    minBufferSeconds: LIVE_MIN_BUFFER,
    targetBufferSeconds: 28,
    maxBufferSeconds: 45,
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
    targetBufferSeconds: 28,
    maxBufferSeconds: 45,
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
    targetBufferSeconds: 32,
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
    targetBufferSeconds: 40,
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

const IN_FLIGHT_RENDER_SECONDS = 10;
const LIVE_CONTINUITY_BUFFER_SECONDS = 8;
const LIVE_CONTINUITY_MIN_UTTERANCES = 3;
const MIN_PLAYABLE_UTTERANCES = LIVE_CONTINUITY_MIN_UTTERANCES;
// Keep ~20–36s of READY speech so TTS latency (6–10s) never drains the queue to silence.
const LIVE_ONAIR_MIN_READY_UTTERANCES = Math.max(
  2,
  Number(process.env.LIVE_ONAIR_MIN_READY_UTTERANCES || 3),
);
const LIVE_ONAIR_MIN_SPEECH_SECONDS = Math.max(
  12,
  Number(process.env.LIVE_ONAIR_MIN_SPEECH_SECONDS || 20),
);
const LIVE_ONAIR_MAX_SPEECH_SECONDS = Math.max(
  LIVE_ONAIR_MIN_SPEECH_SECONDS + 8,
  Number(process.env.LIVE_ONAIR_MAX_SPEECH_SECONDS || 36),
);
const MAX_WORKER_UTTERANCE_QUEUE = Math.max(
  4,
  Number(process.env.LIVE_MAX_WORKER_UTTERANCE_QUEUE || 8),
);
/** Parallel TTS/submit jobs. Keep small so MuseTalk stays realtime (no FPS hit). */
const LIVE_PARALLEL_PRODUCTION = Math.max(
  1,
  Math.min(3, Number(process.env.LIVE_PARALLEL_PRODUCTION || 2)),
);
/** Only pause production when lipsync render queue is truly backed up. */
const LIVE_ONAIR_RENDER_QUEUE_CAP = Math.max(
  4,
  Number(process.env.LIVE_ONAIR_RENDER_QUEUE_CAP || 8),
);

export function hostResponseDelivered(submittedSegments: number): boolean {
  return submittedSegments > 0;
}

export function decideOnAirStep(input: {
  readyCount: number;
  readySpeechSeconds: number;
  workerPending: number;
  renderQueue: number;
  realTimeRatio: number;
  visualWorkerInitializing?: boolean;
  hasComment: boolean;
  commentPriority?: number;
  generationInFlight?: number;
}): "skip_init_or_cap" | "comment" | "wait" | "generate" {
  const inFlight = Math.max(0, Number(input.generationInFlight || 0));
  const pendingAll = input.workerPending + inFlight;
  if (input.visualWorkerInitializing || pendingAll >= MAX_WORKER_UTTERANCE_QUEUE) {
    return "skip_init_or_cap";
  }
  if (inFlight >= LIVE_PARALLEL_PRODUCTION) {
    return "wait";
  }
  const bufferCritical =
    input.readyCount < LIVE_ONAIR_MIN_READY_UTTERANCES ||
    input.readySpeechSeconds < LIVE_ONAIR_MIN_SPEECH_SECONDS;
  const bufferFull =
    pendingAll >= MAX_WORKER_UTTERANCE_QUEUE ||
    input.readySpeechSeconds >= LIVE_ONAIR_MAX_SPEECH_SECONDS ||
    input.renderQueue >= LIVE_ONAIR_RENDER_QUEUE_CAP;
  const gpuSlow = input.realTimeRatio > 0 && input.realTimeRatio < 1;
  const commentSafe =
    input.hasComment &&
    !bufferCritical &&
    input.readyCount >= LIVE_ONAIR_MIN_READY_UTTERANCES &&
    input.readySpeechSeconds >= LIVE_ONAIR_MIN_SPEECH_SECONDS;
  const urgentComment = input.hasComment && (input.commentPriority || 0) >= 45 && input.readyCount >= 1 && !gpuSlow;
  if (input.hasComment && (commentSafe || urgentComment)) return "comment";
  // GPU slower than realtime: keep generating only while speech buffer is critical.
  if (bufferFull || (gpuSlow && !bufferCritical)) return "wait";
  return "generate";
}

function isAiWorkerBroadcastMode(mode: string): boolean {
  const m = (mode || "").trim().toLowerCase();
  return m === "ai_worker" || m === "ai-worker" || m === "realtime" || m === "visual_worker";
}

function emptyQueueMetrics(partial: Partial<QueueMetrics> = {}): QueueMetrics {
  return {
    readyVideos: 0,
    queuedVideos: 0,
    activeProcessing: 0,
    bufferSeconds: 0,
    workerOffline: false,
    broadcasting: false,
    rtmpConnected: false,
    rtmpError: "",
    rtmpHint: "",
    rtmpState: "disconnected",
    rtmpConnectingSeconds: 0,
    warmedUp: false,
    broadcastMode: "segment",
    utteranceQueueCount: 0,
    readyUtteranceCount: 0,
    playbackArmed: false,
    visualWorkerRunning: false,
    visualWorkerInitializing: false,
    broadcastBootState: "idle",
    ...partial,
  };
}

function isSoftRtmpMessage(msg: string): boolean {
  const t = (msg || "").toLowerCase();
  if (!t) return true;
  return (
    t.includes("belum publish") ||
    t.includes("masih") ||
    t.includes("tunggu") ||
    t.includes("menunggu") ||
    t.includes("handshake") ||
    t.includes("menyiapkan") ||
    t.includes("preview") ||
    t.includes("sedang")
  );
}

function isFatalRtmpFailure(queue: QueueMetrics): boolean {
  if (queue.rtmpConnected) return false;
  if (queue.visualWorkerInitializing || queue.broadcastBootState === "starting") {
    return false;
  }
  if (queue.rtmpState === "connecting" || queue.rtmpState === "disconnected") {
    if (!queue.rtmpError || isSoftRtmpMessage(queue.rtmpError)) return false;
  }
  if (queue.rtmpState === "failed") return true;
  if (queue.broadcastBootState === "error" && queue.rtmpError) return true;
  if (queue.rtmpError && !isSoftRtmpMessage(queue.rtmpError)) return true;
  return false;
}
const PRODUCT_CACHE_TTL_MS = 30_000;
const COMMENT_SCAN_MS = 400;
const WORKER_OFFLINE_FAIL_MS = 45_000;
const WORKER_FAIL_STOP_MS = 120_000;
const GENERATION_BACKOFF_MS = 800;
export const MAX_ONAIR_IDLE_SECONDS = LIVE_CONTINUITY_BUFFER_SECONDS;
const SCRIPT_BANK_LLM_REFILL_COOLDOWN_MS = Number(process.env.LIVE_SCRIPT_BANK_LLM_REFILL_COOLDOWN_MS || 90_000);
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
    prompt: "angkat satu masalah nyata yang relevan dengan kategori produk lalu hubungkan ke manfaat yang memang ada di data",
  },
  {
    topic: "benefit",
    modes: ["SELL", "DEMO"],
    prompt: "bedah satu manfaat utama dengan contoh penggunaan sehari-hari, jangan mengulang benefit terakhir",
  },
  {
    topic: "how_to_use",
    modes: ["DEMO", "QNA"],
    prompt: "jelaskan cara penggunaan berdasarkan data produk, praktis dan tidak seperti membaca manual",
  },
  {
    topic: "buyer_fit",
    modes: ["ENGAGE", "SELL"],
    prompt: "jelaskan tipe kebutuhan/orang yang kemungkinan paling cocok dengan produk berdasarkan fakta yang tersedia",
  },
  {
    topic: "objection",
    modes: ["OBJECTION"],
    prompt: "angkat satu keraguan pembeli yang umum hanya bila dapat dijawab dari fakta produk; jangan mengarang jaminan",
  },
  {
    topic: "comparison",
    modes: ["QNA", "SELL"],
    prompt: "jelaskan perbedaan produk aktif dengan produk lain di katalog jika relevan; gunakan data katalog saja",
  },
  {
    topic: "value",
    modes: ["SELL", "ENGAGE"],
    prompt: "bantu penonton menilai value berdasarkan fitur/manfaat yang nyata, tanpa klaim hiperbola",
  },
  {
    topic: "use_case",
    modes: ["ENGAGE", "DEMO"],
    prompt: "ceritakan satu skenario penggunaan yang relatable tanpa membuat testimoni palsu",
  },
  {
    topic: "micro_tip",
    modes: ["DEMO", "ENGAGE"],
    prompt: "berikan satu tips kecil yang berguna terkait penggunaan produk",
  },
  {
    topic: "catalog_bridge",
    modes: ["SELL", "ENGAGE"],
    prompt: "buat jembatan halus ke produk lain di katalog hanya jika ada alasan yang jelas",
  },
  {
    topic: "soft_cta",
    modes: ["SELL"],
    prompt: "buat ajakan tindakan yang ringan dan kontekstual; jangan memakai pola CTA terakhir",
  },
  {
    topic: "social_engagement",
    modes: ["SOCIAL", "ENGAGE"],
    prompt: "ajak penonton ikut percakapan dengan pertanyaan ringan yang tidak selalu berujung jualan",
  },
  {
    topic: "reframe",
    modes: ["OBJECTION", "ENGAGE"],
    prompt: "ubah sudut pandang penonton terhadap satu kebutuhan tanpa mengulang argumen terakhir",
  },
  {
    topic: "mini_story",
    modes: ["ENGAGE", "SOCIAL"],
    prompt: "buat mini-story 20-40 detik yang relatable dan terkait manfaat produk, tanpa membuat cerita pelanggan palsu",
  },
  {
    topic: "price_context",
    modes: ["SELL", "QNA"],
    prompt: "bahas harga hanya jika relevan dengan konteks; jangan mengulang angka harga tanpa alasan",
  },
  {
    topic: "faq",
    modes: ["QNA"],
    prompt: "jawab satu FAQ yang belum dibahas, berdasarkan knowledge produk yang tersedia",
  },
  {
    topic: "energy_reset",
    modes: ["ENGAGE", "SOCIAL"],
    prompt: "ubah ritme percakapan supaya sesi terasa hidup, singkat, hangat, dan tidak seperti membaca skrip",
  },
  {
    topic: "closing_loop",
    modes: ["CLOSING"],
    prompt: "buat rangkuman singkat dari hal penting yang belum dirangkum, lalu CTA hanya bila memang waktunya tepat",
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
  const aa = new Set(
    normalizeText(a)
      .split(" ")
      .filter((x) => x.length >= 3),
  );
  const bb = new Set(
    normalizeText(b)
      .split(" ")
      .filter((x) => x.length >= 3),
  );
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

  public setSessionExpiredHandler(handler: (sessionId: string) => void): void {
    this.onSessionExpired = handler;
  }

  constructor() {
    livePlatformConnector.setSpeechCallback((text: string, sessionId?: string, authorName?: string, platformCommentId?: string) => {
      if (sessionId && text?.trim()) {
        this.enqueue(sessionId, text, authorName, platformCommentId);
      }
    });
  }

  public start(config: HostConfig): void {
    this.startPipelineBackground(config);
  }

  public stop(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.abortController.abort();
    this.sessions.delete(sessionId);
    console.log(`[LiveHost] ðŸ›‘ Session ${sessionId} dihentikan.`);
  }

  public stopAll(): void {
    for (const [sessionId, state] of this.sessions.entries()) {
      state.abortController.abort();
      console.log(`[LiveHost] ðŸ›‘ Session ${sessionId} dihentikan (stopAll).`);
    }
    this.sessions.clear();
  }

  public setPaused(sessionId: string, paused: boolean): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.isPaused = paused;
    console.log(`[LiveHost] Session ${sessionId} soft-${paused ? "paused" : "resumed"}`);
  }

  public switchProduct(sessionId: string, productId: string, snapshot?: ProductSnapshot): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const found =
      snapshot || state.catalog.find((item) => item.id === productId) || (state.config.product?.id === productId ? state.config.product : undefined);

    // Persist memory produk lama  jangan dihapus saat ganti banner/produk.
    if (state.product?.id) {
      const prev = getOrCreateProductMemory(state.productMemories, state.product.id);
      state.conversation.recentProducts.push(state.product.id);
      state.conversation.recentProducts = state.conversation.recentProducts.slice(-24);
      if (state.product.category) {
        state.conversation.recentCategories.push(state.product.category);
        state.conversation.recentCategories = state.conversation.recentCategories.slice(-24);
      }
      void prev;
    }

    state.config.productId = productId;
    if (found) {
      state.config.product = found;
      state.product = { ...found, updatedAt: Date.now() };
    } else {
      state.product = undefined;
    }
    state.productCacheExpiresAt = found ? Date.now() + PRODUCT_CACHE_TTL_MS : 0;

    const productMemory = touchProductVisit(getOrCreateProductMemory(state.productMemories, productId));
    const elapsedMinutes = Math.round(this.elapsedMs(state) / 60_000);
    const cycleId = marathonCycleId(elapsedMinutes);
    state.conversation.currentCycle = cycleId;

    this.setActiveProductBank(state, productId);
    if (state.product) {
      void this.ensureProductBank(state, state.product);
    }
    state.memory.topics.push("product_switch");
    state.currentMode = "ENGAGE";
    state.modeStartedAt = Date.now();
    if (productMemory.entryMode === "re_entry") {
      state.slotCursor = Math.max(state.slotCursor, 3);
    } else {
      state.slotCursor = 0;
    }

    console.log(
      `[LiveHost] ðŸ”„ Product switched: session=${sessionId}, product=${productId}, entry=${productMemory.entryMode}, visits=${productMemory.visitCount}`,
    );
  }

  public async startLivePipeline(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) throw new Error(`Session ${sessionId} tidak ditemukan.`);

    if (state.isLive) return;

    state.isLive = true;
    state.startedAt = Date.now();
    state.lastActivityAt = Date.now();

    console.log(`[LiveHost] âœ… Session ${sessionId} LIVE  plan=${state.config.plan || "2H"}`);

    if (!state.generationRunning) {
      void this.runLiveGenerationLoop(sessionId);
    }
  }

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
      isPaused: false,
      generationRunning: false,
      generationLoopId: 0,
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
        greetings: [],
        commentFingerprints: [],
        lastResponseAt: 0,
        lastCommentResponseAt: 0,
        lastSalesAt: 0,
      },
      conversation: emptyHostConversationMemory(now),
      productMemories: new Map(),
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
      ...(() => {
        const bank = emptyScriptBank(config.productId);
        return {
          productBanks: new Map([[config.productId, bank]]),
          scriptBank: bank,
        };
      })(),
      rtmpFailedAt: 0,
      rtmpFailStopping: false,
      workerOfflineSince: 0,
      lastWorkerError: "",
      lastTtsError: "",
      workerFailStopping: false,
      workerFailedAt: 0,
      broadcastRetryAt: 0,
      broadcastRetryCount: 0,
      generationInFlight: 0,
    };

    this.sessions.set(config.sessionId, state);

    console.log(`[LiveHost] ðŸŽ¬ Background pipeline start: session=${config.sessionId}, plan=${state.config.plan}`);

    if (process.env.LIVE_WORKER_WARMUP === "1") {
      void this.warmupWorkerModel(config.sessionId);
    }
    void this.runPreLivePipeline(config.sessionId);
  }

  private async warmupWorkerModel(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state?.config.podId) return;

    try {
      const avatarFileName = state.config.avatarName ? `${state.config.avatarName.toLowerCase().trim()}.png` : "namira.png";

      await forwardToRunPodGPU(state.config.podId, {
        avatarImagePath: `avatars/${avatarFileName}`,
        text: "baik",
        voice: state.config.voice || "namira",
        tone: state.config.tone,
        requireWorker: false,
        wait: false,
      });

      console.log(`[LiveHost] ðŸ”¥ Worker warmup submitted: ${sessionId}`);
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
    const limitMs = state.config.maxDurationMs && state.config.maxDurationMs > 0 ? state.config.maxDurationMs : this.getPolicy(state).durationMs;
    return this.elapsedMs(state) >= limitMs;
  }

  private async ensureVisualBroadcast(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state || state.abortController.signal.aborted) return;

    const { rtmpUrl, streamKey, podId } = state.config;
    if (!rtmpUrl?.trim() || !streamKey?.trim() || !podId) return;

    const queue = state.lastQueue;
    if (queue.visualWorkerRunning || queue.broadcasting) return;
    if (queue.broadcastBootState === "starting" || queue.visualWorkerInitializing) {
      return;
    }
    if (queue.broadcastBootState === "error" || isFatalRtmpFailure(queue)) {
      return;
    }

    const now = Date.now();
    if (now < state.broadcastRetryAt) return;
    if (state.broadcastRetryCount >= 8) return;

    state.broadcastRetryCount += 1;
    state.broadcastRetryAt = now + 15_000;

    const product = state.product || state.config.product;
    const liveOverlayMedia = (url?: string) => resolveMediaAsDataUrl(url);

    console.log(`[LiveHost] ðŸ” Retry start-broadcast (${state.broadcastRetryCount}/8): ${sessionId}`);

    try {
      const result = await startRunPodBroadcast(podId, {
        rtmpUrl: rtmpUrl.trim(),
        streamKey: streamKey.trim(),
        productName: product?.name,
        productPrice: product?.price ? String(product.price).replace(/\D/g, "") : undefined,
        productImageUrl: liveOverlayMedia(product?.image),
        bannerImageUrl: liveOverlayMedia(product?.bannerImage),
        backgroundImage: liveOverlayMedia(state.config.backgroundImage),
        hostName: state.config.avatarName || "namira",
        waitForReady: false,
      });
      if (!result.success) {
        state.lastWorkerError = result.error || "Gagal memulai visual worker (start-broadcast)";
        console.warn(`[LiveHost] Retry start-broadcast gagal: ${state.lastWorkerError}`);
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
      while (true) {
        const s = this.sessions.get(sessionId);
        if (!s || s.abortController.signal.aborted || s.isLive) break;

        const queue = await this.refreshQueueMetrics(sessionId);
        if (queue.broadcastBootState === "error") {
          await sleep(2000);
          continue;
        }
        if (isFatalRtmpFailure(queue)) {
          await sleep(2000);
          continue;
        }
        if (queue.workerOffline) {
          await sleep(2000);
          continue;
        }
        if (!queue.visualWorkerRunning && !queue.broadcasting) {
          await this.ensureVisualBroadcast(sessionId);
          await sleep(2000);
          continue;
        }

        const policy = this.getPolicy(s);
        const aiWorkerQueue = isAiWorkerBroadcastMode(queue.broadcastMode);
        const playableDepth = aiWorkerQueue ? queue.readyUtteranceCount : queue.queuedVideos;
        const readySpeech = Number(queue.readySpeechSeconds || queue.bufferSeconds || 0);
        const minPlayableDepth = aiWorkerQueue ? AI_WORKER_GO_LIVE_MIN_UTTERANCES : GO_LIVE_MIN_UTTERANCES;
        const openingReady = aiWorkerQueue
          ? playableDepth >= minPlayableDepth && readySpeech >= LIVE_GO_LIVE_MIN_SPEECH_SECONDS
          : playableDepth >= minPlayableDepth && queue.bufferSeconds >= policy.minBufferSeconds;
        // Stop topping once Go Live thresholds are met (count + speech).
        if (openingReady) {
          await sleep(1200);
          continue;
        }
        if (aiWorkerQueue && (s.generationInFlight || 0) >= LIVE_PARALLEL_PRODUCTION) {
          await sleep(400);
          continue;
        }

        try {
          s.generationInFlight = (s.generationInFlight || 0) + 1;
          void this.generateAndQueueNext(sessionId, "prelive")
            .catch((err: any) => {
              const current = this.sessions.get(sessionId);
              if (!current || current.abortController.signal.aborted) return;
              current.counters.failed++;
              console.warn(`[LiveHost] Pre-live generation: ${err?.message || err}`);
            })
            .finally(() => {
              const current = this.sessions.get(sessionId);
              if (current) current.generationInFlight = Math.max(0, (current.generationInFlight || 1) - 1);
            });
          await sleep(350);
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

  private async runLiveGenerationLoop(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state || state.generationRunning) return;
    state.generationRunning = true;
    const myLoopId = ++state.generationLoopId;

    console.log(`[LiveHost] ðŸŽ™ï¸ Runtime supervisor ACTIVE: ${sessionId}`);

    let shouldRecover = false;
    try {
      while (true) {
        const s = this.sessions.get(sessionId);
        if (!s || s.generationLoopId !== myLoopId || s.abortController.signal.aborted || !s.isLive) {
          break;
        }
        if (this.isSessionExpired(s)) {
          console.log(`[LiveHost] â¹ï¸ Plan ${s.config.plan} selesai: ${sessionId}`);
          try {
            this.onSessionExpired?.(sessionId);
          } catch (err: any) {
            console.warn(`[LiveHost] Session expiry handler notice: ${err?.message || err}`);
          }
          break;
        }

        await this.refreshQueueMetrics(sessionId);
        if (s.isPaused) {
          await sleep(800);
          continue;
        }
        if (isFatalRtmpFailure(s.lastQueue)) {
          console.log(`[LiveHost] RTMP fatal saat live  menghentikan generasi: ${sessionId}`);
          this.onSessionExpired?.(sessionId);
          break;
        }
        const policy = this.getPolicy(s);

        this.pruneCommentQueue(s);

        const workerPending = s.lastQueue.utteranceQueueCount || 0;
        const aiWorker = isAiWorkerBroadcastMode(s.lastQueue.broadcastMode);
        if (aiWorker) {
          const comment = this.takeBestComment(s);
          const step = decideOnAirStep({
            readyCount: s.lastQueue.readyUtteranceCount || 0,
            readySpeechSeconds: Number(s.lastQueue.readySpeechSeconds || s.lastQueue.bufferSeconds || 0),
            workerPending,
            renderQueue: Number(s.lastQueue.renderQueueSize || 0),
            realTimeRatio: Number(s.lastQueue.realTimeRatio || 0),
            visualWorkerInitializing: s.lastQueue.visualWorkerInitializing,
            hasComment: Boolean(comment),
            commentPriority: comment?.priority,
            generationInFlight: s.generationInFlight || 0,
          });
          if (step === "skip_init_or_cap" || step === "wait") {
            await sleep(COMMENT_SCAN_MS);
            continue;
          }
          if (step === "comment" && comment) {
            await this.generateAndQueueCommentResponse(sessionId, comment);
            continue;
          }
          // Fire TTS/submit without awaiting — N+1 fills while N plays (capped).
          s.generationInFlight = (s.generationInFlight || 0) + 1;
          void this.generateAndQueueNext(sessionId, "live")
            .catch((err: any) => {
              const msg = String(err?.message || err);
              if (/429/.test(msg)) {
                console.warn(`[LiveHost] Worker queue penuh (429) — rolling producer backoff`);
                return;
              }
              const current = this.sessions.get(sessionId);
              if (current) current.counters.failed++;
              console.warn(`[LiveHost] Live generation: ${msg}`);
            })
            .finally(() => {
              const current = this.sessions.get(sessionId);
              if (current) current.generationInFlight = Math.max(0, (current.generationInFlight || 1) - 1);
            });
          await sleep(Math.min(COMMENT_SCAN_MS, 250));
          continue;
        }

        const workerQueueDepth = Math.max(
          s.lastQueue.utteranceQueueCount || 0,
          s.lastQueue.readyUtteranceCount || 0,
        );
        // Backpressure: jangan flood worker saat lipsync/queue sudah penuh.
        if (
          s.lastQueue.visualWorkerInitializing ||
          workerQueueDepth >= MAX_WORKER_UTTERANCE_QUEUE
        ) {
          await sleep(COMMENT_SCAN_MS);
          continue;
        }

        const playableQueueDepth = isAiWorkerBroadcastMode(s.lastQueue.broadcastMode)
          ? s.lastQueue.readyUtteranceCount || 0
          : s.lastQueue.queuedVideos || 0;
        const continuityMinUtterances = isAiWorkerBroadcastMode(s.lastQueue.broadcastMode)
          ? AI_WORKER_GO_LIVE_MIN_UTTERANCES
          : LIVE_CONTINUITY_MIN_UTTERANCES;
        const queueNeedsContinuity =
          playableQueueDepth < (isAiWorkerBroadcastMode(s.lastQueue.broadcastMode) ? AI_WORKER_GO_LIVE_MIN_UTTERANCES : MIN_PLAYABLE_UTTERANCES) ||
          s.lastQueue.bufferSeconds <= MAX_ONAIR_IDLE_SECONDS ||
          (s.isLive && s.lastQueue.bufferSeconds < LIVE_CONTINUITY_BUFFER_SECONDS && playableQueueDepth < continuityMinUtterances + 1);

        if (queueNeedsContinuity) {
          await this.generateAndQueueNext(sessionId, "live");
          continue;
        }

        const comment = this.takeBestComment(s);
        const urgentComment = comment && (comment.priority >= 45 || s.lastQueue.bufferSeconds <= MAX_ONAIR_IDLE_SECONDS);

        if (comment && (urgentComment || s.lastQueue.bufferSeconds < policy.maxBufferSeconds)) {
          await this.generateAndQueueCommentResponse(sessionId, comment);
          continue;
        }

        if (s.lastQueue.bufferSeconds > policy.maxBufferSeconds && s.lastQueue.bufferSeconds >= policy.minBufferSeconds) {
          await sleep(COMMENT_SCAN_MS);
          continue;
        }

        const aiWorkerBroadcast = isAiWorkerBroadcastMode(s.lastQueue.broadcastMode);
        const queueDepth = aiWorkerBroadcast
          ? Math.max(s.lastQueue.utteranceQueueCount || 0, s.lastQueue.readyUtteranceCount || 0)
          : s.lastQueue.queuedVideos || 0;
        const minQueueBufferSeconds = aiWorkerBroadcast ? Math.min(policy.minBufferSeconds, 8) : policy.minBufferSeconds;

        const needsRefill =
          s.lastQueue.bufferSeconds < policy.targetBufferSeconds ||
          s.lastQueue.bufferSeconds < minQueueBufferSeconds ||
          (!aiWorkerBroadcast && s.lastQueue.queuedVideos === 0) ||
          queueDepth < (aiWorkerBroadcast ? AI_WORKER_GO_LIVE_MIN_UTTERANCES : MIN_PLAYABLE_UTTERANCES) ||
          queueDepth < (aiWorkerBroadcast ? AI_WORKER_GO_LIVE_MIN_UTTERANCES : GO_LIVE_MIN_UTTERANCES);

        if (needsRefill) {
          await this.generateAndQueueNext(sessionId, "live");
          continue;
        }

        await sleep(COMMENT_SCAN_MS);
      }
    } catch (err: any) {
      const s = this.sessions.get(sessionId);
      if (s && s.generationLoopId === myLoopId && !s.abortController.signal.aborted) {
        console.error(`[LiveHost] Runtime supervisor crash: ${err?.message || err}`);
        shouldRecover = true;
      }
    } finally {
      const s = this.sessions.get(sessionId);
      if (s && s.generationLoopId === myLoopId) {
        s.generationRunning = false;
      }
      console.log(`[LiveHost] Runtime supervisor stopped: ${sessionId}`);
    }

    if (shouldRecover) {
      await sleep(2500);
      const s = this.sessions.get(sessionId);
      if (s?.isLive && !s.abortController.signal.aborted && !s.generationRunning) {
        void this.runLiveGenerationLoop(sessionId);
      }
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
      faqPack: product.faqPack?.length
        ? product.faqPack
        : buildDefaultFaqPack({
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

  private getOrCreateProductBank(state: HostRuntimeState, productId: string): ScriptBankState {
    let bank = state.productBanks.get(productId);
    if (!bank) {
      bank = emptyScriptBank(productId);
      state.productBanks.set(productId, bank);
    }
    return bank;
  }

  private setActiveProductBank(state: HostRuntimeState, productId: string): void {
    state.scriptBank = this.getOrCreateProductBank(state, productId);
  }

  /** Lazy LLM fill for a product bank. No-op when remaining > refill threshold. */
  private async ensureProductBank(state: HostRuntimeState, product: ProductSnapshot): Promise<void> {
    this.setActiveProductBank(state, product.id);
    const bank = state.scriptBank;
    const refillAt = liveLlmRefillAt();
    if (remainingScriptLines(bank) > refillAt) return;
    if (bank.refillInFlight) return;

    const productMemory = getOrCreateProductMemory(state.productMemories, product.id);
    if (productMemory.visitCount === 0) {
      touchProductVisit(productMemory);
    }
    const elapsedMinutes = Math.round(this.elapsedMs(state) / 60_000);
    const cycleId = marathonCycleId(elapsedMinutes);
    state.conversation.currentCycle = cycleId;

    bank.refillInFlight = true;
    try {
      await awaitBrainReady(`${state.config.sessionId}:bank-${product.id}`);
      const lines = await generateScriptBankLines(
        this.toBrainInput(state, product, {
          sessionId: `${state.config.sessionId}:bank-${product.id}`,
          userQuestion:
            "Isi bank ucapan otonom untuk produk ini. Bahasa natural host live, jangan kaku/robot, jangan mengarang fakta.",
          requestedMode: state.currentMode,
          requestedIntent: "SELL",
          mode: state.currentMode,
          avoidTopics: state.memory.topics.slice(-8),
          recentUtterances: state.memory.utterances.slice(-20),
        }),
      );
      const recent = state.memory.utterances.slice(-24);
      if (lines.length > 0) {
        mergeScriptLines(bank, lines, recent, { prepend: true, cap: SCRIPT_BANK_ACTIVE_CAP });
        trimScriptBankToCap(bank, SCRIPT_BANK_ACTIVE_CAP);
        bank.lastLlmRefillAt = Date.now();
        bank.lastRefillAt = Date.now();
        bank.llmRefillCount = (bank.llmRefillCount || 0) + 1;
        console.log(
          `[LLM] bank fill product=${product.id} count=${lines.length} remaining=${remainingScriptLines(bank)} session=${state.config.sessionId}`,
        );
      } else if (remainingScriptLines(bank) === 0) {
        const emergency = emergencyScriptLines(this.toScriptFacts(product));
        mergeScriptLines(bank, emergency, recent, { prepend: true, cap: SCRIPT_BANK_ACTIVE_CAP });
        console.warn(
          `[LLM] bank fill failed — emergency ${emergency.length} line(s) product=${product.id} session=${state.config.sessionId}`,
        );
      }
    } finally {
      bank.refillInFlight = false;
    }
  }

  private maybeRefillScriptBank(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state || !state.product || state.scriptBank.refillInFlight) return;

    const remaining = remainingScriptLines(state.scriptBank);
    if (remaining > liveLlmRefillAt()) return;

    const cooled = Date.now() - (state.scriptBank.lastLlmRefillAt || 0) >= SCRIPT_BANK_LLM_REFILL_COOLDOWN_MS;
    if (!cooled && remaining > 0) return;

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
    // Clear in-flight so ensureProductBank can run (caller set the flag for dedupe).
    state.scriptBank.refillInFlight = false;
    await this.ensureProductBank(state, product);
  }

  private async generateAndQueueNext(sessionId: string, source: "prelive" | "live"): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const product = await this.ensureProductSnapshot(state);
    if (!product) throw new Error("Product aktif tidak ditemukan");

    this.setActiveProductBank(state, product.id);
    await this.ensureProductBank(state, product);
    this.maybeRefillScriptBank(sessionId);
    const productMemory = getOrCreateProductMemory(state.productMemories, product.id);
    const elapsedMinutes = Math.round(this.elapsedMs(state) / 60_000);
    const cycleId = marathonCycleId(elapsedMinutes);
    state.conversation.currentCycle = cycleId;

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
      (state.lastQueue.readyUtteranceCount || 0) < LIVE_ONAIR_MIN_READY_UTTERANCES ||
      Number(state.lastQueue.readySpeechSeconds || state.lastQueue.bufferSeconds || 0) < LIVE_ONAIR_MIN_SPEECH_SECONDS ||
      (state.lastQueue.bufferSeconds > 0 && state.lastQueue.bufferSeconds <= LIVE_CONTINUITY_BUFFER_SECONDS) ||
      state.lastQueue.bufferSeconds < policy.minBufferSeconds;
    const preferFiller = bufferCritical;

    const phaseTopics = phasePreferTopics(elapsedMinutes, cycleId);
    const takeOptsBase = {
      productMemory,
      salesMemory: state.conversation.sales,
      now: Date.now(),
      cycleId,
      preferUnusedAngles: true,
      recentTopics,
    };

    let hostResponse =
      takeScriptLine(state.scriptBank, recent, {
        ...takeOptsBase,
        preferMode: requestedMode,
        preferTopic: topic.topic,
        preferTopics: [topic.topic, ...phaseTopics],
        avoidTopics: recentTopics,
        preferFiller,
        avoidCta,
      }) ||
      takeScriptLine(state.scriptBank, recent, {
        ...takeOptsBase,
        preferMode: requestedMode,
        preferFiller: false,
        avoidCta,
      }) ||
      takeScriptLine(state.scriptBank, recent, takeOptsBase);

    if (!hostResponse) {
      const emergency = emergencyScriptLines(this.toScriptFacts(product));
      mergeScriptLines(state.scriptBank, emergency, recent, { prepend: true });
      hostResponse =
        takeScriptLine(state.scriptBank, recent, {
          ...takeOptsBase,
          preferFiller: true,
        }) ||
        emergency[0] || {
          speech: `${product.name || "Produk ini"} masih tersedia di live, cek etalase ya.`,
          action: "IDLE" as const,
          emotion: "warm" as const,
          intent: "SELL" as const,
          mode: "SELL" as const,
          topic: "filler",
          ctaType: "SOFT" as const,
          target_product_id: product.id,
          interruptible: true,
          claims: [],
        };
      console.warn(`[LiveHost] Emergency script line used (bank was empty) session=${sessionId}`);
    }

    hostResponse = {
      ...hostResponse,
      topic: hostResponse.topic || topic.topic,
    };

    const accepted = await this.processHostResponse(sessionId, hostResponse, source, topic.topic, {
      allowRepeatWhenCritical: bufferCritical,
    });

    if (!accepted) {
      state.counters.duplicateResponsesPrevented++;
      const retry =
        takeScriptLine(state.scriptBank, recent, {
          ...takeOptsBase,
          preferMode: requestedMode,
          avoidTopics: [hostResponse.topic, ...recentTopics],
          avoidCta: true,
        }) ||
        takeScriptLine(state.scriptBank, recent, {
          ...takeOptsBase,
          avoidTopics: [hostResponse.topic, ...recentTopics],
        }) ||
        takeScriptLine(state.scriptBank, recent, {
          ...takeOptsBase,
          preferFiller: true,
        }) ||
        emergencyScriptLines(this.toScriptFacts(product))[0];
      if (retry) {
        const retryAccepted = await this.processHostResponse(sessionId, retry, source, retry.topic || topic.topic, {
          allowRepeatWhenCritical: true,
        });
        if (retryAccepted) return;
        state.counters.duplicateResponsesPrevented++;
      }
      if (bufferCritical && hostResponse) {
        const forced = await this.processHostResponse(
          sessionId,
          {
            ...hostResponse,
            speech: `${product.name || "Produk ini"}  ${hostResponse.speech}`,
          },
          source,
          hostResponse.topic || topic.topic,
          { allowRepeatWhenCritical: true },
        );
        if (forced) return;
      }
      await sleep(150);
    }
  }

  private async generateAndQueueCommentResponse(sessionId: string, comment: PendingComment): Promise<void> {
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
      console.log(`[LiveHost] comment LLM reason=${llmDecision.reason} intent=${comment.intent} from=${author || "Audience"}`);
    } else {
      console.log(`[LiveHost] comment local intent=${comment.intent} from=${author || "Audience"}`);
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
        "Jawab spesifik pertanyaan penonton  jangan mengulang isi komentar panjang-panjang.",
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

    const accepted = await this.processHostResponse(sessionId, response, "comment", `comment:${comment.intent}`);

    if (accepted) {
      state.counters.commentsAnswered++;
      state.memory.lastCommentResponseAt = Date.now();
      livePlatformConnector.recordCommentReply(sessionId, comment.id, response.speech);
      return;
    }

    state.counters.duplicateResponsesPrevented++;
    const attempts = (comment.attempts || 0) + 1;
    if (attempts < 2) {
      state.pendingComments.push({
        ...comment,
        attempts,
        priority: Math.max(5, comment.priority - 8),
        createdAt: Date.now(),
      });
      return;
    }

    const forced = buildLocalCommentResponse(facts, comment.text, comment.intent, author, state.memory.utterances.slice(-8));
    if (author) {
      forced.speech = `Kak ${author}, ${forced.speech.replace(/^kak\s+\w+,?\s*/i, "")}`;
    } else {
      forced.speech = `${forced.speech} Ya kak.`;
    }
    const forcedOk = await this.processHostResponse(sessionId, forced, "comment", `comment:${comment.intent}:forced`);
    if (forcedOk) {
      state.counters.commentsAnswered++;
      state.memory.lastCommentResponseAt = Date.now();
      livePlatformConnector.recordCommentReply(sessionId, comment.id, forced.speech);
    } else {
      state.counters.commentsDropped++;
    }
  }

  private async processHostResponse(
    sessionId: string,
    response: HostResponse,
    source: "prelive" | "live" | "comment",
    fallbackTopic: string,
    opts?: { allowRepeatWhenCritical?: boolean },
  ): Promise<boolean> {
    const state = this.sessions.get(sessionId);
    if (!state) return false;

    const speechRaw = response.speech.trim();
    if (!speechRaw || speechRaw.length < 3) return false;

    let speech = speechRaw;
    const recent = state.memory.utterances.slice(-18);
    const allowRepeat = Boolean(opts?.allowRepeatWhenCritical);

    const greetingClass = detectGreetingClass(speech);
    if (greetingClass && (hasRecentGreetingClass(speech, recent, 8) || state.memory.greetings.slice(-3).includes(greetingClass))) {
      if (!allowRepeat) {
        const stripped = stripLeadingGreeting(speech);
        if (stripped !== speech && stripped.length >= 8) {
          speech = stripped;
        } else {
          return false;
        }
      }
    }

    const normalized = normalizeText(speech);

    const maxSimilarity = recent.reduce((max, previous) => Math.max(max, similarity(speech, previous)), 0);

    if (!allowRepeat && (maxSimilarity >= 0.82 || this.hasRepeatedStructure(speech, recent))) {
      return false;
    }

    if (
      !allowRepeat &&
      response.ctaType !== "NONE" &&
      state.memory.ctas.length > 0 &&
      normalizeText(state.memory.ctas[state.memory.ctas.length - 1] || "") === normalizeText(response.ctaType)
    ) {
      return false;
    }

    const segments = splitSpeechIntoGestureSegments(speech, response.action);
    const priority = source === "comment";
    let submittedSegments = 0;

    for (const seg of segments) {
      let audioBase64: string | undefined;
      const spokenText = seg.text.trim();
      if (!spokenText) continue;

      // Selalu gunakan kecepatan natural 1.0x (jangan dipercepat / chipmunk)
      const synthesisSpeed = 1.0;
      try {
        const ttsResult = await synthesizeSpeech({
          text: spokenText,
          voiceId: state.config.voiceId || process.env.VOICE_ID || "girl_cute_kids",
          host: state.config.voice || state.config.avatarName || "girl_cute_kids",
          voice: state.config.voice || state.config.avatarName || "girl_cute_kids",
          avatarName: state.config.avatarName,
          tone: state.config.tone,
          emotion: response.emotion,
          style: state.config.style || state.config.tone,
          lang: state.config.ttsLang || "id",
          speed: synthesisSpeed,
          podId: state.config.podId || process.env.RUNPOD_POD_ID || null,
          sessionId,
          allowOfflineSynth: true,
        });
        if (ttsResult.success && ttsResult.audioBuffer) {
          audioBase64 = ttsResult.audioBuffer.toString("base64");
          state.lastTtsError = "";
        } else {
          state.lastTtsError = ttsResult.message || "TTS gagal";
          console.warn(`[LiveHost] TTS failed: ${ttsResult.message}`);
          continue;
        }
      } catch (err: any) {
        state.lastTtsError = err?.message || String(err);
        console.warn(`[LiveHost] TTS error (seg action=${seg.action}): ${err?.message || err}`);
        continue;
      }

      if (!this.sessions.has(sessionId) || state.abortController.signal.aborted) {
        console.log(`[LiveHost] Batal antre GPU — sesi ${sessionId} sudah dihentikan.`);
        return false;
      }

      await this.submitToGPU(sessionId, spokenText, audioBase64, seg.action, priority);
      submittedSegments++;
    }

    if (!hostResponseDelivered(submittedSegments)) {
      state.counters.failed++;
      state.lastWorkerError = state.lastTtsError || "Tidak ada segmen audio yang berhasil dikirim ke worker.";
      return false;
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
      `[LiveHost] ðŸ—£ï¸ queued source=${source} mode=${response.mode} topic=${response.topic || fallbackTopic} action=${response.action} segments=${segments.map((s) => s.action).join(">")}`,
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
    const greetClass = detectGreetingClass(response.speech);
    if (greetClass) memory.greetings.push(greetClass);

    memory.utterances = memory.utterances.slice(-policy.memoryUtterances);
    memory.topics = memory.topics.slice(-policy.memoryTopics);
    memory.ctas = memory.ctas.slice(-policy.memoryCtas);
    memory.claims = memory.claims.slice(-policy.memoryClaims);
    memory.modes = memory.modes.slice(-20);
    memory.greetings = memory.greetings.slice(-12);

    const productId = state.product?.id || state.config.productId;
    if (productId) {
      const productMemory = getOrCreateProductMemory(state.productMemories, productId);
      const cycleId = typeof response.cycleId === "number" ? response.cycleId : marathonCycleId(Math.round(this.elapsedMs(state) / 60_000));
      recordSpeechUsage({
        productMemory,
        conversation: state.conversation,
        speech: response.speech,
        topic: response.topic,
        semanticKey: response.semanticKey,
        salesRule: response.salesRule as any,
        ctaType: response.ctaType,
        productId,
        category: state.product?.category,
        cycleId,
      });
    }
  }

  private hasRepeatedStructure(speech: string, recent: string[]): boolean {
    const tokens = normalizeText(speech).split(" ").filter(Boolean);
    if (tokens.length < 8) return false;

    const firstFive = tokens.slice(0, 5).join(" ");
    const lastFive = tokens.slice(-5).join(" ");
    const bigrams = new Set<string>();
    for (let i = 0; i < tokens.length - 1; i++) {
      bigrams.add(`${tokens[i]} ${tokens[i + 1]}`);
    }

    for (const previous of recent.slice(-6)) {
      const p = normalizeText(previous).split(" ").filter(Boolean);
      if (p.slice(0, 5).join(" ") === firstFive) return true;
      if (p.slice(-5).join(" ") === lastFive) return true;
      let hits = 0;
      for (let i = 0; i < p.length - 1; i++) {
        if (bigrams.has(`${p[i]} ${p[i + 1]}`)) hits++;
      }
      const denom = Math.min(bigrams.size, Math.max(1, p.length - 1));
      if (hits / denom >= 0.6) return true;
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
    for (const g of state.memory.greetings.slice(-4)) {
      if (g === "halo") phrases.push("halo", "hai semuanya", "hai guys");
      if (g === "guys") phrases.push("guys", "hai guys");
      if (g === "kak") phrases.push("kak", "kakak");
      if (g === "selamat") phrases.push("selamat datang");
      if (g === "teman") phrases.push("teman-teman", "semuanya");
    }
    return phrases;
  }

  private chooseAutonomousTopic(state: HostRuntimeState) {
    const recent = new Set(state.memory.topics.slice(-3));
    const elapsedMinutes = Math.round(this.elapsedMs(state) / 60_000);
    const cycleId = marathonCycleId(elapsedMinutes);
    const phaseBoost = new Set(phasePreferTopics(elapsedMinutes, cycleId));
    const bufferCritical = state.lastQueue.queuedVideos === 0 || (state.lastQueue.bufferSeconds > 0 && state.lastQueue.bufferSeconds <= 4);

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

    for (let attempt = 0; attempt < RHYTHM_SLOT_ATTEMPTS; attempt++) {
      const { topic, nextCursor } = nextRhythmTopic(state.slotCursor);
      state.slotCursor = nextCursor;
      if (recent.has(topic)) continue;
      if (FILLER_TOPICS.has(topic)) continue;
      const modes = topicModesFor(topic);
      return {
        topic,
        modes,
        prompt: phaseBoost.has(topic) ? `fase sesi menit ${elapsedMinutes}: prefer ${topic}` : `ikuti ritme slot: ${topic}`,
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

    const modeOrder: HostMode[] = ["ENGAGE", "DEMO", "QNA", "SELL", "SOCIAL", "OBJECTION", "ENGAGE", "SELL", "QNA", "DEMO", "CLOSING"];

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

  public enqueue(sessionId: string, text: string, authorName?: string, platformCommentId?: string): void {
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
    const duplicateActive = state.pendingComments.some((comment) => comment.dedupeKey === dedupeKey || similarity(comment.text, clean) >= 0.82);

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
      const dropIndex = state.pendingComments.reduce((lowest, item, index, list) => {
        if (lowest === -1) return index;
        const current = list[lowest]!;
        if (item.priority < current.priority) return index;
        if (item.priority === current.priority && item.createdAt < current.createdAt) return index;
        return lowest;
      }, -1);
      if (dropIndex >= 0) {
        state.pendingComments.splice(dropIndex, 1);
        state.counters.commentsDropped++;
      } else {
        break;
      }
    }

    console.log(`[LiveHost]  comment priority=${comment.priority} intent=${comment.intent} from=${comment.authorName || "Audience"}`);
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

  private async ensureProductSnapshot(state: HostRuntimeState): Promise<ProductSnapshot | null> {
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
      const readyUtteranceCount = Number(raw.ready_utterance_count ?? utteranceQueueCount);
      const renderQueueSize = Number(raw.render_queue_size ?? 0);
      const readySpeechSeconds = Number(raw.ready_speech_seconds ?? raw.playable_buffer_seconds ?? 0);
      const renderTimeSec = Number(raw.render_time_sec ?? 0);
      const speechDurationSec = Number(raw.speech_duration_sec ?? 0);
      const realTimeRatio = Number(raw.real_time_ratio ?? 0);
      const gpuThroughputBound = Boolean(raw.gpu_throughput_bound);
      const readyVideos = Number(raw.ready_videos_count || 0);
      const activeProcessing = Number(raw.active_processing_count || 0);
      const visualWorkerRunning = Boolean(raw.visual_worker_running);
      const visualWorkerInitializing = Boolean(raw.visual_worker_initializing);
      const broadcastBootState = String(raw.broadcast_boot_state || "idle");
      const bootError = String(raw.broadcast_boot_error || "");
      let rtmpError = String(raw.rtmp_error || "");
      let rtmpHint = String(raw.rtmp_hint || "");
      const rtmpState = String(raw.rtmp_state || "disconnected");
      const rtmpConnectingSeconds = Number(raw.rtmp_connecting_seconds ?? 0);
      if (!rtmpError && broadcastBootState === "error" && bootError) {
        rtmpError = bootError;
      }
      if (rtmpError && isSoftRtmpMessage(rtmpError)) {
        if (!rtmpHint) rtmpHint = rtmpError;
        if (rtmpState === "connecting" || visualWorkerInitializing || broadcastBootState === "starting") {
          rtmpError = "";
        }
      }

      let queuedVideos = Number(raw.queued_videos_count || 0);
      if (aiWorker) {
        queuedVideos = utteranceQueueCount;
      } else {
        queuedVideos = Math.max(queuedVideos, readyVideos);
      }

      const playableSeconds = Number(raw.playable_buffer_seconds ?? raw.queued_videos_duration_seconds ?? NaN);
      const inFlightSeconds = Number(raw.in_flight_buffer_seconds ?? NaN);
      const explicitTotal = Number(raw.buffer_seconds ?? NaN);

      let bufferSeconds: number;
      if (Number.isFinite(explicitTotal) && explicitTotal >= 0) {
        bufferSeconds = Math.max(0, explicitTotal);
      } else if (Number.isFinite(playableSeconds)) {
        bufferSeconds = Math.max(
          0,
          playableSeconds + (Number.isFinite(inFlightSeconds) ? inFlightSeconds : activeProcessing * IN_FLIGHT_RENDER_SECONDS),
        );
      } else if (aiWorker) {
        bufferSeconds = Number.isFinite(readySpeechSeconds) ? Math.max(0, readySpeechSeconds) : 0;
      } else {
        bufferSeconds = Math.max(0, activeProcessing * IN_FLIGHT_RENDER_SECONDS);
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
        rtmpHint,
        rtmpState,
        rtmpConnectingSeconds: Number.isFinite(rtmpConnectingSeconds) ? Math.max(0, rtmpConnectingSeconds) : 0,
        warmedUp: Boolean(raw.warmed_up || visualWorkerRunning || bufferSeconds > 0 || queuedVideos > 0 || state.counters.submitted > 0),
        broadcastMode,
        utteranceQueueCount,
        readyUtteranceCount,
        renderQueueSize: Number.isFinite(renderQueueSize) ? renderQueueSize : 0,
        readySpeechSeconds: Number.isFinite(readySpeechSeconds) ? readySpeechSeconds : 0,
        renderTimeSec: Number.isFinite(renderTimeSec) ? renderTimeSec : 0,
        speechDurationSec: Number.isFinite(speechDurationSec) ? speechDurationSec : 0,
        realTimeRatio: Number.isFinite(realTimeRatio) ? realTimeRatio : 0,
        gpuThroughputBound,
        playbackArmed: Boolean(raw.playback_armed),
        visualWorkerRunning,
        visualWorkerInitializing,
        broadcastBootState,
      };

      if (state.isLive && state.lastQueue.bufferSeconds > this.getPolicy(state).minBufferSeconds) {
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

  private async submitToGPU(sessionId: string, text: string, audioBase64?: string, action?: string, priority = false): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const avatarFileName = state.config.avatarName ? `${state.config.avatarName.toLowerCase().trim()}.png` : "namira.png";

    // Body hint: worker resolve "talk" → pinned talk clip.
    const gesture = "talk";
    const cleanText = String(text || "")
      .replace(/^\s*\[[A-Z_]+\]\s*/i, "")
      .trim();
    const taggedText = cleanText;

    try {
      await forwardToRunPodGPU(state.config.podId || process.env.RUNPOD_POD_ID, {
        avatarImagePath: `avatars/${avatarFileName}`,
        text: taggedText,
        voice: state.config.voice || "namira",
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
      if (!isAiWorkerBroadcastMode(state.lastQueue.broadcastMode)) {
        state.estimatedBufferSeconds = Math.min(this.getPolicy(state).maxBufferSeconds, state.estimatedBufferSeconds + estimateDurationSeconds(text));
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (/429/.test(msg)) {
        console.warn(`[LiveHost] Worker queue penuh (429) — rolling producer backoff`);
        throw err;
      }
      state.counters.failed++;
      if (msg) state.lastWorkerError = msg;
      if (!state.workerOfflineSince) state.workerOfflineSince = Date.now();
      throw err;
    }
  }

  public async waitForPipelineReady(sessionId: string, timeoutMs = 180_000): Promise<boolean> {
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
    const aiWorker = isAiWorkerBroadcastMode(queue.broadcastMode);
    const readySpeechSeconds = Number(queue.readySpeechSeconds || queue.bufferSeconds || 0);
    // Opening: wait until count + speech thresholds. After Go Live the
    // rolling producer keeps filling one-by-one up to the queue cap.
    const playableReady = aiWorker
      ? queue.readyUtteranceCount >= AI_WORKER_GO_LIVE_MIN_UTTERANCES &&
        readySpeechSeconds >= LIVE_GO_LIVE_MIN_SPEECH_SECONDS
      : queue.queuedVideos >= GO_LIVE_MIN_UTTERANCES && queue.bufferSeconds >= policy.minBufferSeconds;
    const bufferReady = playableReady;

    // Recompute tiap poll (hysteresis: jangan sticky forever).
    const fatalRtmp = isFatalRtmpFailure(queue);
    if (bufferReady && rtmpOk && !fatalRtmp) {
      state.pipelineReady = true;
    } else if (
      fatalRtmp ||
      !rtmpOk ||
      (aiWorker
        ? queue.utteranceQueueCount < 1 && queue.readyUtteranceCount < 1
        : queue.bufferSeconds < policy.minBufferSeconds * 0.5 || (queue.queuedVideos < 1 && queue.bufferSeconds < 2))
    ) {
      state.pipelineReady = false;
    }
    const ready = Boolean(state.pipelineReady) && rtmpOk && !fatalRtmp;

    if (fatalRtmp) {
      if (!state.rtmpFailedAt) state.rtmpFailedAt = Date.now();
      const waitMs = state.isLive ? 5_000 : 10 * 60_000;
      if (!state.rtmpFailStopping && Date.now() - state.rtmpFailedAt >= waitMs) {
        state.rtmpFailStopping = true;
        console.log(`[LiveHost] RTMP gagal  menghentikan sesi ${sessionId} setelah ${Math.round(waitMs / 1000)}s.`);
        this.onSessionExpired?.(sessionId);
      }
    } else {
      state.rtmpFailedAt = 0;
      state.rtmpFailStopping = false;
    }

    let stageIndex = 0;
    let stageText = "Menyiapkan AI Host...";

    const offlineMs = state.workerOfflineSince > 0 ? Date.now() - state.workerOfflineSince : 0;
    const workerStuck =
      queue.workerOffline &&
      offlineMs >= WORKER_OFFLINE_FAIL_MS &&
      (state.counters.failed > 0 || state.counters.submitted > 0 || (state.counters.generated === 0 && offlineMs >= 90_000));
    const workerError = workerStuck
      ? state.lastWorkerError?.includes("502")
        ? "Worker GPU crash atau tidak merespons (HTTP 502). Bukan masalah Stream Key  coba mulai ulang sesi."
        : state.lastWorkerError || "Worker GPU tidak merespons. Coba mulai ulang sesi live."
      : "";

    if (workerError) {
      if (!state.workerFailedAt) state.workerFailedAt = Date.now();
      if (!state.workerFailStopping && Date.now() - state.workerFailedAt >= WORKER_FAIL_STOP_MS) {
        state.workerFailStopping = true;
        console.log(`[LiveHost] Worker offline  menghentikan sesi ${sessionId} setelah ${Math.round(WORKER_FAIL_STOP_MS / 1000)}s.`);
        this.onSessionExpired?.(sessionId);
      }
      stageIndex = 2;
      stageText = workerError;
    } else if (fatalRtmp) {
      stageIndex = 3;
      stageText = queue.rtmpError || "Siaran gagal tersambung. Buat Stream Key baru di Instagram, lalu coba lagi.";
    } else if (queue.broadcastBootState === "error" && !queue.visualWorkerRunning) {
      stageIndex = 2;
      stageText = workerError || "Avatar AI gagal dinyalakan. Tekan batalkan, lalu coba Connect lagi.";
    } else if (!queue.visualWorkerRunning && (queue.broadcastBootState === "starting" || queue.visualWorkerInitializing)) {
      stageIndex = 1;
      stageText = "Menyiapkan wajah & gerak host Pertama kali bisa 3-7 menit. Tetap di halaman ini.";
    } else if (!queue.warmedUp && queue.queuedVideos === 0 && state.counters.submitted === 0) {
      stageIndex = 1;
      stageText = "Menyalakan mesin AI di cloud Mohon tunggu.";
    } else if (
      (aiWorker
        ? !playableReady
        : queue.bufferSeconds < policy.minBufferSeconds && queue.queuedVideos < GO_LIVE_MIN_UTTERANCES) &&
      !state.pipelineReady
    ) {
      stageIndex = 2;
      stageText = aiWorker
        ? `Menyiapkan buffer host (${queue.readyUtteranceCount}/${AI_WORKER_GO_LIVE_MIN_UTTERANCES} · ${Math.round(readySpeechSeconds)}/${LIVE_GO_LIVE_MIN_SPEECH_SECONDS}s)`
        : "Menyiapkan video pembuka host";
    } else if (rtmpRequired && !queue.rtmpConnected) {
      stageIndex = 3;
      stageText = queue.rtmpHint || "Menyambungkan siaran ke Instagram Tunggu sampai status jadi Terhubung.";
    } else if (!state.isLive) {
      stageIndex = 4;
      stageText = "Siap! Cek preview di Instagram, lalu tekan tombol hijau di bawah.";
    } else {
      stageIndex = 5;
      stageText = `Host sedang live  buffer ${Math.round(queue.bufferSeconds)} detik.`;
    }

    return {
      ready,
      generationCount: state.counters.generated,
      lifetimeGenerated: state.counters.generated,
      videosQueued: queue.queuedVideos,
      utteranceQueueCount: queue.utteranceQueueCount,
      readyUtteranceCount: queue.readyUtteranceCount,
      readySpeechSeconds: Math.round(readySpeechSeconds),
      playbackArmed: queue.playbackArmed,
      goLiveMinUtterances: aiWorker ? AI_WORKER_GO_LIVE_MIN_UTTERANCES : GO_LIVE_MIN_UTTERANCES,
      goLiveMinSpeechSeconds: aiWorker ? LIVE_GO_LIVE_MIN_SPEECH_SECONDS : 0,
      broadcastMode: queue.broadcastMode,
      visualWorkerRunning: queue.visualWorkerRunning,
      visualWorkerInitializing: queue.visualWorkerInitializing,
      broadcastBootState: queue.broadcastBootState,
      pendingCount: queue.utteranceQueueCount,
      pendingCommentCount: state.pendingComments.length,
      isLive: state.isLive,
      isBroadcasting: queue.broadcasting,
      isRtmpConnected: queue.rtmpConnected,
      rtmpError: fatalRtmp ? queue.rtmpError || "" : "",
      rtmpHint: queue.rtmpHint || "",
      rtmpState: queue.rtmpState || "disconnected",
      rtmpConnectingSeconds: queue.rtmpConnectingSeconds || 0,
      rtmpFatal: fatalRtmp,
      workerError,
      lastTtsError: state.lastTtsError || "",
      bufferSeconds: Math.round(queue.bufferSeconds),
      workerOffline: queue.workerOffline,
      workerOfflineSeconds: state.workerOfflineSince > 0 ? Math.round((Date.now() - state.workerOfflineSince) / 1000) : 0,
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
      scriptBankSource: state.scriptBank.llmRefillCount > 0 ? "llm" : remainingScriptLines(state.scriptBank) > 0 ? "emergency" : "empty",
      stageIndex,
      stageText,
    };
  }
}

export const liveHostOrchestrator = new LiveHostOrchestrator();
