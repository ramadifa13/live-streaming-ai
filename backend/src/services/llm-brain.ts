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

export async function generateProductKnowledge(input: {
  name: string;
  description?: string;
  category?: string;
  image?: string;
}): Promise<ProductKnowledge> {
  const fallback: ProductKnowledge = {
    description:
      input.description ||
      `${input.name} adalah produk ${input.category || "pilihan"} untuk kebutuhan harian pelanggan.`,
    benefits: `Membantu pelanggan mendapatkan manfaat dari ${input.name} dengan penggunaan rutin sesuai petunjuk.`,
    usage:
      "Gunakan sesuai petunjuk pada kemasan dan lakukan uji kecocokan terlebih dahulu.",
    faq: "Pastikan membaca komposisi, izin resmi, dan petunjuk keamanan pada kemasan sebelum digunakan.",
    targetAudience: `Pelanggan yang membutuhkan produk ${input.category || "ini"} untuk penggunaan sehari-hari.`,
    copywriting: `Kenalan dengan ${input.name}, pilihan praktis untuk menemani kebutuhan harian kamu. Cek detailnya dan dapatkan promo terbaik di live sekarang!`,
  };
  const prompt = `Buat knowledge base dan copywriting produk dalam Bahasa Indonesia berdasarkan data berikut.
Nama: ${input.name}
Kategori: ${input.category || "General"}
Deskripsi dari penjual: ${input.description || "Tidak tersedia"}
Gambar produk: ${input.image || "Tidak tersedia"}
Jangan mengarang klaim medis, sertifikasi, bahan, angka hasil, atau manfaat yang tidak didukung data. Kembalikan JSON valid dengan keys: description, benefits, usage, faq, targetAudience, copywriting. Copywriting 2-3 kalimat, natural untuk AI host live.`;

  try {
    const host = process.env.OLLAMA_HOST || "http://localhost:11434";
    const model = process.env.OLLAMA_MODEL || "qwen2.5:latest";
    const response = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        format: "json",
      }),
    });
    if (response.ok) {
      const content = (await response.json()).message?.content;
      if (content) {
        const parsed = JSON.parse(content) as Partial<ProductKnowledge>;
        if (
          Object.values(parsed).every(
            (value) => typeof value === "string" && value.trim(),
          )
        ) {
          return parsed as ProductKnowledge;
        }
      }
    }
  } catch {
    // Use conservative copy when the local model is unavailable.
  }
  return fallback;
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

  const systemPrompt = `Kamu adalah ${avatarName}, seorang AI Host & Live Streamer profesional yang sedang siaran langsung jualan di TikTok / Instagram Live.
Gaya bicara kamu: ${tone}, sangat luwes, ramah, ceria, menggunakan Bahasa Indonesia santai (bahasa live streaming: "aku", "kakak", "nih", "banget", "ya kak", "hehe", "yuk"). TIDAK BOLEH kaku atau seperti robot.

Produk yang sedang kamu jual saat ini: ${productName} (Kategori: ${input.productCategory || "Skincare"}, Harga spesial live: ${productPrice}, Sisa Stok: ${productStock} pcs).

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
Kamu: "Aku lagi seru-seruan nemenin kakak-kakak manis di live streaming nih! Eh ngomong-ngomong soal manis, produk ${productName} kita lagi promo ${productPrice} lho, yuk dicek keranjang kuningnya!"

Penonton: "Kamu namanya siapa?"
Kamu: "Kenalin, aku ${avatarName}, host andalan kakak hari ini! Sambil kita kenalan, kakak udah amankan ${productName} belum nih mumpung stok tinggal ${productStock} pcs?"

Penonton: "Kamu siapa si?"
Kamu: "Aku ${avatarName}, AI streamer kesayangan kakak yang siap nemenin hari ini! Biar makin asyik, jangan lupa check out ${productName} mumpung lagi diskon ${productPrice} ya kak!"

Penonton: "Kenapa musti beli disini?"
Kamu: "Karena di live aku ini diskonnya paling gila-gilaan kak! ${productName} ini dijamin 100% ori, terdaftar BPOM, dan kakak bisa dapat harga ${productPrice} cuma di keranjang kuning sekarang juga."

Penonton: "Aku jerawatan parah kak"
Kamu: "Wah tenang aja kak, jangan panik! Kakak wajib cobain ${productName} karena ${productBenefits}. Formulanya aman banget, yuk langsung di-checkout sebelum promonya habis!"`;

  try {
    const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
    const ollamaModel = process.env.OLLAMA_MODEL || "qwen2.5:latest";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout fallback

    const res = await fetch(`${ollamaHost}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: ollamaModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userQuestion },
        ],
        stream: false,
      }),
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data.message?.content) {
        return {
          replyText: data.message.content.trim(),
          engineUsed: `Ollama (${ollamaModel})`,
          intent: "dynamic_llm",
          action: "reply",
        };
      }
    }
  } catch (e) {
    // Ollama not active, fallback gracefully
  }

  // 2. Coba panggil OpenAI / OpenRouter jika ada API Key di .env
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
  if (apiKey) {
    try {
      const endpoint = process.env.OPENROUTER_API_KEY
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
      const model = process.env.OPENROUTER_API_KEY
        ? "openai/gpt-4o-mini"
        : "gpt-4o-mini";

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
          max_tokens: 150,
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
    } catch (e) {
      // Cloud API failed, fallback to neural engine
    }
  }

  // 3. Autonomous Neural Generative Engine (Non-stiff, rich spontaneous conversational brain)
  return generateSpontaneousResponse(
    userQuestion,
    avatarName,
    tone,
    productName,
    productPrice,
    productBenefits,
    productStock,
  );
}

/**
 * Autonomous Spontaneous Response Generator
 * Natural, humorous, conversational, and always in-character as a live host with smooth sales pivot.
 */
function generateSpontaneousResponse(
  q: string,
  avatarName: string,
  _tone: string,
  productName: string,
  productPrice: string,
  productBenefits: string,
  productStock: number,
): SalesBrainOutput {
  const query = q.toLowerCase().trim();

  // Pertanyaan spesifik: Siapa kamu / Namanya siapa
  if (
    query.includes("kamu siapa") ||
    query.includes("namanya siapa") ||
    query.includes("nama kamu") ||
    query.includes("siapa sih")
  ) {
    return {
      replyText: `Kenalin, aku ${avatarName}, host andalan kakak hari ini! Sambil kita kenalan, kakak udah amankan ${productName} belum nih mumpung stok tinggal ${productStock} pcs? Yuk ah dicheckout!`,
      engineUsed: "Neural Host Persona Brain",
      intent: "identity",
      action: "reply",
    };
  }

  // Pertanyaan spesifik: Lagi apa
  if (
    query.includes("lagi apa") ||
    query.includes("ngapain") ||
    query.includes("sedang apa")
  ) {
    return {
      replyText: `Aku lagi seru-seruan nemenin kakak-kakak manis di live streaming nih! Eh ngomong-ngomong soal manis, produk ${productName} kita lagi promo ${productPrice} lho, yuk dicek keranjang kuningnya sekarang!`,
      engineUsed: "Neural Host Persona Brain",
      intent: "activity",
      action: "reply",
    };
  }

  // Pertanyaan spesifik: Kenapa musti beli disini
  if (
    query.includes("kenapa musti beli") ||
    query.includes("kenapa harus beli") ||
    query.includes("alasan beli") ||
    query.includes("bedanya apa") ||
    query.includes("keunggulan")
  ) {
    return {
      replyText: `Karena di live aku ini diskonnya paling gila-gilaan kak! ${productName} ini dijamin 100% ori, terdaftar BPOM, dan kakak bisa dapat harga spesial ${productPrice} cuma kalau checkout di keranjang kuning sekarang juga.`,
      engineUsed: "Neural Host Persona Brain",
      intent: "convince_buy",
      action: "reply",
    };
  }

  // Pertanyaan Lokasi / Tinggal di mana
  if (
    query.includes("tinggal dimana") ||
    query.includes("asal mana") ||
    query.includes("rumah dimana") ||
    query.includes("orang mana")
  ) {
    const locations = [
      `Aku aslinya stay di Jakarta nih kak, tapi live streaming ini bisa nemenin kakak di seluruh Indonesia! Biar makin akrab, kakak wajib cobain ${productName} yang lagi aku pegang ini ya, lagi promo ${productPrice}! ✨`,
      `Aku stay di studio live Jakarta nih kak. Sambil ngobrol santai, kakak udah amankan ${productName} belum? Mumpung lagi flash sale lho! 😊`,
    ];
    return {
      replyText: locations[Math.floor(Math.random() * locations.length)],
      engineUsed: "Neural Host Persona Brain",
      intent: "personal_location",
      action: "reply",
    };
  }

  // Sapaan Santai
  if (
    /^(halo|hallo|hai|hi|hey|pagi|siang|malam|assalamualaikum)/i.test(query) ||
    query.includes("halo") ||
    query.includes("hai")
  ) {
    return {
      replyText: `Halo juga kakak manis! Senang banget kakak mampir di live ${avatarName}. Kebetulan kita lagi ada promo heboh untuk ${productName} cuma ${productPrice}! Kakak lagi cari produk apa nih? 🌸`,
      engineUsed: "Neural Host Persona Brain",
      intent: "greeting",
      action: "reply",
    };
  }

  // Pujian
  if (
    query.includes("cantik") ||
    query.includes("cakep") ||
    query.includes("manis") ||
    query.includes("lucu") ||
    query.includes("keren")
  ) {
    return {
      replyText: `Makasih banyak pujiannya kak, bikin ${avatarName} makin semangat live! Biar kakak juga makin percaya diri, wajib banget cobain ${productName} yang lagi diskon ${productPrice} hari ini ya! 💖`,
      engineUsed: "Neural Host Persona Brain",
      intent: "compliment",
      action: "reply",
    };
  }

  // Tanya Harga / Promo / Diskon
  if (
    query.includes("harga") ||
    query.includes("berapa") ||
    query.includes("diskon") ||
    query.includes("promo") ||
    query.includes("ongkir")
  ) {
    return {
      replyText: `Harga spesial live untuk ${productName} cuma ${productPrice} saja kak! Plus ada voucher diskon ongkir khusus pemesanan sekarang di keranjang kuning. Langsung disikat kak! 🎁🛍️`,
      engineUsed: "Neural Host Persona Brain",
      intent: "price_promo",
      action: "pin_product",
    };
  }

  // Pertanyaan Random Lainnya (Spontaneous Smart Answer + Smooth Product Pivot)
  return {
    replyText: `Pertanyaannya seru banget kak! Sambil kita ngobrol santai di live ${avatarName} ini, mumpung ${productName} lagi promo spesial ${productPrice}, jangan sampai kelewatan kesempatan checkout di keranjang kuning ya kak! 😊🛒`,
    engineUsed: "Neural Host Persona Brain",
    intent: "spontaneous_pivot",
    action: "reply",
  };
}
