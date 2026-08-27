import sys

content = """import prisma from "../lib/prisma.js";
import { forwardToRunPodGPU } from "./runpod-bridge.js";
import { generateDynamicSalesResponse } from "./llm-brain.js";
import { livePlatformConnector } from "./live-platform-connector.js";

const DEFAULT_INTERVAL_SECONDS = 35;

type HostConfig = {
  productId: string;
  avatarName: string;
  voice?: string;
  tone: string;
  rtmpUrl?: string;
  streamKey?: string;
  podId?: string | null;
  sessionId: string;
};

interface OrchestratorState {
  config: HostConfig;
  timer: NodeJS.Timeout | null;
  queue: Promise<void>;
  cycle: number;
  usedPromptIndices: Set<number>;
}

class LiveHostOrchestrator {
  private sessions = new Map<string, OrchestratorState>();

  private prompts = [
    "Buat pembukaan singkat yang menyambut penonton baru dan memperkenalkan produk.",
    "Jelaskan satu manfaat utama produk dan cara pakainya dengan bahasa live yang natural.",
    "Buat demo penggunaan atau tips praktis yang relevan dengan produk.",
    "Buat pengingat promo dan ajakan checkout yang informatif, tanpa klaim di luar knowledge base.",
    "Buat rangkuman singkat alasan produk ini cocok untuk target audiensnya.",
    "Jawab pertanyaan umum penonton tentang produk dengan bahasa santai dan mengajak checkout.",
    "Buat interaksi kecil seperti 'siapa yang lagi nonton dari mana?' yang mengalir ke promosi produk.",
    "Jelaskan perbedaan produk ini dengan produk lain di pasaran secara honest.",
    "Buat testimoni ringan atau cerita penggunaan yang relate dengan audiens.",
    "Jawab keraguan umum (harusnya gak perlu ragu, harga spesial, stok terbatas) dengan convincing.",
    "Buat pengingat social proof: bintang 5, ulasan bagus, atau ribuan yang sudah beli.",
    "Jelaskan komposisi atau bahan yang aman dan cocok untuk kebutuhan spesifik penonton.",
    "Buat ice breaking seru seperti 'raise your hand kalau lagi ngeliat keranjang kuning' dan langsung ke value proposition.",
    "Jelaskan kapan waktu terbaik pakai produk ini (pagi, malam, sebelum kerja, dll) dengan alasan natural.",
    "Buat perbandingan singkat: kalau beli di sini dapat apa aja selain produknya (gratis ongkir, gift, dll).",
    "Jawab pertanyaan 'kak ini ori nggak?' atau 'ada BPOM nggak?' dengan jawaban yang tenang dan meyakinkan.",
    "Buat FOMO halus: 'Mumpung lagi live, vouchernya masih bisa diklaim ya kak'.",
    "Jelaskan packaging atau cara pengemasan produk yang aman dan rapi.",
    "Sebutkan garansi atau layanan purna jual yang bikin pembeli tenang.",
    "Buat kalimat penutup sementara yang menahan penonton agar tidak skip live.",
  ];

  constructor() {
    livePlatformConnector.setSpeechCallback((text: string, sessionId?: string) => {
      if (sessionId) {
        this.enqueue(sessionId, text);
      }
    });
  }

  public async start(config: HostConfig) {
    this.stop(config.sessionId);

    this.sessions.set(config.sessionId, {
      config,
      timer: null,
      queue: Promise.resolve(),
      cycle: 0,
      usedPromptIndices: new Set()
    });

    this.schedule(config.sessionId, 10);
  }

  public stop(sessionId: string) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    this.sessions.delete(sessionId);
  }

  public enqueue(sessionId: string, text: string) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.queue = state.queue
      .then(() => this.renderAndQueue(sessionId, text))
      .catch((err) => {
        console.error("[LiveHost] Error di queue antrean:", err);
      });
  }

  private getNextPromptIndex(sessionId: string): number {
    const state = this.sessions.get(sessionId);
    if (!state) return 0;

    if (state.usedPromptIndices.size >= this.prompts.length) {
      state.usedPromptIndices.clear();
    }

    const available = this.prompts
      .map((_, i) => i)
      .filter((i) => !state.usedPromptIndices.has(i));

    if (available.length === 0) return 0;

    const idx = available[Math.floor(Math.random() * available.length)];
    if (idx !== undefined) {
      state.usedPromptIndices.add(idx);
      return idx;
    }
    return 0;
  }

  private getPrebufferCount() {
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

  private schedule(sessionId: string, delaySeconds: number) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const jitter = Math.floor(Math.random() * 5) - 2;
    const actualDelay = Math.max(10, delaySeconds + jitter);
    state.timer = setTimeout(() => {
      const currentState = this.sessions.get(sessionId);
      if (!currentState) return;

      currentState.timer = null;
      void this.createProactiveUtterance(sessionId).finally(() => {
        const nextState = this.sessions.get(sessionId);
        if (nextState) {
          this.schedule(sessionId, this.intervalSeconds());
        }
      });
    }, actualDelay * 1000);
  }

  private async createProactiveUtterance(sessionId: string) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const product = await prisma.product.findUnique({
      where: { id: state.config.productId },
    });
    if (!product) {
      console.warn(
        `[LiveHost] Product ${state.config.productId} tidak ditemukan`,
      );
      return;
    }

    if (state.cycle === 0 && product.copywriting) {
      state.cycle += 1;
      this.enqueue(sessionId, product.copywriting);
      return;
    }

    const promptIndex = this.getNextPromptIndex(sessionId);
    const result = await generateDynamicSalesResponse({
      userQuestion: `${this.prompts[promptIndex]} Gunakan copywriting produk ini sebagai acuan: ${product.copywriting || "Tidak tersedia"}`,
      avatarName: state.config.avatarName,
      tone: state.config.tone,
      productName: product.name,
      productPrice: `Rp${product.price.toLocaleString("id-ID")}`,
      productDescription: product.description || "",
      productCategory: product.category || "General",
      productBenefits: product.benefits || "",
      productUsage: product.usage || "",
      productFaq: product.faq || "",
      productStock: product.stock,
    });

    // Check if session still exists after the async call
    if (this.sessions.has(sessionId)) {
      this.enqueue(sessionId, result.replyText);
    }
  }

  private async renderAndQueue(sessionId: string, text: string) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const config = state.config;
    const start = Date.now();
    await forwardToRunPodGPU(config.podId, {
      avatarImagePath: "avatars/namira.png",
      text,
      voice: config.voice || "id-ID-GadisNeural",
      tone: config.tone,
      rtmpUrl: config.rtmpUrl,
      streamKey: config.streamKey,
      requireWorker: true,
    });
    console.log(`[LiveHost] Utterance round-trip for ${sessionId}: ${Date.now() - start}ms`);
  }
}

export const liveHostOrchestrator = new LiveHostOrchestrator();
"""

with open("backend/src/services/live-host-orchestrator.ts", "w") as f:
    f.write(content)
