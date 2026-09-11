import prisma from "../lib/prisma.js";
import {
  setLiveSessionActive,
  startPodAndWait,
  releaseGpuForJob,
  isPodKeepWarm,
  getStaticPodId,
  isStaticPodId,
  verifyWorkerHealth,
  listManagedLivePods,
} from "./runpod-manager.js";
import { livePlatformConnector } from "./live-platform-connector.js";
import { durationHoursToPlan, liveHostOrchestrator, type ProductSnapshot } from "./live-host-orchestrator.js";
import { stopRunPodBroadcast, triggerWorkerPlayback } from "./runpod-bridge.js";

export type SessionState = "starting" | "pending" | "live" | "ended" | "error";

export function reuseExistingLiveStart(
  existing: { id: string } | null | undefined,
  managed: { state: SessionState } | null | undefined,
): { sessionId: string; state: SessionState } | null {
  if (existing && managed && managed.state !== "ended" && managed.state !== "error") {
    return { sessionId: existing.id, state: managed.state };
  }
  return null;
}

export function canTransitionPlatformLive(input: {
  isRtmpConnected: boolean;
  playable: number;
  minReady: number;
}): boolean {
  return input.isRtmpConnected === true && input.playable >= input.minReady;
}

export function shouldRehydrateRow(row: { runpodPodId: string | null }, alreadyActive: boolean): boolean {
  return Boolean(row.runpodPodId) && !alreadyActive;
}

export function shouldTerminateOrphanPod(podId: string, knownPodIds: Set<string>): boolean {
  return !knownPodIds.has(podId) && !isStaticPodId(podId);
}

export interface ManagedSession {
  sessionId: string;
  state: SessionState;
  platform: string;
  durationHours: number;
  startedAt: number;
  liveStartedAt?: number;
  deadlineAt: number;
  avatarName: string;
  voice?: string;
  voiceId?: string;
  style?: string;
  ttsLang?: string;
  speechSpeed?: number;
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
  backgroundImage?: string;
}

