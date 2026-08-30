import { SessionSummaryData } from "@/app/dashboard/types";

export interface StartSessionParams {
  productId: string;
  avatarId: string;
  platform: string;
  durationHours: number;
  autoReply: boolean;
  autoPin: boolean;
  autoPromotion: boolean;
  autoModeration: boolean;
  avatarName: string;
  tone: string;
  accessToken?: string;
  liveChatId?: string;
  liveVideoId?: string;
}

export interface BroadcastParams {
  rtmpUrl: string;
  streamKey: string;
  sessionId?: string;
  avatarImage: string;
  avatarVideo?: string;
  productName: string;
  productPrice: string;
  productImageUrl?: string;
  bannerImageUrl?: string;
  platform: string;
  stockCount: number;
  ctaLabel: string;
}

export const liveSessionService = {
  async startSession(params: StartSessionParams, signal?: AbortSignal) {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "";
    const res = await fetch(`${backendUrl}/api/live-session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Gagal membuat sesi live");
    }
    return await res.json();
  },

  async startBroadcast(params: BroadcastParams, signal?: AbortSignal) {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "";
    const res = await fetch(`${backendUrl}/api/live-stream/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Gagal broadcast stream");
    }
    return await res.json();
  },

  async stopBroadcast(sessionId?: string | null) {
    try {
      await fetch("/api/live-stream/stop-broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } catch {}
  },

  async stopSession(params: {
    sessionId?: string | null;
    durationSeconds?: number;
    viewers?: number;
    comments?: number;
    clicks?: number;
    sales?: number;
    productSold?: number;
  }): Promise<{ summary?: SessionSummaryData } | null> {
    try {
      const res = await fetch("/api/live-session/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {}
    return null;
  },

  async pauseStream(): Promise<boolean> {
    const res = await fetch("/api/live-stream/pause", { method: "POST" });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.data?.message || "Perubahan status stream gagal");
    }
    return true;
  },

  async resumeStream(): Promise<boolean> {
    const res = await fetch("/api/live-stream/resume", { method: "POST" });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.data?.message || "Perubahan status stream gagal");
    }
    return true;
  },

  async fetchMetrics() {
    const res = await fetch("/api/live-session/metrics");
    if (res.ok) {
      return await res.json();
    }
    return null;
  },

  async fetchPipelineStatus(sessionId: string) {
    const res = await fetch(
      `/api/live-stream/pipeline-status?sessionId=${encodeURIComponent(sessionId)}`,
    );
    if (res.ok) {
      return await res.json();
    }
    return null;
  },

  async confirmGoLive(sessionId: string) {
    const res = await fetch("/api/live-stream/go-live-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Gagal konfirmasi siaran");
    }
    return json;
  },

  async switchProduct(productId: string, productName: string) {
    try {
      await fetch("/api/live-session/switch-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, productName }),
      });
    } catch {}
  },
};
