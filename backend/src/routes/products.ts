import { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { generateProductKnowledge } from "../services/groq-brain.js";

export const PRODUCT_CATEGORIES = [
  "Skincare",
  "Beauty",
  "Fashion",
  "Supplements",
  "Food & Beverage",
  "Electronics",
  "Home & Living",
  "General",
] as const;

const productSchema = z.object({
  name: z.string().min(1, "Nama produk wajib diisi"),
  description: z.string().optional(),
  price: z.number().min(1, "Harga harus lebih dari 0"),
  stock: z.number().min(0, "Stok tidak boleh negatif"),
  sku: z.string().optional(),
  category: z
    .enum(PRODUCT_CATEGORIES, {
      errorMap: () => ({
        message: `Kategori harus salah satu dari: ${PRODUCT_CATEGORIES.join(", ")}`,
      }),
    })
    .default("General"),
  image: z.string().optional(),
  link: z.string().optional(),
  benefits: z.string().optional(),
  usage: z.string().optional(),
  faq: z.string().optional(),
  targetAudience: z.string().optional(),
  copywriting: z.string().optional(),
});

const bulkProductSchema = z.object({
  products: z.array(productSchema).min(1, "Minimal 1 produk untuk bulk import"),
});

const updateProductSchema = productSchema.partial();

export async function productsRoutes(server: FastifyInstance) {
  // GET all products
  server.get("/api/products", async (_request, reply) => {
    try {
      const products = await prisma.product.findMany({
        orderBy: { createdAt: "desc" },
      });

      return {
        success: true,
        data: products || [],
        total: products ? products.length : 0,
      };
    } catch (error: any) {
      server.log.error(error);
      reply.code(500);
      return {
        success: false,
        data: [],
        total: 0,
        error: error.message || "Failed to fetch products from database",
      };
    }
  });

  // GET single product by ID
  server.get("/api/products/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const product = await prisma.product.findUnique({
        where: { id },
      });

      if (!product) {
        reply.code(404);
        return { success: false, error: "Product not found" };
      }

      return {
        success: true,
        data: product,
      };
    } catch (error: any) {
      server.log.error(error);
      reply.code(500);
      return {
        success: false,
        error: error.message || "Failed to fetch product",
      };
    }
  });

  // POST create single product with RAG knowledge fields
  server.post("/api/products", async (request, reply) => {
    const parsed = productSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { success: false, error: parsed.error.flatten() };
    }

    const {
      name,
      description,
      price,
      stock,
      sku,
      category,
      image,
      link,
      benefits,
      usage,
      faq,
      targetAudience,
      copywriting,
    } = parsed.data;

    try {
      const knowledge = await generateProductKnowledge({
        name,
        description,
        category,
        image,
      });
      const created = await prisma.product.create({
        data: {
          name,
          description: knowledge.description,
          price,
          stock,
          sku: sku || `SKU-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          category: category || "Skincare",
          image:
            image ||
            "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80",
          link: link || "",
          benefits: benefits || knowledge.benefits,
          usage: usage || knowledge.usage,
          faq: faq || knowledge.faq,
          targetAudience: targetAudience || knowledge.targetAudience,
          copywriting: copywriting || knowledge.copywriting,
        },
      });

      return {
        success: true,
        data: created,
      };
    } catch (error: any) {
      server.log.error(error);
      reply.code(500);
      return {
        success: false,
        error: error.message || "Failed to create product",
      };
    }
  });

  // POST bulk import products (from CSV or batch input)
  server.post("/api/products/bulk", async (request, reply) => {
    const parsed = bulkProductSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { success: false, error: parsed.error.flatten() };
    }

    try {
      const createdList = await prisma.$transaction(
        parsed.data.products.map((p, idx) =>
          prisma.product.create({
            data: {
              name: p.name,
              description: p.description || "",
              price: p.price,
              stock: p.stock ?? 50,
              sku:
                p.sku ||
                `SKU-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
              category: p.category || "General",
              image:
                p.image ||
                "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80",
              link: p.link || "",
              benefits: p.benefits || "",
              usage: p.usage || "",
              faq: p.faq || "",
              targetAudience: p.targetAudience || "",
            },
          }),
        ),
      );

      return {
        success: true,
        importedCount: createdList.length,
        data: createdList,
      };
    } catch (error: any) {
      server.log.error(error);
      reply.code(500);
      return {
        success: false,
        error: error.message || "Failed to bulk import products",
      };
    }
  });

  // PATCH update product
  server.patch("/api/products/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateProductSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { success: false, error: parsed.error.flatten() };
    }

    try {
      const updated = await prisma.product.update({
        where: { id },
        data: parsed.data,
      });

      return {
        success: true,
        data: updated,
      };
    } catch (error: any) {
      server.log.error(error);
      reply.code(500);
      return {
        success: false,
        error: error.message || "Failed to update product",
      };
    }
  });

  // DELETE product
  server.delete("/api/products/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      // 1. Cascading delete from live sessions
      await prisma.liveSession.deleteMany({
        where: { productId: id },
      });

      // 2. Delete product from database
      await prisma.product.delete({
        where: { id },
      });

      return {
        success: true,
        message: "Product deleted successfully from database",
      };
    } catch (error: any) {
      server.log.error(error);
      reply.code(500);
      return {
        success: false,
        error: error.message || "Failed to delete product",
      };
    }
  });
}
