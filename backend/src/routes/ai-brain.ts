import { FastifyInstance } from "fastify";
import { z } from "zod";
import { generateDynamicSalesResponse } from "../services/llm-brain.js";
// Re-implement the other features dynamically using llm-brain instead of stubbing

const salesResponseSchema = z.object({
  productId: z.string().optional(),
  productName: z.string().optional(),
  productPrice: z.string().optional(),
  userQuestion: z.string().min(1),
  tone: z.string().optional().default("Persuasif"),
  avatarName: z.string().optional().default("Namira"),
  activeProduct: z.any().optional(),
});

const videoScriptSchema = z.object({
  productName: z.string().min(1),
  productDescription: z.string().optional().default(""),
  productPrice: z.string().optional().default("Harga Spesial"),
  productCategory: z.string().optional().default("General"),
  durationType: z.enum(["15s", "30s", "60s"]).default("30s"),
  style: z.string().optional().default("Viral TikTok"),
});

export async function aiBrainRoutes(server: FastifyInstance) {
  server.post("/api/ai/sales-response", async (request, reply) => {
    const parsed = salesResponseSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    let {
      productId,
      productName = "Produk",
      productPrice = "Harga Spesial",
      userQuestion,
      tone = "Persuasif",
      avatarName = "Namira",
    } = parsed.data;

    let productDescription = "";
    let productCategory = "Skincare";
    let productBenefits = "";
    let productUsage = "";
    let productFaq = "";
    let productStock = 50;

    if (parsed.data.activeProduct) {
      const p = parsed.data.activeProduct as Record<string, any>;
      productName = p.name || productName;
      productPrice = p.price || productPrice;
      productDescription = p.description || "";
      productCategory = p.tag || p.category || "Skincare";
      productBenefits = p.benefits || "";
      productUsage = p.usage || "";
      productFaq = p.faq || "";
      productStock = p.stock || 50;
    }

    try {
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
    } catch (err: any) {
      server.log.error(err);
      reply.code(500);
      return { success: false, error: err.message || "Failed to generate dynamic sales response" };
    }
  });

  server.post("/api/ai/live-sales-script", async (request, reply) => {
    const body = request.body as {
      productName?: string;
      productPrice?: string;
      category?: string;
      avatarName?: string;
      tone?: string;
      productDescription?: string;
      productBenefits?: string;
      productUsage?: string;
      productFaq?: string;
      activeProduct?: any;
    };

    let name = body.productName || "Produk";
    let price = body.productPrice || "Harga Spesial";
    let category = body.category || "General";
    let description = body.productDescription || "";
    let benefits = body.productBenefits || "";
    let usage = body.productUsage || "";
    let faq = body.productFaq || "";
    let stock = 50;

    if (body.activeProduct) {
      const p = body.activeProduct;
      name = p.name || name;
      price = p.price || price;
      category = p.tag || p.category || category;
      description = p.description || description;
      benefits = p.benefits || benefits;
      usage = p.usage || usage;
      faq = p.faq || faq;
      stock = p.stock || stock;
    }

    const hostName = body.avatarName || "Namira";
    const tone = body.tone || "Persuasif";

    try {
      // Create a specific LLM prompt for live sales script format
      const userQ = `Buatlah script live streaming untuk produk ${name} dalam 3 bagian dengan gaya ${tone}. Format JSON: {"hook": "...", "showcase": "...", "cta": "...", "fullScript": "..."}`;

      const aiResult = await generateDynamicSalesResponse({
        userQuestion: userQ,
        avatarName: hostName,
        tone,
        productName: name,
        productPrice: price,
        productDescription: description,
        productCategory: category,
        productBenefits: benefits,
        productUsage: usage,
        productFaq: faq,
        productStock: stock,
      });

      // Try to parse the json from the reply text, or fallback
      let parsedResponse = {
         hook: "Halo semua!",
         showcase: `Ini dia ${name} yang kalian cari!`,
         cta: "Langsung checkout sekarang!",
         fullScript: aiResult.replyText
      };

      try {
         // attempt naive extract json from text if it's wrapped
         const jsonStr = aiResult.replyText.replace(/```json/g, "").replace(/```/g, "");
         const match = jsonStr.match(/\{[\s\S]*\}/);
         if (match) {
             const maybeJson = JSON.parse(match[0]);
             if (maybeJson.hook && maybeJson.showcase) parsedResponse = maybeJson;
         }
      } catch (e) {}

      return {
        success: true,
        data: parsedResponse
      };
    } catch (err: any) {
      reply.code(502);
      return {
        success: false,
        error: err?.message || "Gagal menghasilkan live script dari AI",
      };
    }
  });

  server.post("/api/ai/video-script", async (request, reply) => {
    const parsed = videoScriptSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const {
      productName,
      productDescription,
      productPrice,
      productCategory,
      durationType,
      style = "Viral TikTok",
    } = parsed.data;

    try {
      const aiResult = await generateDynamicSalesResponse({
        userQuestion: `Buat script video iklan durasi ${durationType} dengan gaya ${style}`,
        avatarName: "Video Creator",
        tone: "Menarik",
        productName,
        productPrice,
        productDescription,
        productCategory,
        productBenefits: "",
        productUsage: "",
        productFaq: "",
        productStock: 100,
      });
      return {
        success: true,
        data: {
          product: productName,
          category: productCategory,
          format: "MP4 9:16 (Vertical Video Ads)",
          style,
          script: aiResult.replyText,
        },
      };
    } catch (err: any) {
      server.log.error(err);
      reply.code(500);
      return { success: false, error: err.message || "Failed to generate video script" };
    }
  });
}
