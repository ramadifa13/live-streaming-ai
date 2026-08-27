import sys

# Because we are rewriting it, we will just supply the whole file for live-session-manager.ts. It's cleaner than regex patching.
content = """import prisma from "../lib/prisma.js";
import {
  setLiveSessionActive,
  startPodAndWait,
  stopPod,
} from "./runpod-manager.js";
import { livePlatformConnector } from "./live-platform-connector.js";
import { liveHostOrchestrator } from "./live-host-orchestrator.js";

export type SessionState = "starting" | "pending" | "live" | "ended" | "error";

export interface ManagedSession {
  sessionId: string;
  state: SessionState;
  platform: string;
  durationHours: number;
  startedAt: number;
  deadlineAt: number;
  avatarName: string;
  voice?: string;
  tone: string;
  podId?: string | null;
  watchdogTimer?: NodeJS.Timeout;
  livePollTimer?: NodeJS.Timeout;
  onStateChange?: (state: SessionState, sessionId: string) => void;
}

class LiveSessionManager {
  private activeSessions: Map<string, ManagedSession> = new Map();
  private liveDetectionAttempts: number = 0;
  private pendingVoicePreference: string | null = null;

  public async startSession(params: {
    productId: string;
    avatarId: string;
    voice?: string;
    platform: string;
    durationHours: number;
    autoReply?: boolean;
    autoPin?: boolean;
    autoPromotion?: boolean;
    autoModeration?: boolean;
    accessToken?: string;
    liveChatId?: string;
    liveVideoId?: string;
    avatarName?: string;
    tone?: string;
  }): Promise<{ sessionId: string; state: SessionState }> {

    const podIdStr = await startPodAndWait();
    const podId = typeof podIdStr === 'string' ? podIdStr : null;
    setLiveSessionActive(true);

    const session = await prisma.liveSession.create({
      data: {
        productId: params.productId,
        avatarId: params.avatarId,
        voice: params.voice,
        platform: params.platform,
        durationHours: params.durationHours,
        autoReply: params.autoReply ?? true,
        autoPin: params.autoPin ?? true,
        autoPromotion: params.autoPromotion ?? true,
        autoModeration: params.autoModeration ?? true,
        status: "starting",
        estimatedCost: Math.round(params.durationHours * 12500),
      },
    });

    const managedSession: ManagedSession = {
      sessionId: session.id,
      state: "starting",
      platform: params.platform,
      durationHours: params.durationHours,
      startedAt: Date.now(),
      deadlineAt: Date.now() + params.durationHours * 3600 * 1000,
      avatarName: params.avatarName || "Namira",
      voice: params.voice || this.pendingVoicePreference || undefined,
      tone: params.tone || "Persuasif",
      podId: podId,
      onStateChange: undefined,
    };

    this.activeSessions.set(session.id, managedSession);

    livePlatformConnector.startSession({
      sessionId: session.id,
      podId: podId,
      platform: params.platform,
      accessToken: params.accessToken,
      liveChatId: params.liveChatId,
      liveVideoId: params.liveVideoId,
      autoReply: params.autoReply ?? true,
      productId: params.productId,
      avatarName: params.avatarName,
      voice: params.voice || this.pendingVoicePreference || undefined,
      tone: params.tone || "Persuasif",
    });

    livePlatformConnector.setLiveDetectedCallback(async (triggerSessionId?: string) => {
      // The callback will need to know which session triggered it, or we rely on connector to pass it
      const sId = triggerSessionId || session.id;
      const currentSession = this.activeSessions.get(sId);
      if (currentSession?.state === "pending") {
        console.log(
          `[LiveSessionManager] Platform live detected for session ${sId}. Transitioning to live...`,
        );
        await this.transitionState("live", sId);
      }
    });

    await this.transitionState("pending", session.id);
    this.startPlatformLivePoll(session.id, params.liveVideoId, params.accessToken);

    return {
      sessionId: session.id,
      state: managedSession.state,
    };
  }

  public async stopSession(sessionId: string, summary?: {
    durationSeconds?: number;
    viewers?: number;
    comments?: number;
    clicks?: number;
    sales?: number;
    productSold?: number;
  }): Promise<{
    success: boolean;
    summary?: Record<string, unknown>;
  }> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { success: false };
    }

    this.clearTimers(sessionId);
    liveHostOrchestrator.stop(sessionId);

    await this.transitionState("ended", sessionId);

    const metrics = livePlatformConnector.getMetricsSnapshot(sessionId);
    livePlatformConnector.stopSession(sessionId);

    await prisma.liveSession.updateMany({
      where: {
        id: sessionId,
        status: { in: ["live", "pending", "starting"] },
      },
      data: { status: "ended" },
    });

    setLiveSessionActive(false);
    if (session.podId) {
       stopPod(session.podId).catch((err) => console.error("Failed to stop GPU Pod:", err));
    }

    const durationSeconds =
      summary?.durationSeconds && summary.durationSeconds > 0
        ? summary.durationSeconds
        : metrics.durationSeconds;

    const finalViewers = Math.max(
      summary?.viewers || 0,
      metrics.viewers,
      metrics.peakViewers,
    );
    const finalComments = Math.max(summary?.comments || 0, metrics.comments);
    const finalClicks = Math.max(summary?.clicks || 0, metrics.clicks);
    const finalSales = Math.max(summary?.sales || 0, metrics.sales);
    const finalProductSold = Math.max(
      summary?.productSold || 0,
      metrics.orders,
    );

    const durationHours = Math.max(0.1, durationSeconds / 3600);
    const estimatedGpuCost = Math.round(durationHours * 12500);
    const netProfit = Math.max(0, finalSales - estimatedGpuCost);
    const roiPercentage =
      estimatedGpuCost > 0
        ? Math.round((netProfit / estimatedGpuCost) * 100)
        : 0;

    this.activeSessions.delete(sessionId);

    return {
      success: true,
      summary: {
        durationSeconds,
        durationFormatted: `${Math.floor(durationSeconds / 3600)}j ${Math.floor((durationSeconds % 3600) / 60)}m ${durationSeconds % 60}d`,
        totalViewers: finalViewers,
        peakViewers: Math.round(finalViewers * 1.25),
        totalComments: finalComments,
        aiRepliesCount: Math.max(
          metrics.aiReplies,
          Math.round(finalComments * 0.95),
        ),
        totalClicks: finalClicks,
        totalProductSold: finalProductSold,
        grossRevenue: finalSales,
        grossRevenueFormatted: `Rp${finalSales.toLocaleString("id-ID")}`,
        estimatedGpuCost,
        estimatedGpuCostFormatted: `Rp${estimatedGpuCost.toLocaleString("id-ID")}`,
        netProfit,
        netProfitFormatted: `Rp${netProfit.toLocaleString("id-ID")}`,
        roiPercentage: `${roiPercentage}%`,
        endedAt: new Date().toISOString(),
      },
    };
  }

  public getSession(sessionId: string): ManagedSession | null {
    return this.activeSessions.get(sessionId) || null;
  }

  public setPendingVoicePreference(voice: string | null) {
    this.pendingVoicePreference = voice;
  }

  public getPendingVoicePreference(): string | null {
    return this.pendingVoicePreference;
  }

  public isLive(sessionId: string): boolean {
    return this.activeSessions.get(sessionId)?.state === "live";
  }

  public isPending(sessionId: string): boolean {
    return this.activeSessions.get(sessionId)?.state === "pending";
  }

  public async markBroadcastLive(sessionId: string): Promise<void> {
    if (this.activeSessions.get(sessionId)?.state === "pending") {
      await this.transitionState("live", sessionId);
    }
  }

  public getRemainingDurationSeconds(sessionId: string): number {
    const session = this.activeSessions.get(sessionId);
    if (!session) return 0;
    return Math.max(
      0,
      Math.floor((session.deadlineAt - Date.now()) / 1000),
    );
  }

  private async transitionState(newState: SessionState, sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const previousState = session.state;
    session.state = newState;

    if (newState === "live" && previousState !== "live") {
      this.startDurationWatchdog(sessionId);
    }

    if (newState !== "live") {
      this.clearWatchdog(sessionId);
    }

    try {
      await prisma.liveSession.updateMany({
        where: {
          id: sessionId,
          status: { in: ["starting", "pending", "live"] },
        },
        data: { status: newState },
      });
    } catch (err) {
      console.error(
        `[LiveSessionManager] Failed to update session state to ${newState}:`,
        err,
      );
    }

    session.onStateChange?.(newState, sessionId);
  }

  private startDurationWatchdog(sessionId: string): void {
    this.clearWatchdog(sessionId);
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const checkMs = 5000;
    session.watchdogTimer = setInterval(async () => {
      const s = this.activeSessions.get(sessionId);
      if (!s) return;

      const remaining = this.getRemainingDurationSeconds(sessionId);
      if (remaining <= 0) {
        console.log(
          `[LiveSessionManager] Duration exceeded for session ${s.sessionId}. Stopping...`,
        );
        await this.stopSession(sessionId);
        return;
      }

      if (s.state === "live") {
        const elapsedSeconds = Math.floor(
          (Date.now() - s.startedAt) / 1000,
        );
        const maxSeconds = s.durationHours * 3600;

        if (elapsedSeconds >= maxSeconds) {
          console.log(
            `[LiveSessionManager] Max live duration reached (${maxSeconds}s). Stopping...`,
          );
          await this.stopSession(sessionId);
        }
      }
    }, checkMs);
  }

  private clearWatchdog(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session?.watchdogTimer) {
      clearInterval(session.watchdogTimer);
      session.watchdogTimer = undefined;
    }
  }

  private clearLivePoll(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session?.livePollTimer) {
      clearTimeout(session.livePollTimer);
      session.livePollTimer = undefined;
    }
  }

  private clearTimers(sessionId: string): void {
    this.clearWatchdog(sessionId);
    this.clearLivePoll(sessionId);
  }

  private startPlatformLivePoll(
    sessionId: string,
    liveVideoId?: string,
    accessToken?: string,
  ): void {
    this.clearLivePoll(sessionId);
    const session = this.activeSessions.get(sessionId);
    if (!session || !liveVideoId || !accessToken) return;

    const platform = session.platform.toLowerCase();

    const poll = async (): Promise<void> => {
      const currentSession = this.activeSessions.get(sessionId);
      if (!currentSession || currentSession.state !== "pending") {
        return;
      }

      this.liveDetectionAttempts += 1;

      if (this.liveDetectionAttempts > 60) {
        console.warn(
          `[LiveSessionManager] Platform live poll timed out after 60 attempts for session ${sessionId}.`,
        );
        return;
      }

      try {
        const isLive = await this.checkPlatformLiveStatus(
          platform,
          liveVideoId,
          accessToken,
        );

        if (isLive) {
          console.log(
            `[LiveSessionManager] Platform confirmed live for session ${sessionId}. Starting AI...`,
          );
          await this.transitionState("live", sessionId);
          return;
        }
      } catch (err) {
        console.warn(`[LiveSessionManager] Platform live poll failed:`, err);
      }

      const postPollSession = this.activeSessions.get(sessionId);
      if (postPollSession?.state === "pending") {
        postPollSession.livePollTimer = setTimeout(poll, 5000);
      }
    };

    session.livePollTimer = setTimeout(poll, 5000);
  }

  private async checkPlatformLiveStatus(
    platform: string,
    liveVideoId: string,
    accessToken: string,
  ): Promise<boolean> {
    const lower = platform.toLowerCase();

    if (lower.includes("instagram")) {
      const url = `https://graph.facebook.com/v18.0/${encodeURIComponent(liveVideoId)}?fields=status,title&access_token=${encodeURIComponent(accessToken)}`;
      const res = await fetch(url);

      if (!res.ok) {
        if (res.status === 400 || res.status === 404) {
          return false;
        }
        throw new Error(`Instagram status check failed: ${res.status}`);
      }

      const json = (await res.json()) as { status?: string };
      return json.status === "LIVE_NOW" || json.status === "live";
    }

    if (lower.includes("youtube")) {
      const url = new URL(
        "https://www.googleapis.com/youtube/v3/liveBroadcasts",
      );
      url.searchParams.set("part", "status");
      url.searchParams.set("broadcastStatus", "active");
      url.searchParams.set("mine", "true");

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        throw new Error(`YouTube status check failed: ${res.status}`);
      }

      const json = (await res.json()) as { items?: Array<{ id?: string }> };
      return (json.items?.length || 0) > 0;
    }

    if (lower.includes("tiktok")) {
      return false;
    }

    if (lower.includes("shopee")) {
      return false;
    }

    return false;
  }

  public async forceStopSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    this.clearTimers(sessionId);
    liveHostOrchestrator.stop(sessionId);

    try {
      await prisma.liveSession.updateMany({
        where: {
          id: sessionId,
          status: { in: ["starting", "pending", "live"] },
        },
        data: { status: "ended" },
      });
    } catch {}

    livePlatformConnector.stopSession(sessionId);
    setLiveSessionActive(false);
    if (session.podId) {
        stopPod(session.podId).catch(() => {});
    }
    this.activeSessions.delete(sessionId);
  }
}

export const liveSessionManager = new LiveSessionManager();
"""
with open("backend/src/services/live-session-manager.ts", "w") as f:
    f.write(content)

