export type ProviderStatus = "ready" | "warming" | "error";

export interface ProviderHealth {
  provider: string;
  status: ProviderStatus;
  model?: string;
  message?: string;
}

export interface LLMProvider {
  readonly name: string;
  generateResponse(input: {
    prompt: string;
    productName?: string;
    sellerContext?: string;
  }): Promise<{
    text: string;
    tokens: number;
    model: string;
    cost: number;
  }>;
  getHealth(): Promise<ProviderHealth>;
}

export interface TTSProvider {
  readonly name: string;
  synthesize(input: {
    text: string;
    voice: string;
    language: string;
  }): Promise<{
    audioUrl: string;
    voice: string;
    language: string;
    durationSeconds: number;
    cost: number;
  }>;
  getHealth(): Promise<ProviderHealth>;
}

export interface AvatarProvider {
  readonly name: string;
  listAvatars(): Promise<
    Array<{
      id: string;
      name: string;
      style: string;
      language: string;
      voice: string;
      description?: string;
    }>
  >;
  getAvatar(id: string): Promise<{
    id: string;
    name: string;
    style: string;
    language: string;
    voice: string;
    description?: string;
  } | null>;
  getHealth(): Promise<ProviderHealth>;
}

export interface GPUProvider {
  readonly name: string;
  acquire(jobName: string): Promise<{
    jobName: string;
    status: "allocated" | "queued";
    gpuType: string;
    allocationId: string;
    costPerMinute: number;
  }>;
  release(allocationId: string): Promise<void>;
  getHealth(): Promise<ProviderHealth>;
}
