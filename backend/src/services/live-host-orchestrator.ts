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
  authorName?: string;
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
    "Mulai dengan hook penasaran atau masalah sehari-hari yang sering dialami penonton, lalu jelaskan bagaimana produk ini jadi solusi nyatanya (DILARANG mengawali dengan salam 'halo kak').",
    "Bedah satu keunggulan utama produk dan sensasi saat pertama kali pakai dengan bahasa ekspresif dan santai.",
    "Berikan tips dan trik praktis cara pakai produk langkah demi langkah agar penonton mendapat hasil paling maksimal.",
    "Ingatkan sisa stok promo yang semakin menipis dan alasan kenapa wajib amankan kupon diskon di keranjang kuning sekarang juga.",
    "Ucapkan terima kasih spontan dan hangat kepada pembeli yang baru saja checkout (sebut nama pembeli dan kota di Indonesia secara acak, contoh: 'Kak Dinda dari Surabaya'), lalu ingatkan penonton lain untuk amankan pesanan sekarang.",
    "Ceritakan ulasan positif dan alasan kenapa produk ini viral serta jadi favorit ribuan pembeli.",
    "Bahas keraguan umum yang sering bikin orang ragu beli (misal: kecocokan, rasa, atau kemudahan pakai) dengan penjelasan yang sangat meyakinkan.",
    "Ajak penonton yang sedang mantengin live untuk segera tap etalase mumpung harga promo sesi ini masih berlaku.",
    "Berikan pengumuman urgensi flash sale: ingatkan sisa kupon diskon dan promo live tinggal sedikit sebelum harga kembali normal.",
    "Bandingkan value produk ini: harga sangat terjangkau dibanding segudang manfaat dan kualitas yang didapat.",
    "Jelaskan keamanan formulasi dan kualitas bahan produk yang sudah teruji, higienis, dan aman digunakan.",
    "Berikan rekomendasi spesifik mengenai siapa saja yang wajib punya produk ini dan kenapa tidak boleh dilewatkan.",
    "Bahas detail kemasan yang rapi, praktis dibawa bepergian, dan pengiriman yang aman sampai ke rumah pembeli.",
    "Buat analogi atau cerita relate tentang bagaimana produk ini bikin rutinitas harian jadi jauh lebih mudah dan menyenangkan.",
    "Spill keuntungan belanja langsung saat sesi live (harga khusus live, voucher gratis ongkir) dibanding checkout di luar jam live.",
    "Tegaskan keaslian 100% produk original dan jaminan kepuasan pelanggan dengan nada bicara yang ramah dan percaya diri.",
    "Berikan panduan waktu atau momen paling tepat untuk menggunakan produk ini agar manfaatnya terasa maksimal.",
    "Tekankan kembali bahwa promo harga spesial ini terbatas selama sesi live berlangsung dan ajak penonton langsung amankan pesanan.",
    "Rangkum 3 alasan utama kenapa penonton harus mencoba produk ini hari ini juga.",
    "Ceritakan feedback nyata dari pelanggan yang sudah repeat order dan merasa puas dengan hasilnya.",
    "Ingatkan penonton untuk tidak menunda checkout karena harga bisa kembali normal sewaktu-waktu.",
    "Berikan kalimat penutup sesi bahasan produk ini dengan antusias dan ajakan checkout terakhir sebelum kita bahas etalase berikutnya.",
  ];

  constructor() {
    livePlatformConnector.setSpeechCallback(
      (text: string, sessionId?: string, authorName?: string) => {
        if (sessionId) {
          // Komentar audiens → sisipkan reply ke GPU queue sebagai prioritas beserta nama penonton
          this.enqueue(sessionId, text, authorName);
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

  public switchProduct(sessionId: string, productId: string) {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.config.productId = productId;
      state.usedPromptIndices.clear();
      console.log(
        `[LiveHost] 🔄 Produk aktif untuk session ${sessionId} beralih ke: ${productId}`,
      );
    }
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
    this.stop(config.sessionId); // Hentikan sesi lama dengan ID yang sama jika ada

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
      const avatarFileName = state.config.avatarName
        ? `${state.config.avatarName.toLowerCase().trim()}.png`
        : "namira.png";
      await forwardToRunPodGPU(state.config.podId, {
        avatarImagePath: `avatars/${avatarFileName}`,
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

      let isWorkerOffline = false;
      if (state.config.podId || process.env.RUNPOD_POD_ID) {
        try {
          const queueStatus = await getRunPodQueueStatus(
            state.config.podId || process.env.RUNPOD_POD_ID,
          );
          if (!queueStatus.success) isWorkerOffline = true;
        } catch {}
      }

      if (isWorkerOffline) {
        await new Promise((r) => setTimeout(r, 5000));
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

        let isWorkerOffline = false;

        if (state.config.podId || process.env.RUNPOD_POD_ID) {
          try {
            const queueStatus = await getRunPodQueueStatus(
              state.config.podId || process.env.RUNPOD_POD_ID,
            );
            if (!queueStatus.success) {
              isWorkerOffline = true;
            }
            queuedOnDisk =
              queueStatus.queued_videos_count !== undefined
                ? queueStatus.queued_videos_count
                : queueStatus.ready_videos_count || 0;
            isWorkerBusy = (queueStatus.active_processing_count ?? 0) > 0;
          } catch {}
        }

        // Jika worker offline, tunggu agar tidak spam LLM dan TTS
        if (isWorkerOffline) {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        // Buffer queue: Jaga agar buffer selalu terisi 3-4 video bicara siap putar di disk.
        // Proaktif men-submit ke worker agar rendering selalu 1-2 langkah di depan durasi bicara.
        if (queuedOnDisk >= 4) {
          await new Promise((r) => setTimeout(r, 1500));
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
            `[LiveHost] ⚡ Memproses komentar prioritas dari ${nextComment.authorName || "Penonton"}: "${nextComment.text.substring(0, 40)}..."`,
          );
          nextUtterance = await this.synthesizeComment(
            sessionId,
            nextComment.text,
            nextComment.authorName,
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
   * Tunggu sampai minimal 2 video sudah selesai dirender di GPU dan RTMP aktif.
   */
  public async waitForPipelineReady(
    sessionId: string,
    timeoutMs = 180_000,
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const state = this.sessions.get(sessionId);
      if (!state || state.abortController.signal.aborted) return false;

      const status = await this.getPipelineStatus(sessionId);
      if (status.ready) {
        console.log(
          `[LiveHost] ✅ waitForPipelineReady: RTMP connected & ${status.generationCount}/2 videos ready (session: ${sessionId})`,
        );
        return true;
      }

      await new Promise((r) => setTimeout(r, 1000));
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
    let isBroadcasting = false;
    let isRtmpConnected = false;
    let isWarmedUp = false;

    const podId = state?.config.podId || process.env.RUNPOD_POD_ID || null;

    try {
      const queueStatus = await getRunPodQueueStatus(podId);
      renderedCount = queueStatus.ready_videos_count || 0;
      isBroadcasting = queueStatus.broadcasting ?? false;
      isRtmpConnected = queueStatus.rtmp_connected ?? false;
      isWarmedUp = queueStatus.warmed_up ?? false;
    } catch {}

    if (renderedCount === 0 && state?.videosQueued) {
      renderedCount = state.videosQueued;
    }
    if (renderedCount > 0) {
      isWarmedUp = true;
    }

    // Syarat Ready: RTMP terhubung (atau broadcasting aktif) DAN minimal 2 video pembuka selesai dirender
    const isReady =
      (renderedCount >= 2 && (isRtmpConnected || isBroadcasting)) ||
      Boolean(state?.pipelineReady);

    let stageIndex = 0;
    let stageText = "Mengalokasikan Cloud GPU NVIDIA RTX 4090...";

    if (state) {
      if (!isWarmedUp && renderedCount === 0) {
        stageIndex = 1;
        stageText = "Memuat Neural Lipsync (MuseTalk)...";
      } else if (state.videosQueued === 0 && renderedCount === 0) {
        stageIndex = 2;
        stageText = "Generate Voice Persona & Skrip Selling...";
      } else if (!isRtmpConnected && !isBroadcasting) {
        stageIndex = 3;
        stageText = "Koneksi Stream RTMP Handshake (Menunggu Server)...";
      } else if (renderedCount < 2) {
        stageIndex = 4;
        stageText = `Generate AI Host (Video ${Math.min(renderedCount, 2)}/2 Selesai)...`;
      } else {
        stageIndex = 5;
        stageText = "Video AI & RTMP Siap! Silakan konfirmasi Go Live.";
      }
    }

    return {
      ready: isReady,
      generationCount: renderedCount,
      videosQueued: state?.videosQueued ?? 0,
      pendingCount: state?.pendingVideos.length ?? 0,
      isLive: state?.isLive ?? false,
      isBroadcasting,
      stageIndex,
      stageText,
    };
  }

  /**
   * Enqueue reply komentar audiens dengan Leaky-Bucket (Max capacity 2, TTL 30s).
   * Hanya berjalan saat isLive=true — tidak aktif saat fase idle.
   */
  public enqueue(sessionId: string, text: string, authorName?: string) {
    const state = this.sessions.get(sessionId);
    if (!state || !state.isLive) return;

    const now = Date.now();
    // 1. Purge expired comments (> 30s)
    state.pendingComments = state.pendingComments.filter(
      (c) => now - c.createdAt <= 30_000,
    );

    // 2. High-Intent Buying Detection (Prioritaskan pertanyaan yang berpotensi closing penjualan)
    const isHighIntent =
      /\b(beli|order|checkout|co|harga|ongkir|cod|bayar|kirim|stok|promo|diskon|paket|bundle|asli|ori|bpom|halal|rekomendasi|warna|ukuran|size|ready)\b/i.test(
        text,
      );

    const newCommentItem: PendingComment = { text, authorName, createdAt: now };

    // Jika komentar berpotensi closing tinggi, letakkan di depan antrean
    if (isHighIntent && state.pendingComments.length > 0) {
      state.pendingComments.unshift(newCommentItem);
      console.log(
        `[LiveHost] 🎯 HIGH-INTENT Komentar dari ${authorName || "Penonton"} diprioritaskan: "${text.substring(0, 40)}..."`,
      );
    } else {
      state.pendingComments.push(newCommentItem);
      console.log(
        `[LiveHost] 💬 Komentar penonton dari ${authorName || "Audience"} masuk antrean: "${text.substring(0, 40)}..."`,
      );
    }

    // 3. Leaky-bucket cap: Max 2 komentar menunggu agar respons selalu realtime
    if (state.pendingComments.length > 2) {
      const dropped = state.pendingComments.pop();
      console.log(
        `[LiveHost] 💧 Leaky-bucket drop komentar terendah: "${dropped?.text.substring(0, 30)}..."`,
      );
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /** Sintesis audio untuk komentar penonton dengan penyebutan nama, gaya baca, jeda, & cross-selling */
  private async synthesizeComment(
    sessionId: string,
    commentText: string,
    authorName?: string,
  ): Promise<{ text: string; audioBase64: string | undefined }> {
    const state = this.sessions.get(sessionId);
    if (!state) return { text: "", audioBase64: undefined };

    let product = null;
    let allProducts: any[] = [];
    try {
      if (state.config.productId) {
        product = await prisma.product.findUnique({
          where: { id: state.config.productId },
        });
      }
      allProducts = await prisma.product.findMany({
        take: 8,
        select: {
          id: true,
          name: true,
          price: true,
          category: true,
          benefits: true,
          description: true,
        },
      });
    } catch {}

    // Generate respon AI cerdas yang membaca komentar penonton dengan jeda nafas (...)
    const result = await generateDynamicSalesResponse({
      userQuestion: `Komentar dari penonton ${authorName ? `(bernama "${authorName}")` : ""}: "${commentText}". Respon seolah-olah kamu sedang membaca komentar ini di layar live dengan jeda singkat (...), sebut namanya jika ada, lalu langsung jawab secara ramah, solutif, dan ajak amankan produk di keranjang kuning.`,
      authorName,
      avatarName: state.config.avatarName,
      tone: state.config.tone,
      productName: product?.name || "Produk Pilihan",
      productPrice: product
        ? `Rp${product.price.toLocaleString("id-ID")}`
        : "Harga Spesial",
      productDescription: product?.description || "",
      productCategory: product?.category || "General",
      productBenefits: product?.benefits || "",
      productUsage: product?.usage || "",
      productFaq: product?.faq || "",
      productStock: product?.stock ?? 50,
      allProducts,
    });

    let text = (result?.replyText || "").trim();
    if (!text || text.length < 5) {
      text = `[NOD] Ada pertanyaan ${authorName ? `dari Kak ${authorName}` : "di chat"} nih: "${commentText}"... Nah buat yang nanya, produk ini kualitasnya original dan terjamin ya! Yuk langsung amankan di keranjang kuning sekarang!`;
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

    let allProducts: any[] = [];
    try {
      allProducts = await prisma.product.findMany({
        take: 8,
        select: {
          id: true,
          name: true,
          price: true,
          category: true,
          benefits: true,
        },
      });
    } catch {}

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
      allProducts,
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

    const avatarFileName = state.config.avatarName
      ? `${state.config.avatarName.toLowerCase().trim()}.png`
      : "namira.png";

    await forwardToRunPodGPU(state.config.podId, {
      avatarImagePath: `avatars/${avatarFileName}`,
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