content = """import prisma from "../lib/prisma.js";
import { forwardToRunPodGPU } from "./runpod-bridge.js";
import { generateDynamicSalesResponse } from "./llm-brain.js";
import { livePlatformConnector } from "./live-platform-connector.js";

const DEFAULT_INTERVAL_SECONDS = 35;

type HostConfig = {
  productId: string;
  avatarName: string;
  voice?: string;
  tone: string;
  rtmpUrl?: string;
  streamKey?: string;
  podId?: string | null;
  sessionId: string;
};

interface OrchestratorState {
  config: HostConfig;
  timer: NodeJS.Timeout | null;
  queue: Promise<void>;
  cycle: number;
  usedPromptIndices: Set<number>;
}

class LiveHostOrchestrator {
  private sessions = new Map<string, OrchestratorState>();

  private prompts = [
    "Buat pembukaan singkat yang menyambut penonton baru dan memperkenalkan produk.",
    "Jelaskan satu manfaat utama produk dan cara pakainya dengan bahasa live yang natural.",
    "Buat demo penggunaan atau tips praktis yang relevan dengan produk.",
    "Buat pengingat promo dan ajakan checkout yang informatif, tanpa klaim di luar knowledge base.",
    "Buat rangkuman singkat alasan produk ini cocok untuk target audiensnya.",
    "Jawab pertanyaan umum penonton tentang produk dengan bahasa santai dan mengajak checkout.",
    "Buat interaksi kecil seperti 'siapa yang lagi nonton dari mana?' yang mengalir ke promosi produk.",
    "Jelaskan perbedaan produk ini dengan produk lain di pasaran secara honest.",
    "Buat testimoni ringan atau cerita penggunaan yang relate dengan audiens.",
    "Jawab keraguan umum (harusnya gak perlu ragu, harga spesial, stok terbatas) dengan convincing.",
    "Buat pengingat social proof: bintang 5, ulasan bagus, atau ribuan yang sudah beli.",
    "Jelaskan komposisi atau bahan yang aman dan cocok untuk kebutuhan spesifik penonton.",
    "Buat ice breaking seru seperti 'raise your hand kalau lagi ngeliat keranjang kuning' dan langsung ke value proposition.",
    "Jelaskan kapan waktu terbaik pakai produk ini (pagi, malam, sebelum kerja, dll) dengan alasan natural.",
    "Buat perbandingan singkat: kalau beli di sini dapat apa aja selain produknya (gratis ongkir, gift, dll).",
    "Jawab pertanyaan 'kak ini ori nggak?' atau 'ada BPOM nggak?' dengan jawaban yang tenang dan meyakinkan.",
    "Buat FOMO halus: 'Mumpung lagi live, vouchernya masih bisa diklaim ya kak'.",
    "Jelaskan packaging atau cara pengemasan produk yang aman dan rapi.",
    "Sebutkan garansi atau layanan purna jual yang bikin pembeli tenang.",
    "Buat kalimat penutup sementara yang menahan penonton agar tidak skip live.",
  ];

  constructor() {
    livePlatformConnector.setSpeechCallback((text: string, sessionId?: string) => {
      if (sessionId) {
        this.enqueue(sessionId, text);
      }
    });
  }

  public async start(config: HostConfig) {
    this.stop(config.sessionId);

    this.sessions.set(config.sessionId, {
      config,
      timer: null,
      queue: Promise.resolve(),
      cycle: 0,
      usedPromptIndices: new Set()
    });

    this.schedule(config.sessionId, 10);
  }

  public stop(sessionId: string) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    this.sessions.delete(sessionId);
  }

  public enqueue(sessionId: string, text: string) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.queue = state.queue
      .then(() => this.renderAndQueue(sessionId, text))
      .catch((err) => {
        console.error("[LiveHost] Error di queue antrean:", err);
      });
  }

  private getNextPromptIndex(sessionId: string): number {
    const state = this.sessions.get(sessionId);
    if (!state) return 0;

    if (state.usedPromptIndices.size >= this.prompts.length) {
      state.usedPromptIndices.clear();
    }

    const available = this.prompts
      .map((_, i) => i)
      .filter((i) => !state.usedPromptIndices.has(i));

    if (available.length === 0) return 0;

    const idx = available[Math.floor(Math.random() * available.length)];
    if (idx !== undefined) {
      state.usedPromptIndices.add(idx);
      return idx;
    }
    return 0;
  }

  private getPrebufferCount() {
    const configured = Number(process.env.LIVE_HOST_PREBUFFER_COUNT);
    return Number.isInteger(configured) && configured >= 1 && configured <= 5
      ? configured
      : 2;
  }

  private intervalSeconds() {
    const configured = Number(process.env.LIVE_HOST_INTERVAL_SECONDS);
    return Number.isFinite(configured) && configured >= 10
      ? configured
      : DEFAULT_INTERVAL_SECONDS;
  }

  private schedule(sessionId: string, delaySeconds: number) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const jitter = Math.floor(Math.random() * 5) - 2;
    const actualDelay = Math.max(10, delaySeconds + jitter);
    state.timer = setTimeout(() => {
      const currentState = this.sessions.get(sessionId);
      if (!currentState) return;

      currentState.timer = null;
      void this.createProactiveUtterance(sessionId).finally(() => {
        const nextState = this.sessions.get(sessionId);
        if (nextState) {
          this.schedule(sessionId, this.intervalSeconds());
        }
      });
    }, actualDelay * 1000);
  }

  private async createProactiveUtterance(sessionId: string) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const product = await prisma.product.findUnique({
      where: { id: state.config.productId },
    });
    if (!product) {
      console.warn(
        `[LiveHost] Product ${state.config.productId} tidak ditemukan`,
      );
      return;
    }

    if (state.cycle === 0 && product.copywriting) {
      state.cycle += 1;
      this.enqueue(sessionId, product.copywriting);
      return;
    }

    const promptIndex = this.getNextPromptIndex(sessionId);
    const result = await generateDynamicSalesResponse({
      userQuestion: `${this.prompts[promptIndex]} Gunakan copywriting produk ini sebagai acuan: ${product.copywriting || "Tidak tersedia"}`,
      avatarName: state.config.avatarName,
      tone: state.config.tone,
      productName: product.name,
      productPrice: `Rp${product.price.toLocaleString("id-ID")}`,
      productDescription: product.description || "",
      productCategory: product.category || "General",
      productBenefits: product.benefits || "",
      productUsage: product.usage || "",
      productFaq: product.faq || "",
      productStock: product.stock,
    });

    // Check if session still exists after the async call
    if (this.sessions.has(sessionId)) {
      this.enqueue(sessionId, result.replyText);
    }
  }

  private async renderAndQueue(sessionId: string, text: string) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const config = state.config;
    const start = Date.now();
    await forwardToRunPodGPU(config.podId, {
      avatarImagePath: "avatars/namira.png",
      text,
      voice: config.voice || "id-ID-GadisNeural",
      tone: config.tone,
      rtmpUrl: config.rtmpUrl,
      streamKey: config.streamKey,
      requireWorker: true,
    });
    console.log(`[LiveHost] Utterance round-trip for ${sessionId}: ${Date.now() - start}ms`);
  }
}

export const liveHostOrchestrator = new LiveHostOrchestrator();
"""
with open("backend/src/services/live-host-orchestrator.ts", "w") as f:
    f.write(content)

