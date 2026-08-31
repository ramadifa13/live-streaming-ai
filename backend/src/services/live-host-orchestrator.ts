import prisma from "../lib/prisma.js";
import {
  forwardToRunPodGPU,
  getRunPodQueueStatus,
} from "./runpod-bridge.js";
import {
  generateHostResponse,
  getBrainBackoffMs,
  type HostIntent,
  type HostMode,
  type HostResponse,
} from "./groq-brain.js";
import { livePlatformConnector } from "./live-platform-connector.js";
import { synthesizeSpeech } from "./tts.js";

/**
 * Live Host Runtime V2
 *
 * Fokus:
 * - content tidak mengulang secara semantik;
 * - komentar diprioritaskan berdasarkan intent/recency/novelty;
 * - buffer dihitung dalam DETIK, bukan jumlah video;
 * - session memiliki memory + show-mode + elapsed time;
 * - product knowledge dicache, bukan query DB setiap utterance;
 * - fallback berlapis untuk mencegah audio queue kosong;
 * - kontrak lama start/stop/enqueue/status tetap dipertahankan.
 *
 * Catatan penting:
 * Orchestrator ini mengatur dan mengisi queue GPU. Benar-benar zero-idle tetap
 * bergantung pada worker/player RunPod yang dapat memainkan item queue tanpa gap.
 */

export type StreamPlan = "2H" | "8H" | "24H";

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
   * Durasi sesi sebenarnya dalam ms. Plan hanya bucket (2H/8H/24H), sehingga
   * sesi 3 jam ter-map ke plan "2H" dan loop generasi berhenti satu jam lebih
   * awal — GPU menganggur tetapi tetap ditagih. Nilai ini dipakai bila ada.
   */
  maxDurationMs?: number;
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

interface ProductSnapshot {
  id: string;
  name: string;
  price: number | string;
  category: string;
  benefits: string;
  description: string;
  usage: string;
  faq: string;
  copywriting: string;
  stock: number;
  updatedAt: number;
}

interface CatalogItem {
  id: string;
  name: string;
  price: number | string;
  category?: string;
  benefits?: string;
  description?: string;
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
  warmedUp: boolean;
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
  catalog: CatalogItem[];
  productCacheExpiresAt: number;

  memory: HostMemory;
  pendingComments: PendingComment[];
  processedCommentIds: Set<string>;

  currentMode: HostMode;
  modeStartedAt: number;
  showTurn: number;
  topicCursor: number;

  counters: RuntimeCounters;
  lastQueue: QueueMetrics;

  // Last known speech queue estimate. Used even if worker API temporarily errors.
  estimatedBufferSeconds: number;
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
}

const PLAN_POLICIES: Record<StreamPlan, PlanPolicy> = {
  "2H": {
    durationMs: 2 * 60 * 60 * 1000,
    minBufferSeconds: 10,
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
  },
};

/** Estimasi durasi clip pendek (speech 20–35 kata ≈ 8–14 detik). */
const FALLBACK_SPEECH_SECONDS = 12;
const IN_FLIGHT_RENDER_SECONDS = 10;
const PRODUCT_CACHE_TTL_MS = 30_000;
const QUEUE_POLL_MS = 800;
const COMMENT_SCAN_MS = 400;
const GENERATION_BACKOFF_MS = 800;
/** Batas idle di siaran sebelum orchestrator boost generate (detik). */
export const MAX_ONAIR_IDLE_SECONDS = 5;

