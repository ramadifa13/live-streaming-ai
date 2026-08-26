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
  "speech": "Jawaban verbal ${avatarName} MAKSIMAL 1 KALIMAT PENDEK saja (sangat penting agar latensi video cepat)",
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
  // Works with: Ollama (http://localhost:11434/v1), vLLM, DeepSeek (https://api.deepseek.com/v1), Groq, OpenAI, OpenRouter
  const llmBaseUrl =
    process.env.LLM_BASE_URL ||
    (process.env.OPENROUTER_API_KEY ? "https://openrouter.ai/api/v1" : null) ||
    (process.env.DEEPSEEK_API_KEY ? "https://api.deepseek.com/v1" : null) ||
    (process.env.OPENAI_API_KEY ? "https://api.openai.com/v1" : null) ||
    "http://localhost:11434/v1";

  const llmApiKey =
    process.env.LLM_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "ollama";

  const llmModel =
    process.env.LLM_MODEL ||
    (process.env.OPENROUTER_API_KEY ? "openai/gpt-4o-mini" : null) ||
    (process.env.DEEPSEEK_API_KEY ? "deepseek-chat" : null) ||
    (process.env.OPENAI_API_KEY ? "gpt-4o-mini" : null) ||
    "qwen2.5:7b";

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for cloud LLM

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
  } catch (err: any) {
    throw new Error(`AI Host Brain is offline / unreachable (${err?.message || "LLM error"}). Pastikan Ollama atau Cloud LLM API aktif.`);
  }

  throw new Error("AI Host Brain failed to produce valid response. Pastikan Ollama atau Cloud LLM API aktif.");
}
