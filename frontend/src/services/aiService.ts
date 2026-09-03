import { LiveSalesScript, Product } from "@/app/dashboard/types";
import { hostSampleAudioPath } from "@/app/dashboard/constants";

export interface SynthesizeTTSOptions {
  text: string;
  voice: string;
  avatarName: string;
  speed: number;
  tone: string;
  /** Hanya untuk live — FE pra-live jangan panggil synthesizeTTS. */
  sessionId?: string;
}

export interface VideoScriptData {
  hook: string;
  problem: string;
  solution: string;
  cta: string;
  fullVoiceover?: string;
}

function resolveHostId(voiceOrName?: string): string {
  const raw = (voiceOrName || "namira").trim().toLowerCase();
  if (!raw || raw.includes("gadis") || raw.includes("neural") || raw.includes("edge")) {
    return "namira";
  }
  if (raw.includes("namira")) return "namira";
  return raw.replace(/\s+/g, "_");
}

export const aiService = {
  /** Pra-live: URL sample host (static). Tidak hit Piper. */
  getHostSampleUrl(hostOrVoice?: string, sampleFromAvatar?: string | null): string {
    if (sampleFromAvatar) return sampleFromAvatar;
    return hostSampleAudioPath(resolveHostId(hostOrVoice));
  },

  /**
   * Live-only Piper TTS. Pra-live harus pakai getHostSampleUrl / play sample.
   * Akan 403 tanpa session live + pod.
   */
  async synthesizeTTS(options: SynthesizeTTSOptions): Promise<Blob> {
    const host = resolveHostId(options.voice || options.avatarName);
    const res = await fetch("/api/tts/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: options.text,
        host,
        voice: host,
        avatarName: options.avatarName,
        speed: options.speed,
        tone: options.tone,
        sessionId: options.sessionId,
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      const errorMsg =
        errJson?.error ||
        `HTTP ${res.status}: TTS Piper hanya saat live. Pra-live pakai sample.`;
      throw new Error(errorMsg);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("json")) {
      const json = await res.json();
      throw new Error(json.error || "Gagal memproses suara.");
    }

    return await res.blob();
  },

  async prepareProduct(params: {
    name: string;
    price?: string | number;
    category?: string;
    description?: string;
    benefits?: string;
    usage?: string;
    faq?: string;
    stock?: number;
    sku?: string;
    link?: string;
    targetAudience?: string;
    copywriting?: string;
    bannerImage?: string;
    avatarName?: string;
    tone?: string;
  }): Promise<{
    scriptBank: Product["scriptBank"];
    faqPack: Product["faqPack"];
    enriched: {
      benefits?: string;
      usage?: string;
      faq?: string;
      targetAudience?: string;
      copywriting?: string;
    };
    engine: string;
    count: number;
  }> {
    const controller = new AbortController();
    const timeoutMs = 25_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch("/api/ai/prepare-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("Timeout menyiapkan script bank (LLM terlalu lama)");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      throw new Error(json?.error || "Gagal menyiapkan script bank");
    }
    return {
      scriptBank: json.data?.scriptBank || [],
      faqPack: json.data?.faqPack || [],
      enriched: json.data?.enriched || {},
      engine: json.data?.engine || "local",
      count: Number(json.data?.count || 0),
    };
  },

  async generateLiveSalesScript(params: {
    activeProduct: Product;
    avatarName: string;
    tone: string;
  }): Promise<LiveSalesScript> {
    const { activeProduct, avatarName, tone } = params;
    const res = await fetch("/api/ai/live-sales-script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activeProduct,
        avatarName,
        tone,
        productName: activeProduct.name,
        productPrice: String(activeProduct.price),
        category: activeProduct.tag,
        productDescription: activeProduct.description || "",
        productBenefits: activeProduct.benefits || "",
        productUsage: activeProduct.usage || "",
        productFaq: activeProduct.faq || "",
        productStock: activeProduct.stock,
      }),
    });

    const text = await res.text();
    let json: { success?: boolean; data?: LiveSalesScript; error?: string } | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        res.ok
          ? "Format data AI tidak valid"
          : `Backend error (${res.status}): ${text.slice(0, 80) || "Internal Server Error"}`,
      );
    }

    if (res.ok && json?.data) {
      return json.data;
    }
    throw new Error(json?.error || "AI service offline");
  },

  async generateVideoScript(params: {
    productName: string;
    productPrice: string | number;
    productCategory: string;
    durationType: string;
  }): Promise<VideoScriptData> {
    const res = await fetch("/api/ai/video-script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!res.ok) throw new Error("Gagal generate script video iklan");
    const json = await res.json();
    if (json.data?.script) {
      return json.data.script;
    }
    throw new Error("Format script tidak valid");
  },

  async generateAvatarVideo(params: {
    avatarImageUrl: string;
    productImageUrl?: string;
    scriptText: string;
    avatarName: string;
    tone: string;
  }): Promise<{ jobId: string; provider: string }> {
    const res = await fetch("/api/avatar/generate-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      throw new Error(`Backend error: ${res.status}`);
    }

    const data = await res.json();
    const jobId = data.data?.jobId;
    if (!jobId) throw new Error("No jobId returned from backend");

    return { jobId, provider: data.data?.provider || "AI" };
  },

  async checkVideoStatus(jobId: string): Promise<{
    status: "done" | "error" | "processing" | "pending";
    progress?: number;
    videoUrl?: string;
  }> {
    const res = await fetch(`/api/avatar/video-status/${jobId}`);
    const json = await res.json();
    return json.data ?? {};
  },
};
