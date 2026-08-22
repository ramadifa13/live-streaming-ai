import { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { generateDynamicSalesResponse } from "../services/llm-brain.js";

const salesResponseSchema = z.object({
  productId: z.string().optional(),
  productName: z.string().optional(),
  productPrice: z.string().optional(),
  userQuestion: z.string().min(1),
  tone: z.string().optional().default("Persuasif"),
  avatarName: z.string().optional().default("Luna"),
});

const videoScriptSchema = z.object({
  productName: z.string().min(1),
  productPrice: z.string().optional().default("Rp99.000"),
  productCategory: z.string().optional().default("Skincare"),
  durationType: z.enum(["15s", "30s", "60s"]).default("30s"),
  style: z.string().optional().default("Viral TikTok"),
});

export async function aiBrainRoutes(server: FastifyInstance) {
  // POST /api/ai/sales-response (Autonomous LLM Sales Brain with RAG & Conversational Pivot)
  server.post("/api/ai/sales-response", async (request, reply) => {
    const parsed = salesResponseSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    let {
      productId,
      productName = "Serum Brightening Premium",
      productPrice = "Rp99.000",
      userQuestion,
      tone = "Persuasif",
      avatarName = "Luna",
    } = parsed.data;

    // RAG: Load real product details from database if available
    let productDescription = "";
    let productCategory = "Skincare";
    let productBenefits = "";
    let productUsage = "";
    let productFaq = "";
    let productStock = 50;

    try {
      if (productId) {
        const dbProduct = await prisma.product.findUnique({
          where: { id: productId },
        });
        if (dbProduct) {
          productName = dbProduct.name;
          productPrice = `Rp${dbProduct.price.toLocaleString("id-ID")}`;
          productDescription = dbProduct.description || "";
          productCategory = dbProduct.category || "Skincare";
          productBenefits = dbProduct.benefits || "";
          productUsage = dbProduct.usage || "";
          productFaq = dbProduct.faq || "";
          productStock = dbProduct.stock;
        }
      }
    } catch (e) {
      // Gracefully continue with parameters
    }

    // Call Autonomous LLM Sales Brain with RAG Knowledge
    const aiResult = await generateDynamicSalesResponse({
      userQuestion,
      avatarName,
      tone,
      productName,
      productPrice,
      productDescription,
      productCategory,
      productBenefits,
      productUsage,
      productFaq,
      productStock,
    });

    return {
      success: true,
      data: {
        avatar: avatarName,
        tone,
        intent: aiResult.intent,
        action: aiResult.action,
        engine: aiResult.engineUsed,
        replyText: aiResult.replyText,
        productFeatured: productName,
        timestamp: new Date().toISOString(),
      },
    };
  });

  // POST /api/ai/video-script (Autonomous Commercial Video Ads Generator)
  server.post("/api/ai/video-script", async (request, reply) => {
    const parsed = videoScriptSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const { productName, productPrice, productCategory, durationType, style = "Viral TikTok" } = parsed.data;

    let script = {
      tierName: durationType === "15s" ? "Short Hook (15 Detik)" : durationType === "30s" ? "Standard Showcase (30 Detik)" : "Deep Review (60 Detik)",
      tierPrice: durationType === "15s" ? "Rp19.000" : durationType === "30s" ? "Rp35.000" : "Rp59.000",
      estimatedCogs: durationType === "15s" ? "~Rp200" : durationType === "30s" ? "~Rp350" : "~Rp600",
      hookHeadline: "",
      hook: "",
      problem: "",
      solution: "",
      cta: "",
      fullVoiceover: "",
      badges: ["✨ 100% BPOM Resmi", "⚡ Cepat Meresap", "💧 24H Glowing"],
      durationSeconds: durationType === "15s" ? 15 : durationType === "30s" ? 30 : 60,
    };

    if (durationType === "15s") {
      script.hookHeadline = "⚠️ JANGAN DI-SKIP! RACUN TIKTOK TER-VIRAL!";
      script.hook = `STOP SCROLLING! Wajah kusam dan kering tapi malas perawatan ribet?`;
      script.solution = `Wajib coba ${productName}! Sekali oles langsung bikin glowing dan lembap seketika!`;
      script.cta = `Khusus hari ini diskon jadi ${productPrice}! Klik keranjang kuning sekarang sebelum kehabisan ya!`;
      script.fullVoiceover = `${script.hook} ${script.solution} ${script.cta}`;
    } else if (durationType === "30s") {
      script.hookHeadline = "🔥 RAHASIA KULIT GLOWING TANPA FILTER!";
      script.hook = `Gila sih, pantesan produk ini sold out terus di mana-mana!`;
      script.problem = `Kalian yang punya masalah kulit kusam, belang, atau noda bekas jerawat membandel, kalian wajib tahu ini.`;
      script.solution = `Ini dia ${productName}! Diformulasikan dengan konsentrat premium berstandar BPOM yang efektif mencerahkan tanpa bikin iritasi. Teksturnya super adem dan cepat meresap.`;
      script.cta = `Harga promo flash sale cuma ${productPrice} plus GRATIS ONGKIR seluruh Indonesia! Klik link di keranjang kuning sekarang!`;
      script.fullVoiceover = `${script.hook} ${script.problem} ${script.solution} ${script.cta}`;
    } else {
      script.hookHeadline = "📦 UNBOXING & HONEST REVIEW VIRAL!";
      script.hook = `Banyak banget yang minta honest review tentang produk yang lagi viral ini. Yuk kita bongkar bareng!`;
      script.problem = `Sering kecewa beli produk mahal tapi hasilnya zonk dan lengket di kulit? Aku juga dulu gitu sampai akhirnya nemu holy grail ini.`;
      script.solution = `Kenalin ${productName}. Kandungan nutrisi aktifnya bekerja merawat skin barrier dari dalam. Setelah pemakaian rutin, kulit terasa jauh lebih kenyal, halus, dan cerah alami sepanjang hari.`;
      script.cta = `Garansi 100% original resmi BPOM, promo spesial bundle cuma ${productPrice}. Stok terbatas banget, buruan amankan keranjang kuningmu sekarang!`;
      script.fullVoiceover = `${script.hook} ${script.problem} ${script.solution} ${script.cta}`;
    }

    return {
      success: true,
      data: {
        product: productName,
        category: productCategory,
        format: "MP4 9:16 (Vertical Video Ads)",
        style,
        script,
      },
    };
  });

  // POST /api/ai/live-sales-script (Dynamic RAG Live Stream Sales Script)
  server.post("/api/ai/live-sales-script", async (request) => {
    const body = request.body as {
      productId?: string;
      productName?: string;
      productPrice?: string;
      category?: string;
      avatarName?: string;
      tone?: string;
    };

    let name = body.productName || "Serum Brightening Premium";
    let price = body.productPrice || "Rp99.000";
    let category = body.category || "Skincare";
    let benefits = "Mencerahkan dan melembapkan kulit secara mendalam";
    let usage = "Gunakan 2-3 tetes setiap pagi dan malam hari";
    let faq = "100% Original BPOM resmi & aman untuk ibu hamil/menyusui";
    let stock = 50;

    if (body.productId) {
      try {
        const p = await prisma.product.findUnique({ where: { id: body.productId } });
        if (p) {
          name = p.name;
          price = `Rp${p.price.toLocaleString("id-ID")}`;
          category = p.category || category;
          if (p.benefits) benefits = p.benefits;
          if (p.usage) usage = p.usage;
          if (p.faq) faq = p.faq;
          stock = p.stock;
        }
      } catch {}
    }

    const hostName = body.avatarName || "Luna";
    const tone = body.tone || "Persuasif";

    let hook = `Halo kakak-kakak semuanya! Selamat datang di live streaming ${hostName} hari ini! Kakak yang lagi cari solusi ${category.toLowerCase()} terbaik, pas banget lagi mampir di sini!`;
    let showcase = `Kenalin ini ${name}. Keunggulan utamanya ${benefits}. Cara pakainya sangat mudah: ${usage}. Produk ini sudah teruji ${faq} dan ready stock cuma ${stock} pcs!`;
    let cta = `Khusus di keranjang live saat ini, harganya cuma ${price} plus promo gratis ongkir ke seluruh Indonesia! Klik tombol Beli Sekarang di pojok kiri bawah sebelum kehabisan ya kak!`;

    if (tone === "Energetic") {
      hook = `HALO GUYS! Semangat banget ${hostName} nemenin kalian hari ini! Siapa yang mau racun ${category.toLowerCase()} ter-viral yang bikin glowing seketika? Gaskeun merapat!`;
      showcase = `Ini dia ${name}! ${benefits}. Teksturnya juara banget dan ${faq}. Kualitas premium harga merakyat!`;
      cta = `DISKON SPESIAL LIVE cuma jadi ${price}! Jangan sampai nyesel kehabisan, langsung CHECKOUT sekarang di keranjang kuning ya guys!`;
    } else if (tone === "FOMO") {
      hook = `PERHATIAN KAKAK SEMUANYA! Promo flash sale terbatas cuma berlaku beberapa menit ke depan di sesi live ${hostName}!`;
      showcase = `Stok ${name} kita sisa ${stock} pcs lagi ya kak! ${benefits}. ${faq}.`;
      cta = `VOUCHER DISKON POTONGAN HARGA ${price} TINGGAL HITUNGAN MENIT! Buruan amankan payment sekarang juga sebelum kehabisan kuota diskon!`;
    } else if (tone === "Professional") {
      hook = `Selamat datang para pemirsa yang terhormat. Saya ${hostName}, memandu siaran resmi untuk solusi perawatan ${category}.`;
      showcase = `${name} diformulasikan dengan standar mutu tinggi. ${benefits}. Teruji secara klinis dengan sertifikasi resmi: ${faq}.`;
      cta = `Penawaran eksklusif khusus siaran ini dengan harga ${price}. Dapatkan jaminan original dan perlindungan pengiriman aman melalui keranjang live.`;
    }

    return {
      success: true,
      data: {
        productName: name,
        price,
        stock,
        category,
        avatarName: hostName,
        tone,
        hook,
        showcase,
        cta,
        fullScript: `${hook}\n\n${showcase}\n\n${cta}`,
      },
    };
  });
}

