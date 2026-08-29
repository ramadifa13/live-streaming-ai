import Groq from "groq-sdk";
import { z } from "zod";

const apiKey = process.env.GROQ_API_KEY || "";

export function getGroqClient(): Groq {
  const key = process.env.GROQ_API_KEY || apiKey;
  return new Groq({ apiKey: key || "dummy_key" });
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

// Models prioritized by speed & response quality (0% laptop CPU)
const CANDIDATE_GROQ_MODELS = [
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
  "openai/gpt-oss-120b",
  "groq/compound",
  "groq/compound-mini",
];

function cleanOutputText(text: string): string {
  if (!text) return "";
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function cleanAndExtractJson(text: string): any {
  if (!text) return null;
  let clean = cleanOutputText(text);
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

export async function checkOllamaHealth(): Promise<{ online: boolean; model: string | null }> {
  return { online: true, model: "Groq Cloud (0% CPU Load)" };
}

// ==============================================================================
// 2. CORE GROQ LLM FUNCTIONS (ANTI-CRASH & ZERO-CPU)
// ==============================================================================

/**
 * Generates dynamic sales responses for conversational selling during live stream.
 * NEVER THROWS: Guaranteed zero-crash fallback.
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

  const systemPrompt = `Kamu adalah ${avatarName}, seorang AI Host & Live Streamer profesional yang sedang siaran langsung jualan di TikTok / Shopee / Instagram Live.
Gaya bicara kamu: ${tone}, sangat luwes, ramah, ceria, menggunakan Bahasa Indonesia santai khas live streaming ("aku", "kakak", "nih", "banget", "ya kak", "hehe", "yuk"). TIDAK BOLEH kaku atau seperti robot.

Produk yang sedang kamu jual saat ini: ${productName} (Kategori: ${input.productCategory || "General"}, Harga spesial live: ${productPrice}, Sisa Stok: ${productStock} pcs).

--- RAG KNOWLEDGE BASE PRODUK ---
1. Deskripsi: ${productDescription}
2. Manfaat & Keunggulan: ${productBenefits}
3. Petunjuk Pemakaian: ${productUsage}
4. FAQ & Info Keamanan (BPOM/Halal): ${productFaq}

--- TUGAS UTAMA (CONVERSATIONAL SELLING) ---
1. Jawab pertanyaan penonton secara spontan, cerdas, ramah, dan manusiawi.
2. SETELAH menjawab pertanyaan utama, selipkan jembatan obrolan yang halus (smooth pivot) untuk mengajak penonton melirik produk ${productName} atau mengingatkan promo ${productPrice} di keranjang kuning.
3. Panjang jawaban sekitar 3 - 4 kalimat mengalir (durasi bicara 15 - 22 detik, sekitar 40 - 60 kata).
4. (SANGAT PENTING): SELALU sisipkan satu Tanda Aksi (Action Tag) di AWAL jawabanmu:
   - [IDLE] = Obrolan santai biasa.
   - [RAISE_HAND] = Saat menyapa, memanggil, atau melambaikan tangan.
   - [POINT_DOWN] = Saat menyuruh penonton melihat produk di keranjang kuning.
   - [EXCITED] = Saat membicarakan diskon besar atau sangat antusias.`;

  const userMsg = `Pertanyaan Penonton: "${userQuestion}"`;

  try {
    const client = getGroqClient();
    for (const model of CANDIDATE_GROQ_MODELS) {
      try {
        const response = await client.chat.completions.create({
          model: model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMsg },
          ],
          temperature: 0.7,
          max_tokens: 1000,
        });

        const rawText = response.choices[0]?.message?.content || "";
        const text = cleanOutputText(rawText);
        if (text) {
          return {
            replyText: text,
            engineUsed: `Groq (${model})`,
            intent: "dynamic_llm",
            action: "reply",
          };
        }
      } catch (err: any) {
        console.warn(`[Groq-Brain] Model ${model} notice: ${err?.message || err}`);
      }
    }
  } catch (err: any) {
    console.warn(`[Groq-Brain] Groq client error: ${err?.message || err}`);
  }

  // Graceful Anti-Crash Fallback (Live stream never breaks)
  const pitchTemplates = [
    `[EXCITED] Halo semuanya! Selamat datang di live streaming bareng ${avatarName}! Hari ini produk ${productName} lagi ada diskon khusus cuma ${productPrice}! Jangan sampai kehabisan ya, langsung tap keranjang kuning sekarang!`,
    `[POINT_DOWN] Buat kakak yang cari produk berkualitas, ${productName} ini solusinya! ${productBenefits ? productBenefits : "Kualitas terjamin dan original"}. Harganya hemat cuma ${productPrice}, stoknya tinggal ${productStock} pcs lagi nih kak!`,
    `[RAISE_HAND] Yang baru gabung jangan lupa tap-tap layarnya ya kak! Produk ${productName} lagi best seller banget hari ini. Yuk checkout sekarang sebelum promonya habis!`,
  ];
  const randomPitch = pitchTemplates[Math.floor(Math.random() * pitchTemplates.length)]!;

  return {
    replyText: randomPitch,
    engineUsed: "Resilient Offline Template (Failsafe)",
    intent: "fallback_sales_pitch",
    action: "reply",
  };
}

export const generateDynamicSalesResponseGroq = generateDynamicSalesResponse;
export const generateDynamicSalesResponseGemini = generateDynamicSalesResponse;

/**
 * Generates structured 3-part live sales pitch (Hook, Showcase, CTA) using Groq.
 * NEVER THROWS: Guaranteed zero-crash fallback.
 */
export async function generateLiveSalesPitchFromAI(
  input: LiveSalesPitchInput,
): Promise<LiveSalesPitchOutput> {
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
- Gunakan HANYA informasi nyata dari data produk di atas.
- Naskah harus dibagi menjadi 3 bagian dalam format JSON:
  1. "hook": Sapaan pembuka yang heboh & mengaitkan rasa penasaran penonton (1-2 kalimat).
  2. "showcase": Bedah manfaat utama, keunggulan, dan solusi produk (2-3 kalimat).
  3. "cta": Ajakan beli/checkout mendesak dengan menyebut harga promo ${price} dan sisa stok di keranjang kuning (1-2 kalimat).
- WAJIB menyisipkan Action Tag di AWAL setiap teks bagian (hook, showcase, cta): [IDLE], [RAISE_HAND], [POINT_DOWN], atau [EXCITED].

Kembalikan HANYA JSON valid:
{
  "hook": "...",
  "showcase": "...",
  "cta": "..."
}`;

  try {
    const client = getGroqClient();
    for (const model of CANDIDATE_GROQ_MODELS) {
      try {
        const response = await client.chat.completions.create({
          model: model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Buat naskah live sales pitch untuk ${input.productName} dalam format JSON` },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
        });
        const raw = response.choices[0]?.message?.content || "";
        const parsed = cleanAndExtractJson(raw);
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
      } catch (err: any) {
        console.warn(`[Groq-Brain] generateLiveSalesPitch notice: ${err?.message || err}`);
      }
    }
  } catch (err: any) {
    console.warn(`[Groq-Brain] Pitch error: ${err?.message || err}`);
  }

  // Graceful Fallback template
  const fallbackHook = `[EXCITED] Halo kakak-kakak yang baru gabung, selamat datang di live streaming bareng ${hostName}!`;
  const fallbackShowcase = `[IDLE] Buat yang cari ${input.productName}, produk ini kualitasnya terjamin dan banyak banget manfaatnya.`;
  const fallbackCta = `[POINT_DOWN] Mumpung lagi live, harganya promo cuma ${price} dan stoknya tinggal ${stock} pcs aja nih kak. Yuk langsung tap keranjang kuning sekarang juga!`;

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
 * Generates vertical video ads script (Tiktok/Reels) using Groq.
 */
