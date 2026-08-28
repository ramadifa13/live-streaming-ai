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

export interface PendingComment {
  text: string;
  createdAt: number;
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
  pendingComments: PendingComment[]; // Leaky-Bucket Priority Queue dengan TTL
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

  public stopAll() {
    for (const [sId, state] of this.sessions.entries()) {
      state.abortController.abort();
      console.log(
        `[LiveHost] Pipeline untuk session ${sId} dihentikan (stopAll).`,
      );
    }
    this.sessions.clear();
  }

  // ============================================================================
  // TAHAP 1 — PRE-LIVE PIPELINE
  // Dipanggil saat broadcast RTMP dimulai.
  // Generate V1+V2 ke GPU.
  // ============================================================================

  /**
   * Mulai pipeline background saat broadcast dimulai.
   * Return immediately — pipeline jalan non-blocking di background.
   */
  public startPipelineBackground(config: HostConfig): void {
    this.stopAll(); // Hentikan semua sesi lama agar tidak berjalan bersamaan

    const state: OrchestratorState = {
      config,
      abortController: new AbortController(),
      pipelineReady: false,
      generationCount: 0,
      videosQueued: 0,
      pendingVideos: [],
      usedPromptIndices: new Set(),
      isLive: false,
      pendingComments: [],
    };
    this.sessions.set(config.sessionId, state);

    console.log(
      `[LiveHost] 🎬 Pipeline background dimulai (Session: ${config.sessionId}). Generating V1...`,
    );

    // Kirim warmup ke worker agar model unet ter-load ke VRAM sebelum render dimulai.
    // Ini menghindari overhead load model (10-30 detik) di setiap video pertama.
    void this.warmupWorkerModel(config.sessionId);

    void this.runPreLivePipeline(config.sessionId);
  }

  /**
   * Kirim request warmup minimal ke worker agar model ter-load ke VRAM sekali.
   * Tidak menunggu response — hanya trigger agar model siap saat V1 tiba.
   */
  private async warmupWorkerModel(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state?.config.podId) return;

