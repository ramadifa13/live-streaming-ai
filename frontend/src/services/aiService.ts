import { LiveSalesScript, Product } from "@/app/dashboard/types";

export interface SynthesizeTTSOptions {
  text: string;
  voice: string;
  avatarName: string;
  speed?: number;
  tone?: string;
  /** VoxCPM2 voice_id (female host catalog) */
  voiceId?: string;
  /** ISO lang: id | en */
  lang?: string;
  sessionId?: string;
  /** Studio preview — butuh AI Worker GPU (VoxCPM2). */
  allowOfflineSynth?: boolean;
}

export interface VideoScriptData {
  hook: string;
  problem: string;
  solution: string;
  cta: string;
  fullVoiceover?: string;
}

function resolveVoiceId(voiceOrName?: string): string {
  const raw = (voiceOrName || "girl_cute_kids").trim().toLowerCase();
  if (!raw || raw.includes("gadis") || raw.includes("neural") || raw.includes("edge")) {
    return "girl_cute_kids";
  }
  if (
    raw.includes("namira") ||
    raw === "namira" ||
    raw === "default_host" ||
    raw.includes("default")
  ) {
    return "girl_cute_kids";
  }
  return raw.replace(/\s+/g, "_").replace(/&/g, "and").replace(/[^a-z0-9_]/g, "_");
}

export const aiService = {
  /** VoxCPM2 TTS — live (session) atau studio preview (`allowOfflineSynth` + worker GPU). */
  async synthesizeTTS(options: SynthesizeTTSOptions): Promise<Blob> {
    const voiceId = resolveVoiceId(
      options.voiceId || options.voice || options.avatarName,
    );
    const res = await fetch("/api/tts/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: options.text,
        voiceId,
        host: voiceId,
        voice: voiceId,
        avatarName: options.avatarName,
        speed: options.speed ?? 1,
        tone: options.tone,
        lang: options.lang,
        sessionId: options.sessionId,
        allowOfflineSynth: options.allowOfflineSynth === true,
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      const errorMsg =
        errJson?.error ||
        `HTTP ${res.status}: Gagal sintesis VoxCPM2 TTS.`;
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
