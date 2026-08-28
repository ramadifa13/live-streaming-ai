import prisma from "../lib/prisma.js";
import { forwardToRunPodGPU, getRunPodQueueStatus } from "./runpod-bridge.js";
import { generateDynamicSalesResponse } from "./groq-brain.js";
import { livePlatformConnector } from "./live-platform-connector.js";
import { synthesizeSpeech } from "./tts.js";

const DEFAULT_INTERVAL_SECONDS = 18;

export type HostConfig = {
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
    livePlatformConnector.setSpeechCallback(
      (text: string, sessionId?: string) => {
        if (sessionId) {
          // Ketika ada komentar live audiens masuk, interupsikan dan prioritaskan responnya
          this.enqueue(sessionId, text);
          // Reset schedule proaktif berikutnya agar lanjut pitching 5 detik setelah balas chat
          this.rescheduleAfterComment(sessionId, 5);
        }
      },
    );
  }

  public start(config: HostConfig) {
    this.startSession(config);
  }

  public stop(sessionId: string) {
    this.stopSession(sessionId);
  }

  /**
   * Pre-generates the initial talking videos (default 2 videos) before starting live broadcast.
   * Ensures RTMP stream to Instagram/TikTok doesn't start until 2 video files are fully rendered and ready!
   */
  public async prepareInitialVideos(config: HostConfig, count: number = 2): Promise<void> {
    console.log(
      `[LiveHost] Mempersiapkan ${count} video awal sebelum live stream dimulai (Session: ${config.sessionId})...`,
    );

    const product = await prisma.product.findUnique({
      where: { id: config.productId },
    });
    if (!product) {
      throw new Error(`Produk dengan ID ${config.productId} tidak ditemukan.`);
    }

    const utterances: string[] = [];

    // Utterance 1: Opening & Product Introduction
    if (product.copywriting && product.copywriting.trim().length > 0) {
      utterances.push(product.copywriting.trim());
    } else {
      utterances.push(
        `[RAISE_HAND] Halo semuanya! Selamat datang di live streaming aku bareng ${config.avatarName}! Hari ini kita kedatangan produk spesial ${product.name} dengan harga promo cuma Rp${product.price.toLocaleString("id-ID")}. Jangan lupa tap love dan tap keranjang kuning ya kak!`,
      );
    }

    // Utterance 2: Key Benefits & Promotion Callout
    if (count >= 2) {
      try {
        const result = await generateDynamicSalesResponse({
          userQuestion: `Jelaskan satu manfaat utama produk dan cara pakainya dengan bahasa live yang natural dan ajak penonton checkout. Gunakan data ini: ${product.description || ""} ${product.benefits || ""}`,
          avatarName: config.avatarName,
          tone: config.tone,
          productName: product.name,
          productPrice: `Rp${product.price.toLocaleString("id-ID")}`,
          productDescription: product.description || "",
          productCategory: product.category || "General",
          productBenefits: product.benefits || "",
          productUsage: product.usage || "",
          productFaq: product.faq || "",
          productStock: product.stock,
        });
        utterances.push(result.replyText);
      } catch (err) {
        utterances.push(
          `[POINT_DOWN] Buat kakak-kakak yang baru gabung, ${product.name} ini punya banyak keunggulan dan stoknya tinggal ${product.stock} pcs lagi! Yuk mumpung promo live berlangsung, langsung checkout sekarang ya kak!`,
        );
      }
    }

    // Render each initial video synchronously on the GPU worker
    for (let i = 0; i < utterances.length; i++) {
      const text = utterances[i]!;
      console.log(`[LiveHost] Rendering video pre-buffer ${i + 1}/${utterances.length}...`);

      let audioBase64: string | undefined = undefined;
      try {
        const ttsResult = await synthesizeSpeech({
          text,
          voice: config.voice || "id-ID-GadisNeural",
          avatarName: config.avatarName,
          tone: config.tone,
        });
        if (ttsResult.success && ttsResult.audioBuffer) {
          audioBase64 = ttsResult.audioBuffer.toString("base64");
        }
      } catch (ttsErr) {
        console.warn(`[LiveHost] TTS prebuffer notice:`, ttsErr);
      }

      await forwardToRunPodGPU(config.podId, {
        avatarImagePath: "avatars/namira.png",
        text,
        voice: config.voice || "id-ID-GadisNeural",
        tone: config.tone,
        audioBase64,
        rtmpUrl: config.rtmpUrl,
        streamKey: config.streamKey,
        requireWorker: true,
        wait: true,
      });

      console.log(
        `[LiveHost] Video pre-buffer ${i + 1}/${utterances.length} selesai di-render dan siap di antrean!`,
      );
    }

    console.log(
      `[LiveHost] Semua ${utterances.length} video awal telah siap. Transmisi live stream aman dimulai.`,
    );
  }

  public startSession(config: HostConfig) {
    this.stopSession(config.sessionId);

    const state: OrchestratorState = {
      config,
      timer: null,
      queue: Promise.resolve(),
      cycle: 1, // 1 because initial utterances are already rendered
      usedPromptIndices: new Set(),
    };
    this.sessions.set(config.sessionId, state);

    // Mulai loop siaran berkelanjutan berikutnya
    this.schedule(config.sessionId, this.intervalSeconds());
  }

  public stopSession(sessionId: string) {
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

  public rescheduleAfterComment(sessionId: string, delaySeconds = 5) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    this.schedule(sessionId, delaySeconds);
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

  private intervalSeconds() {
    const configured = Number(process.env.LIVE_HOST_INTERVAL_SECONDS);
    return Number.isFinite(configured) && configured >= 5
      ? configured
      : DEFAULT_INTERVAL_SECONDS;
  }

  private schedule(sessionId: string, delaySeconds: number) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const actualDelay = Math.max(3, delaySeconds);
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

    try {
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
    } catch (orchestratorErr) {
      console.error(
        "[LiveHostOrchestrator] Error generating proactive sales pitch:",
        orchestratorErr,
      );
      if (this.sessions.has(sessionId)) {
        this.enqueue(
          sessionId,
          `Halo kakak yang baru gabung! Jangan lupa tap keranjang kuning sekarang mumpung ${product.name} lagi promo cuma Rp${product.price.toLocaleString("id-ID")} ya!`,
        );
      }
    }
  }

  private async renderAndQueue(sessionId: string, text: string) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const config = state.config;
    const start = Date.now();

    // Pre-buffer TTS audio asynchronously to minimize GPU inference latency
    let audioBase64: string | undefined = undefined;
    try {
      const ttsResult = await synthesizeSpeech({
        text,
        voice: config.voice || "id-ID-GadisNeural",
        avatarName: config.avatarName,
        tone: config.tone,
      });
      if (ttsResult.success && ttsResult.audioBuffer) {
        audioBase64 = ttsResult.audioBuffer.toString("base64");
      }
    } catch (ttsErr) {
      console.warn(`[LiveHost] TTS pre-buffering fallback notice:`, ttsErr);
    }

    await forwardToRunPodGPU(config.podId, {
      avatarImagePath: "avatars/namira.png",
      text,
      voice: config.voice || "id-ID-GadisNeural",
      tone: config.tone,
      audioBase64,
      rtmpUrl: config.rtmpUrl,
      streamKey: config.streamKey,
      requireWorker: true,
      wait: false,
    });
    console.log(
      `[LiveHost] Utterance round-trip for ${sessionId}: ${Date.now() - start}ms`,
    );
  }
}

export const liveHostOrchestrator = new LiveHostOrchestrator();