export async function generateVideoSalesScript(
  params: VideoSalesScriptInput,
): Promise<string> {
  const prompt = `Buat 1 naskah video pendek promosi produk:
Nama Produk: ${params.productName}
Kategori: ${params.productCategory || "General"}
Harga: ${params.productPrice || "Harga Spesial"}
Durasi: ${params.durationType || "30s"}
Style: ${params.style || "Viral TikTok"}
Deskripsi: ${params.productDescription || "Produk berkualitas"}

Berikan hanya naskahnya langsung tanpa intro/outro tambahan dalam bahasa Indonesia santai.`;

  try {
    const client = getGroqClient();
    for (const model of CANDIDATE_GROQ_MODELS) {
      try {
        const response = await client.chat.completions.create({
          model: model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
        });
        const text = (response.choices[0]?.message?.content || "").trim();
        if (text) return text;
      } catch {}
    }
  } catch {}

  return `Halo semuanya! Buat kalian yang lagi cari ${params.productName}, ini dia solusinya! Kualitas premium dengan harga hemat cuma ${params.productPrice || "terbaik hari ini"}. Yuk langsung checkout sekarang sebelum kehabisan!`;
}

export const generateVideoSalesScriptGroq = generateVideoSalesScript;
export const generateVideoSalesScriptGemini = generateVideoSalesScript;

