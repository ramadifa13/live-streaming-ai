import prisma from "../lib/prisma.js";
import {
  setLiveSessionActive,
  startPodAndWait,
  releaseGpuForJob,
} from "./runpod-manager.js";
import { livePlatformConnector } from "./live-platform-connector.js";
import {
  liveHostOrchestrator,
  type ProductSnapshot,
} from "./live-host-orchestrator.js";
import { triggerWorkerPlayback } from "./runpod-bridge.js";

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
  podBootStatus?: "pending" | "booting" | "ready" | "failed";
  podBootMessage?: string;
  bootstrapAbort?: boolean;
  watchdogTimer?: NodeJS.Timeout;
  livePollTimer?: NodeJS.Timeout;
  pendingTimer?: NodeJS.Timeout;
  liveDetectionAttempts: number;
  onStateChange?: (state: SessionState, sessionId: string) => void;
  product?: ProductSnapshot;
  catalog: ProductSnapshot[];
}

/**
 * Batas waktu sebuah sesi boleh menggantung di state "pending" (RTMP sudah
 * jalan, tetapi operator belum menekan Go Live). Tanpa batas ini pod terus
 * ditagih karena watchdog durasi hanya aktif setelah state "live".
 */
const PENDING_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.LIVE_PENDING_TIMEOUT_MS || "1800000"),
);
function pendingTimeoutFor(durationHours: number): number {
  const quarterOfPlan = durationHours * 3600 * 1000 * 0.25;
  return Math.max(5 * 60_000, Math.min(PENDING_TIMEOUT_MS, quarterOfPlan));
}

class LiveSessionManager {
  private activeSessions: Map<string, ManagedSession> = new Map();
  private pendingVoicePreference: string | null = null;

