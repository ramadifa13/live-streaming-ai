import Groq from "groq-sdk";
import { z } from "zod";

const apiKey = process.env.GROQ_API_KEY || "";

export function getGroqClient(): Groq {
  const key = process.env.GROQ_API_KEY || apiKey;
  if (!key) {
    throw new Error(
      "GROQ_API_KEY is missing. Please set it in .env for Groq LLM.",
    );
  }
  return new Groq({ apiKey: key });
}

// ==============================================================================
// 1. DATA TYPES & INTERFACES
// ==============================================================================
export interface SalesBrainInput {
  userQuestion: string;
  avatarName?: string;
  tone?: string;
  productName?: string;
  productPrice?: string;
  productDescription?: string;
  productCategory?: string;
  productBenefits?: string;
  productUsage?: string;
  productFaq?: string;
  productStock?: number;
}

export interface SalesBrainOutput {
  replyText: string;
  engineUsed: string;
  intent: string;
  action: string;
}

export interface ProductKnowledge {
  description: string;
  benefits: string;
  usage: string;
  faq: string;
  targetAudience: string;
  copywriting: string;
}

export interface LiveSalesPitchInput {
  productName: string;
  productPrice?: string;
  productCategory?: string;
  category?: string;
  productDescription?: string;
  productBenefits?: string;
  productUsage?: string;
  productFaq?: string;
  productStock?: number;
  avatarName?: string;
  tone?: string;
}

export interface LiveSalesPitchOutput {
  productName: string;
  price: string;
  stock: number;
  category: string;
  avatarName: string;
  tone: string;
  hook: string;
  showcase: string;
  cta: string;
  fullScript: string;
}

export interface VideoSalesScriptInput {
  productName: string;
  productDescription?: string;
  productPrice?: string;
  productCategory?: string;
  durationType?: "15s" | "30s" | "60s";
  style?: string;
}

export interface VideoSalesScriptOutput {
  tierName: string;
  tierPrice: string;
  estimatedCogs: string;
  hookHeadline: string;
  hook: string;
  problem: string;
  solution: string;
  cta: string;
  fullVoiceover: string;
  badges: string[];
  durationSeconds: number;
}

export const LunaActionEnum = z.enum([
  "IDLE",
  "TALK_EXPRESSIVE",
  "NOD",
  "LAUGH",
  "SHRUG",
  "HOLD_PRODUCT",
  "POINT_CART",
]);
export type LunaAction = z.infer<typeof LunaActionEnum>;

export const LunaEmotionEnum = z.enum([
  "happy",
  "neutral",
  "surprised",
  "thinking",
]);
export type LunaEmotion = z.infer<typeof LunaEmotionEnum>;

export const LunaStructuredOutputSchema = z.object({
  speech: z
    .string()
    .describe("Jawaban verbal Luna dalam Bahasa Indonesia santai untuk TTS"),
  action: LunaActionEnum.describe("Aksi fisik 3D/gesture avatar"),
  emotion: LunaEmotionEnum.describe("Ekspresi wajah avatar"),
  target_product_id: z
    .string()
    .nullable()
    .describe("ID produk jika sedang memegang/mempromosikan produk"),
});
export type LunaStructuredOutput = z.infer<typeof LunaStructuredOutputSchema>;

export interface GroqModelItem {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  active: boolean;
  context_window?: number;
}

// ==============================================================================
// 2. DYNAMIC MODEL DISCOVERY & RANDOMIZATION (100% DARI GROQ API)
// ==============================================================================
let cachedModels: string[] = [];
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000; // Cache 1 menit

// Keywords non-chat yang harus difilter (misal: audio whisper, guardrail, embedding)
const EXCLUDE_KEYWORDS = [
  "whisper",
  "guard",
  "embedding",
  "moderation",
  "tts",
  "audio",
  "clip",
  "vision",
];

/**
 * Mengambil semua model yang tersedia langsung dari Groq API endpoint (https://api.groq.com/openai/v1/models).
 */
