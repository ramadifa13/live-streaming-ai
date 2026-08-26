import { GoogleGenerativeAI } from "@google/generative-ai";
import { SalesBrainInput, SalesBrainOutput, LiveSalesPitchInput, LiveSalesPitchOutput } from "./llm-brain.js";

// Initialize Gemini Flash (Free Tier)
// For RAG & Conversational Pivot / Ingestion Produk
const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

export async function generateDynamicSalesResponseGemini(
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

Penonton: "Kaka lagi apa?"
Kamu: "Aku lagi seru-seruan nemenin kakak-kakak manis di live streaming nih! Eh ngomong-ngomong, produk ${productName} kita lagi diskon spesial ${productPrice} lho, yuk dicek keranjang kuningnya!"

Penonton: "Kamu namanya siapa?"
Kamu: "Kenalin, aku ${avatarName}, host andalan kakak hari ini! Sambil kita kenalan, kakak udah amankan ${productName} belum nih mumpung stok tinggal ${productStock} pcs?"

Penonton: "Kenapa musti beli disini?"
Kamu: "Karena di live aku ini diskonnya paling gila-gilaan kak! ${productName} ini dijamin 100% ori, dan kakak bisa dapat harga ${productPrice} cuma di keranjang kuning sekarang juga."

Pertanyaan Penonton yang baru: "${userQuestion}"`;

  try {
    const result = await model.generateContent(systemPrompt);
    const text = result.response.text();
    return {
      replyText: text.trim(),
      engineUsed: `Gemini Flash 1.5`,
      intent: "dynamic_llm",
      action: "reply",
    };
  } catch (err) {
    console.warn("[Gemini-Brain] generateDynamicSalesResponse failed:", err);
    throw new Error("AI Sales Brain (Gemini) is offline / unreachable.");
  }
}

export async function generateLiveSalesPitchFromAIGemini(
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
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
           responseMimeType: "application/json",
        }
      });
      const text = result.response.text();

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
    console.warn("[Gemini-Brain] generateLiveSalesPitchFromAIGemini failed:", err);
    throw new Error("AI Sales Script Generator (Gemini) is offline.");
  }
}

export async function generateVideoSalesScriptGemini(params: any): Promise<string> {
    if(!apiKey){
        throw new Error("GEMINI_API_KEY is missing");
    }
    const prompt = `Buat 1 naskah video pendek (Tiktok/Reels) untuk promosi produk:
Nama Produk: ${params.productName}
Kategori: ${params.productCategory}
Harga: ${params.productPrice}
Durasi: ${params.durationType}
Style: ${params.style}
Deskripsi: ${params.productDescription}

Berikan hanya naskahnya langsung tanpa intro/outro tambahan, dalam bahasa Indonesia yang memikat.`;

    try {
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (e) {
        throw new Error("AI Video Script Generator (Gemini) failed: " + String(e));
    }
}
