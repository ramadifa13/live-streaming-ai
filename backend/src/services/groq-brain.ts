import { z } from "zod";

const DEFAULT_OLLAMA_HOST =
  process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const PREFERRED_OLLAMA_MODELS = [
  "qwen2.5:7b",
  "llama3.2:1b",
  "qwen2.5:3b",
  "llama3.1:8b",
  "mistral:7b",
];

let activeOllamaModel: string | null = null;
let lastOllamaCheck = 0;
let isOllamaOnline = false;

export async function checkOllamaHealth(
  host = DEFAULT_OLLAMA_HOST,
): Promise<{ online: boolean; model: string | null }> {
  const now = Date.now();
  if (isOllamaOnline && activeOllamaModel && now - lastOllamaCheck < 20_000) {
    return { online: true, model: activeOllamaModel };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${host}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      isOllamaOnline = false;
      return { online: false, model: null };
    }

    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const available = (data.models || []).map((m) => m.name);

    if (available.length === 0) {
      isOllamaOnline = false;
      return { online: false, model: null };
    }

    let selectedModel = available[0]!;
    for (const pref of PREFERRED_OLLAMA_MODELS) {
      const found = available.find(
        (m) => m === pref || m.startsWith(`${pref}:`) || m.includes(pref),
      );
      if (found) {
        selectedModel = found;
        break;
      }
    }

    if (
      process.env.OLLAMA_MODEL &&
      available.includes(process.env.OLLAMA_MODEL)
    ) {
      selectedModel = process.env.OLLAMA_MODEL;
    }

    activeOllamaModel = selectedModel;
    isOllamaOnline = true;
    lastOllamaCheck = now;
    return { online: true, model: selectedModel };
  } catch {
    isOllamaOnline = false;
    return { online: false, model: null };
  }
}

export async function callOllamaChat(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: { temperature?: number; format?: "json" } = {},
  host = DEFAULT_OLLAMA_HOST,
): Promise<string> {
  const health = await checkOllamaHealth(host);
  if (!health.online || !health.model) {
    throw new Error("Ollama server is not running or no models found");
  }

  const payload: Record<string, any> = {
    model: health.model,
    messages,
    stream: false,
    options: {
      temperature: options.temperature ?? 0.7,
    },
  };

  if (options.format === "json") {
    payload.format = "json";
  }

  const res = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Ollama chat error (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as { message?: { content?: string } };
  return (json.message?.content || "").trim();
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
    .describe("Jawaban verbal host dalam Bahasa Indonesia santai untuk TTS"),
  action: LunaActionEnum.describe("Aksi fisik 3D/gesture avatar"),
  emotion: LunaEmotionEnum.describe("Ekspresi wajah avatar"),
  target_product_id: z
    .string()
    .nullable()
    .describe("ID produk jika sedang memegang/mempromosikan produk"),
});
export type LunaStructuredOutput = z.infer<typeof LunaStructuredOutputSchema>;

