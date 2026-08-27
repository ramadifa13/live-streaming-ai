/**
 * Autonomous LLM Sales Brain Service
 * Generates natural, dynamic, non-stiff responses using real LLM (Ollama / OpenAI / Neural Engine).
 * Capable of answering any random/personal questions and smoothly pivoting to product sales.
 */

import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });
const MODEL_NAME = "gemini-3.6-flash";

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
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const parsed = JSON.parse(response.text || "") as Partial<ProductKnowledge>;
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
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    return parseResult(response.text || "");
  } catch (err) {
    console.warn("[LLM-Brain] generateVideoSalesScript failed:", err);
    throw new Error("AI video script generator is unavailable");
  }
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
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing.");
  }

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
- WAJIB menyisipkan Action Tag di AWAL setiap teks bagian (hook, showcase, cta). Pilih: [IDLE], [RAISE_HAND], [POINT_DOWN], atau [EXCITED]. (contoh: "[RAISE_HAND] Halo semua!").

Kembalikan HANYA JSON valid tanpa teks pengantar:
{
  "hook": "...",
  "showcase": "...",
  "cta": "..."
}`;

  try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        }
      });

      let text = response.text || "";

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

  } catch (err) {
    console.warn("[LLM-Brain] generateLiveSalesPitchFromAI failed:", err);
    throw new Error("AI Sales Script Generator (Gemini) is offline.");
  }
}

export async function generateDynamicSalesResponse(
  input: SalesBrainInput,
): Promise<SalesBrainOutput> {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in .env for Free Tier RAG.");
  }

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
4. (SANGAT PENTING): Kamu harus SELALU menyisipkan satu Tanda Aksi (Action Tag) di AWAL jawabanmu untuk mengendalikan gerakan video AI. Pilih salah satu tag berikut sesuai konteks pembicaraan:
   - [IDLE] = Obrolan santai biasa.
   - [RAISE_HAND] = Saat menyapa, memanggil, atau melambaikan tangan ("Halo!", "Hai kak!").
   - [POINT_DOWN] = Saat menyuruh penonton melihat produk di keranjang kuning ("Cek keranjang kuning di bawah!").
   - [EXCITED] = Saat membicarakan diskon besar atau sangat antusias.

--- CONTOH DIALOG (FEW-SHOT PROMPTING) ---
Penonton: "Kaka lagi apa?"
Kamu: "[IDLE] Aku lagi seru-seruan nemenin kakak-kakak manis di live streaming nih! Eh ngomong-ngomong, produk ${productName} kita lagi diskon spesial ${productPrice} lho, yuk dicek keranjang kuningnya!"

Penonton: "Kamu namanya siapa?"
Kamu: "[RAISE_HAND] Kenalin, aku ${avatarName}, host andalan kakak hari ini! Sambil kita kenalan, kakak udah amankan ${productName} belum nih mumpung stok tinggal ${productStock} pcs?"

Penonton: "Gimana cara belinya?"
Kamu: "[POINT_DOWN] Gampang banget kak! Langsung aja klik ikon keranjang kuning di pojok kiri bawah ya, checkout sekarang mumpung harganya cuma ${productPrice}!"

Penonton: "Kenapa musti beli disini?"
Kamu: "[EXCITED] Karena di live aku ini diskonnya paling gila-gilaan kak! ${productName} ini dijamin 100% ori, dan kakak bisa dapat harga ${productPrice} cuma di keranjang kuning sekarang juga."

Pertanyaan Penonton yang baru: "${userQuestion}"`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: systemPrompt,
    });

    const text = response.text || "";
    return {
      replyText: text.trim(),
      engineUsed: `Gemini Flash 1.5`,
      intent: "dynamic_llm",
      action: "reply",
    };
  } catch (err) {
    console.warn("[LLM-Brain] generateDynamicSalesResponse failed:", err);
    throw new Error("AI Sales Brain (Gemini) is offline / unreachable.");
  }
}
