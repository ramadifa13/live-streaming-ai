import { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { generateProductKnowledge } from "../services/groq-brain.js";

export const PRODUCT_CATEGORIES = [
  "Skincare",
  "Beauty & Makeup",
  "Fashion & Pakaian",
  "Hijab & Muslim",
  "Kesehatan & Herbal",
  "Elektronik & Gadget",
  "Makanan & Minuman",
  "Ibu & Bayi",
  "Perlengkapan Rumah",
  "Aksesoris & Sepatu",
  "General",
] as const;

const productSchema = z.object({
  name: z.string().min(1, "Nama produk wajib diisi"),
  image: z.string().min(1, "Foto / gambar produk wajib diisi"),
  price: z.number().min(0, "Harga jual live wajib diisi dan valid"),
  stock: z.number().min(0, "Stok tidak boleh negatif").optional().default(0),
  category: z.string().min(1, "Kategori wajib diisi"),
  sku: z.string().optional().default(""),
  link: z.string().optional().default(""),
  description: z.string().min(1, "Deskripsi lengkap produk wajib diisi"),
  benefits: z.string().optional().default(""),
  usage: z.string().optional().default(""),
  bannerImage: z.string().optional().default(""),
  faq: z.string().optional(),
  targetAudience: z.string().optional(),
  copywriting: z.string().optional(),
});

const bulkProductSchema = z.object({
  products: z.array(productSchema).min(1, "Minimal 1 produk untuk bulk import"),
});

const updateProductSchema = z.object({
  name: z.string().min(1, "Nama produk wajib diisi").optional(),
  image: z.string().min(1, "Foto produk wajib diisi").optional(),
  price: z.number().min(0, "Harga jual live harus valid").optional(),
  stock: z.number().min(0, "Stok tidak boleh negatif").optional(),
  category: z.string().min(1, "Kategori wajib diisi").optional(),
  sku: z.string().optional(),
  link: z.string().optional(),
  description: z
    .string()
    .min(1, "Deskripsi lengkap produk wajib diisi")
    .optional(),
  benefits: z.string().optional(),
  usage: z.string().optional(),
  bannerImage: z.string().optional(),
  faq: z.string().optional(),
  targetAudience: z.string().optional(),
  copywriting: z.string().optional(),
});

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
      bannerImage,
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
        price,
        stock,
        sku,
        link,
        benefits,
        usage,
        image,
        bannerImage,
      });

      const created = await prisma.product.create({
        data: {
          name,
          description: knowledge.description || description,
          price,
          stock: stock ?? 0,
          sku: sku || `SKU-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          category: category || "General",
          image: image,
          bannerImage: bannerImage || "",
          link: link || "",
          benefits: knowledge.benefits || benefits || "",
          usage: knowledge.usage || usage || "",
          faq: knowledge.faq || faq || "",
          targetAudience: knowledge.targetAudience || targetAudience || "",
          copywriting: knowledge.copywriting || copywriting || "",
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
              stock: p.stock ?? 0,
              sku:
                p.sku ||
                `SKU-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
              category: p.category || "General",
              image: p.image,
              bannerImage: p.bannerImage || "",
              link: p.link || "",
              benefits: p.benefits || "",
              usage: p.usage || "",
              faq: p.faq || "",
              targetAudience: p.targetAudience || "",
              copywriting: p.copywriting || "",
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
