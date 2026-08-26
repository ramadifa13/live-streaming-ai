/**
 * Autonomous LLM Sales Brain Service
 * Generates natural, dynamic, non-stiff responses using real LLM (Ollama / OpenAI / Neural Engine).
 * Capable of answering any random/personal questions and smoothly pivoting to product sales.
 */

export interface SalesBrainInput {
  userQuestion: string;
  avatarName: string;
  tone: string;
  productName: string;
  productPrice: string;
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

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:latest";
const OLLAMA_TIMEOUT = Number(process.env.OLLAMA_TIMEOUT_MS || "60000");
const OLLAMA_RETRIES = Number(process.env.OLLAMA_RETRIES || "3");
const LLM_PROVIDER = (process.env.LLM_PROVIDER || "auto").toLowerCase();

export async function ollamaChat(
  messages: Array<{ role: string; content: string }>,
  options?: { format?: string; timeoutMs?: number; retries?: number },
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? OLLAMA_TIMEOUT;
  const retries = options?.retries ?? OLLAMA_RETRIES;

  if (LLM_PROVIDER === "openrouter" || LLM_PROVIDER === "openai") {
    throw new Error(`Skipped Ollama because LLM_PROVIDER=${LLM_PROVIDER}`);
  }

  const body = {
    model: OLLAMA_MODEL,
    messages,
    stream: false,
    ...(options?.format ? { format: options.format } : {}),
  };

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Ollama chat failed: ${res.status} ${text}`);
      }

      const data = await res.json();
      const content = data?.message?.content;
      if (typeof content === "string" && content.trim()) {
        return content.trim();
      }

      throw new Error("Ollama returned empty response");
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const message = lastError.message || "";
      const isTimeout = /timeout|timed out|context canceled|aborted/i.test(message);
      const isTransient = /502|503|504|ECONNRESET|ENOTFOUND|ECONNREFUSED/i.test(message);

      if (isTimeout || isTransient) {
        const backoff = 1000 * Math.pow(2, attempt);
        console.warn(
          `[LLM-Brain] Ollama attempt ${attempt + 1} failed (${message}), retrying in ${backoff}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error("Ollama chat failed after retries");
}

export async function generateProductKnowledge(input: {
  name: string;
  description?: string;
  category?: string;
  image?: string;
}): Promise<ProductKnowledge> {
  const prompt = `Buat knowledge base dan copywriting produk dalam Bahasa Indonesia berdasarkan data berikut.
Nama: ${input.name}
Kategori: ${input.category || "General"}
Deskripsi dari penjual: ${input.description || "Tidak tersedia"}
Gambar produk: ${input.image || "Tidak tersedia"}
Jangan mengarang klaim medis, sertifikasi, bahan, angka hasil, atau manfaat yang tidak didukung data. Kembalikan JSON valid dengan keys: description, benefits, usage, faq, targetAudience, copywriting. Copywriting 2-3 kalimat, natural untuk AI host live.`;

  try {
    const content = await ollamaChat(
      [{ role: "user", content: prompt }],
      { format: "json", timeoutMs: Math.max(OLLAMA_TIMEOUT, 45000), retries: 2 },
    );
    const parsed = JSON.parse(content) as Partial<ProductKnowledge>;
    if (
      Object.values(parsed).every(
        (value) => typeof value === "string" && value.trim(),
      )
    ) {
      return parsed as ProductKnowledge;
    }
  } catch (err) {
    console.warn("[LLM-Brain] generateProductKnowledge failed:", err);
  }
  throw new Error("AI product knowledge generator is unavailable");
}

export async function generateVideoSalesScript(input: {
  productName: string;
  productDescription?: string;
  productPrice?: string;
  productCategory?: string;
  durationType?: "15s" | "30s" | "60s";
  style?: string;
}): Promise<{
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
}> {
  const durationType = input.durationType || "30s";
  const durationSeconds = durationType === "15s" ? 15 : durationType === "30s" ? 30 : 60;
  const base = {
    tierName:
      durationType === "15s"
        ? "Short Hook (15 Detik)"
        : durationType === "30s"
          ? "Standard Showcase (30 Detik)"
          : "Deep Review (60 Detik)",
    tierPrice:
      durationType === "15s"
        ? "Rp19.000"
        : durationType === "30s"
          ? "Rp35.000"
          : "Rp59.000",
    estimatedCogs:
      durationType === "15s"
        ? "~Rp200"
        : durationType === "30s"
          ? "~Rp350"
          : "~Rp600",
    hookHeadline: "",
    hook: "",
    problem: "",
    solution: "",
    cta: "",
    fullVoiceover: "",
    badges: ["✨ 100% BPOM Resmi", "⚡ Cepat Meresap", "💧 24H Glowing"],
    durationSeconds,
  };

  const prompt = `Buat naskah iklan video UGC dalam Bahasa Indonesia yang natural, tajam, dan langsung bisa dipakai host live.
Produk: ${input.productName}
Deskripsi produk dari penjual: ${input.productDescription || "Tidak tersedia"}
Kategori: ${input.productCategory || "General"}
Harga promo live: ${input.productPrice || "Harga Spesial"}
Durasi: ${durationType}
Gaya: ${input.style || "Viral TikTok"}

Wajib:
- Gunakan hanya fakta yang ada di deskripsi produk.
- Jangan menambahkan klaim medis, hasil instan, atau sertifikasi yang tidak ada di data.
- Output harus JSON valid dengan keys: hookHeadline, hook, problem, solution, cta, fullVoiceover.
- Hook singkat, problem relevan dengan kategori, solution menjelaskan manfaat dari deskripsi produk, CTA spesifik ke harga dan urgency.
- Tone: persuasif, komersial, natural, tidak kaku.
`;

  const parseResult = (text: string) => {
    const parsed = JSON.parse(text) as Partial<typeof base>;
    const required = [
      parsed.hookHeadline,
      parsed.hook,
      parsed.problem,
      parsed.solution,
      parsed.cta,
      parsed.fullVoiceover,
    ];
    if (required.some((value) => typeof value !== "string" || !value.trim())) {
      throw new Error("AI returned incomplete video script");
    }
    return {
      ...base,
      hookHeadline: parsed.hookHeadline!,
      hook: parsed.hook!,
      problem: parsed.problem!,
      solution: parsed.solution!,
      cta: parsed.cta!,
      fullVoiceover: parsed.fullVoiceover!,
    };
  };

  try {
    const content = await ollamaChat(
      [{ role: "user", content: prompt }],
      { format: "json", timeoutMs: Math.max(OLLAMA_TIMEOUT, 45000), retries: 2 },
    );
    return parseResult(content);
  } catch (err) {
    console.warn("[LLM-Brain] generateVideoSalesScript Ollama failed:", err);
  }

  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
  if (apiKey) {
    try {
      const endpoint = process.env.OPENROUTER_API_KEY
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
      const model = process.env.OPENROUTER_API_KEY ? "openai/gpt-4o-mini" : "gpt-4o-mini";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.8,
          max_tokens: 500,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) return parseResult(text);
      }
    } catch (err) {
      console.warn("[LLM-Brain] generateVideoSalesScript cloud LLM failed:", err);
    }
  }

  throw new Error("AI video script generator is unavailable");
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