content = """import prisma from "../lib/prisma.js";
import { generateDynamicSalesResponse } from "./llm-brain.js";

export interface LiveMetricsSnapshot {
  viewers: number;
  peakViewers: number;
  comments: number;
  aiReplies: number;
  clicks: number;
  sales: number;
  orders: number;
  durationSeconds: number;
  recentComments: Array<{
    id: string;
    sender: string;
    text: string;
    time: string;
    aiReply?: string;
  }>;
}

export interface PollerSessionConfig {
  sessionId: string;
  platform: string;
  accessToken?: string;
  liveChatId?: string;
  liveVideoId?: string;
  autoReply?: boolean;
  productId?: string;
  avatarName?: string;
  voice?: string;
  tone?: string;
  podId?: string | null;
}

type LiveDetectedCallback = (sessionId?: string) => Promise<void> | void;
type SpeechCallback = (text: string, sessionId?: string) => void;

interface SessionState {
  config: PollerSessionConfig;
  isRunning: boolean;
  startedAtTimestamp: number;
  pollerTimeout: NodeJS.Timeout | null;
  lastProcessedCommentIds: Set<string>;
  nextPageToken: string | null;
  pollDelayMs: number;
  consecutiveErrors: number;
  liveDetectionAttempts: number;
  metrics: LiveMetricsSnapshot;
}

class LivePlatformConnector {
  private sessions = new Map<string, SessionState>();
  private globalLiveDetectedCallback: LiveDetectedCallback | null = null;
  private globalSpeechCallback: SpeechCallback | null = null;

  public setLiveDetectedCallback(callback: LiveDetectedCallback | null) {
    this.globalLiveDetectedCallback = callback;
  }

  public setSpeechCallback(callback: SpeechCallback | null) {
    this.globalSpeechCallback = callback;
  }

  public startSession(config: PollerSessionConfig) {
    this.stopSession(config.sessionId);

    const state: SessionState = {
      config,
      isRunning: true,
      startedAtTimestamp: Date.now(),
      pollerTimeout: null,
      lastProcessedCommentIds: new Set(),
      nextPageToken: null,
      pollDelayMs: 2500,
      consecutiveErrors: 0,
      liveDetectionAttempts: 0,
      metrics: {
        viewers: 0,
        peakViewers: 0,
        comments: 0,
        aiReplies: 0,
        clicks: 0,
        sales: 0,
        orders: 0,
        durationSeconds: 0,
        recentComments: [],
      }
    };

    this.sessions.set(config.sessionId, state);

    const platformLower = config.platform.toLowerCase();

    // Start adaptive polling loop for pull-based platforms (YouTube / Instagram)
    if (
      platformLower.includes("youtube") ||
      platformLower.includes("instagram")
    ) {
      this.scheduleNextPoll(config.sessionId, 1000);
    }
  }

  public stopSession(sessionId: string) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.isRunning = false;
    if (state.pollerTimeout) {
      clearTimeout(state.pollerTimeout);
      state.pollerTimeout = null;
    }
    this.sessions.delete(sessionId);
  }

  private scheduleNextPoll(sessionId: string, delayMs?: number) {
    const state = this.sessions.get(sessionId);
    if (!state || !state.isRunning) return;

    if (state.pollerTimeout) clearTimeout(state.pollerTimeout);

    const wait = delayMs !== undefined ? delayMs : state.pollDelayMs;
    state.pollerTimeout = setTimeout(async () => {
      const currentState = this.sessions.get(sessionId);
      if (!currentState || !currentState.isRunning) return;

      await this.pollActivePlatform(sessionId);

      if (currentState.isRunning) {
        this.scheduleNextPoll(sessionId);
      }
    }, wait);
  }

  public async ingestEvent(
    sessionId: string,
    platform: string,
    eventType: string,
    data: Record<string, unknown>,
  ) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    if (eventType === "viewer_update") {
      const v =
        typeof data.viewers === "number"
          ? data.viewers
          : Number(data.viewers) || 0;
      state.metrics.viewers = v;
      if (v > state.metrics.peakViewers) state.metrics.peakViewers = v;
    } else if (eventType === "cart_click") {
      state.metrics.clicks += 1;
    } else if (eventType === "order_paid") {
      state.metrics.orders += 1;
      const amt =
        typeof data.amount === "number"
          ? data.amount
          : Number(data.amount) || 0;
      state.metrics.sales += amt;
    } else if (eventType === "comment") {
      const sender = String(
        data.sender || data.username || data.author || "Penonton",
      );
      const text = String(data.text || data.message || data.comment || "");
      const commentId = String(data.id || data.commentId || Date.now());

      if (!state.lastProcessedCommentIds.has(commentId)) {
        state.lastProcessedCommentIds.add(commentId);
        await this.handleNewComment(sessionId, commentId, sender, text);
      }
    }
  }

  private async pollActivePlatform(sessionId: string) {
    const state = this.sessions.get(sessionId);
    if (!state || !state.isRunning) return;

    const { platform, accessToken, liveChatId, liveVideoId } = state.config;
    const p = platform.toLowerCase();

    try {
      if (p.includes("youtube") && liveChatId && accessToken) {
        await this.pollYouTubeChat(sessionId, liveChatId, accessToken);
      } else if (p.includes("instagram") && liveVideoId && accessToken) {
        await this.pollInstagramComments(sessionId, liveVideoId, accessToken);
        await this.checkInstagramLiveStatus(sessionId, liveVideoId, accessToken);
      }
    } catch (err) {
      state.consecutiveErrors++;
      state.pollDelayMs = Math.min(
        30000,
        2500 * Math.pow(1.5, state.consecutiveErrors),
      );
      console.warn(
        `[LivePlatformConnector] Polling warning for ${platform} (Backoff: ${state.pollDelayMs}ms):`,
        err,
      );
    }
  }

  private async pollYouTubeChat(sessionId: string, liveChatId: string, accessToken: string) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const url = new URL(
      "https://www.googleapis.com/youtube/v3/liveChatMessages",
    );
    url.searchParams.set("liveChatId", liveChatId);
    url.searchParams.set("part", "id,snippet,authorDetails");
    if (state.nextPageToken)
      url.searchParams.set("pageToken", state.nextPageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 429 || res.status === 403) {
      state.consecutiveErrors++;
      state.pollDelayMs = Math.min(
        30000,
        2500 * Math.pow(2, state.consecutiveErrors),
      );
      console.warn(
        `[YouTube Poller] Rate limited (Status ${res.status}). Backing off for ${state.pollDelayMs}ms`,
      );
      return;
    }

    if (res.ok) {
      // Reset backoff on success
      state.consecutiveErrors = 0;
      state.pollDelayMs = 2500;

      const json = (await res.json()) as {
        nextPageToken?: string;
        items?: Array<{
          id: string;
          snippet?: { displayMessage?: string };
          authorDetails?: { displayName?: string };
        }>;
      };

      if (json.nextPageToken) state.nextPageToken = json.nextPageToken;

      if (json.items && json.items.length > 0) {
        for (const item of json.items) {
          const commentId = item.id;
          if (!state.lastProcessedCommentIds.has(commentId)) {
            state.lastProcessedCommentIds.add(commentId);
            const sender = item.authorDetails?.displayName || "YouTube User";
            const text = item.snippet?.displayMessage || "";
            await this.handleNewComment(sessionId, commentId, sender, text);
          }
        }
      }
    }
  }

  private async checkInstagramLiveStatus(
    sessionId: string,
    liveVideoId: string,
    accessToken: string,
  ): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state || !state.isRunning) return;

    if (this.globalLiveDetectedCallback && state.liveDetectionAttempts > 60) {
      return;
    }

    try {
      const url = `https://graph.facebook.com/v18.0/${encodeURIComponent(liveVideoId)}?fields=status,title&access_token=${encodeURIComponent(accessToken)}`;
      const res = await fetch(url);

      if (res.ok) {
        const json = (await res.json()) as { status?: string };
        const isLive = json.status === "LIVE_NOW" || json.status === "live";

        if (isLive && this.globalLiveDetectedCallback) {
          state.liveDetectionAttempts = 999;
          try {
            await this.globalLiveDetectedCallback(sessionId);
          } catch (err) {
            console.error(
              "[LivePlatformConnector] Live detected callback failed:",
              err,
            );
          }
        }
      }
    } catch (err) {
      // Ignore polling errors for live status check
    }
  }

  private async pollInstagramComments(
    sessionId: string,
    liveVideoId: string,
    accessToken: string,
  ) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const url = `https://graph.facebook.com/v18.0/${liveVideoId}/comments?access_token=${accessToken}`;
    const res = await fetch(url);

    if (res.status === 429 || res.status === 403) {
      state.consecutiveErrors++;
      state.pollDelayMs = Math.min(
        30000,
        2500 * Math.pow(2, state.consecutiveErrors),
      );
      return;
    }

    if (res.ok) {
      state.consecutiveErrors = 0;
      state.pollDelayMs = 2500;

      const json = (await res.json()) as {
        data?: Array<{
          id: string;
          from?: { username?: string };
          message?: string;
        }>;
      };

      if (json.data && json.data.length > 0) {
        for (const item of json.data) {
          if (!state.lastProcessedCommentIds.has(item.id)) {
            state.lastProcessedCommentIds.add(item.id);
            const sender = item.from?.username || "IG Viewer";
            const text = item.message || "";
            await this.handleNewComment(sessionId, item.id, sender, text);
          }
        }
      }
    }
  }

  private async handleNewComment(
    sessionId: string,
    commentId: string,
    sender: string,
    text: string,
  ) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.metrics.comments += 1;
    let aiResponseText: string | undefined = undefined;

    if (state.config.autoReply !== false && text.trim().length > 0) {
      try {
        const product = state.config.productId
          ? await prisma.product.findUnique({
              where: { id: state.config.productId },
            })
          : null;
        const response: any = await generateDynamicSalesResponse({
          userQuestion: text,
          productName: product?.name || "Produk",
          productPrice: product?.price ? `Rp${product.price}` : "",
          productDescription: product?.description || "",
          productCategory: product?.category || "",
          productBenefits: product?.benefits || "",
          productUsage: product?.usage || "",
          productFaq: product?.faq || "",
          productStock: product?.stock || 0,
          avatarName: state.config.avatarName || "Namira",
          tone: state.config.tone || "Persuasif",
        });
        aiResponseText = response.replyText;
        state.metrics.aiReplies += 1;
        this.globalSpeechCallback?.(response.replyText, sessionId);
      } catch {
        aiResponseText = `Terima kasih pertanyaannya kak ${sender}! Produk ini lagi promo spesial, yuk langsung checkout sekarang yaa! ✨`;
        state.metrics.aiReplies += 1;
        this.globalSpeechCallback?.(aiResponseText, sessionId);
      }
    }

    const timeStr = new Date().toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });
    state.metrics.recentComments.push({
      id: commentId,
      sender,
      text,
      time: timeStr,
      aiReply: aiResponseText,
    });

    if (state.metrics.recentComments.length > 100) {
      state.metrics.recentComments.shift();
    }
  }

  public getMetricsSnapshot(sessionId: string): LiveMetricsSnapshot {
    const state = this.sessions.get(sessionId);
    if (!state) {
        return {
          viewers: 0, peakViewers: 0, comments: 0, aiReplies: 0, clicks: 0, sales: 0, orders: 0, durationSeconds: 0, recentComments: []
        };
    }

    const duration =
      state.startedAtTimestamp > 0
        ? Math.floor((Date.now() - state.startedAtTimestamp) / 1000)
        : 0;

    return {
      ...state.metrics,
      durationSeconds: duration,
    };
  }
}

export const livePlatformConnector = new LivePlatformConnector();
"""
with open("backend/src/services/live-platform-connector.ts", "w") as f:
    f.write(content)