function cleanAndExtractJson(text: string): any {
  if (!text) return null;
  let clean = text.trim();
  clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const firstBrace = clean.indexOf("{");
  const lastBrace = clean.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.substring(firstBrace, lastBrace + 1);
  }
  try {
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

// ==============================================================================
// 2. CORE OLLAMA LLM FUNCTIONS (100% FREE & UNLIMITED)
// ==============================================================================

/**
 * Generates dynamic sales responses for conversational selling during live stream.
 */
export async function generateDynamicSalesResponse(
  input: SalesBrainInput,
): Promise<SalesBrainOutput> {
  const {
    userQuestion,
    avatarName = "Namira",
    tone = "Persuasif",
    productName = "Produk",
    productPrice = "Harga Spesial",
    productDescription = "Deskripsi produk",
    productBenefits = "Banyak manfaat dan keunggulan",
    productUsage = "Mudah digunakan",
    productFaq = "Terjamin kualitasnya",
    productStock = 50,
  } = input;

  const systemPrompt = `Kamu adalah ${avatarName}, seorang AI Host & Live Streamer profesional.
Gaya bicara kamu: ${tone}, sangat luwes, ramah, ceria, menggunakan Bahasa Indonesia santai ("aku", "kakak", "nih", "banget", "yuk").

Produk: ${productName} (Harga: ${productPrice}, Stok: ${productStock}).

--- RAG KNOWLEDGE BASE PRODUK ---
1. Deskripsi: ${productDescription}
2. Manfaat & Keunggulan: ${productBenefits}
3. Petunjuk Pemakaian: ${productUsage}
4. FAQ & Info Keamanan (BPOM/Halal): ${productFaq}

--- TUGAS UTAMA (CONVERSATIONAL SELLING) ---
1. Jawab pertanyaan penonton secara spontan, cerdas, ramah, dan manusiawi.
2. SETELAH menjawab, selipkan jembatan halus untuk mengajak penonton melirik produk ${productName} atau promo ${productPrice} di keranjang kuning.
3. Panjang jawaban 3 - 4 kalimat mengalir.
4. (SANGAT PENTING): SELALU sisipkan Tanda Aksi (Action Tag) di AWAL:
   - [IDLE], [RAISE_HAND], [POINT_DOWN], [EXCITED].`;

  const userMsg = `Pertanyaan Penonton: "${userQuestion}"`;

  try {
    const ollama = await checkOllamaHealth();
    if (ollama.online && ollama.model) {
      const text = await callOllamaChat([
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
      ]);
      if (text.trim()) {
        return {
          replyText: text.trim(),
          engineUsed: `Ollama (${ollama.model})`,
          intent: "dynamic_llm",
          action: "reply",
        };
      }
    }
  } catch (ollamaErr) {
    console.warn(`[Ollama-Brain] Ollama error:`, (ollamaErr as Error).message);
  }

  const pitchTemplates = [
    `Halo semuanya! Selamat datang di live streaming aku bareng ${avatarName}! Hari ini spesial banget karena produk ${productName} lagi ada diskon khusus cuma ${productPrice}! Jangan sampai kehabisan ya, langsung tap keranjang kuning sekarang!`,
    `Buat kakak yang lagi cari produk berkualitas, ${productName} ini solusinya banget! ${productBenefits ? productBenefits : "Kualitas premium dan sudah terbukti"}. Harganya lagi hemat cuma ${productPrice}, stoknya tinggal ${productStock} pcs lagi nih kak!`,
  ];
  const randomPitch = pitchTemplates[Math.floor(Math.random() * pitchTemplates.length)];

  return {
    replyText: randomPitch,
    engineUsed: "Resilient Offline Template (Ollama Offline)",
    intent: "fallback_sales_pitch",
    action: "reply",
  };
}

export const generateDynamicSalesResponseGroq = generateDynamicSalesResponse;
export const generateDynamicSalesResponseGemini = generateDynamicSalesResponse;

/**
 * Generates structured 3-part live sales pitch (Hook, Showcase, CTA) using Ollama.
 */
export async function generateLiveSalesPitchFromAI(
  input: LiveSalesPitchInput,
): Promise<LiveSalesPitchOutput> {
  const hostName = input.avatarName || "Namira";
  const tone = input.tone || "Persuasif";
  const category = input.productCategory || input.category || "General";
  const price = input.productPrice || "Harga Spesial";
  const stock = input.productStock ?? 50;

  const systemPrompt = `Kamu adalah ${hostName}, seorang Top Live Host & Streamer profesional.
Buat naskah live sales pitch dalam Bahasa Indonesia yang sangat natural, santai, dan memikat.

DATA PRODUK:
- Nama: ${input.productName}
- Harga: ${price}
- Stok: ${stock}
- Deskripsi: ${input.productDescription || "Tidak ada deskripsi"}

ATURAN WAJIB:
- Format JSON: {"hook": "...", "showcase": "...", "cta": "..."}
- Gunakan Action Tag [IDLE], [RAISE_HAND], [POINT_DOWN], atau [EXCITED] di AWAL setiap bagian.`;

  try {
    const ollama = await checkOllamaHealth();
    if (ollama.online && ollama.model) {
      const text = await callOllamaChat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Buat naskah live sales pitch untuk ${input.productName} dalam format JSON` },
        ],
        { format: "json" },
      );
      const parsed = cleanAndExtractJson(text);
      if (parsed?.hook && parsed?.showcase && parsed?.cta) {
        return {
          productName: input.productName,
          price,
          stock,
          category,
          avatarName: hostName,
          tone,
          hook: String(parsed.hook),
          showcase: String(parsed.showcase),
          cta: String(parsed.cta),
          fullScript: `${parsed.hook}\n\n${parsed.showcase}\n\n${parsed.cta}`,
        };
      }
    }
  } catch (ollamaErr) {
    console.warn(`[Ollama-Brain] Ollama pitch error:`, (ollamaErr as Error).message);
  }

  const fallbackHook = `[EXCITED] Halo kakak-kakak yang baru gabung, selamat datang di live streaming bareng ${hostName}!`;
  const fallbackShowcase = `[IDLE] Buat yang cari ${input.productName}, produk ini kualitasnya terjamin dan banyak banget manfaatnya.`;
  const fallbackCta = `[POINT_DOWN] Mumpung lagi live, harganya promo cuma ${price} dan stoknya tinggal ${stock} pcs aja nih kak. Yuk checkout sekarang!`;

  return {
    productName: input.productName,
    price,
    stock,
    category,
    avatarName: hostName,
    tone,
    hook: fallbackHook,
    showcase: fallbackShowcase,
    cta: fallbackCta,
    fullScript: `${fallbackHook}\n\n${fallbackShowcase}\n\n${fallbackCta}`,
  };
}

export const generateLiveSalesPitchFromAIGroq = generateLiveSalesPitchFromAI;
export const generateLiveSalesPitchFromAIGemini = generateLiveSalesPitchFromAI;

/**
 * Generates vertical video ads script (Tiktok/Reels) using Ollama.
 */
export async function generateVideoSalesScript(
  params: VideoSalesScriptInput,
): Promise<string> {
  const prompt = `Buat 1 naskah video pendek (Tiktok/Reels) untuk produk ${params.productName}. Harga: ${params.productPrice}. Gaya: ${params.style || "Viral"}.`;

  try {
    const ollama = await checkOllamaHealth();
    if (ollama.online && ollama.model) {
      const text = await callOllamaChat([{ role: "user", content: prompt }]);
      if (text.trim()) return text.trim();
    }
  } catch (ollamaErr) {
    console.warn(`[Ollama-Brain] Ollama video script error:`, (ollamaErr as Error).message);
  }

  return `Halo semuanya! Buat kalian yang lagi cari ${params.productName}, ini dia solusinya! Kualitas premium dengan harga hemat cuma ${params.productPrice}. Yuk langsung tap keranjang kuning sekarang!`;
}

export const generateVideoSalesScriptGroq = generateVideoSalesScript;
export const generateVideoSalesScriptGemini = generateVideoSalesScript;

/**
 * Generates structured host response with 3D animation actions and emotions using Ollama.
 */
export async function generateLunaResponse(
  userComment: string,
  product?: { id: string; name: string; price: number | string; stock: number; description?: string } | null,
  avatarName: string = "Namira",
  tone: string = "Persuasif",
): Promise<LunaStructuredOutput> {
  const systemPrompt = `Kamu adalah ${avatarName}, AI Live Streamer.
Format JSON: {"speech": "...", "action": "...", "emotion": "...", "target_product_id": "..."}`;

  try {
    const ollama = await checkOllamaHealth();
    if (ollama.online && ollama.model) {
      const text = await callOllamaChat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Komentar: "${userComment}"` },
        ],
        { format: "json" },
      );
      const parsed = cleanAndExtractJson(text);
      const validated = LunaStructuredOutputSchema.safeParse(parsed);
      if (validated.success) return validated.data;
    }
  } catch (ollamaErr) {
    console.warn(`[Ollama-Brain] Ollama comment reply error:`, (ollamaErr as Error).message);
  }

  return {
    speech: `Halo kak, makasih banyak ya udah mampir! ${product ? `Yuk cek ${product.name} di keranjang kuning!` : ""}`,
    action: "TALK_EXPRESSIVE",
    emotion: "happy",
    target_product_id: product ? product.id : null,
  };
}

