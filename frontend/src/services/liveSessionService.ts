import { Product, SessionSummaryData } from "@/app/dashboard/types";

function isHttpUrl(value?: string): boolean {
  return Boolean(value && /^https?:\/\//i.test(value));
}

/** Snapshot untuk RAM backend: fakta + script bank. Foto data-URL hanya untuk produk aktif. */
export function toLiveProductSnapshot(product: Product, includeMedia = false) {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    stock: product.stock,
    tag: product.tag,
    sku: product.sku,
    description: product.description,
    benefits: product.benefits,
    usage: product.usage,
    faq: product.faq,
    copywriting: product.copywriting,
    targetAudience: product.targetAudience,
    link: product.link,
    scriptBank: product.scriptBank,
    faqPack: product.faqPack,
    image: includeMedia || isHttpUrl(product.image) ? product.image : undefined,
    bannerImage: includeMedia || isHttpUrl(product.bannerImage) ? product.bannerImage : undefined,
  };
}

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
  product?: unknown;
  products?: unknown[];
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
    const res = await fetch("/api/live-session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 504 || res.status === 502) {
        throw new Error(
          "Server timeout saat memulai sesi. Deploy backend terbaru diperlukan — start session harus langsung balas, boot GPU dipolling terpisah.",
        );
      }
      throw new Error(err.error || `Gagal membuat sesi live (HTTP ${res.status})`);
    }
    return await res.json();
  },

  async startBroadcast(params: BroadcastParams, signal?: AbortSignal) {
    const res = await fetch("/api/live-stream/broadcast", {
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
    if (!res.ok) {
      return null;
    }
    return await res.json();
  },

  async fetchPipelineStatus(sessionId: string) {
    const res = await fetch(
      `/api/live-stream/pipeline-status?sessionId=${encodeURIComponent(sessionId)}`,
    );
    if (!res.ok) {
      return null;
    }
    return await res.json();
  },

  async waitForPodReady(
    sessionId: string,
    options?: {
      signal?: AbortSignal;
      onProgress?: (stageText: string) => void;
      maxWaitMs?: number;
    },
  ): Promise<void> {
    const maxWaitMs = options?.maxWaitMs ?? 380_000;
    const started = Date.now();

    while (Date.now() - started < maxWaitMs) {
      if (options?.signal?.aborted) {
        throw new DOMException("Inisialisasi dibatalkan", "AbortError");
      }

      const status = await this.fetchPipelineStatus(sessionId);
      if (status?.stageText && options?.onProgress) {
        options.onProgress(String(status.stageText));
      }
      if (status?.podFailed) {
        throw new Error(status.stageText || "GPU RunPod gagal dihidupkan");
      }
      if (status?.podReady) return;

      await new Promise((r) => setTimeout(r, 2500));
    }

    throw new Error(
      "Timeout menunggu GPU RunPod siap (lebih dari 6 menit). Coba lagi atau cek worker di RunPod.",
    );
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

  async switchProduct(productId: string, productName: string, product?: unknown, sessionId?: string) {
    const res = await fetch("/api/live-session/switch-product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, productName, product, sessionId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn("[switchProduct] Failed:", err.error || `HTTP ${res.status}`);
    }
  },
};