  constructor() {
    liveHostOrchestrator.setSessionExpiredHandler((sessionId) => {
      if (!this.activeSessions.has(sessionId)) return;
      console.log(
        `[LiveSessionManager] Menghentikan sesi ${sessionId} & melepas GPU.`,
      );
      void this.stopSession(sessionId).catch((err) =>
        console.error(
          `[LiveSessionManager] Gagal menghentikan sesi ${sessionId}:`,
          err,
        ),
      );
    });
  }

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
    product?: ProductSnapshot;
    catalog?: ProductSnapshot[];
  }): Promise<{ sessionId: string; state: SessionState }> {
    const previousIds = Array.from(this.activeSessions.keys());
    const staticPodId = (process.env.RUNPOD_POD_ID || "").trim();
    const keepGpu = Boolean(staticPodId);
    for (const id of previousIds) {
      console.log(
        `[LiveSessionManager] Mengganti sesi lama ${id} sebelum sesi baru (keepGpu=${keepGpu}).`,
      );
      await this.stopSession(id, undefined, { keepGpu }).catch((err) =>
        console.warn(
          `[LiveSessionManager] Gagal menghentikan sesi lama ${id}:`,
          err,
        ),
      );
    }

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

    const catalog = params.catalog?.length
      ? params.catalog
      : params.product
        ? [params.product]
        : [];
    const product =
      params.product ||
      catalog.find((item) => item.id === params.productId) ||
      catalog[0];

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
      podId: null,
      podBootStatus: "booting",
      podBootMessage: "Mengalokasikan Cloud GPU RTX 4090...",
      liveDetectionAttempts: 0,
      onStateChange: undefined,
      product,
      catalog,
    };

    this.activeSessions.set(session.id, managedSession);

    livePlatformConnector.setLiveDetectedCallback(
      async (triggerSessionId?: string) => {
        const sId = triggerSessionId || session.id;
        const currentSession = this.activeSessions.get(sId);
        if (currentSession?.state === "pending") {
          console.log(
            `[LiveSessionManager] Platform live detected for session ${sId}. Transitioning to live...`,
          );
          await this.transitionState("live", sId);
        }
      },
    );

    void this.bootstrapPodForSession(session.id, {
      productId: params.productId,
      platform: params.platform,
      accessToken: params.accessToken,
      liveChatId: params.liveChatId,
      liveVideoId: params.liveVideoId,
      autoReply: params.autoReply,
      avatarName: params.avatarName,
      voice: params.voice || this.pendingVoicePreference || undefined,
      tone: params.tone || "Persuasif",
    });

    return {
      sessionId: session.id,
      state: managedSession.state,
    };
  }

  private async bootstrapPodForSession(
    sessionId: string,
    connectorParams: {
      productId: string;
      platform: string;
      accessToken?: string;
      liveChatId?: string;
      liveVideoId?: string;
      autoReply?: boolean;
      avatarName?: string;
      voice?: string;
      tone?: string;
    },
  ): Promise<void> {
    const managed = this.activeSessions.get(sessionId);
    if (!managed) return;

    try {
      managed.podBootStatus = "booting";
      managed.podBootMessage = "Mengalokasikan Cloud GPU RTX 4090...";
      const podIdStr = await startPodAndWait(360_000, {
        onProgress: (message) => {
          const current = this.activeSessions.get(sessionId);
          if (current) current.podBootMessage = message;
        },
        onPodCreated: (podId) => {
          const current = this.activeSessions.get(sessionId);
          if (current) current.podId = podId;
        },
        shouldAbort: () => {
          const current = this.activeSessions.get(sessionId);
          return (
            !current ||
            current.bootstrapAbort === true ||
            current.state === "ended"
          );
        },
      });
      const podId = typeof podIdStr === "string" ? podIdStr : null;
      if (!this.activeSessions.has(sessionId)) {
        if (podId) {
          const staticId = (process.env.RUNPOD_POD_ID || "").trim();
          const reused = Array.from(this.activeSessions.values()).some(
            (item) => item.podId === podId,
          );
          if (podId === staticId || reused) {
            console.log(
              `[LiveSessionManager] Pod ${podId} tetap dipakai sesi lain — tidak di-release.`,
            );
          } else {
            await releaseGpuForJob(podId).catch((err) =>
              console.error(
                `[LiveSessionManager] Gagal terminate pod ${podId} setelah sesi dihapus:`,
                err,
              ),
            );
          }
        }
        return;
      }

      managed.podId = podId;
      managed.podBootStatus = "ready";
      managed.podBootMessage = "GPU siap — menghubungkan ke worker...";

      livePlatformConnector.startSession({
        sessionId,
        podId,
        platform: connectorParams.platform,
        accessToken: connectorParams.accessToken,
        liveChatId: connectorParams.liveChatId,
        liveVideoId: connectorParams.liveVideoId,
        autoReply: connectorParams.autoReply ?? true,
        productId: connectorParams.productId,
        avatarName: connectorParams.avatarName,
        voice: connectorParams.voice,
        tone: connectorParams.tone || "Persuasif",
      });

      await this.transitionState("pending", sessionId);
      this.startPlatformLivePoll(
        sessionId,
        connectorParams.liveVideoId,
        connectorParams.accessToken,
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Gagal menghidupkan GPU RunPod";
      if (message.includes("dibatalkan")) {
        console.log(
          `[LiveSessionManager] Pod bootstrap dibatalkan (${sessionId})`,
        );
        return;
      }
      console.error(`[LiveSessionManager] Pod bootstrap gagal (${sessionId}):`, err);
      const current = this.activeSessions.get(sessionId);
      if (current) {
        current.podBootStatus = "failed";
        current.podBootMessage = message;
        await this.transitionState("error", sessionId);
      }
    }
  }

  public getSessionBootStatus(sessionId: string): {
    podReady: boolean;
    podBooting: boolean;
    podFailed: boolean;
    stageText: string;
    podId: string | null;
    state: SessionState;
  } | null {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;

    const podFailed = session.podBootStatus === "failed";
    const podReady =
      session.podBootStatus === "ready" && Boolean(session.podId);
    const podBooting =
      !podFailed &&
      !podReady &&
      (session.podBootStatus === "booting" ||
        session.podBootStatus === "pending" ||
        session.state === "starting");

    return {
      podReady,
      podBooting,
      podFailed,
      stageText:
        session.podBootMessage ||
        (podBooting
          ? "Memuat PyTorch CUDA ke GPU..."
          : podReady
            ? "GPU siap"
            : "Menyiapkan sesi..."),
      podId: session.podId ?? null,
      state: session.state,
    };
  }

  public async stopSession(
    sessionId: string,
    summary?: {
      durationSeconds?: number;
      viewers?: number;
      comments?: number;
      clicks?: number;
      sales?: number;
      productSold?: number;
    },
    options?: { keepGpu?: boolean },
  ): Promise<{
    success: boolean;
    summary?: Record<string, unknown>;
  }> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { success: false };
    }

    session.bootstrapAbort = true;
    const staticPodId = (process.env.RUNPOD_POD_ID || "").trim();
    const podToTerminate = options?.keepGpu
      ? null
      : session.podId || staticPodId || null;

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

    if (podToTerminate) {
      try {
        await releaseGpuForJob(podToTerminate);
        console.log(
          `[LiveSessionManager] Pod ${podToTerminate} terminate/stop diminta untuk sesi ${sessionId}`,
        );
      } catch (err) {
        console.error("Failed to stop GPU Pod:", err);
      }
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
    if (this.activeSessions.size === 0) {
      setLiveSessionActive(false);
    }

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
    return Math.max(0, Math.floor((session.deadlineAt - Date.now()) / 1000));
  }

  private async transitionState(
    newState: SessionState,
    sessionId: string,
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const previousState = session.state;
    session.state = newState;

    if (newState === "live" && previousState !== "live") {
      this.startDurationWatchdog(sessionId);
      if (session.podId) {
        triggerWorkerPlayback(session.podId).catch((err) =>
          console.warn(
            "[LiveSessionManager] triggerWorkerPlayback notice:",
            err,
          ),
        );
      }
      liveHostOrchestrator
        .startLivePipeline(sessionId)
        .catch((err) =>
          console.warn("[LiveSessionManager] startLivePipeline notice:", err),
        );
    }

    if (newState !== "live") {
      this.clearWatchdog(sessionId);
    }

    if (newState === "pending") {
      this.startPendingTimeout(sessionId);
    } else {
      this.clearPendingTimeout(sessionId);
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
        const elapsedSeconds = Math.floor((Date.now() - s.startedAt) / 1000);
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

  private startPendingTimeout(sessionId: string): void {
    this.clearPendingTimeout(sessionId);
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const timeoutMs = pendingTimeoutFor(session.durationHours);
    session.pendingTimer = setTimeout(() => {
      const s = this.activeSessions.get(sessionId);
      if (!s || s.state !== "pending") return;
      console.warn(
        `[LiveSessionManager] Sesi ${sessionId} masih "pending" setelah ` +
          `${Math.round(timeoutMs / 60_000)} menit tanpa Go Live. ` +
          `Menghentikan sesi agar GPU tidak terus ditagih.`,
      );
      void this.stopSession(sessionId).catch((err) =>
        console.error(
          `[LiveSessionManager] Gagal menghentikan sesi pending ${sessionId}:`,
          err,
        ),
      );
    }, timeoutMs);
  }

  private clearPendingTimeout(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session?.pendingTimer) {
      clearTimeout(session.pendingTimer);
      session.pendingTimer = undefined;
    }
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
    this.clearPendingTimeout(sessionId);
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

      currentSession.liveDetectionAttempts += 1;

      if (currentSession.liveDetectionAttempts > 60) {
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

    session.bootstrapAbort = true;
    const podToTerminate = session.podId ?? null;

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

    if (podToTerminate) {
      await releaseGpuForJob(podToTerminate).catch(() => {});
    }
    this.activeSessions.delete(sessionId);
    if (this.activeSessions.size === 0) {
      setLiveSessionActive(false);
    }
  }
}

export const liveSessionManager = new LiveSessionManager();
