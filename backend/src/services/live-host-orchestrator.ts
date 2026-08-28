import prisma from "../lib/prisma.js";
import { forwardToRunPodGPU, getRunPodQueueStatus } from "./runpod-bridge.js";
import { generateDynamicSalesResponse } from "./groq-brain.js";
import { livePlatformConnector } from "./live-platform-connector.js";
import { synthesizeSpeech } from "./tts.js";

/**
 * Jumlah maksimum video yang di-pre-generate ke memory selama fase idle.
 * Mencegah over-generation yang memboroskan API Groq sebelum live dimulai.
 */
const MAX_PRE_BUFFER = 5;

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

/** Konten video yang sudah di-generate (LLM+TTS) tapi belum dikirim ke GPU queue */
interface PendingVideo {
  text: string;
  audioBase64: string | undefined;
}

interface OrchestratorState {
  config: HostConfig;
  abortController: AbortController; // stop signal untuk semua pipeline loop
  pipelineReady: boolean; // true ketika V1+V2 sudah selesai di-generate ke memory
  generationCount: number; // total video yang sudah di-generate (pending + queued)
  videosQueued: number; // total video yang sudah masuk GPU queue
  pendingVideos: PendingVideo[]; // video yang sudah di-generate, menunggu go-live-confirm
  usedPromptIndices: Set<number>;
  isLive: boolean; // true setelah go-live-confirm dipanggil
  commentQueue: Promise<void>; // promise chain khusus reply komentar audiens
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
          // Komentar audiens → sisipkan reply ke GPU queue sebagai prioritas
          this.enqueue(sessionId, text);
        }
      },
    );
  }

  /** Alias untuk startPipelineBackground — kompatibilitas dengan kode lama */
  public start(config: HostConfig) {
    this.startPipelineBackground(config);
  }

  public stop(sessionId: string) {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.abortController.abort();
    this.sessions.delete(sessionId);
    console.log(`[LiveHost] Pipeline untuk session ${sessionId} dihentikan.`);
  }

  // ============================================================================
  // TAHAP 1 — PRE-LIVE PIPELINE
  // Dipanggil saat broadcast RTMP dimulai.
  // Generate V1+V2 (lalu terus sampai MAX_PRE_BUFFER) ke memory.
  // GPU queue TIDAK diisi sampai go-live-confirm dipanggil.
  // ============================================================================

  /**
   * Mulai pipeline background saat broadcast dimulai.
   * Return immediately — pipeline jalan non-blocking di background.
   */
  public startPipelineBackground(config: HostConfig): void {
    this.stop(config.sessionId); // stop sesi lama jika ada

    const state: OrchestratorState = {
      config,
      abortController: new AbortController(),
      pipelineReady: false,
      generationCount: 0,
      videosQueued: 0,
      pendingVideos: [],
      usedPromptIndices: new Set(),
      isLive: false,
      commentQueue: Promise.resolve(),
    };
    this.sessions.set(config.sessionId, state);

    console.log(
      `[LiveHost] 🎬 Pipeline background dimulai (Session: ${config.sessionId}). Generating V1...`,
    );

    void this.runPreLivePipeline(config.sessionId);
  }

  /** Pre-live loop: generate konten ke memory, berhenti saat isLive atau MAX_PRE_BUFFER */
  private async runPreLivePipeline(sessionId: string): Promise<void> {
    while (true) {
      const state = this.sessions.get(sessionId);
      if (!state || state.abortController.signal.aborted) break;
      if (state.isLive) break; // live pipeline sudah ambil alih

      // Jangan generate lebih dari MAX_PRE_BUFFER — hemat resource
      if (state.pendingVideos.length >= MAX_PRE_BUFFER) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      try {
        const { text, audioBase64 } =
          await this.generateAndSynthesize(sessionId);

        const s = this.sessions.get(sessionId);
        if (!s || s.abortController.signal.aborted || s.isLive) break;
        if (!text) continue;

        s.pendingVideos.push({ text, audioBase64 });
        s.generationCount++;

        // LANGSUNG KIRIM KE GPU AGAR LANGSUNG DI-RENDER!
        await this.submitToGPU(sessionId, text, audioBase64);

        console.log(
          `[LiveHost] 📝 Video #${s.generationCount} selesai di-generate dan LANGSUNG dikirim ke GPU (Pre-Live)`,
        );

        if (s.generationCount >= 2 && !s.pipelineReady) {
          s.pipelineReady = true;
          console.log(
            `[LiveHost] ✅ Backend telah mengirim V1+V2 ke GPU. Menunggu GPU merender .mp4 dan user konfirmasi Go Live...`,
          );
        }
      } catch (err) {
        const s = this.sessions.get(sessionId);
        if (!s || s.abortController.signal.aborted) break;
        console.warn(`[LiveHost] Pre-live generation error (non-fatal):`, err);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  // ============================================================================
  // TAHAP 2 — LIVE PIPELINE
  // Dipanggil dari go-live-confirm setelah user klik siaran di Instagram.
  // Flush pending → GPU, lalu terus generate+submit tanpa henti.
  // ============================================================================

  /**
   * Flush semua pending video ke GPU queue lalu mulai continuous pipeline.
   * Dipanggil setelah user konfirmasi Go Live.
   */
  public async startLivePipeline(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) throw new Error(`Session ${sessionId} tidak ditemukan.`);

    state.isLive = true; // sinyal ke pre-live loop untuk berhenti

    const pendingCount = state.pendingVideos.length;
    state.pendingVideos = [];

    console.log(
      `[LiveHost] ✅ Transisi ke Live. ${pendingCount} video sudah masuk di GPU queue sejak pre-live. Memulai live pipeline berkelanjutan...`,
    );

    // Mulai continuous live pipeline (tanpa henti sampai stop() dipanggil)
    void this.runLivePipeline(sessionId);
  }

  /** Live loop: generate + submit ke GPU dengan batas antrian MAX_PRE_BUFFER */
  private async runLivePipeline(sessionId: string): Promise<void> {
    while (true) {
      const state = this.sessions.get(sessionId);
      if (!state || state.abortController.signal.aborted) break;

      try {
        // Jangan terus generate jika antrian GPU sudah penuh (misal: MAX_PRE_BUFFER / 5)
        const queueStatus = await getRunPodQueueStatus(state.config.podId);
        const currentQueue =
          (queueStatus.ready_videos_count || 0) +
          (queueStatus.active_processing_count || 0);

        if (currentQueue >= MAX_PRE_BUFFER) {
          await new Promise((r) => setTimeout(r, 2000));
          continue; // Tunggu GPU worker mengosongkan antrian
        }

        const { text, audioBase64 } =
          await this.generateAndSynthesize(sessionId);

        const s = this.sessions.get(sessionId);
        if (!s || s.abortController.signal.aborted) break;
        if (!text) continue;

        await this.submitToGPU(sessionId, text, audioBase64);

        // Jeda ringan antar iterasi
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err: any) {
        const s = this.sessions.get(sessionId);
        if (!s || s.abortController.signal.aborted) break;
        console.warn(`[LiveHost] Live pipeline error (non-fatal):`, err);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    console.log(`[LiveHost] Live pipeline selesai untuk session ${sessionId}.`);
  }

  // ============================================================================
  // PUBLIC UTILITY
  // ============================================================================

  /**
   * Tunggu sampai V1+V2 selesai di-generate ke memory.
   * Dipanggil dari go-live-confirm sebelum flush ke GPU.
   * @returns true jika ready, false jika timeout
   */
  public async waitForPipelineReady(
    sessionId: string,
    timeoutMs = 180_000,
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const state = this.sessions.get(sessionId);
      if (!state || state.abortController.signal.aborted) return false;

      // Pastikan GPU sudah merender setidaknya 2 video
      if (state.pipelineReady) {
        try {
          const queueStatus = await getRunPodQueueStatus(state.config.podId);
          if (queueStatus.ready_videos_count >= 2) {
            return true;
          }
        } catch (err) {
          console.warn(`[LiveHost] waitForPipelineReady queueStatus error:`, err);
        }
      }

      await new Promise((r) => setTimeout(r, 500));
    }
    console.warn(
      `[LiveHost] waitForPipelineReady timeout (${Math.round(timeoutMs / 1000)}s) — session ${sessionId}`,
    );
    return false;
  }

  /** Status pipeline untuk polling frontend (GET /api/live-stream/pipeline-status) */
  public getPipelineStatus(sessionId: string) {
    const state = this.sessions.get(sessionId);
    return {
      ready: state?.pipelineReady ?? false,
      generationCount: state?.generationCount ?? 0,
      videosQueued: state?.videosQueued ?? 0,
      pendingCount: state?.pendingVideos.length ?? 0,
      isLive: state?.isLive ?? false,
    };
  }

  /**
   * Enqueue reply komentar audiens.
   * Hanya berjalan saat isLive=true — tidak aktif saat fase idle.
   */
  public enqueue(sessionId: string, text: string) {
    const state = this.sessions.get(sessionId);
    if (!state || !state.isLive) return;

    state.commentQueue = state.commentQueue
      .then(async () => {
        const s = this.sessions.get(sessionId);
        if (!s || !s.isLive) return;
        let audioBase64: string | undefined;
        try {
          const ttsResult = await synthesizeSpeech({
            text,
            voice: s.config.voice || "id-ID-GadisNeural",
            avatarName: s.config.avatarName,
            tone: s.config.tone,
          });
          if (ttsResult.success && ttsResult.audioBuffer) {
            audioBase64 = ttsResult.audioBuffer.toString("base64");
          }
        } catch {}
        await this.submitToGPU(sessionId, text, audioBase64);
      })
      .catch((err) => console.error("[LiveHost] Comment queue error:", err));
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /** Generate utterance via LLM lalu synthesize via TTS */
  private async generateAndSynthesize(
    sessionId: string,
  ): Promise<{ text: string; audioBase64: string | undefined }> {
    const state = this.sessions.get(sessionId);
    if (!state) return { text: "", audioBase64: undefined };

    const product = await prisma.product.findUnique({
      where: { id: state.config.productId },
    });
    if (!product) return { text: "", audioBase64: undefined };

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

    const text = result.replyText;
    let audioBase64: string | undefined;

    try {
      const ttsResult = await synthesizeSpeech({
        text,
        voice: state.config.voice || "id-ID-GadisNeural",
        avatarName: state.config.avatarName,
        tone: state.config.tone,
      });
      if (ttsResult.success && ttsResult.audioBuffer) {
        audioBase64 = ttsResult.audioBuffer.toString("base64");
      }
    } catch (ttsErr) {
      console.warn(`[LiveHost] TTS error (non-fatal):`, ttsErr);
    }

    return { text, audioBase64 };
  }

  /** Kirim satu video ke GPU queue (non-blocking) */
  private async submitToGPU(
    sessionId: string,
    text: string,
    audioBase64?: string,
  ): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    await forwardToRunPodGPU(state.config.podId, {
      avatarImagePath: "avatars/namira.png",
      text,
      voice: state.config.voice || "id-ID-GadisNeural",
      tone: state.config.tone,
      audioBase64,
      rtmpUrl: state.config.rtmpUrl,
      streamKey: state.config.streamKey,
      requireWorker: true,
      wait: false,
    });

    state.videosQueued++;
    console.log(
      `[LiveHost] 📤 Video #${state.videosQueued} masuk GPU queue (session: ${sessionId})`,
    );
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
}

export const liveHostOrchestrator = new LiveHostOrchestrator();
