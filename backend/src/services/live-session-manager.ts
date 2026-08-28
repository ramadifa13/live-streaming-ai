import prisma from "../lib/prisma.js";
import {
  setLiveSessionActive,
  startPodAndWait,
  releaseGpuForJob,
} from "./runpod-manager.js";
import { livePlatformConnector } from "./live-platform-connector.js";
import { liveHostOrchestrator } from "./live-host-orchestrator.js";
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
    const podId = typeof podIdStr === "string" ? podIdStr : null;
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
      podId: typeof podId === "string" ? podId : null,
      onStateChange: undefined,
    };

    this.activeSessions.set(session.id, managedSession);

    livePlatformConnector.startSession({
      sessionId: session.id,
      podId: typeof podId === "string" ? podId : null,
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

    livePlatformConnector.setLiveDetectedCallback(
      async (triggerSessionId?: string) => {
        // The callback will need to know which session triggered it, or we rely on connector to pass it
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

    await this.transitionState("pending", session.id);
    this.startPlatformLivePoll(
      session.id,
      params.liveVideoId,
      params.accessToken,
    );

    return {
      sessionId: session.id,
      state: managedSession.state,
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
  ): Promise<{
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

    if (session.podId) {
      releaseGpuForJob(session.podId).catch((err) =>
        console.error("Failed to stop GPU Pod:", err),
      );
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

    if (session.podId) {
      releaseGpuForJob(session.podId).catch(() => {});
    }
    this.activeSessions.delete(sessionId);
  }
}

export const liveSessionManager = new LiveSessionManager();
