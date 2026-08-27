import prisma from "../lib/prisma.js";
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
};

class LiveHostOrchestrator {
  private config: HostConfig | null = null;
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<void> = Promise.resolve();
  private cycle = 0;
  private usedPromptIndices: Set<number> = new Set();

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
    "Buat Flash Sale tease: 'Nanti seperpintas lagi aku kasih kode khusus, siap-siap ya keranjang kuningnya!'",
    "Jelaskan cara claim garansi atau refund jika ada masalah, agar penonton merasa aman.",
    "Buat engagement: minta penonton tulis 'MANTUL' atau kirim lokasi mereka untuk memancing interaksi.",
    "Jawab pertanyaan spesifik: 'untuk kulit sensitif bisa pakai nggak?' dengan jawaban knowledge base yang akurat.",
    "Buat story telling singkat tentang pengguna lain yang senang dengan produk ini.",
    "Buat ringkasan ulang harga normal vs harga live dan total hemat yang didapat penonton.",
    "Jelaskan step by step pemesanan yang mudah: klik keranjang kuning, isi alamat, bayar, done.",
    "Buat last call CTA sebelum diganti topik berikutnya: 'Stok tinggal beberapa puluh, jangan sampai kehabisan!'",
    "Jawab pertanyaan 'kalau gagal cara pengembaliannya?' dengan tenang dan jelas.",
    "Buat motivasi kecil: 'Kakak pasti bisa punya yang lebih baik, harga spesial cuma di live ini.'",
  ];

  private getNextPromptIndex(): number {
    if (this.usedPromptIndices.size >= this.prompts.length) {
      this.usedPromptIndices.clear();
    }
    let index: number;
    let attempts = 0;
    do {
      index = Math.floor(Math.random() * this.prompts.length);
      attempts += 1;
    } while (this.usedPromptIndices.has(index) && attempts < this.prompts.length);
    this.usedPromptIndices.add(index);
    return index;
  }

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
    const jitter = Math.floor(Math.random() * 5) - 2;
    const actualDelay = Math.max(10, delaySeconds + jitter);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.createProactiveUtterance().finally(() => {
        this.schedule(this.intervalSeconds());
      });
    }, actualDelay * 1000);
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

    const promptIndex = this.getNextPromptIndex();
    const result = await generateDynamicSalesResponse({
      userQuestion: `${this.prompts[promptIndex]} Gunakan copywriting produk ini sebagai acuan: ${product.copywriting || "Tidak tersedia"}`,
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
    // TTS + voice cloning now happens entirely on the RunPod worker
    // (Chatterbox-TTS-Indonesian) — backend only forwards text + tone.
    const start = Date.now();
    await forwardToRunPodGPU({
      avatarImagePath: "avatars/namira.png",
      text,
      voice: config.voice || "id-ID-GadisNeural",
      tone: config.tone,
      rtmpUrl: config.rtmpUrl,
      streamKey: config.streamKey,
      requireWorker: true,
    });
    console.log(`[LiveHost] Utterance round-trip: ${Date.now() - start}ms`);
  }
}

export const liveHostOrchestrator = new LiveHostOrchestrator();
