import { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  generateDynamicSalesResponseGroq,
  generateVideoSalesScriptGroq,
  generateLiveSalesPitchFromAIGroq,
  prepareProductScriptPack,
  checkGroqHealth,
} from "../services/groq-brain.js";

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
  // GET /api/ai/models — status Groq/Gemini (bukan Ollama)
  server.get("/api/ai/models", async (_request, reply) => {
    try {
      const health = await checkGroqHealth();
      return {
        success: true,
        provider: health.provider,
        online: health.online,
        activeModel: health.model,
        latencyMs: health.latencyMs,
        error: health.error,
      };
    } catch (err: any) {
      server.log.error(err);
      reply.code(500);
      return {
        success: false,
        error: err.message || "Failed to check LLM status",
      };
    }
  });

  // POST /api/ai/sales-response (Autonomous LLM Sales Brain with RAG & Conversational Pivot)
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

    // Call Autonomous LLM Sales Brain with RAG Knowledge
    try {
      const aiResult = await generateDynamicSalesResponseGroq({
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
      return {
        success: false,
        error: err.message || "Failed to generate dynamic sales response",
      };
    }
  });

  // POST /api/ai/video-script (Autonomous Commercial Video Ads Generator)
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
      const script = await generateVideoSalesScriptGroq({
        productName,
        productDescription,
        productPrice,
        productCategory,
        durationType,
        style,
      });
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
    } catch (err: any) {
      server.log.error(err);
      reply.code(500);
      return {
        success: false,
        error: err.message || "Failed to generate video script",
      };
    }
  });

  server.post("/api/ai/prepare-product", async (request, reply) => {
    const schema = z.object({
      name: z.string().min(1),
      price: z.union([z.string(), z.number()]).optional(),
      category: z.string().optional(),
      description: z.string().optional(),
      benefits: z.string().optional(),
      usage: z.string().optional(),
      faq: z.string().optional(),
      stock: z.number().optional(),
      sku: z.string().optional(),
      link: z.string().optional(),
      targetAudience: z.string().optional(),
      copywriting: z.string().optional(),
      bannerImage: z.string().optional(),
      avatarName: z.string().optional(),
      tone: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { success: false, error: parsed.error.flatten() };
    }
    try {
      const pack = await prepareProductScriptPack(parsed.data);
      return {
        success: true,
        data: {
          scriptBank: pack.lines,
          engine: pack.engine,
          count: pack.count,
          enriched: pack.enriched,
          faqPack: pack.faqPack,
        },
      };
    } catch (err: any) {
      server.log.error(err);
      reply.code(500);
      return { success: false, error: err.message || "Gagal menyiapkan script bank" };
    }
  });

  server.post("/api/ai/live-sales-script", async (request, reply) => {
    const body = request.body as {
      productId?: string;
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
      const scriptResult = await generateLiveSalesPitchFromAIGroq({
        productName: name,
        productPrice: price,
        productCategory: category,
        productDescription: description,
        productBenefits: benefits,
        productUsage: usage,
        productFaq: faq,
        productStock: stock,
        avatarName: hostName,
        tone,
      });

      return {
        success: true,
        data: scriptResult,
      };
    } catch (err: any) {
      reply.code(502);
      return {
        success: false,
        error: err?.message || "Gagal menghasilkan live script dari AI",
      };
    }
  });
}