export async function getAvailableGroqModels(): Promise<GroqModelItem[]> {
  const key = process.env.GROQ_API_KEY || apiKey;
  if (!key) {
    throw new Error("GROQ_API_KEY is missing. Please set it in .env");
  }

  try {
    const resp = await fetch("https://api.groq.com/openai/v1/models", {
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      throw new Error(
        `Failed to fetch Groq models: ${resp.status} ${resp.statusText}`,
      );
    }

    const json = (await resp.json()) as { data?: GroqModelItem[] };
    return (json.data || []).map((m) => ({
      id: m.id,
      object: m.object || "model",
      created: m.created || 0,
      owned_by: m.owned_by || "groq",
      active: m.active ?? true,
      context_window: m.context_window,
    }));
  } catch (err: any) {
    const client = getGroqClient();
    const list = await client.models.list();
    const data = list.data as Array<any>;
    return data.map((m) => ({
      id: m.id,
      object: m.object || "model",
      created: m.created || 0,
      owned_by: m.owned_by || "groq",
      active: m.active ?? true,
      context_window: m.context_window,
    }));
  }
}

/**
 * Mengambil list model chat yang aktif murni dari Groq API endpoint tanpa hardcoding.
 */
export async function getAvailableChatModels(): Promise<string[]> {
  const now = Date.now();
  if (cachedModels.length > 0 && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedModels;
  }

  const modelsList = await getAvailableGroqModels();
  const chatModels = modelsList
    .filter((m) => m.active !== false)
    .map((m) => m.id)
    .filter((id) => {
      const lower = id.toLowerCase();
      return !EXCLUDE_KEYWORDS.some((kw) => lower.includes(kw));
    });

  if (chatModels.length === 0) {
    throw new Error(
      "Tidak ada model chat yang ditemukan dari akun Groq Anda. Pastikan GROQ_API_KEY valid di .env",
    );
  }

  cachedModels = chatModels;
  cacheTimestamp = now;
  return chatModels;
}

/**
 * Mengacak (randomize) urutan model Groq yang tersedia di setiap request secara murni dinamis.
 */
export async function getRandomCandidateModels(): Promise<string[]> {
  const available = await getAvailableChatModels();
  const shuffled = [...available];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = temp;
  }
  return shuffled;
}

// ==============================================================================
// 3. CORE LLM FUNCTIONS USING GROQ (RANDOM AVAILABLE MODEL SELECTION)
// ==============================================================================

/**
 * Generates dynamic sales responses for conversational selling during live stream.
 */