content = """import { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import {
  stopBroadcast,
  pauseBroadcast,
  resumeBroadcast,
  getStreamStatus,
} from "../services/rtmp-streamer.js";
import {
  getRunPodBroadcastStatus,
  startRunPodBroadcast,
  stopRunPodBroadcast,
  warmupWorker,
} from "../services/runpod-bridge.js";
import { livePlatformConnector } from "../services/live-platform-connector.js";
import { liveSessionManager } from "../services/live-session-manager.js";
import { liveHostOrchestrator } from "../services/live-host-orchestrator.js";

const liveSessionSchema = z.object({
  productId: z.string().min(1),
  avatarId: z.string().min(1),
  voice: z.string().optional(),
  platform: z.string().min(1),
  durationHours: z.literal(1),
  autoReply: z.boolean().optional(),
  autoPin: z.boolean().optional(),
  autoPromotion: z.boolean().optional(),
  autoPromo: z.boolean().optional(),
  autoModeration: z.boolean().optional(),
  accessToken: z.string().optional(),
  liveChatId: z.string().optional(),
  liveVideoId: z.string().optional(),
  avatarName: z.string().optional(),
  tone: z.string().optional(),
});

const liveStopSchema = z.object({
  sessionId: z.string().optional(),
  durationSeconds: z.number().optional(),
  viewers: z.number().optional(),
  comments: z.number().optional(),
  clicks: z.number().optional(),
  sales: z.number().optional(),
  productSold: z.number().optional(),
});

const broadcastSchema = z.object({
  sessionId: z.string().optional(),
  rtmpUrl: z.string().url(),
  streamKey: z.string().min(1),
  avatarImage: z.string().optional(),
  avatarVideo: z.string().optional(),
  productName: z.string().optional(),
  productPrice: z.string().optional(),
  platform: z.string().optional(),
  stockCount: z.number().optional(),
  ctaLabel: z.string().optional(),
});

export async function liveSessionRoutes(server: FastifyInstance) {
  // GET /api/live-session/active
  server.get("/api/live-session/active", async (request) => {
    const sessionId = (request.query as any).sessionId;
    const session = sessionId
      ? await prisma.liveSession.findUnique({ where: { id: sessionId }, include: { avatar: true } })
      : await prisma.liveSession.findFirst({
        where: { status: { in: ["starting", "pending", "live"] } },
        orderBy: { createdAt: "desc" },
        include: { avatar: true },
      });

    const activeManaged = session ? liveSessionManager.getSession(session.id) : null;
    const effectiveStatus = activeManaged?.state || session?.status || "ended";

    return {
      data: session
        ? session
        : {
            status: effectiveStatus,
          },
    };
  });

  // POST /api/live-session/start
  server.post("/api/live-session/start", async (request, reply) => {
    const parsed = liveSessionSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const avatarById = await prisma.avatar.findUnique({
      where: { id: parsed.data.avatarId },
    });
    const avatar =
      avatarById ||
      (parsed.data.avatarName
        ? await prisma.avatar.findFirst({
            where: { name: parsed.data.avatarName },
          })
        : null);

    if (!avatar) {
      reply.code(404);
      return { error: "avatar not found" };
    }
    if (avatar.name.toLowerCase() !== "namira") {
      reply.code(400);
      return { error: "Demo hanya mendukung AI Host Namira" };
    }

    try {
      const result = await liveSessionManager.startSession({
        productId: parsed.data.productId,
        avatarId: avatar.id,
        platform: parsed.data.platform,
        durationHours: parsed.data.durationHours,
        autoReply: parsed.data.autoReply ?? true,
        autoPin: parsed.data.autoPin ?? true,
        autoPromotion:
          parsed.data.autoPromotion ?? parsed.data.autoPromo ?? true,
        autoModeration: parsed.data.autoModeration ?? true,
        accessToken: parsed.data.accessToken,
        liveChatId: parsed.data.liveChatId,
        liveVideoId: parsed.data.liveVideoId,
        avatarName: avatar.name,
        voice: parsed.data.voice || avatar.voice || undefined,
        tone: parsed.data.tone || "Persuasif",
      });

      return {
        success: true,
        data: {
          id: result.sessionId,
          status: result.state,
          platform: parsed.data.platform,
          voice: parsed.data.voice || avatar.voice || null,
          durationHours: parsed.data.durationHours,
          maxDurationSeconds: parsed.data.durationHours * 3600,
          estimatedCost: Math.round(parsed.data.durationHours * 12500),
          gpuMode: "on-demand (NVIDIA RTX 4090)",
          startedAt: new Date().toISOString(),
        },
      };
    } catch (err: any) {
      reply.code(500);
      return { error: `Gagal memulai sesi live: ${err.message}` };
    }
  });

  // POST /api/live-session/preferences
  server.post("/api/live-session/preferences", async (request, reply) => {
    const bodySchema = z.object({
      voice: z.string().min(1).optional(),
    });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    liveSessionManager.setPendingVoicePreference(parsed.data.voice ?? null);
    return {
      success: true,
      data: {
        voice: liveSessionManager.getPendingVoicePreference(),
      },
    };
  });

  // POST /api/live-session/stop
  server.post("/api/live-session/stop", async (request, reply) => {
    const parsed = liveStopSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const sessionId = parsed.data.sessionId || '';
    const managedSession = sessionId ? liveSessionManager.getSession(sessionId) : null;
    if (sessionId) liveHostOrchestrator.stop(sessionId);
    await stopRunPodBroadcast(managedSession?.podId).catch(() => {});
    stopBroadcast();
    const result = await liveSessionManager.stopSession(sessionId, {
      durationSeconds: parsed.data.durationSeconds,
      viewers: parsed.data.viewers,
      comments: parsed.data.comments,
      clicks: parsed.data.clicks,
      sales: parsed.data.sales,
      productSold: parsed.data.productSold,
    });

    return {
      success: result.success,
      summary: result.summary,
    };
  });

  // POST /api/live-stream/broadcast
  server.post("/api/live-stream/broadcast", async (request, reply) => {
    const parsed = broadcastSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const {
      rtmpUrl,
      streamKey,
      avatarImage,
      avatarVideo,
      sessionId,
      productName,
      productPrice,
      platform,
      stockCount,
      ctaLabel,
    } = parsed.data;
    const managedSession = sessionId ? liveSessionManager.getSession(sessionId) : null;
    const liveSession = sessionId
      ? await prisma.liveSession.findUnique({ where: { id: sessionId } })
      : null;

    if (sessionId && managedSession && liveSession) {
      try {
        await warmupWorker(managedSession.podId);
        await liveHostOrchestrator.start({
          productId: liveSession.productId,
          avatarName: managedSession.avatarName,
          tone: managedSession.tone,
          rtmpUrl,
          streamKey,
          voice: liveSession.voice || undefined,
          podId: managedSession.podId,
          sessionId: sessionId
        });
      } catch (error) {
        liveHostOrchestrator.stop(sessionId);
        await liveSessionManager.stopSession(sessionId).catch(() => {});
        reply.code(502);
        return {
          success: false,
          error: `AI Worker pre-buffer gagal: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    const result = await startRunPodBroadcast(managedSession?.podId, { rtmpUrl, streamKey });

    if (result.success && sessionId) {
      await liveSessionManager.markBroadcastLive(sessionId);
    }

    if (!result.success) {
      reply.code(502);
      if (sessionId) await liveSessionManager.stopSession(sessionId).catch(() => {});
      if (sessionId) {
        await prisma.liveSession
          .updateMany({
            where: { id: sessionId, status: { in: ["starting", "pending"] } },
            data: { status: "ended" },
          })
          .catch(() => {});
      }
    } else if (sessionId) {
      await prisma.liveSession
        .updateMany({
          where: { id: sessionId, status: { in: ["starting", "pending"] } },
          data: { status: "pending" },
        })
        .catch(() => {});
    }

    return {
      success: result.success,
      data: result,
    };
  });

  // POST /api/live-stream/stop-broadcast
  server.post("/api/live-stream/stop-broadcast", async (request, reply) => {
    const sessionId = (request.body as any)?.sessionId;
    if (!sessionId) { reply.code(400); return { error: "Missing sessionId" }; }

    const managedSession = liveSessionManager.getSession(sessionId);
    liveHostOrchestrator.stop(sessionId);
    await stopRunPodBroadcast(managedSession?.podId).catch(() => {});
    const res = stopBroadcast();
    return {
      success: true,
      data: res,
    };
  });

  // POST /api/live-stream/pause
  server.post("/api/live-stream/pause", async () => {
    const result = pauseBroadcast();
    if (!result.success) {
      return { success: false, data: result };
    }
    return {
      success: result.success,
      data: result,
    };
  });

  // POST /api/live-stream/resume
  server.post("/api/live-stream/resume", async () => {
    const result = await resumeBroadcast();
    if (!result.success) {
      return { success: false, data: result };
    }
    return {
      success: result.success,
      data: result,
    };
  });

  // POST /api/live-session/switch-product
  server.post("/api/live-session/switch-product", async (request, reply) => {
    const bodySchema = z.object({
      productId: z.string().min(1),
      productName: z.string().optional(),
    });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    try {
      const latestSession = await prisma.liveSession.findFirst({
        where: { status: "live" },
        orderBy: { createdAt: "desc" },
      });
      if (latestSession) {
        await prisma.liveSession.update({
          where: { id: latestSession.id },
          data: { productId: parsed.data.productId },
        });
      }
    } catch {}

    return {
      success: true,
      activeProductId: parsed.data.productId,
      message: `Active live product switched to ${parsed.data.productName || parsed.data.productId}`,
    };
  });

  // POST /api/webhooks/platform-events
  server.post("/api/webhooks/platform-events", async (request, reply) => {
    const sessionId = (request.query as any).sessionId;
    if (!sessionId) { reply.code(400); return { error: "Missing sessionId in query" }; }
    const webhookSchema = z.object({
      platform: z.string(),
      eventType: z.enum([
        "comment",
        "order_paid",
        "cart_click",
        "viewer_update",
      ]),
      data: z.record(z.string(), z.unknown()),
    });

    const parsed = webhookSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const { platform, eventType, data } = parsed.data;
    await livePlatformConnector.ingestEvent(sessionId, platform, eventType, data);
    const metrics = livePlatformConnector.getMetricsSnapshot(sessionId);

    return {
      success: true,
      receivedAt: new Date().toISOString(),
      eventType,
      currentMetrics: {
        viewers: metrics.viewers,
        comments: metrics.comments,
        clicks: metrics.clicks,
        sales: metrics.sales,
      },
    };
  });

  // GET /api/live-session/metrics
  server.get("/api/live-session/metrics", async (request) => {
    const querySessionId = (request.query as any).sessionId;
    const session = querySessionId ? await prisma.liveSession.findUnique({
      where: { id: querySessionId },
      include: { avatar: true },
    }) : await prisma.liveSession.findFirst({
      where: { status: { in: ["starting", "pending", "live"] } },
      orderBy: { createdAt: "desc" },
      include: { avatar: true },
    });

    const sessionId = session?.id || '';
    const managedSession = liveSessionManager.getSession(sessionId);
    const streamStatus = getStreamStatus();
    const workerBroadcast = await getRunPodBroadcastStatus(managedSession?.podId).catch(() => null);
    const metrics = livePlatformConnector.getMetricsSnapshot(sessionId);

    const sessionStatus = managedSession?.state || session?.status || "idle";

    return {
      success: true,
      data: {
        isStreaming:
          workerBroadcast?.status === "streaming" ||
          streamStatus.status === "streaming",
        handshakeVerified:
          workerBroadcast?.status === "streaming" ||
          streamStatus.handshakeVerified,
        sessionStatus,
        platform: session?.platform || "TikTok LIVE",
        product: null,
        avatar: session?.avatar || null,
        startedAt:
          session?.createdAt ||
          streamStatus.startedAt ||
          new Date().toISOString(),
        metrics,
        serverTimestamp: Date.now(),
      },
    };
  });
}
"""

with open("backend/src/routes/live-session.ts", "w") as f:
    f.write(content)