async function awaitBrainReady(): Promise<void> {
  const waitMs = getBrainBackoffMs();
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
  return "2H";
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

  public switchProduct(sessionId: string, productId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.config.productId = productId;
    state.product = undefined;
    state.productCacheExpiresAt = 0;
    state.memory.topics.push("product_switch");
    state.currentMode = "ENGAGE";
    state.modeStartedAt = Date.now();

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
      catalog: [],
      productCacheExpiresAt: 0,
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
      lastQueue: {
        readyVideos: 0,
        queuedVideos: 0,
        activeProcessing: 0,
        bufferSeconds: 0,
        workerOffline: false,
        broadcasting: false,
        rtmpConnected: false,
        warmedUp: false,
      },
      estimatedBufferSeconds: 0,
    };

    this.sessions.set(config.sessionId, state);

    console.log(
      `[LiveHost] 🎬 Background pipeline start: session=${config.sessionId}, plan=${state.config.plan}`,
    );

    void this.warmupWorkerModel(config.sessionId);
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
        if (queue.workerOffline) {
          await sleep(2000);
          continue;
        }

        const policy = this.getPolicy(s);
        if (
          queue.bufferSeconds >= policy.minBufferSeconds &&
          queue.queuedVideos >= 2
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

  private async generateAndQueueNext(
    sessionId: string,
    source: "prelive" | "live",
  ): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const product = await this.ensureProductSnapshot(state);
    if (!product) throw new Error("Product aktif tidak ditemukan");

    const topic = this.chooseAutonomousTopic(state);
    const requestedMode = this.resolveModeForTopic(state, topic.modes);

    await awaitBrainReady();
    let hostResponse: HostResponse;
    try {
      hostResponse = await generateHostResponse({
        userQuestion: `Buat satu segmen bicara otonom untuk live. Topic: ${topic.topic}. Tujuan segmen: ${topic.prompt}. Jangan terdengar seperti membaca skrip.`,
        avatarName: state.config.avatarName,
        tone: state.config.tone,
        productName: product.name,
        productPrice: `Rp${Number(product.price).toLocaleString("id-ID")}`,
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
        mode: requestedMode,
        requestedMode,
        requestedIntent: "SELL",
        elapsedMinutes: Math.round(this.elapsedMs(state) / 60_000),
        audienceCount: undefined,
        plan: parsePlan(state.config.plan),
      });
    } catch (err: any) {
      state.counters.failed++;
      console.warn(`[LiveHost] Autonomous generation error: ${err?.message || err}`);
      await sleep(GENERATION_BACKOFF_MS);
      return;
    }

    const accepted = await this.processHostResponse(
      sessionId,
      hostResponse,
      source,
      topic.topic,
    );

    if (!accepted) {
      state.counters.duplicateResponsesPrevented++;
      // Jangan menambah lagi dalam satu tick. Response generator berikutnya akan
      // mendapatkan memory yang sama + topic yang berbeda.
      await sleep(150);
      return;
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
    const userQuestion = [
      `Ada komentar baru dari ${author ? `Kak ${author}` : "penonton"}.`,
      `Komentar: "${comment.text}".`,
      "Baca konteks komentar dengan wajar, jangan mengulang isi komentar panjang-panjang.",
      "Jawab kebutuhan penonton terlebih dahulu; CTA hanya jika benar-benar relevan.",
    ].join(" ");

    const response = await (async () => {
      await awaitBrainReady();
      try {
        return await generateHostResponse({
          userQuestion,
          authorName: author,
          avatarName: state.config.avatarName,
          tone: state.config.tone,
          productName: product.name,
          productPrice: `Rp${Number(product.price).toLocaleString("id-ID")}`,
          productDescription: product.description,
          productCategory: product.category,
          productBenefits: product.benefits,
          productUsage: product.usage,
          productFaq: product.faq,
          productStock: product.stock,
          allProducts: state.catalog,
          recentUtterances: state.memory.utterances.slice(-24),
          recentTopics: state.memory.topics.slice(-15),
          recentCTAs: state.memory.ctas.slice(-8),
          recentClaims: state.memory.claims.slice(-20),
          avoidPhrases: this.buildAvoidPhrases(state),
          avoidTopics: state.memory.topics.slice(-10),
          mode: "QNA",
          requestedMode: "QNA",
          requestedIntent: comment.intent,
          elapsedMinutes: Math.round(this.elapsedMs(state) / 60_000),
          plan: parsePlan(state.config.plan),
        });
      } catch (err: any) {
        state.counters.failed++;
        console.warn(`[LiveHost] Comment generation error: ${err?.message || err}`);
        await sleep(GENERATION_BACKOFF_MS);
        return null;
      }
    })();

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

    if (response.topic && state.memory.topics.slice(-5).includes(normalizeText(response.topic))) {
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

    let finalText = speech;
    let audioBase64: string | undefined;

    try {
      const ttsResult = await synthesizeSpeech({
        text: finalText,
        voice: state.config.voice || "id-ID-GadisNeural",
        avatarName: state.config.avatarName,
        tone: state.config.tone,
        emotion: response.emotion,
      });
      if (ttsResult.success && ttsResult.audioBuffer) {
        audioBase64 = ttsResult.audioBuffer.toString("base64");
      }
    } catch (err: any) {
      console.warn(`[LiveHost] TTS error; fallback audio unavailable: ${err?.message || err}`);
    }

    // Bila TTS gagal, submit tetap dilakukan bila worker mampu menghasilkan audio/video
    // dari text; ini mempertahankan jalur fallback lama.
    //
    // Jawaban komentar ditandai prioritas agar broadcaster memutarnya sebelum
    // sisa buffer otonom. Tanpa ini jawaban harus mengantre di belakang
    // targetBufferSeconds penuh, sehingga terasa ~30 detik terlambat.
    await this.submitToGPU(
      sessionId,
      finalText,
      audioBase64,
      response.action,
      source === "comment",
    );

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
      topic: response.topic || fallbackTopic,
    });

    console.log(
      `[LiveHost] 🗣️ queued source=${source} mode=${response.mode} topic=${response.topic || fallbackTopic} action=${response.action}`,
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
    const mode = this.chooseNextMode(state);
    const candidates = AUTONOMOUS_TOPIC_BANK.filter((item) => item.modes.includes(mode));
    const recent = new Set(state.memory.topics.slice(-12));

    // Cari kandidat pertama yang belum dipakai baru-baru ini.
    for (let offset = 0; offset < AUTONOMOUS_TOPIC_BANK.length; offset++) {
      const index = (state.topicCursor + offset) % AUTONOMOUS_TOPIC_BANK.length;
      const candidate = AUTONOMOUS_TOPIC_BANK[index]!;
      if (candidate.modes.includes(mode) && !recent.has(candidate.topic)) {
        state.topicCursor = (index + 1) % AUTONOMOUS_TOPIC_BANK.length;
        return candidate;
      }
    }

    // Bila semua topic baru saja dipakai, putar ulang format setelah memory window,
    // bukan langsung kalimat yang sama.
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

    const product = await prisma.product.findUnique({
      where: { id: state.config.productId },
    });
    if (!product) return null;

    const p = product as any;
    state.product = {
      id: String(p.id),
      name: String(p.name || "Produk"),
      price: p.price ?? 0,
      category: String(p.category || "General"),
      benefits: String(p.benefits || ""),
      description: String(p.description || ""),
      usage: String(p.usage || ""),
      faq: String(p.faq || ""),
      copywriting: String(p.copywriting || ""),
      stock: Number(p.stock ?? 0),
      updatedAt: Date.now(),
    };
    state.productCacheExpiresAt = Date.now() + PRODUCT_CACHE_TTL_MS;

    try {
      const products = await prisma.product.findMany({
        take: 8,
        select: {
          id: true,
          name: true,
          price: true,
          category: true,
          benefits: true,
          description: true,
        },
      });
      state.catalog = products.map((item: any) => ({
        id: String(item.id),
        name: String(item.name || "Produk"),
        price: item.price ?? 0,
        category: item.category || "General",
        benefits: item.benefits || "",
        description: item.description || "",
      }));
    } catch (err: any) {
      console.warn(`[LiveHost] Catalog refresh gagal: ${err?.message || err}`);
    }

    return state.product;
  }

  private async refreshQueueMetrics(sessionId: string): Promise<QueueMetrics> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return {
        readyVideos: 0,
        queuedVideos: 0,
        activeProcessing: 0,
        bufferSeconds: 0,
        workerOffline: true,
        broadcasting: false,
        rtmpConnected: false,
        warmedUp: false,
      };
    }

    const podId = state.config.podId || process.env.RUNPOD_POD_ID;
    if (!podId) {
      state.lastQueue = {
        readyVideos: 0,
        queuedVideos: 0,
        activeProcessing: 0,
        bufferSeconds: state.estimatedBufferSeconds,
        workerOffline: false,
        broadcasting: false,
        rtmpConnected: false,
        warmedUp: false,
      };
      return state.lastQueue;
    }

    try {
      const raw: any = await getRunPodQueueStatus(podId);
      if (!raw?.success) {
        state.lastQueue = {
          ...state.lastQueue,
          workerOffline: true,
        };
        return state.lastQueue;
      }

      const readyVideos = Number(raw.queued_videos_count || 0);
      const queuedVideos = readyVideos;
      const activeProcessing = Number(raw.active_processing_count || 0);

      const playableSeconds = Number(
        raw.playable_buffer_seconds ??
          raw.queued_videos_duration_seconds ??
          NaN,
      );
      const inFlightSeconds = Number(raw.in_flight_buffer_seconds ?? NaN);

      const explicitTotal = Number(raw.buffer_seconds ?? NaN);

      let bufferSeconds: number;
      if (Number.isFinite(explicitTotal)) {
        bufferSeconds = Math.max(0, explicitTotal);
      } else if (Number.isFinite(playableSeconds)) {
        bufferSeconds = Math.max(
          0,
          playableSeconds +
            (Number.isFinite(inFlightSeconds) ? inFlightSeconds : activeProcessing * IN_FLIGHT_RENDER_SECONDS),
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
        warmedUp: Boolean(raw.warmed_up || bufferSeconds > 0 || queuedVideos > 0),
      };

      if (
        state.isLive &&
        state.lastQueue.bufferSeconds > this.getPolicy(state).minBufferSeconds
      ) {
        state.lastActivityAt = Date.now();
      }

      return state.lastQueue;
    } catch (err: any) {
      state.lastQueue = {
        ...state.lastQueue,
        workerOffline: true,
      };
      console.warn(`[LiveHost] Queue status error: ${err?.message || err}`);
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

    const gesture = (action || "TALK_EXPRESSIVE").toUpperCase().replace(/[^A-Z_]/g, "");
    const taggedText = /^\s*\[[A-Z_]+\]/.test(text)
      ? text
      : `[${gesture || "TALK_EXPRESSIVE"}] ${text}`.trim();

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
        action: gesture || "TALK_EXPRESSIVE",
        priority,
      });

      state.counters.submitted++;
      state.estimatedBufferSeconds = Math.min(
        this.getPolicy(state).maxBufferSeconds,
        state.estimatedBufferSeconds + estimateDurationSeconds(text),
      );
    } catch (err) {
      state.counters.failed++;
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
        bufferSeconds: 0,
        workerOffline: true,
        stageIndex: 0,
        stageText: "Session tidak ditemukan.",
      };
    }

    const queue = await this.refreshQueueMetrics(sessionId);
    const policy = this.getPolicy(state);
    const ready =
      queue.bufferSeconds >= policy.minBufferSeconds &&
      queue.queuedVideos >= 1 &&
      (queue.rtmpConnected || queue.broadcasting || !state.config.rtmpUrl);

    if (ready) state.pipelineReady = true;

    let stageIndex = 0;
    let stageText = "Menyiapkan AI Host...";

    if (!queue.warmedUp && queue.queuedVideos === 0 && state.counters.submitted === 0) {
      stageIndex = 1;
      stageText = "Memuat model AI Host ke Cloud GPU...";
    } else if (queue.bufferSeconds < policy.minBufferSeconds || queue.queuedVideos < 2) {
      stageIndex = 2;
      stageText = "Menyiapkan segmen pembuka AI Host...";
    } else if (!queue.rtmpConnected && !queue.broadcasting && state.config.rtmpUrl) {
      stageIndex = 3;
      stageText = "Menunggu koneksi RTMP...";
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
      pendingCount: 0,
      pendingCommentCount: state.pendingComments.length,
      isLive: state.isLive,
      isBroadcasting: queue.broadcasting,
      isRtmpConnected: queue.rtmpConnected,
      bufferSeconds: Math.round(queue.bufferSeconds),
      workerOffline: queue.workerOffline,
      warmedUp: queue.warmedUp,
      currentMode: state.currentMode,
      elapsedSeconds: Math.round(this.elapsedMs(state) / 1000),
      plan: parsePlan(state.config.plan),
      commentsReceived: state.counters.commentsReceived,
      commentsAnswered: state.counters.commentsAnswered,
      commentsDropped: state.counters.commentsDropped,
      duplicateResponsesPrevented: state.counters.duplicateResponsesPrevented,
      stageIndex,
      stageText,
    };
  }
}

export const liveHostOrchestrator = new LiveHostOrchestrator();