export const generateLunaResponseGroq = generateLunaResponse;

/**
 * Generates product knowledge base and copywriting from product info using Ollama.
 */
export async function generateProductKnowledge(input: {
  name: string;
  description?: string;
  category?: string;
  image?: string;
}): Promise<ProductKnowledge> {
  const systemPrompt = `Buat knowledge base dan copywriting produk. Format JSON: {"description": "...", "benefits": "...", "usage": "...", "faq": "...", "targetAudience": "...", "copywriting": "..."}`;

  try {
    const ollama = await checkOllamaHealth();
    if (ollama.online && ollama.model) {
      const text = await callOllamaChat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Nama: ${input.name}, Deskripsi: ${input.description}` },
        ],
        { format: "json" },
      );
      const parsed = cleanAndExtractJson(text) as ProductKnowledge;
      if (parsed?.description) return parsed;
    }
  } catch (ollamaErr) {
    console.warn(`[Ollama-Brain] Ollama RAG error:`, (ollamaErr as Error).message);
  }

  return {
    description: `Produk ${input.name} berkualitas premium.`,
    benefits: `Kualitas terbaik dan terbukti bermanfaat.`,
    usage: `Gunakan sesuai petunjuk.`,
    faq: `Produk original dan aman.`,
    targetAudience: `Umum.`,
    copywriting: `Yuk checkout ${input.name} sekarang!`,
  };
}
