import type {
  AvatarProvider,
  GPUProvider,
  LLMProvider,
  ProviderHealth,
  TTSProvider,
} from "./types.js";

export class MockLLMProvider implements LLMProvider {
  readonly name = "mock-llm";

  async generateResponse(input: {
    prompt: string;
    productName?: string;
    sellerContext?: string;
  }): Promise<{ text: string; tokens: number; model: string; cost: number }> {
    const productName = input.productName ?? "produk unggulan";
    const sellerContext = input.sellerContext ?? "UMKM skincare lokal";

    const text = [
      `Halo semuanya! Hari ini kami hadirkan ${productName} untuk kebutuhan ${sellerContext}.`,
      "Produk ini dirancang untuk memberi hasil yang cepat, aman, dan nyaman dipakai setiap hari.",
      `Jangan lewatkan promo hari ini. ${input.prompt}`,
    ].join(" ");

    return {
      text,
      tokens: 168,
      model: "llama3.1:8b",
      cost: 0.0008,
    };
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      status: "ready",
      model: "llama3.1:8b",
      message: "Local inference backend ready",
    };
  }
}

export class MockTTSProvider implements TTSProvider {
  readonly name = "mock-tts";

  async synthesize(input: {
    text: string;
    voice: string;
    language: string;
  }): Promise<{
    audioUrl: string;
    voice: string;
    language: string;
    durationSeconds: number;
    cost: number;
  }> {
    const durationSeconds = Math.max(12, Math.ceil(input.text.length / 18));

    return {
      audioUrl: `https://example.local/audio/${encodeURIComponent(input.voice)}.mp3`,
      voice: input.voice,
      language: input.language,
      durationSeconds,
      cost: 0.0004,
    };
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      status: "ready",
      model: "piper-tts",
      message: "Voice synthesis pipeline healthy",
    };
  }
}

export class MockAvatarProvider implements AvatarProvider {
  readonly name = "mock-avatar";

  async listAvatars(): Promise<
    Array<{
      id: string;
      name: string;
      style: string;
      language: string;
      voice: string;
      description?: string;
    }>
  > {
    return [
      {
        id: "alya",
        name: "Alya",
        style: "Friendly",
        language: "Indonesia",
        voice: "Wanita Natural",
        description: "Warm and natural host style",
      },
      {
        id: "luna",
        name: "Luna",
        style: "Energetic",
        language: "Indonesia",
        voice: "Energetic Promo",
        description: "High-energy conversion style",
      },
      {
        id: "cinta",
        name: "Cinta",
        style: "Professional",
        language: "Indonesia",
        voice: "Soft Professional",
        description: "Calm premium host style",
      },
    ];
  }

  async getAvatar(
    id: string,
  ): Promise<{
    id: string;
    name: string;
    style: string;
    language: string;
    voice: string;
    description?: string;
  } | null> {
    const avatars = await this.listAvatars();
    return avatars.find((avatar) => avatar.id === id) ?? null;
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      status: "ready",
      model: "LivePortrait / MuseTalk (Neural Video Driver)",
      message: "Photorealistic neural avatar rendering service ready",
    };
  }
}

export class MockGPUProvider implements GPUProvider {
  readonly name = "mock-gpu";

  private allocations = new Map<
    string,
    { jobName: string; gpuType: string; costPerMinute: number }
  >();

  async acquire(
    jobName: string,
  ): Promise<{
    jobName: string;
    status: "allocated" | "queued";
    gpuType: string;
    allocationId: string;
    costPerMinute: number;
  }> {
    const allocationId = `gpu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const gpuType = "RTX 4090 / on-demand";
    const allocation = {
      jobName,
      gpuType,
      costPerMinute: 0.6,
    };

    this.allocations.set(allocationId, allocation);

    return {
      jobName,
      status: "allocated",
      gpuType,
      allocationId,
      costPerMinute: allocation.costPerMinute,
    };
  }

  async release(allocationId: string): Promise<void> {
    this.allocations.delete(allocationId);
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      status: "ready",
      model: "RTX-4090",
      message: "GPU scheduler is running in on-demand mode",
    };
  }
}

export const llmProvider = new MockLLMProvider();
export const ttsProvider = new MockTTSProvider();
export const avatarProvider = new MockAvatarProvider();
export const gpuProvider = new MockGPUProvider();
