import { z } from "zod";


// ==============================================================================
// 1. ZOD SCHEMA: STRUCTURED LUNA OUTPUT
// ==============================================================================
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
  speech: z.string().describe("Jawaban verbal Luna dalam Bahasa Indonesia santai untuk TTS"),
  action: LunaActionEnum.describe("Aksi fisik 3D/gesture avatar"),
  emotion: LunaEmotionEnum.describe("Ekspresi wajah avatar"),
  target_product_id: z.string().nullable().describe("ID produk jika sedang memegang/mempromosikan produk"),
});

export type LunaStructuredOutput = z.infer<typeof LunaStructuredOutputSchema>;

// ==============================================================================
// 2. PERSONA HOST SYSTEM PROMPT
// ==============================================================================
export function buildLunaSystemPrompt(
  productContext?: {
    id: string;
    name: string;
    price: number;
    stock: number;
    description?: string;
  } | null,
  avatarName: string = "Namira",
  tone: string = "Persuasif"
): string {
  const productSection = productContext
    ? `\nPRODUK AKTIF DI KERANJANG KUNING:
- ID: ${productContext.id}
- Nama: ${productContext.name}
- Harga Promo Live: Rp${productContext.price.toLocaleString("id-ID")}
- Sisa Stok: ${productContext.stock} pcs
- Manfaat/Deskripsi: ${productContext.description || "Formula premium teruji klinis"}`
    : "\n(Belum ada produk spesifik yang disematkan di keranjang kuning)";

  return `Kamu adalah ${avatarName.toUpperCase()}, AI Live Streamer Host profesional paling populer di Indonesia.
Sifat & Persona ${avatarName}:
- Gaya siaran: ${tone} (Gaya bahasa luwes, interaktif, percaya diri, dan ramah khas live streaming Indonesia).
- Menggunakan bahasa gaul live streaming yang santai, luwes, dan akrab ("aku", "kakak", "banget", "nih", "ya kak", "hehe", "yuk").
- SANGAT INTERAKTIF: Apapun pertanyaan penonton (baik tentang produk, sapaan, curhat, lelucon, atau pertanyaan di luar topik), kamu WAJIB menjawab dengan nyambung, pintar, dan menghibur.
- KEMAMPUAN SMOOTH PIVOT: Setelah merespon obrolan santai, selipkan jembatan halus yang mengajak penonton melirik promo produk atau keranjang kuning.
${productSection}

PANDUAN AKSI & GESTURE (action):
- "HOLD_PRODUCT": Gunakan saat menjelaskan keunggulan, tekstur, atau detail produk aktif (tangan akan memegang produk 3D).
- "POINT_CART": Gunakan saat mengingatkan diskon, promo harga, sisa stok, atau mengajak checkout keranjang kuning.
- "LAUGH": Gunakan saat penonton melontarkan lelucon, gombalan, atau candaan lucu.
- "NOD": Gunakan saat menyetujui, memberi konfirmasi, atau mengiyakan pertanyaan penonton (misal: "Bisa COD?", "Aman untuk kulit sensitif?").
- "SHRUG": Gunakan saat pertanyaan ambigu, santai, atau bercanda ringan.
- "TALK_EXPRESSIVE": Gunakan saat menyapa, bercerita, atau menjawab obrolan umum.
- "IDLE": Default saat jeda singkat.

ATURAN OUTPUT:
Kamu WAJIB mengembalikan output HANYA dalam format JSON valid sesuai schema berikut:
{
  "speech": "Jawaban verbal ${avatarName} maksimal 2-3 kalimat",
  "action": "HOLD_PRODUCT" | "POINT_CART" | "LAUGH" | "NOD" | "SHRUG" | "TALK_EXPRESSIVE" | "IDLE",
  "emotion": "happy" | "neutral" | "surprised" | "thinking",
  "target_product_id": "${productContext ? productContext.id : "null"}" atau null
}`;
}