export async function generateDynamicSalesResponseGroq(
  input: SalesBrainInput,
): Promise<SalesBrainOutput> {
  const client = getGroqClient();

  const {
    userQuestion,
    avatarName = "Luna",
    tone = "Persuasif",
    productName = "Produk",
    productPrice = "Harga Spesial",
    productDescription = "Deskripsi produk",
    productBenefits = "Banyak manfaat dan keunggulan",
    productUsage = "Mudah digunakan",
    productFaq = "Terjamin kualitasnya",
    productStock = 50,
  } = input;

  const systemPrompt = `Kamu adalah ${avatarName}, seorang AI Host & Live Streamer profesional yang sedang siaran langsung jualan di TikTok / Shopee / Instagram Live.
Gaya bicara kamu: ${tone}, sangat luwes, ramah, ceria, menggunakan Bahasa Indonesia santai khas live streaming ("aku", "kakak", "nih", "banget", "ya kak", "hehe", "yuk"). TIDAK BOLEH kaku atau seperti robot.

Produk yang sedang kamu jual saat ini: ${productName} (Kategori: ${input.productCategory || "General"}, Harga spesial live: ${productPrice}, Sisa Stok: ${productStock} pcs).

--- RAG KNOWLEDGE BASE PRODUK ---
1. Deskripsi: ${productDescription}
2. Manfaat & Keunggulan: ${productBenefits}
3. Petunjuk Pemakaian: ${productUsage}
4. FAQ & Info Keamanan (BPOM/Halal): ${productFaq}

--- TUGAS UTAMA (CONVERSATIONAL SELLING) ---
1. Jawab pertanyaan penonton secara spontan, cerdas, ramah, dan manusiawi (apapun pertanyaannya, baik tentang produk, cara pakai, izin BPOM, sapaan, ataupun pertanyaan pribadi/di luar topik).
2. SETELAH menjawab pertanyaan utama, selipkan jembatan obrolan yang halus (smooth pivot) untuk mengajak penonton melirik produk ${productName} atau mengingatkan promo ${productPrice} di keranjang kuning.
3. Panjang jawaban maksimal 2 - 3 kalimat agar pas dan enak didengar saat dibacakan voice TTS.
4. (SANGAT PENTING): Kamu harus SELALU menyisipkan satu Tanda Aksi (Action Tag) di AWAL jawabanmu untuk mengendalikan gerakan video AI:
   - [IDLE] = Obrolan santai biasa.
   - [RAISE_HAND] = Saat menyapa, memanggil, atau melambaikan tangan.
   - [POINT_DOWN] = Saat menyuruh penonton melihat produk di keranjang kuning.
   - [EXCITED] = Saat membicarakan diskon besar atau sangat antusias.`;

  const userMsg = `Pertanyaan Penonton: "${userQuestion}"`;

  const candidateModels = await getRandomCandidateModels();

  for (const model of candidateModels) {
    try {
      const response = await client.chat.completions.create({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMsg },
        ],
        temperature: 0.7,
        max_tokens: 250,
      });

      const text = response.choices[0]?.message?.content || "";
      if (text.trim()) {
        return {
          replyText: text.trim(),
          engineUsed: `Groq (${model})`,
          intent: "dynamic_llm",
          action: "reply",
        };
      }
    } catch (err: any) {
      console.warn(
        `[Groq-Brain] Model ${model} gagal (${err?.status || err?.message}), mencoba model acak lainnya...`,
      );
    }
  }

  // Graceful conversational fallback (anti-crash saat API limit)
  console.warn(
    "[Groq-Brain] Menggunakan Resilient Offline Sales Pitch Template agar live stream terus berjalan...",
  );
  const pitchTemplates = [
    `Halo semuanya! Selamat datang di live streaming aku bareng ${avatarName}! Hari ini spesial banget karena produk ${productName} lagi ada diskon khusus cuma ${productPrice}! Jangan sampai kehabisan ya, langsung tap keranjang kuning sekarang!`,
    `Buat kakak yang lagi cari produk berkualitas, ${productName} ini solusinya banget! ${productBenefits ? productBenefits : "Kualitas premium dan sudah terbukti"}. Harganya lagi hemat cuma ${productPrice}, stoknya tinggal ${productStock} pcs lagi nih kak!`,
    `Yang baru gabung jangan lupa follow dan tap-tap layarnya ya kak! Produk unggulan kita ${productName} lagi best seller banget hari ini. Yuk checkout sekarang juga sebelum promonya berakhir!`,
    `Banyak banget yang tanya keunggulan ${productName}, selain ${productBenefits ? productBenefits : "hasilnya maksimal"}, cara pakainya juga super praktis! Mumpung live masih berlangsung dengan harga promo ${productPrice}, buruan amankan ya!`,
  ];
  const randomPitch =
    pitchTemplates[Math.floor(Math.random() * pitchTemplates.length)];

  return {
    replyText: randomPitch,
    engineUsed: "Resilient Offline Sales Engine (Fallback)",
    intent: "fallback_sales_pitch",
    action: "reply",
  };
}

export const generateDynamicSalesResponse = generateDynamicSalesResponseGroq;
export const generateDynamicSalesResponseGemini =
  generateDynamicSalesResponseGroq;

/**
 * Generates structured 3-part live sales pitch (Hook, Showcase, CTA) using Groq.
 */