export async function generateLiveSalesPitchFromAI(
  input: LiveSalesPitchInput,
): Promise<LiveSalesPitchOutput> {
  const hostName = input.avatarName || "Namira";
  const tone = input.tone || "Persuasif";
  const category = input.productCategory || input.category || "General";
  const price = input.productPrice || "Harga Spesial";
  const stock = input.productStock ?? 50;

  const prompt = `Kamu adalah ${hostName}, seorang Top Live Host & Streamer profesional di Indonesia.
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

Kembalikan HANYA JSON valid tanpa teks pengantar:
{
  "hook": "...",
  "showcase": "...",
  "cta": "..."
}`;

  const parseResult = (text: string): LiveSalesPitchOutput => {
    const parsed = JSON.parse(text) as { hook?: string; showcase?: string; cta?: string };
    if (!parsed.hook || !parsed.showcase || !parsed.cta) {
      throw new Error("AI returned incomplete live sales script format");
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
  };

  // 1. Coba Ollama
  try {
    const content = await ollamaChat(
      [{ role: "user", content: prompt }],
      { format: "json", timeoutMs: Math.max(OLLAMA_TIMEOUT, 45000), retries: 2 },
    );
    return parseResult(content);
  } catch (err) {
    console.warn("[LLM-Brain] generateLiveSalesPitchFromAI Ollama failed:", err);
  }

  // 2. Coba Cloud LLM (OpenAI / OpenRouter)
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
  if (apiKey) {
    try {
      const endpoint = process.env.OPENROUTER_API_KEY
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
      const model = process.env.OPENROUTER_API_KEY ? "openai/gpt-4o-mini" : "gpt-4o-mini";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 600,
          response_format: { type: "json_object" },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) return parseResult(text);
      }
    } catch (err) {
      console.warn("[LLM-Brain] generateLiveSalesPitchFromAI cloud LLM failed:", err);
    }
  }

  throw new Error("AI Sales Script Generator is offline (Ollama/LLM unreachable). Harap aktifkan Ollama atau set OPENAI_API_KEY.");
}

