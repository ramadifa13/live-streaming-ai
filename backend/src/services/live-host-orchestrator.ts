import prisma from "../lib/prisma.js";
import { forwardToRunPodGPU } from "./runpod-bridge.js";
import { generateDynamicSalesResponse } from "./llm-brain.js";
import { livePlatformConnector } from "./live-platform-connector.js";
import { synthesizeSpeech } from "./tts.js";

const DEFAULT_INTERVAL_SECONDS = 35;

type HostConfig = {
  productId: string;
  avatarName: string;
  voice?: string;
  tone: string;
  rtmpUrl?: string;
  streamKey?: string;
};

class LiveHostOrchestrator {
  private config: HostConfig | null = null;
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<void> = Promise.resolve();
  private cycle = 0;

  public async start(config: HostConfig) {
    this.stop();
    this.config = config;
    this.cycle = 0;
    livePlatformConnector.setSpeechCallback((text) => this.enqueue(text));
    const prebufferCount = this.prebufferCount();
    for (let index = 0; index < prebufferCount; index += 1) {
      await this.createProactiveUtterance();
    }
    await this.queue;
    this.schedule(this.intervalSeconds());
    console.log(
      `[LiveHost] Proactive speech enabled every ${this.intervalSeconds()}s with ${prebufferCount} buffered videos`,
    );
  }

  public stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.config = null;
    livePlatformConnector.setSpeechCallback(null);
  }

  public enqueue(text: string) {
    if (!this.config || !text.trim()) return;
    this.queue = this.queue
      .then(() => this.renderAndQueue(text.trim()))
      .catch((error) => console.error("[LiveHost] Speech job failed:", error));
  }

  private prebufferCount() {
    const configured = Number(process.env.LIVE_HOST_PREBUFFER_COUNT);
    return Number.isInteger(configured) && configured >= 1 && configured <= 5
      ? configured
      : 2;
  }

  private intervalSeconds() {
    const configured = Number(process.env.LIVE_HOST_INTERVAL_SECONDS);
    return Number.isFinite(configured) && configured >= 10
      ? configured
      : DEFAULT_INTERVAL_SECONDS;
  }

  private schedule(delaySeconds: number) {
    if (!this.config) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.createProactiveUtterance().finally(() => {
        this.schedule(this.intervalSeconds());
      });
    }, delaySeconds * 1000);
  }

  private async createProactiveUtterance() {
    if (!this.config) return;
    const product = await prisma.product.findUnique({
      where: { id: this.config.productId },
    });
    if (!product) {
      console.warn(
        `[LiveHost] Product ${this.config.productId} tidak ditemukan`,
      );
      return;
    }

    if (this.cycle === 0 && product.copywriting) {
      this.cycle += 1;
      this.enqueue(product.copywriting);
      return;
    }

    const prompts = [
      "Buat pembukaan singkat yang menyambut penonton baru dan memperkenalkan produk.",
      "Jelaskan satu manfaat utama produk dan cara pakainya dengan bahasa live yang natural.",
      "Buat demo penggunaan atau tips praktis yang relevan dengan produk.",
      "Buat pengingat promo dan ajakan checkout yang informatif, tanpa klaim di luar knowledge base.",
      "Buat rangkuman singkat alasan produk ini cocok untuk target audiensnya.",
    ];
    const result = await generateDynamicSalesResponse({
      userQuestion: `${prompts[this.cycle++ % prompts.length]} Gunakan copywriting produk ini sebagai acuan: ${product.copywriting || "Tidak tersedia"}`,
      avatarName: this.config.avatarName,
      tone: this.config.tone,
      productName: product.name,
      productPrice: `Rp${product.price.toLocaleString("id-ID")}`,
      productDescription: product.description || "",
      productCategory: product.category || "General",
      productBenefits: product.benefits || "",
      productUsage: product.usage || "",
      productFaq: product.faq || "",
      productStock: product.stock,
    });
    this.enqueue(result.replyText);
  }

  private async renderAndQueue(text: string) {
    const config = this.config;
    if (!config) return;
    const tts = await synthesizeSpeech({
      text,
      avatarName: config.avatarName,
      voice: config.voice || "id-ID-GadisNeural",
    });
    const audioBase64 = tts.audioBuffer
      ? tts.audioBuffer.toString("base64")
      : undefined;
    if (!audioBase64) {
      throw new Error("Backend TTS gagal menghasilkan audio untuk RunPod");
    }
    await forwardToRunPodGPU({
      avatarImagePath: "avatars/namira.png",
      text,
      voice: config.voice || "id-ID-GadisNeural",
      rtmpUrl: config.rtmpUrl,
      streamKey: config.streamKey,
      audioBase64,
      requireWorker: true,
    });
  }
}

export const liveHostOrchestrator = new LiveHostOrchestrator();