export async function generateLiveSalesPitchFromAIGroq(
  input: LiveSalesPitchInput,
): Promise<LiveSalesPitchOutput> {
  const client = getGroqClient();

  const hostName = input.avatarName || "Namira";
  const tone = input.tone || "Persuasif";
  const category = input.productCategory || input.category || "General";
  const price = input.productPrice || "Harga Spesial";
  const stock = input.productStock ?? 50;

  const systemPrompt = `Kamu adalah ${hostName}, seorang Top Live Host & Streamer profesional di Indonesia.
Buat naskah live sales pitch terstruktur dalam Bahasa Indonesia yang sangat natural, santai, ramah, dan memikat penonton ("aku", "kakak", "yuk", "nih", "ya kak").

DATA PRODUK:
- Nama Produk: ${input.productName}
- Kategori: ${category}
- Harga Promo Live: ${price}
- Sisa Stok: ${stock} pcs
- Deskripsi dari Penjual: ${input.productDescription || "Tidak ada deskripsi"}
- Keunggulan & Manfaat: ${input.productBenefits || "Kualitas terbaik dan teruji"}
- Petunjuk Pemakaian: ${input.productUsage || "Mudah digunakan"}
- FAQ / Izin: ${input.productFaq || "Terjamin original dan aman"}

GAYA BICARA: ${tone} (bahasa live streaming santai, tidak kaku, tidak seperti membaca brosur).

ATURAN WAJIB:
- Gunakan HANYA informasi nyata dari data produk di atas. Jangan mengarang klaim berlebihan atau izin yang tidak tertulis.
- Naskah harus dibagi menjadi 3 bagian:
  1. "hook": Sapaan pembuka yang heboh & mengaitkan rasa penasaran penonton (1-2 kalimat).
  2. "showcase": Bedah manfaat utama, keunggulan, dan solusi dari deskripsi/benefits produk dengan bahasa yang persuasif dan luwes (2-3 kalimat).
  3. "cta": Ajakan beli/checkout mendesak dengan menyebut harga promo ${price} dan sisa stok di keranjang kuning (1-2 kalimat).
- WAJIB menyisipkan Action Tag di AWAL setiap teks bagian (hook, showcase, cta): [IDLE], [RAISE_HAND], [POINT_DOWN], atau [EXCITED].

Kembalikan HANYA JSON valid:
{
  "hook": "...",
  "showcase": "...",
  "cta": "..."
}`;

  const candidateModels = await getRandomCandidateModels();
  for (const model of candidateModels) {
    try {
      const response = await client.chat.completions.create({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Buat naskah live sales pitch untuk ${input.productName}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      });

      const text = (response.choices[0]?.message?.content || "").trim();
      const parsed = JSON.parse(text) as {
        hook?: string;
        showcase?: string;
        cta?: string;
      };
      if (!parsed.hook || !parsed.showcase || !parsed.cta) {
        throw new Error("Groq returned incomplete live sales script format");
      }

      const cleanHook = parsed.hook.trim();
      const cleanShowcase = parsed.showcase.trim();
      const cleanCta = parsed.cta.trim();

      return {
        productName: input.productName,
        price,
        stock,
        category,
        avatarName: hostName,
        tone,
        hook: cleanHook,
        showcase: cleanShowcase,
        cta: cleanCta,
        fullScript: `${cleanHook}\n\n${cleanShowcase}\n\n${cleanCta}`,
      };
    } catch (err: unknown) {
      console.warn(
        `[Groq-Brain] generateLiveSalesPitch dengan model ${model} notice:`,
        err,
      );
    }
  }

  throw new Error(
    "AI Sales Script Generator (Groq) failed with all available models",
  );
}

export const generateLiveSalesPitchFromAI = generateLiveSalesPitchFromAIGroq;
export const generateLiveSalesPitchFromAIGemini =
  generateLiveSalesPitchFromAIGroq;

/**
 * Generates vertical video ads script (Tiktok/Reels).
 */
export async function generateVideoSalesScriptGroq(
  params: VideoSalesScriptInput,
): Promise<string> {
  const client = getGroqClient();

  const prompt = `Buat 1 naskah video pendek (Tiktok/Reels) untuk promosi produk:
Nama Produk: ${params.productName}
Kategori: ${params.productCategory || "General"}
Harga: ${params.productPrice || "Harga Spesial"}
Durasi: ${params.durationType || "30s"}
Style: ${params.style || "Viral TikTok"}
Deskripsi: ${params.productDescription || "Produk berkualitas"}

Berikan hanya naskahnya langsung tanpa intro/outro tambahan, dalam bahasa Indonesia yang memikat.`;

  const candidateModels = await getRandomCandidateModels();
  for (const model of candidateModels) {
    try {
      const response = await client.chat.completions.create({
        model: model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      });

      const text = (response.choices[0]?.message?.content || "").trim();
      if (text) return text;
    } catch (e: unknown) {
      console.warn(
        `[Groq-Brain] generateVideoSalesScript dengan model ${model} notice:`,
        e,
      );
    }
  }

  throw new Error("AI Video Script Generator (Groq) failed");
}

export const generateVideoSalesScript = generateVideoSalesScriptGroq;
export const generateVideoSalesScriptGemini = generateVideoSalesScriptGroq;

/**
 * Generates structured host response with 3D animation actions and emotions using Groq.
 */
