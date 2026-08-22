import { generateLunaResponse, LunaStructuredOutput } from "./luna-brain.js";

export interface LiveMetricsSnapshot {
  viewers: number;
  peakViewers: number;
  comments: number;
  aiReplies: number;
  clicks: number;
  sales: number;
  orders: number;
  durationSeconds: number;
  recentComments: Array<{ id: string; sender: string; text: string; time: string; aiReply?: string }>;
}

export interface PollerSessionConfig {
  platform: string;
  accessToken?: string;
  liveChatId?: string;
  liveVideoId?: string;
  autoReply?: boolean;
  productId?: string;
  avatarName?: string;
  tone?: string;
}

class LivePlatformConnector {
  private isRunning: boolean = false;
  private pollerTimeout: NodeJS.Timeout | null = null;
  private currentConfig: PollerSessionConfig | null = null;
  private nextPageToken: string | null = null;
  private lastProcessedCommentIds: Set<string> = new Set();
  private startedAtTimestamp: number = 0;

  // Rate Limiting & Exponential Backoff State (C-03 Fix)
  private pollDelayMs: number = 2500;
  private consecutiveErrors: number = 0;

  private metrics: LiveMetricsSnapshot = {
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

  public startSession(config: PollerSessionConfig) {
    this.stopSession();
    this.currentConfig = config;
    this.isRunning = true;
    this.startedAtTimestamp = Date.now();
    this.lastProcessedCommentIds.clear();
    this.nextPageToken = null;
    this.pollDelayMs = 2500;
    this.consecutiveErrors = 0;

    this.metrics = {
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

    const platformLower = config.platform.toLowerCase();

    // Start adaptive polling loop for pull-based platforms (YouTube / Instagram)
    if (platformLower.includes("youtube") || platformLower.includes("instagram")) {
      this.scheduleNextPoll(1000);
    }
  }

  public stopSession() {
    this.isRunning = false;
    if (this.pollerTimeout) {
      clearTimeout(this.pollerTimeout);
      this.pollerTimeout = null;
    }
    this.currentConfig = null;
  }

  private scheduleNextPoll(delayMs?: number) {
    if (!this.isRunning) return;
    if (this.pollerTimeout) clearTimeout(this.pollerTimeout);

    const wait = delayMs !== undefined ? delayMs : this.pollDelayMs;
    this.pollerTimeout = setTimeout(async () => {
      if (!this.isRunning) return;
      await this.pollActivePlatform();
      if (this.isRunning) {
        this.scheduleNextPoll();
      }
    }, wait);
  }

  public async ingestEvent(platform: string, eventType: string, data: Record<string, unknown>) {
    if (eventType === "viewer_update") {
      const v = typeof data.viewers === "number" ? data.viewers : Number(data.viewers) || 0;
      this.metrics.viewers = v;
      if (v > this.metrics.peakViewers) this.metrics.peakViewers = v;
    } else if (eventType === "cart_click") {
      this.metrics.clicks += 1;
    } else if (eventType === "order_paid") {
      this.metrics.orders += 1;
      const amt = typeof data.amount === "number" ? data.amount : Number(data.amount) || 0;
      this.metrics.sales += amt;
    } else if (eventType === "comment") {
      const sender = String(data.sender || data.username || data.author || "Penonton");
      const text = String(data.text || data.message || data.comment || "");
      const commentId = String(data.id || data.commentId || Date.now());

      if (!this.lastProcessedCommentIds.has(commentId)) {
        this.lastProcessedCommentIds.add(commentId);
        await this.handleNewComment(commentId, sender, text);
      }
    }
  }

  private async pollActivePlatform() {
    if (!this.isRunning || !this.currentConfig) return;
    const { platform, accessToken, liveChatId, liveVideoId } = this.currentConfig;
    const p = platform.toLowerCase();

    try {
      if (p.includes("youtube") && liveChatId && accessToken) {
        await this.pollYouTubeChat(liveChatId, accessToken);
      } else if (p.includes("instagram") && liveVideoId && accessToken) {
        await this.pollInstagramComments(liveVideoId, accessToken);
      }
    } catch (err) {
      this.consecutiveErrors++;
      this.pollDelayMs = Math.min(30000, 2500 * Math.pow(1.5, this.consecutiveErrors));
      console.warn(`[LivePlatformConnector] Polling warning for ${platform} (Backoff: ${this.pollDelayMs}ms):`, err);
    }
  }

  private async pollYouTubeChat(liveChatId: string, accessToken: string) {
    const url = new URL("https://www.googleapis.com/youtube/v3/liveChatMessages");
    url.searchParams.set("liveChatId", liveChatId);
    url.searchParams.set("part", "id,snippet,authorDetails");
    if (this.nextPageToken) url.searchParams.set("pageToken", this.nextPageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 429 || res.status === 403) {
      this.consecutiveErrors++;
      this.pollDelayMs = Math.min(30000, 2500 * Math.pow(2, this.consecutiveErrors));
      console.warn(`[YouTube Poller] Rate limited (Status ${res.status}). Backing off for ${this.pollDelayMs}ms`);
      return;
    }

    if (res.ok) {
      // Reset backoff on success
      this.consecutiveErrors = 0;
      this.pollDelayMs = 2500;

      const json = await res.json() as {
        nextPageToken?: string;
        items?: Array<{
          id: string;
          snippet?: { displayMessage?: string };
          authorDetails?: { displayName?: string };
        }>;
      };

      if (json.nextPageToken) this.nextPageToken = json.nextPageToken;

      if (json.items && json.items.length > 0) {
        for (const item of json.items) {
          const commentId = item.id;
          if (!this.lastProcessedCommentIds.has(commentId)) {
            this.lastProcessedCommentIds.add(commentId);
            const sender = item.authorDetails?.displayName || "YouTube User";
            const text = item.snippet?.displayMessage || "";
            await this.handleNewComment(commentId, sender, text);
          }
        }
      }
    }
  }

  private async pollInstagramComments(liveVideoId: string, accessToken: string) {
    const url = `https://graph.facebook.com/v18.0/${liveVideoId}/comments?access_token=${accessToken}`;
    const res = await fetch(url);

    if (res.status === 429 || res.status === 403) {
      this.consecutiveErrors++;
      this.pollDelayMs = Math.min(30000, 2500 * Math.pow(2, this.consecutiveErrors));
      return;
    }

    if (res.ok) {
      this.consecutiveErrors = 0;
      this.pollDelayMs = 2500;

      const json = await res.json() as {
        data?: Array<{
          id: string;
          from?: { username?: string };
          message?: string;
        }>;
      };

      if (json.data && json.data.length > 0) {
        for (const item of json.data) {
          if (!this.lastProcessedCommentIds.has(item.id)) {
            this.lastProcessedCommentIds.add(item.id);
            const sender = item.from?.username || "IG Viewer";
            const text = item.message || "";
            await this.handleNewComment(item.id, sender, text);
          }
        }
      }
    }
  }

  private async handleNewComment(commentId: string, sender: string, text: string) {
    this.metrics.comments += 1;
    let aiResponseText: string | undefined = undefined;

    if (this.currentConfig?.autoReply !== false && text.trim().length > 0) {
      try {
        const response: LunaStructuredOutput = await generateLunaResponse(
          text,
          this.currentConfig?.productId,
          this.currentConfig?.avatarName || "Luna",
          this.currentConfig?.tone || "Persuasif"
        );
        aiResponseText = response.speech;
        this.metrics.aiReplies += 1;
      } catch {
        aiResponseText = `Terima kasih pertanyaannya kak ${sender}! Produk ini lagi promo spesial, yuk langsung checkout sekarang yaa! ✨`;
        this.metrics.aiReplies += 1;
      }
    }

    const timeStr = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    this.metrics.recentComments.push({
      id: commentId,
      sender,
      text,
      time: timeStr,
      aiReply: aiResponseText,
    });

    if (this.metrics.recentComments.length > 100) {
      this.metrics.recentComments.shift();
    }
  }

  public getMetricsSnapshot(): LiveMetricsSnapshot {
    const duration = this.startedAtTimestamp > 0
      ? Math.floor((Date.now() - this.startedAtTimestamp) / 1000)
      : 0;

    return {
      ...this.metrics,
      durationSeconds: duration,
    };
  }
}

export const livePlatformConnector = new LivePlatformConnector();
