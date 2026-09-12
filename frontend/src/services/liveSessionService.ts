import { Product, SessionSummaryData } from "@/app/dashboard/types";

function isHttpUrl(value?: string): boolean {
  return Boolean(value && /^https?:\/\//i.test(value));
}

/** Snapshot untuk RAM backend: fakta + script bank. Foto data-URL hanya untuk produk aktif. */
export function toLiveProductSnapshot(product: Product, options: boolean | { includeMedia?: boolean; includeScriptBank?: boolean } = false) {
  const opts =
    typeof options === "boolean"
      ? { includeMedia: options, includeScriptBank: options }
      : {
          includeMedia: options.includeMedia ?? false,
          includeScriptBank: options.includeScriptBank ?? options.includeMedia ?? false,
        };

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
    scriptBank: opts.includeScriptBank ? product.scriptBank : undefined,
    faqPack: opts.includeScriptBank ? product.faqPack : undefined,
    image:
      opts.includeMedia ||
      isHttpUrl(product.image) ||
      product.image?.startsWith("/") ||
      product.image?.startsWith("data:image/")
        ? product.image
        : undefined,
    bannerImage:
      opts.includeMedia ||
      isHttpUrl(product.bannerImage) ||
      product.bannerImage?.startsWith("/") ||
      product.bannerImage?.startsWith("data:image/")
        ? product.bannerImage
        : undefined,
  };
}

export type LiveClockSnapshot = {
  liveStartedAtMs: number;
  liveSeconds: number;
  durationHours?: number;
};

/** Derive wall-clock elapsed from metrics so refresh does not reset the timer. */
export function parseLiveClockFromMetrics(data: Record<string, unknown> | null | undefined): LiveClockSnapshot | null {
  if (!data) return null;
  const serverTs = Number(data.serverTimestamp);
  const now = Number.isFinite(serverTs) && serverTs > 1_000_000_000_000 ? serverTs : Date.now();
  const startedIso = data.liveStartedAt;
  let startedMs = startedIso ? Date.parse(String(startedIso)) : Number.NaN;
  let elapsed = Number(data.elapsedSeconds);
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    if (!Number.isFinite(startedMs)) return null;
    elapsed = Math.max(0, Math.floor((now - startedMs) / 1000));
  }
  if (!Number.isFinite(startedMs)) {
    startedMs = now - elapsed * 1000;
  }
  const durationHours = Number(data.durationHours);
  return {
    liveStartedAtMs: startedMs,
    liveSeconds: elapsed,
    durationHours: Number.isFinite(durationHours) && durationHours >= 1 ? durationHours : undefined,
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
  /** Backend Pocket TTS voice profile id */
  voice?: string;
  voiceId?: string;
  lang?: string;
  speechSpeed?: number;
  accessToken?: string;
  liveChatId?: string;
  liveVideoId?: string;
  product?: unknown;
  products?: unknown[];
  backgroundImage?: string;
  clientRequestId?: string;
}

export interface BroadcastParams {
  rtmpUrl: string;
  streamKey: string;
  sessionId?: string;
  avatarImage: string;
  avatarVideo?: string;
  backgroundImage?: string;
  productName: string;
  productPrice: string;
  productImageUrl?: string;
  bannerImageUrl?: string;
  platform: string;
  stockCount: number;
  ctaLabel: string;
  avatarName?: string;
}

export const liveSessionService = {
  async startSession(params: StartSessionParams, signal?: AbortSignal) {
    const res = await fetch("/api/live-session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        ...params,
        clientRequestId: params.clientRequestId || crypto.randomUUID(),
      }),
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
      if (res.status === 409 && err.podBooting) {
        throw new Error(err.stageText || "GPU masih booting. Tunggu sebentar lalu coba hubungkan lagi.");
      }
      if (res.status === 504 || res.status === 502) {
        throw new Error(err.error || "Server timeout saat menghubungkan RTMP. Pastikan GPU RunPod sudah siap.");
      }
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

  async teardownSession(sessionId?: string | null) {
    if (!sessionId) return;
    // Single end path — /stop already stops worker broadcast.
    await this.stopSession({ sessionId });
  },

  async pauseStream(sessionId?: string | null): Promise<boolean> {
    const res = await fetch("/api/live-stream/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId || undefined }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.data?.error || json.data?.message || json.error || "Pause stream gagal");
    }
    return true;
  },

  async resumeStream(sessionId?: string | null): Promise<boolean> {
    const res = await fetch("/api/live-stream/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId || undefined }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.data?.error || json.data?.message || json.error || "Resume stream gagal");
    }
    return true;
  },

  async sendTestComment(params: {
    comment: string;
    sessionId?: string | null;
    sender?: string;
    avatarName?: string;
    tone?: string;
    voice?: string;
  }): Promise<{
    mode: "live" | "prelive";
    speech?: string;
    note?: string;
  }> {
    const res = await fetch("/api/live-session/test-comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Gagal mengirim komentar uji");
    }
    return {
      mode: json.mode,
      speech: json.data?.speech,
      note: json.data?.note,
    };
  },

  async fetchMetrics(sessionId?: string | null) {
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    const res = await fetch(`/api/live-session/metrics${query}`);
    if (!res.ok) {
      return null;
    }
    return await res.json();
  },

  async fetchPipelineStatus(sessionId: string) {
    try {
      const res = await fetch(`/api/live-stream/pipeline-status?sessionId=${encodeURIComponent(sessionId)}`);
      if (!res.ok) {
        return null;
      }
      return await res.json();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      return null;
    }
  },

  async waitForRtmpConnected(
    sessionId: string,
    options?: {
      signal?: AbortSignal;
      onProgress?: (stageText: string) => void;
      maxWaitMs?: number;
    },
  ): Promise<void> {
    // Cold start MuseTalk bisa 2–5 menit; jangan gagal cepat.
    const maxWaitMs = options?.maxWaitMs ?? 10 * 60_000;
    const started = Date.now();

    while (Date.now() - started < maxWaitMs) {
      if (options?.signal?.aborted) {
        throw new DOMException("Inisialisasi dibatalkan", "AbortError");
      }

      const status = await this.fetchPipelineStatus(sessionId);
      const progressText = status?.stageText || status?.rtmpHint || status?.rtmpError;
      if (progressText && options?.onProgress) {
        options.onProgress(String(progressText));
      }
      if (status?.isRtmpConnected) return;

      // Soft connecting hints bukan gagal — overlay tetap menunggu.
      const fatal = status?.rtmpFatal === true || (status?.rtmpState === "failed" && Boolean(status?.rtmpError));
      if (fatal) {
        throw new Error(String(status?.rtmpError || "Siaran gagal tersambung. Coba Stream Key baru."));
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    throw new Error("Masih menyiapkan siaran. Tunggu lebih lama atau coba Connect lagi tanpa tutup halaman terlalu cepat.");
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

    throw new Error("Cloud AI belum siap setelah menunggu lama. Coba Connect lagi, atau pastikan koneksi internet stabil.");
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