const PENDING_TIMEOUT_MS = Math.max(60_000, Number(process.env.LIVE_PENDING_TIMEOUT_MS || "1800000"));
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
      console.log(`[LiveSessionManager] Menghentikan sesi ${sessionId} & melepas GPU.`);
      void this.stopSession(sessionId).catch((err) => console.error(`[LiveSessionManager] Gagal menghentikan sesi ${sessionId}:`, err));
    });
  }

  public async startSession(params: {
    productId: string;
    avatarId: string;
    voice?: string;
    voiceId?: string;
    style?: string;
    ttsLang?: string;
    speechSpeed?: number;
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
    backgroundImage?: string;
    clientRequestId?: string;
  }): Promise<{ sessionId: string; state: SessionState }> {
    if (params.clientRequestId) {
      const existing = await prisma.liveSession.findUnique({
        where: { clientRequestId: params.clientRequestId },
      });
      const managed = existing ? this.activeSessions.get(existing.id) : null;
      const reused = reuseExistingLiveStart(existing, managed);
      if (reused) return reused;
    }

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
        podStatus: "provisioning",
        clientRequestId: params.clientRequestId,
        deadlineAt: new Date(Date.now() + params.durationHours * 3600 * 1000),
        runtimeConfig: JSON.stringify({
          productId: params.productId,
          avatarId: params.avatarId,
          platform: params.platform,
          durationHours: params.durationHours,
          avatarName: params.avatarName,
          voice: params.voice,
          voiceId: params.voiceId,
          style: params.style,
          ttsLang: params.ttsLang,
          speechSpeed: params.speechSpeed,
          tone: params.tone,
          product: params.product,
          catalog: params.catalog,
          backgroundImage: params.backgroundImage,
        }),
        estimatedCost: Math.round(params.durationHours * 12500),
      },
    });
    setLiveSessionActive(true, session.id);

    const staticPodId = getStaticPodId();
    const catalog = params.catalog?.length ? params.catalog : params.product ? [params.product] : [];
    const product = params.product || catalog.find((item) => item.id === params.productId) || catalog[0];

    const managedSession: ManagedSession = {
      sessionId: session.id,
      state: "starting",
      platform: params.platform,
      durationHours: params.durationHours,
      startedAt: Date.now(),
      deadlineAt: Date.now() + params.durationHours * 3600 * 1000,
      avatarName: params.avatarName || "Namira",
      voice: params.voice || this.pendingVoicePreference || undefined,
      voiceId: params.voiceId || process.env.VOICE_ID || "girl_cute_kids",
      style: params.style || undefined,
      ttsLang: params.ttsLang || "id",
      speechSpeed: params.speechSpeed ?? 1,
      tone: params.tone || "Persuasif",
      podId: staticPodId || null,
      podBootStatus: "booting",
      podBootMessage: staticPodId ? `Menghubungkan ke pod statis ${staticPodId}...` : "Mengalokasikan Cloud GPU (pod baru)...",
      liveDetectionAttempts: 0,
      onStateChange: undefined,
      product,
      catalog,
      backgroundImage: params.backgroundImage,
    };

    this.activeSessions.set(session.id, managedSession);

    livePlatformConnector.setLiveDetectedCallback(session.id, async (triggerSessionId?: string) => {
      const sId = triggerSessionId || session.id;
      const currentSession = this.activeSessions.get(sId);
      if (currentSession?.state === "pending") {
        await this.tryTransitionPlatformLive(sId);
      }
    });

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
      managed.podBootMessage = getStaticPodId() ? `Menghubungkan ke pod statis ${getStaticPodId()}...` : "Mengalokasikan Cloud GPU (pod baru)...";
      const podIdStr = await startPodAndWait(360_000, {
        sessionId,
        onProgress: (message) => {
          const current = this.activeSessions.get(sessionId);
          if (current) current.podBootMessage = message;
        },
        onPodCreated: (podId) => {
          const current = this.activeSessions.get(sessionId);
          if (current) current.podId = podId;
          void prisma.liveSession
            .update({
              where: { id: sessionId },
              data: {
                runpodPodId: podId,
                podStatus: "provisioning",
                podCreatedAt: new Date(),
              },
            })
            .catch((err) => console.error(`[LiveSessionManager] Gagal menyimpan pod ${podId}:`, err));
        },
        shouldAbort: () => {
          const current = this.activeSessions.get(sessionId);
          return !current || current.bootstrapAbort === true || current.state === "ended";
        },
      });
      const podId = typeof podIdStr === "string" ? podIdStr.trim() : "";
      if (!this.activeSessions.has(sessionId)) {
        if (podId) {
          const staticId = getStaticPodId();
          const reused = Array.from(this.activeSessions.values()).some((item) => item.podId === podId);
          if (podId === staticId || reused) {
            console.log(`[LiveSessionManager] Pod ${podId} tetap dipakai sesi lain — tidak di-release.`);
          } else {
            await releaseGpuForJob(podId, sessionId).catch((err) =>
              console.error(`[LiveSessionManager] Gagal terminate pod ${podId} setelah sesi dihapus:`, err),
            );
          }
        }
        return;
      }

      const localWorkerUrl = (process.env.RUNPOD_WORKER_URL || "").trim();
      if (!podId) {
        if (localWorkerUrl) {
          managed.podId = null;
          managed.podBootStatus = "ready";
          managed.podBootMessage = "Worker lokal siap (RUNPOD_WORKER_URL).";
        } else {
          managed.podId = null;
          managed.podBootStatus = "failed";
          managed.podBootMessage = "GPU tidak tersedia (pod null). Cek RUNPOD_API_KEY / kuota GPU.";
          await this.transitionState("error", sessionId);
          return;
        }
      } else {
        managed.podId = podId;
        managed.podBootStatus = "ready";
        managed.podBootMessage = "GPU siap — menghubungkan ke worker...";
      }
      await prisma.liveSession.update({
        where: { id: sessionId },
        data: {
          runpodPodId: managed.podId || undefined,
          podStatus: "ready",
        },
      });

      livePlatformConnector.startSession({
        sessionId,
        podId: managed.podId || null,
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
      this.startPlatformLivePoll(sessionId, connectorParams.liveVideoId, connectorParams.accessToken);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Gagal menghidupkan GPU RunPod";
      if (message.includes("dibatalkan")) {
        console.log(`[LiveSessionManager] Pod bootstrap dibatalkan (${sessionId})`);
        return;
      }
      console.error(`[LiveSessionManager] Pod bootstrap gagal (${sessionId}):`, err);
      const current = this.activeSessions.get(sessionId);
      if (current) {
        current.podBootStatus = "failed";
        current.podBootMessage = message;
        await prisma.liveSession
          .update({
            where: { id: sessionId },
            data: { podStatus: "failed", endedReason: "pod_boot_failed" },
          })
          .catch(() => {});
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
    const hasLocalWorker = Boolean((process.env.RUNPOD_WORKER_URL || "").trim());
    const podReady = session.podBootStatus === "ready" && (Boolean(session.podId) || hasLocalWorker);
    const podBooting =
      !podFailed && !podReady && (session.podBootStatus === "booting" || session.podBootStatus === "pending" || session.state === "starting");

    return {
      podReady,
      podBooting,
      podFailed,
      stageText: session.podBootMessage || (podBooting ? "Memuat PyTorch CUDA ke GPU..." : podReady ? "GPU siap" : "Menyiapkan sesi..."),
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
    options?: { keepGpu?: boolean; endedReason?: string },
  ): Promise<{
    success: boolean;
    summary?: Record<string, unknown>;
  }> {
    const session = this.activeSessions.get(sessionId);
    const persisted = await prisma.liveSession.findUnique({ where: { id: sessionId } });
    if (!session && !persisted) {
      return { success: false };
    }

    if (session) session.bootstrapAbort = true;
    const staticPodId = getStaticPodId();
    const keepGpu = options?.keepGpu ?? isPodKeepWarm();
    const podToTerminate = keepGpu ? null : session?.podId || persisted?.runpodPodId || staticPodId || null;

    this.clearTimers(sessionId);
    liveHostOrchestrator.stop(sessionId);

    if (session) await this.transitionState("ended", sessionId);

    const metrics = livePlatformConnector.getMetricsSnapshot(sessionId);
    livePlatformConnector.stopSession(sessionId);
    livePlatformConnector.setLiveDetectedCallback(sessionId, null);

    await prisma.liveSession.updateMany({
      where: {
        id: sessionId,
        status: { in: ["live", "pending", "starting"] },
      },
      data: {
        status: "ended",
        endedReason: options?.endedReason || "user_stop",
      },
    });

    if (podToTerminate) {
      const claim = await prisma.liveSession.updateMany({
        where: {
          id: sessionId,
          podStatus: { notIn: ["terminating", "terminated"] },
        },
        data: { podStatus: "terminating" },
      });
      if (claim.count > 0) {
        await stopRunPodBroadcast(podToTerminate).catch(() => {});
        try {
          await releaseGpuForJob(podToTerminate, sessionId);
          await prisma.liveSession.update({
            where: { id: sessionId },
            data: { podStatus: "terminated", podTerminatedAt: new Date() },
          });
          console.log(`[LiveSessionManager] Pod ${podToTerminate} terminated untuk sesi ${sessionId}`);
        } catch (err) {
          await prisma.liveSession
            .update({ where: { id: sessionId }, data: { podStatus: "terminate_failed" } })
            .catch(() => {});
          console.error("Failed to stop GPU Pod:", err);
        }
      }
    }

    const durationSeconds = summary?.durationSeconds && summary.durationSeconds > 0 ? summary.durationSeconds : metrics.durationSeconds;

    const finalViewers = Math.max(summary?.viewers || 0, metrics.viewers, metrics.peakViewers);
    const finalComments = Math.max(summary?.comments || 0, metrics.comments);
    const finalClicks = Math.max(summary?.clicks || 0, metrics.clicks);
    const finalSales = Math.max(summary?.sales || 0, metrics.sales);
    const finalProductSold = Math.max(summary?.productSold || 0, metrics.orders);

    const durationHours = Math.max(0.1, durationSeconds / 3600);
    const estimatedGpuCost = Math.round(durationHours * 12500);
    const netProfit = Math.max(0, finalSales - estimatedGpuCost);
    const roiPercentage = estimatedGpuCost > 0 ? Math.round((netProfit / estimatedGpuCost) * 100) : 0;

    this.activeSessions.delete(sessionId);
    setLiveSessionActive(false, sessionId);

    return {
      success: true,
      summary: {
        durationSeconds,
        durationFormatted: `${Math.floor(durationSeconds / 3600)}j ${Math.floor((durationSeconds % 3600) / 60)}m ${durationSeconds % 60}d`,
        totalViewers: finalViewers,
        peakViewers: Math.max(metrics.peakViewers || 0, finalViewers),
        totalComments: finalComments,
        aiRepliesCount: metrics.aiReplies || 0,
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

  public getLatestActiveSession(): ManagedSession | null {
    const all = Array.from(this.activeSessions.values());
    return all.find((s) => s.state === "live") || all.find((s) => s.state === "pending") || all.find((s) => s.state === "starting") || all[0] || null;
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

  private async transitionState(newState: SessionState, sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const previousState = session.state;
    session.state = newState;

    if (newState === "live" && previousState !== "live") {
      session.liveStartedAt = Date.now();
      session.deadlineAt = session.liveStartedAt + session.durationHours * 3600 * 1000;
      this.startDurationWatchdog(sessionId);
      try {
        await triggerWorkerPlayback(session.podId ?? null);
      } catch (err) {
        console.warn("[LiveSessionManager] triggerWorkerPlayback notice:", err);
      }
      liveHostOrchestrator.startLivePipeline(sessionId).catch((err) => console.warn("[LiveSessionManager] startLivePipeline notice:", err));
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
        data: {
          status: newState,
          ...(newState === "live"
            ? {
                liveStartedAt: new Date(session.liveStartedAt || Date.now()),
                deadlineAt: new Date(session.deadlineAt),
              }
            : {}),
        },
      });
    } catch (err) {
      console.error(`[LiveSessionManager] Failed to update session state to ${newState}:`, err);
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
        console.log(`[LiveSessionManager] Duration exceeded for session ${s.sessionId}. Stopping...`);
        await this.stopSession(sessionId, undefined, { endedReason: "duration_expiry" });
        return;
      }

      if (s.state === "live") {
        const liveAnchor = s.liveStartedAt || s.startedAt;
        const elapsedSeconds = Math.floor((Date.now() - liveAnchor) / 1000);
        const maxSeconds = s.durationHours * 3600;

        if (elapsedSeconds >= maxSeconds) {
          console.log(`[LiveSessionManager] Max live duration reached (${maxSeconds}s). Stopping...`);
          await this.stopSession(sessionId, undefined, { endedReason: "duration_expiry" });
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
      void this.stopSession(sessionId, undefined, { endedReason: "pending_timeout" }).catch((err) =>
        console.error(`[LiveSessionManager] Gagal menghentikan sesi pending ${sessionId}:`, err),
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

  private startPlatformLivePoll(sessionId: string, liveVideoId?: string, accessToken?: string): void {
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
        console.warn(`[LiveSessionManager] Platform live poll timed out after 60 attempts for session ${sessionId}.`);
        return;
      }

      try {
        const isLive = await this.checkPlatformLiveStatus(platform, liveVideoId, accessToken);

        if (isLive) {
          if (await this.tryTransitionPlatformLive(sessionId)) return;
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

  private async tryTransitionPlatformLive(sessionId: string): Promise<boolean> {
    const status = await liveHostOrchestrator.getPipelineStatus(sessionId);
    const minReady = Number(status.goLiveMinUtterances || 1);
    const realtime = /ai_worker|ai-worker|realtime|visual_worker/i.test(String(status.broadcastMode || ""));
    const playable = realtime ? Number(status.readyUtteranceCount || 0) : Number(status.videosQueued || 0);
    if (!canTransitionPlatformLive({
      isRtmpConnected: status.isRtmpConnected === true,
      playable,
      minReady,
    })) {
      console.log(
        `[LiveSessionManager] Platform live ${sessionId}, tetapi pipeline belum siap ` +
          `(rtmp=${status.isRtmpConnected === true}, ready=${playable}/${minReady}).`,
      );
      return false;
    }
    console.log(`[LiveSessionManager] Platform dan pipeline siap untuk ${sessionId}. Starting AI...`);
    await this.transitionState("live", sessionId);
    return true;
  }

  private async checkPlatformLiveStatus(platform: string, liveVideoId: string, accessToken: string): Promise<boolean> {
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
      const url = new URL("https://www.googleapis.com/youtube/v3/liveBroadcasts");
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

  public async rehydrateActiveSessions(): Promise<void> {
    const rows = await prisma.liveSession.findMany({
      where: {
        status: { in: ["starting", "pending", "live"] },
        runpodPodId: { not: null },
      },
      orderBy: { createdAt: "asc" },
    });

    for (const row of rows) {
      if (!shouldRehydrateRow(row, this.activeSessions.has(row.id))) continue;
      const podId = row.runpodPodId;
      if (!podId) continue;
      const healthy = await verifyWorkerHealth(podId, 8_000);
      if (!healthy) {
        console.warn(`[LiveSessionManager] Reconcile: worker ${podId} offline untuk ${row.id}.`);
        await this.stopSession(row.id, undefined, { endedReason: "recovery_worker_offline" });
        continue;
      }

      let config: Record<string, any> = {};
      try {
        config = row.runtimeConfig ? JSON.parse(row.runtimeConfig) : {};
      } catch {}
      const durationHours = Number(config.durationHours || row.durationHours || 1);
      const deadlineAt = row.deadlineAt?.getTime() || Date.now() + durationHours * 3600 * 1000;
      const state = (["starting", "pending", "live"].includes(row.status) ? row.status : "pending") as SessionState;
      const product = normalizeRecoveredProduct(config.product);
      const catalog = Array.isArray(config.catalog)
        ? config.catalog.map(normalizeRecoveredProduct).filter((item): item is ProductSnapshot => Boolean(item))
        : product
          ? [product]
          : [];
      const managed: ManagedSession = {
        sessionId: row.id,
        state,
        platform: row.platform,
        durationHours,
        startedAt: row.createdAt.getTime(),
        liveStartedAt: row.liveStartedAt?.getTime(),
        deadlineAt,
        avatarName: String(config.avatarName || "Namira"),
        voice: config.voice ? String(config.voice) : row.voice || undefined,
        voiceId: config.voiceId ? String(config.voiceId) : process.env.VOICE_ID || "girl_cute_kids",
        style: config.style ? String(config.style) : undefined,
        ttsLang: config.ttsLang ? String(config.ttsLang) : "id",
        speechSpeed: Number(config.speechSpeed ?? 1),
        tone: String(config.tone || "Persuasif"),
        podId,
        podBootStatus: "ready",
        podBootMessage: "Sesi dipulihkan setelah backend restart.",
        liveDetectionAttempts: 0,
        product,
        catalog,
        backgroundImage: config.backgroundImage ? String(config.backgroundImage) : undefined,
      };
      this.activeSessions.set(row.id, managed);
      setLiveSessionActive(true, row.id);
      livePlatformConnector.startSession({
        sessionId: row.id,
        podId,
        platform: row.platform,
        productId: row.productId,
        avatarName: managed.avatarName,
        voice: managed.voice,
        tone: managed.tone,
      });
      liveHostOrchestrator.startPipelineBackground({
        productId: row.productId,
        avatarName: managed.avatarName,
        voice: managed.voice,
        voiceId: managed.voiceId,
        style: managed.style,
        ttsLang: managed.ttsLang,
        speechSpeed: managed.speechSpeed,
        tone: managed.tone,
        podId,
        sessionId: row.id,
        plan: durationHoursToPlan(durationHours),
        maxDurationMs: Math.max(1_000, deadlineAt - Date.now()),
        product,
        catalog,
        backgroundImage: managed.backgroundImage,
      });
      if (state === "live") {
        await liveHostOrchestrator.startLivePipeline(row.id);
        this.startDurationWatchdog(row.id);
      } else {
        this.startPendingTimeout(row.id);
      }
      console.log(`[LiveSessionManager] Rehydrated ${row.id} on pod ${row.runpodPodId}.`);
    }

    const dangling = await prisma.liveSession.findMany({
      where: {
        status: { in: ["starting", "pending", "live"] },
        runpodPodId: null,
      },
    });
    for (const row of dangling) {
      await this.stopSession(row.id, undefined, { endedReason: "recovery_missing_pod" });
    }

    const knownPodIds = new Set(
      (await prisma.liveSession.findMany({
        where: { runpodPodId: { not: null }, status: { in: ["starting", "pending", "live"] } },
        select: { runpodPodId: true },
      }))
        .map((row) => row.runpodPodId)
        .filter((id): id is string => Boolean(id)),
    );
    const livePods = await listManagedLivePods();
    for (const pod of livePods) {
      if (!shouldTerminateOrphanPod(pod.id, knownPodIds)) continue;
      console.warn(`[LiveSessionManager] Orphan pod ${pod.id} (${pod.name}) — terminate.`);
      await releaseGpuForJob(pod.id).catch((err) =>
        console.error(`[LiveSessionManager] Gagal terminate orphan ${pod.id}:`, err),
      );
    }
  }

  public async forceStopSession(sessionId: string): Promise<void> {
    await this.stopSession(sessionId, undefined, { endedReason: "force_stop" });
  }
}

function normalizeRecoveredProduct(value: unknown): ProductSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as ProductSnapshot;
  return item.id && item.name ? item : undefined;
}

export const liveSessionManager = new LiveSessionManager();
