import { LiveSalesScript, Product } from "@/app/dashboard/types";

export interface SynthesizeTTSOptions {
  text: string;
  voice: string;
  avatarName: string;
  speed: number;
  tone: string;
}

export interface VideoScriptData {
  hook: string;
  problem: string;
  solution: string;
  cta: string;
  fullVoiceover?: string;
}

export const aiService = {
  async synthesizeTTS(options: SynthesizeTTSOptions): Promise<Blob> {
    const res = await fetch("/api/tts/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error || "Gagal memproses audio TTS dari backend.");
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("json")) {
      const json = await res.json();
      throw new Error(json.error || "Gagal memproses suara.");
    }

    return await res.blob();
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