    try {
      const { forwardToRunPodGPU } = await import("./runpod-bridge.js");
      console.log(
        `[LiveHost] 🔥 Warmup worker model (pre-load unet ke VRAM) — session: ${sessionId}`,
      );
      await forwardToRunPodGPU(state.config.podId, {
        avatarImagePath: "avatars/namira.png",
        text: "halo",
        voice: state.config.voice || "id-ID-GadisNeural",
        tone: state.config.tone,
        requireWorker: false, // Non-fatal jika gagal
        wait: false,
      });
      console.log(`[LiveHost] ✅ Worker model warmup request terkirim.`);
    } catch (err) {
      // Non-fatal — warmup hanya optimasi
      console.warn(
        `[LiveHost] Warmup model notice (non-fatal):`,
        (err as Error).message,
      );
    }
  }

  /** Pre-live loop: generate V1 dan V2 ke GPU, lalu tunggu Go Live */
  private async runPreLivePipeline(sessionId: string): Promise<void> {
    while (true) {
      const state = this.sessions.get(sessionId);
      if (!state || state.abortController.signal.aborted) break;
      if (state.isLive) break; // live pipeline sudah ambil alih

      // Di pre-live, cukup buat maksimal 2 video awal (V1 dan V2)
      if (state.videosQueued >= 2) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      try {
        const { text, audioBase64 } =
          await this.generateAndSynthesize(sessionId);

        const s = this.sessions.get(sessionId);
        if (!s || s.abortController.signal.aborted || s.isLive) break;
        if (!text) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        s.pendingVideos.push({ text, audioBase64 });
        s.generationCount++;

        // KIRIM KE GPU AGAR DI-RENDER
        await this.submitToGPU(sessionId, text, audioBase64);

        console.log(
          `[LiveHost] 📝 Video #${s.generationCount} selesai di-generate dan dikirim ke GPU (Pre-Live)`,
        );

        if (s.videosQueued >= 2 && !s.pipelineReady) {
          s.pipelineReady = true;
          console.log(
            `[LiveHost] ✅ Backend telah mengirim V1+V2 ke GPU. Siap untuk Go Live.`,
          );
        }

        // Beri jeda 2 detik antar submission
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        const s = this.sessions.get(sessionId);
        if (!s || s.abortController.signal.aborted) break;
        console.warn(`[LiveHost] Pre-live generation error (non-fatal):`, err);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  // ============================================================================
  // TAHAP 2 — LIVE PIPELINE
  // Dipanggil dari go-live-confirm setelah user klik siaran di Instagram.
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

  /**
   * ZERO-IDLE NONSTOP PIPELINE:
   * Menjaga buffer selalu berisi 2-3 video bicara di disk RunPod.
   * Karena render video (6s) jauh lebih cepat dari durasi bicara (20s),
   * antrean video bicara TIDAK AKAN PERNAH KOSONG sehingga AI Host bicara 100% nonstop.
   */
  private async runLivePipeline(sessionId: string): Promise<void> {
    console.log(
      `[LiveHost] 🎙️ ZERO-IDLE Nonstop Pipeline aktif untuk session: ${sessionId}`,
    );

    while (true) {
      const state = this.sessions.get(sessionId);
      if (!state || state.abortController.signal.aborted) break;

      try {
        let queuedOnDisk = 0;
        let isWorkerBusy = false;

        if (state.config.podId) {
          try {
            const queueStatus = await getRunPodQueueStatus(state.config.podId);
            queuedOnDisk =
              queueStatus.queued_videos_count !== undefined
                ? queueStatus.queued_videos_count
                : queueStatus.ready_videos_count || 0;
            isWorkerBusy = (queueStatus.active_processing_count ?? 0) > 0;
          } catch {}
        }

        // Jika antrean video bicara di disk sudah ada >= 3 video ATAU GPU sedang merender:
        // Tunggu 3 detik lalu cek kembali agar GPU tidak overload
        if (queuedOnDisk >= 3 || isWorkerBusy) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }

        // Prioritas 1: Periksa apakah ada komentar penonton di pendingComments queue
        let nextUtterance: {
          text: string;
          audioBase64: string | undefined;
        } | null = null;
        const now = Date.now();

        while (state.pendingComments.length > 0) {
          const nextComment = state.pendingComments.shift();
          if (!nextComment) break;
          // Validasi TTL (30 detik): jika komentar sudah lebih dari 30s, drop agar respon tidak basi
          if (now - nextComment.createdAt > 30_000) {
            console.log(
              `[LiveHost] ⏱️ Komentar penonton kedaluwarsa (>30s) di-skip: "${nextComment.text.substring(0, 30)}..."`,
            );
            continue;
          }
          console.log(
            `[LiveHost] ⚡ Memproses komentar prioritas penonton: "${nextComment.text.substring(0, 40)}..."`,
          );
          nextUtterance = await this.synthesizeComment(
            sessionId,
            nextComment.text,
          );
          break;
        }

        // Prioritas 2: Jika tidak ada komentar valid, generate topik promosi penjualan dinamis
        if (!nextUtterance) {
          nextUtterance = await this.generateAndSynthesize(sessionId);
        }

        const s = this.sessions.get(sessionId);
        if (!s || s.abortController.signal.aborted) break;
        if (!nextUtterance.text) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        await this.submitToGPU(
          sessionId,
          nextUtterance.text,
          nextUtterance.audioBase64,
        );

        // Beri jeda 4 detik untuk memberi GPU waktu menyelesaikan render
        await new Promise((r) => setTimeout(r, 4000));
      } catch (err: any) {
        const s = this.sessions.get(sessionId);
        if (!s || s.abortController.signal.aborted) break;
        console.warn(`[LiveHost] Zero-Idle pipeline notice:`, err);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    console.log(`[LiveHost] Live pipeline selesai untuk session ${sessionId}.`);
  }

  // ============================================================================
  // PUBLIC UTILITY
  // ============================================================================

  /**
   * Tunggu sampai minimal 1 video sudah selesai dirender di GPU atau V1+V2 dikirim.
   */
  public async waitForPipelineReady(
    sessionId: string,
    timeoutMs = 180_000,
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const state = this.sessions.get(sessionId);
      if (!state || state.abortController.signal.aborted) return false;

      if (state.videosQueued >= 2) {
        console.log(
          `[LiveHost] ✅ waitForPipelineReady: videosQueued=${state.videosQueued} >= 2 — pipeline ready (session: ${sessionId})`,
        );
        return true;
      }

      await new Promise((r) => setTimeout(r, 500));
    }
    console.warn(
      `[LiveHost] waitForPipelineReady timeout (${Math.round(timeoutMs / 1000)}s) — session ${sessionId}`,
    );
    return false;
  }

  /** Status pipeline untuk polling frontend (GET /api/live-stream/pipeline-status) */
  public async getPipelineStatus(sessionId: string) {
    const state = this.sessions.get(sessionId);
    let renderedCount = 0;
    if (state?.config.podId) {
      try {
        const queueStatus = await getRunPodQueueStatus(state.config.podId);
        renderedCount = queueStatus.ready_videos_count || 0;
      } catch {}
    } else {
      renderedCount = state?.videosQueued ?? 0;
    }

    // BUG FIX: dulu kondisi kedua selalu true sehingga ready=true langsung
    // setelah 2 video DIKIRIM ke GPU, padahal GPU butuh 70-155 detik untuk render.
    // Sekarang: wajib ada >= 1 video yang sudah benar-benar SELESAI dirender di worker.
    const isReady = (state?.videosQueued ?? 0) >= 2 && renderedCount >= 1; // Video harus sudah selesai dirender di GPU, bukan hanya dikirim

    return {
      ready: isReady,
      generationCount: renderedCount,
      videosQueued: state?.videosQueued ?? 0,
      pendingCount: state?.pendingVideos.length ?? 0,
      isLive: state?.isLive ?? false,
    };
  }

  /**
   * Enqueue reply komentar audiens dengan Leaky-Bucket (Max capacity 2, TTL 30s).
   * Hanya berjalan saat isLive=true — tidak aktif saat fase idle.
   */
  public enqueue(sessionId: string, text: string) {
    const state = this.sessions.get(sessionId);
    if (!state || !state.isLive) return;

    const now = Date.now();
    // 1. Purge expired comments (> 30s)
    state.pendingComments = state.pendingComments.filter(
      (c) => now - c.createdAt <= 30_000,
    );

    // 2. Leaky-bucket cap: Max 2 komentar menunggu agar respons selalu realtime
    if (state.pendingComments.length >= 2) {
      const dropped = state.pendingComments.shift();
      console.log(
        `[LiveHost] 💧 Leaky-bucket drop komentar terlama: "${dropped?.text.substring(0, 30)}..."`,
      );
    }

    state.pendingComments.push({ text, createdAt: now });
    console.log(
      `[LiveHost] 💬 Komentar penonton masuk prioritas queue (${state.pendingComments.length} antrean): "${text.substring(0, 40)}..."`,
    );
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /** Sintesis audio untuk komentar penonton */
  private async synthesizeComment(
    sessionId: string,
    text: string,
  ): Promise<{ text: string; audioBase64: string | undefined }> {
    const state = this.sessions.get(sessionId);
    if (!state) return { text: "", audioBase64: undefined };

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
      console.warn(`[LiveHost] Comment TTS error (non-fatal):`, ttsErr);
    }
    return { text, audioBase64 };
  }

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

    let text = (result?.replyText || "").trim();
    if (text.length < 10) {
      text = `[EXCITED] Halo kakak-kakak yang baru gabung, selamat datang di live streaming kami! Khusus hari ini produk ${product.name} lagi ada promo harga spesial cuma ${product.price.toLocaleString("id-ID")} rupiah aja. Yuk langsung tap keranjang kuning sekarang juga sebelum kehabisan!`;
    }

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
