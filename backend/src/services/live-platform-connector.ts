import prisma from "../lib/prisma.js";
import { generateDynamicSalesResponse } from "./groq-brain.js";

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
      },
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
        await this.checkInstagramLiveStatus(
          sessionId,
          liveVideoId,
          accessToken,
        );
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

  private async pollYouTubeChat(
    sessionId: string,
    liveChatId: string,
    accessToken: string,
  ) {
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
      } catch (err) {
        console.warn(`[LivePlatformConnector] Failed to generate AI reply for comment:`, err);
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
        viewers: 0,
        peakViewers: 0,
        comments: 0,
        aiReplies: 0,
        clicks: 0,
        sales: 0,
        orders: 0,
        durationSeconds: 0,
        recentComments: [],
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