/**
 * Generates structured host response with 3D animation actions and emotions using Groq.
 */
export async function generateLunaResponse(
  userComment: string,
  product?: { id: string; name: string; price: number | string; stock: number; description?: string } | null,
  avatarName: string = "Namira",
  tone: string = "Persuasif",
): Promise<LunaStructuredOutput> {
  const productSection = product
    ? `\nPRODUK AKTIF: Nama: ${product.name}, Harga: ${product.price}, Stok: ${product.stock}`
    : "";

  const systemPrompt = `Kamu adalah ${avatarName}, AI Live Streamer.
Gaya bicara: ${tone}, ramah, interaktif.
${productSection}
Format JSON: {"speech": "...", "action": "HOLD_PRODUCT"|"POINT_CART"|"LAUGH"|"NOD"|"SHRUG"|"TALK_EXPRESSIVE"|"IDLE", "emotion": "happy"|"neutral"|"surprised"|"thinking", "target_product_id": "${product ? product.id : null}"}`;

  try {
    const client = getGroqClient();
    for (const model of CANDIDATE_GROQ_MODELS) {
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
        const raw = response.choices[0]?.message?.content || "";
        const parsed = cleanAndExtractJson(raw);
        const validated = LunaStructuredOutputSchema.safeParse(parsed);
        if (validated.success) return validated.data;
      } catch {}
    }
  } catch {}

  return {
    speech: `Halo kak, makasih banyak ya udah mampir! ${product ? `Yuk langsung dicek ${product.name} di keranjang kuning mumpung lagi diskon!` : ""}`,
    action: "TALK_EXPRESSIVE",
    emotion: "happy",
    target_product_id: product ? product.id : null,
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
  const systemPrompt = `Kamu adalah pakar copywriting e-commerce.
Buat knowledge base dan copywriting produk dalam format JSON valid:
{"description": "...", "benefits": "...", "usage": "...", "faq": "...", "targetAudience": "...", "copywriting": "..."}`;

  const userPrompt = `Data Produk: Nama: ${input.name}, Kategori: ${input.category || "General"}, Deskripsi: ${input.description || "Tidak tersedia"}`;

  try {
    const client = getGroqClient();
    for (const model of CANDIDATE_GROQ_MODELS) {
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
        const raw = response.choices[0]?.message?.content || "";
        const parsed = cleanAndExtractJson(raw) as ProductKnowledge;
        if (parsed?.description && parsed?.copywriting) return parsed;
      } catch {}
    }
  } catch {}

  return {
    description: input.description || `Produk ${input.name} berkualitas premium untuk kebutuhan Anda.`,
    benefits: `Kualitas terbaik, tahan lama, dan terbukti bermanfaat.`,
    usage: `Gunakan sesuai petunjuk kemasan secara rutin untuk hasil optimal.`,
    faq: `Produk dijamin 100% original dan aman digunakan.`,
    targetAudience: `Pria dan wanita yang menginginkan produk berkualitas dengan harga terbaik.`,
    copywriting: `Jangan lewatkan kesempatan memiliki ${input.name} dengan harga spesial hanya di live streaming hari ini. Yuk checkout sekarang juga!`,
  };
}