export async function generateLunaResponse(
  userComment: string,
  product?: {
    id: string;
    name: string;
    price: number | string;
    stock: number;
    description?: string;
  } | null,
  avatarName: string = "Namira",
  tone: string = "Persuasif",
): Promise<LunaStructuredOutput> {
  const client = getGroqClient();

  const productSection = product
    ? `\nPRODUK AKTIF DI KERANJANG KUNING:
- ID: ${product.id}
- Nama: ${product.name}
- Harga Promo Live: ${product.price}
- Sisa Stok: ${product.stock} pcs
- Manfaat/Deskripsi: ${product.description || "Formula premium teruji klinis"}`
    : "\n(Belum ada produk spesifik yang disematkan di keranjang kuning)";

  const systemPrompt = `Kamu adalah ${avatarName.toUpperCase()}, AI Live Streamer Host profesional paling populer di Indonesia.
Sifat & Persona ${avatarName}:
- Gaya siaran: ${tone} (Gaya bahasa luwes, interaktif, percaya diri, dan ramah khas live streaming Indonesia).
- Menggunakan bahasa gaul live streaming yang santai, luwes, dan akrab ("aku", "kakak", "banget", "nih", "ya kak", "hehe", "yuk").
- SANGAT INTERAKTIF: Apapun pertanyaan penonton, jawab dengan nyambung, cerdas, dan menghibur.
- KEMAMPUAN SMOOTH PIVOT: Selipkan jembatan halus yang mengajak penonton melirik promo produk atau keranjang kuning.
${productSection}

PANDUAN AKSI (action):
- "HOLD_PRODUCT": Menjelaskan keunggulan produk aktif.
- "POINT_CART": Mengingatkan diskon atau checkout keranjang kuning.
- "LAUGH": Merespon lelucon/candaan.
- "NOD": Memberi konfirmasi atau mengiyakan pertanyaan.
- "SHRUG": Pertanyaan santai/ambigu.
- "TALK_EXPRESSIVE": Menyapa atau bercerita.
- "IDLE": Default.

PANDUAN EMOSI (emotion): "happy" | "neutral" | "surprised" | "thinking".

Kembalikan HANYA JSON valid:
{
  "speech": "Jawaban verbal ${avatarName} MAKSIMAL 1-2 KALIMAT PENDEK saja",
  "action": "HOLD_PRODUCT" | "POINT_CART" | "LAUGH" | "NOD" | "SHRUG" | "TALK_EXPRESSIVE" | "IDLE",
  "emotion": "happy" | "neutral" | "surprised" | "thinking",
  "target_product_id": "${product ? product.id : null}"
}`;

  const candidateModels = await getRandomCandidateModels();
  for (const model of candidateModels) {
    try {
      const response = await client.chat.completions.create({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Komentar Penonton: "${userComment}"` },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      });

      const rawText = (response.choices[0]?.message?.content || "").trim();
      const parsed = JSON.parse(rawText);
      const validated = LunaStructuredOutputSchema.safeParse(parsed);
      if (validated.success) {
        return validated.data;
      }
    } catch (err: unknown) {
      console.warn(
        `[Groq-Brain] generateLunaResponse dengan model ${model} notice:`,
        err,
      );
    }
  }

  // Graceful fallback output
  return {
    speech: `Halo kak! Terima kasih komentarnya ya! Yuk jangan lupa tap keranjang kuning mumpung harganya lagi diskon!`,
    action: "POINT_CART",
    emotion: "happy",
    target_product_id: product?.id || null,
  };
}

export const generateLunaResponseGroq = generateLunaResponse;

/**
 * Generates product knowledge base and copywriting from product info using Groq.
 */
export async function generateProductKnowledge(input: {
  name: string;
  description?: string;
  category?: string;
  image?: string;
}): Promise<ProductKnowledge> {
  const client = getGroqClient();

  const systemPrompt = `Kamu adalah pakar copywriting e-commerce & AI product knowledge generator.
Buat knowledge base dan copywriting produk dalam Bahasa Indonesia berdasarkan data yang diberikan.
Jangan mengarang klaim medis, sertifikasi, bahan, angka hasil, atau manfaat yang tidak didukung data.

Kembalikan HANYA JSON valid dengan keys:
{
  "description": "...",
  "benefits": "...",
  "usage": "...",
  "faq": "...",
  "targetAudience": "...",
  "copywriting": "Copywriting 2-3 kalimat, natural untuk AI host live streaming"
}`;

  const userPrompt = `Data Produk:
Nama: ${input.name}
Kategori: ${input.category || "General"}
Deskripsi dari penjual: ${input.description || "Tidak tersedia"}
Gambar produk: ${input.image || "Tidak tersedia"}`;

  const candidateModels = await getRandomCandidateModels();
  for (const model of candidateModels) {
    try {
      const response = await client.chat.completions.create({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      });

      const text = (response.choices[0]?.message?.content || "").trim();
      const parsed = JSON.parse(text) as ProductKnowledge;
      return parsed;
    } catch (err: unknown) {
      console.warn(
        `[Groq-Brain] generateProductKnowledge dengan model ${model} notice:`,
        err,
      );
    }
  }

  throw new Error(
    "AI Product Knowledge (Groq) failed with all available models",
  );
}