export async function generateDynamicSalesResponse(
  input: SalesBrainInput,
): Promise<SalesBrainOutput> {
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

--- CONTOH DIALOG (FEW-SHOT PROMPTING) ---
Penonton: "Kaka lagi apa?"
Kamu: "Aku lagi seru-seruan nemenin kakak-kakak manis di live streaming nih! Eh ngomong-ngomong, produk ${productName} kita lagi diskon spesial ${productPrice} lho, yuk dicek keranjang kuningnya!"

Penonton: "Kamu namanya siapa?"
Kamu: "Kenalin, aku ${avatarName}, host andalan kakak hari ini! Sambil kita kenalan, kakak udah amankan ${productName} belum nih mumpung stok tinggal ${productStock} pcs?"

Penonton: "Kenapa musti beli disini?"
Kamu: "Karena di live aku ini diskonnya paling gila-gilaan kak! ${productName} ini dijamin 100% ori, dan kakak bisa dapat harga ${productPrice} cuma di keranjang kuning sekarang juga."`;

  // 1. Coba Ollama
  try {
    const content = await ollamaChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userQuestion },
      ],
      { timeoutMs: Math.max(OLLAMA_TIMEOUT, 45000), retries: 2 },
    );
    return {
      replyText: content,
      engineUsed: `Ollama (${OLLAMA_MODEL})`,
      intent: "dynamic_llm",
      action: "reply",
    };
  } catch (err) {
    console.warn("[LLM-Brain] generateDynamicSalesResponse Ollama failed:", err);
  }

  // 2. Coba panggil OpenAI / OpenRouter jika ada API Key di .env
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
  if (apiKey) {
    try {
      const endpoint = process.env.OPENROUTER_API_KEY
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
      const model = process.env.OPENROUTER_API_KEY ? "openai/gpt-4o-mini" : "gpt-4o-mini";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userQuestion },
          ],
          max_tokens: 200,
          temperature: 0.8,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) {
          return {
            replyText: text.trim(),
            engineUsed: `Cloud LLM (${model})`,
            intent: "dynamic_llm",
            action: "reply",
          };
        }
      }
    } catch (err) {
      console.warn("[LLM-Brain] generateDynamicSalesResponse cloud LLM failed:", err);
    }
  }

  // Hard-fail explicitly instead of using fake static template
  throw new Error("AI Sales Brain is offline / unreachable. Pastikan server Ollama (qwen2.5) atau Cloud LLM API aktif.");
}