// ==============================================================================
// 3. OPENAI-COMPATIBLE LLM ENGINE (Supports Ollama, DeepSeek, vLLM, Groq, OpenAI)
// ==============================================================================
export async function generateLunaResponse(
  userComment: string,
  product?: any,
  avatarName: string = "Namira",
  tone: string = "Persuasif"
): Promise<LunaStructuredOutput> {

  const systemPrompt = buildLunaSystemPrompt(product ? {
    id: product.id,
    name: product.name,
    price: product.price,
    stock: product.stock,
    description: product.description || undefined,
  } : null, avatarName, tone);

  // 2. Resolve OpenAI-compatible LLM endpoint
  // Works with: Ollama (http://localhost:11434/v1), vLLM, DeepSeek (https://api.deepseek.com/v1), Groq, OpenAI
  const llmBaseUrl =
    process.env.LLM_BASE_URL ||
    (process.env.DEEPSEEK_API_KEY ? "https://api.deepseek.com/v1" : null) ||
    (process.env.OPENAI_API_KEY ? "https://api.openai.com/v1" : null) ||
    "http://localhost:11434/v1";

  const llmApiKey =
    process.env.LLM_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "ollama";

  const llmModel =
    process.env.LLM_MODEL ||
    (process.env.DEEPSEEK_API_KEY ? "deepseek-chat" : null) ||
    (process.env.OPENAI_API_KEY ? "gpt-4o-mini" : null) ||
    "qwen2.5:7b";

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5s timeout

    const res = await fetch(`${llmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${llmApiKey}`,
      },
      body: JSON.stringify({
        model: llmModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userComment },
        ],
        temperature: 0.7,
        max_tokens: 250,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const rawText = data?.choices?.[0]?.message?.content;
      if (rawText) {
        const parsed = JSON.parse(rawText);
        const validated = LunaStructuredOutputSchema.safeParse(parsed);
        if (validated.success) {
          return validated.data;
        }
      }
    }
  } catch (err) {
    // Graceful fallback to rule-based engine on LLM error/timeout
  }

  // 3. Fallback: Ultra-fast local rule-based intent engine
  return generateLocalRuleBasedLunaResponse(userComment, product, avatarName, tone);
}

// ==============================================================================
// 4. RULE-BASED FAST FALLBACK INTENT ENGINE
// ==============================================================================
function generateLocalRuleBasedLunaResponse(
  comment: string,
  product?: { id?: string | null; name?: string | null; price?: number | string | null; category?: string | null; description?: string | null } | null,
  avatarName: string = "Namira",
  _tone: string = "Persuasif"
): LunaStructuredOutput {
  const q = comment.toLowerCase();
  const prodName = product?.name || "produk viral kita";
  const prodPrice = product?.price ? `Rp${product.price.toLocaleString("id-ID")}` : "harga promo";
  const prodId = product?.id || null;

  // Lelucon / Gombalan / Candaan
  if (/lucu|jodoh|pacar|cantik|cakep|ganteng|nikah|gombal|manis|kangen|sayang|love/i.test(q)) {
    return {
      speech: `Aduh kakak bisa aja bikin ${avatarName} salting! Hehe terima kasih yaa. Tapi yang bikin makin glowing dan percaya diri itu ${prodName} nih kak, wajib checkout ya!`,
      action: "LAUGH",
      emotion: "happy",
      target_product_id: prodId,
    };
  }

  // Tanya Harga / Promo / Diskon / Voucher
  if (/harga|berapa|price|promo|diskon|voucher|murah|ongkir|potongan/i.test(q)) {
    return {
      speech: `Khusus sesi live ${avatarName} saat ini, ${prodName} harganya cuma ${prodPrice} aja kak plus gratis ongkir! Yuk langsung checkout di keranjang kuning sekarang!`,
      action: "POINT_CART",
      emotion: "happy",
      target_product_id: prodId,
    };
  }

  // Tanya COD / Pengiriman / Keaslian / Garansi
  if (/cod|bayar di tempat|asli|ori|original|bpom|aman|nyampe|garansi/i.test(q)) {
    return {
      speech: `Bisa COD (Bayar di Tempat) ke seluruh Indonesia ya kak, dan produk ini 100% original resmi BPOM! Kakak bayar pas barang sampai dengan aman.`,
      action: "NOD",
      emotion: "happy",
      target_product_id: prodId,
    };
  }

  // Tanya Detail / Khasiat / Kulit / Penggunaan
  if (/kulit|jerawat|kering|berminyak|sensitif|manfaat|khasiat|cara|pakai|bagus/i.test(q)) {
    return {
      speech: `Nah untuk ${prodName} ini formulanya super ringan, cepat meresap, dan sudah teruji aman untuk merawat kulit tetap sehat dan cerah sepanjang hari kak!`,
      action: "HOLD_PRODUCT",
      emotion: "happy",
      target_product_id: prodId,
    };
  }

  // Sapaan / Halo / Hadir
  if (/halo|hai|pagi|siang|sore|malam|ass|hadir|tes|absen/i.test(q)) {
    return {
      speech: `Halo juga kakak! Selamat bergabung di live streaming ${avatarName} yaa. Senang banget kakak mampir hari ini. Mau tanya-tanya tentang ${prodName} yang lagi promo?`,
      action: "TALK_EXPRESSIVE",
      emotion: "happy",
      target_product_id: prodId,
    };
  }

  // Default General Chat
  return {
    speech: `Wah pertanyaan menarik nih kak! Ngomong-ngomong, mumpung stok promo ${prodName} masih aktif di harga ${prodPrice}, jangan sampai kehabisan diskonnya ya kak!`,
    action: "TALK_EXPRESSIVE",
    emotion: "happy",
    target_product_id: prodId,
  };
}
