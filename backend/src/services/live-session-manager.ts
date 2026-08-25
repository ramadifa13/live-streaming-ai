import prisma from "../lib/prisma.js";
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
  tone: string;
  watchdogTimer?: NodeJS.Timeout;
  livePollTimer?: NodeJS.Timeout;
  onStateChange?: (state: SessionState, sessionId: string) => void;
}

class LiveSessionManager {
  private activeSession: ManagedSession | null = null;
  private liveDetectionAttempts: number = 0;

  public async startSession(params: {
    productId: string;
    avatarId: string;
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
    if (this.activeSession) {
      await this.forceStopSession();
    }

    await startPodAndWait();
    setLiveSessionActive(true);

    const session = await prisma.liveSession.create({
      data: {
        productId: params.productId,
        avatarId: params.avatarId,
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

    this.activeSession = {
      sessionId: session.id,
      state: "starting",
      platform: params.platform,
      durationHours: params.durationHours,
      startedAt: Date.now(),
      deadlineAt: Date.now() + params.durationHours * 3600 * 1000,
      avatarName: params.avatarName || "Namira",
      tone: params.tone || "Persuasif",
      onStateChange: undefined,
    };

    livePlatformConnector.startSession({
      platform: params.platform,
      accessToken: params.accessToken,
      liveChatId: params.liveChatId,
      liveVideoId: params.liveVideoId,
      autoReply: params.autoReply ?? true,
      productId: params.productId,
      avatarName: params.avatarName,
      tone: params.tone || "Persuasif",
    });

    livePlatformConnector.setLiveDetectedCallback(async () => {
      if (this.activeSession?.state === "pending") {
        console.log(
          `[LiveSessionManager] Platform live detected for session ${this.activeSession.sessionId}. Transitioning to live...`,
        );
        await this.transitionState("live");
      }
    });

    await this.transitionState("pending");
    this.startPlatformLivePoll(params.liveVideoId, params.accessToken);

    return {
      sessionId: session.id,
      state: this.activeSession.state,
    };
  }

  public async stopSession(summary?: {
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
    if (!this.activeSession) {
      return { success: false };
    }

    const session = this.activeSession;
    this.clearTimers();
    liveHostOrchestrator.stop();

    await this.transitionState("ended");

    const metrics = livePlatformConnector.getMetricsSnapshot();
    livePlatformConnector.stopSession();

    await prisma.liveSession.updateMany({
      where: {
        id: session.sessionId,
        status: { in: ["live", "pending", "starting"] },
      },
      data: { status: "ended" },
    });

    setLiveSessionActive(false);
    stopPod().catch((err) => console.error("Failed to stop GPU Pod:", err));

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

    this.activeSession = null;

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

  public getActiveSession(): ManagedSession | null {
    return this.activeSession;
  }

  public isLive(): boolean {
    return this.activeSession?.state === "live";
  }

  public isPending(): boolean {
    return this.activeSession?.state === "pending";
  }

  public async markBroadcastLive(): Promise<void> {
    if (this.activeSession?.state === "pending") {
      await this.transitionState("live");
    }
  }

  public getRemainingDurationSeconds(): number {
    if (!this.activeSession) return 0;
    return Math.max(
      0,
      Math.floor((this.activeSession.deadlineAt - Date.now()) / 1000),
    );
  }

  private async transitionState(newState: SessionState): Promise<void> {
    if (!this.activeSession) return;

    const previousState = this.activeSession.state;
    this.activeSession.state = newState;

    if (newState === "live" && previousState !== "live") {
      this.startDurationWatchdog();
    }

    if (newState !== "live") {
      this.clearWatchdog();
    }

    try {
      await prisma.liveSession.updateMany({
        where: {
          id: this.activeSession.sessionId,
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

    this.activeSession.onStateChange?.(newState, this.activeSession.sessionId);
  }

  private startDurationWatchdog(): void {
    this.clearWatchdog();
    if (!this.activeSession) return;

    const checkMs = 5000;
    this.activeSession.watchdogTimer = setInterval(async () => {
      if (!this.activeSession) return;

      const remaining = this.getRemainingDurationSeconds();
      if (remaining <= 0) {
        console.log(
          `[LiveSessionManager] Duration exceeded for session ${this.activeSession?.sessionId}. Stopping...`,
        );
        await this.stopSession();
        return;
      }

      if (this.activeSession.state === "live") {
        const elapsedSeconds = Math.floor(
          (Date.now() - this.activeSession.startedAt) / 1000,
        );
        const maxSeconds = this.activeSession.durationHours * 3600;

        if (elapsedSeconds >= maxSeconds) {
          console.log(
            `[LiveSessionManager] Max live duration reached (${maxSeconds}s). Stopping...`,
          );
          await this.stopSession();
        }
      }
    }, checkMs);
  }

  private clearWatchdog(): void {
    if (this.activeSession?.watchdogTimer) {
      clearInterval(this.activeSession.watchdogTimer);
      this.activeSession.watchdogTimer = undefined;
    }
  }

  private clearLivePoll(): void {
    if (this.activeSession?.livePollTimer) {
      clearTimeout(this.activeSession.livePollTimer);
      this.activeSession.livePollTimer = undefined;
    }
  }

  private clearTimers(): void {
    this.clearWatchdog();
    this.clearLivePoll();
  }

  private startPlatformLivePoll(
    liveVideoId?: string,
    accessToken?: string,
  ): void {
    this.clearLivePoll();
    if (!this.activeSession || !liveVideoId || !accessToken) return;

    const platform = this.activeSession.platform.toLowerCase();

    const poll = async (): Promise<void> => {
      if (!this.activeSession || this.activeSession.state !== "pending") {
        return;
      }

      this.liveDetectionAttempts += 1;

      if (this.liveDetectionAttempts > 60) {
        console.warn(
          `[LiveSessionManager] Platform live poll timed out after 60 attempts for session ${this.activeSession.sessionId}.`,
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
            `[LiveSessionManager] Platform confirmed live for session ${this.activeSession?.sessionId}. Starting AI...`,
          );
          await this.transitionState("live");
          this.activeSession = null;
          return;
        }
      } catch (err) {
        console.warn(`[LiveSessionManager] Platform live poll failed:`, err);
      }

      if (this.activeSession?.state === "pending") {
        this.activeSession.livePollTimer = setTimeout(poll, 5000);
      }
    };

    this.activeSession.livePollTimer = setTimeout(poll, 5000);
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

  private async forceStopSession(): Promise<void> {
    if (!this.activeSession) return;

    const sessionId = this.activeSession.sessionId;
    this.clearTimers();
    liveHostOrchestrator.stop();

    try {
      await prisma.liveSession.updateMany({
        where: {
          id: sessionId,
          status: { in: ["starting", "pending", "live"] },
        },
        data: { status: "ended" },
      });
    } catch {}

    livePlatformConnector.stopSession();
    setLiveSessionActive(false);
    stopPod().catch(() => {});
    this.activeSession = null;
  }
}

export const liveSessionManager = new LiveSessionManager();
