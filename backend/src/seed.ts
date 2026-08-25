import prisma from "./lib/prisma.js";

async function main() {
  console.log("=== EXECUTING DATABASE MIGRATION & SEEDING ===");

  // 1. Add 'link' column if it doesn't exist yet via raw SQL
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "link" TEXT;`);
    console.log("✅ Column 'link' verified/added to Product table.");
  } catch (err) {
    console.error("Error adding column:", err);
  }

  // 2. Clear old test products if any
  try {
    await prisma.liveSession.deleteMany();
    await prisma.product.deleteMany();
    console.log("Cleared existing records.");
  } catch (e) {
    console.log("No previous records to clear");
  }

  // 3. Seed initial 6 official products directly into PostgreSQL
  const initialProducts = [
    {
      id: "prod_01_serum_brightening",
      name: "Serum Brightening Premium",
      description: "Serum pencerah wajah dengan Niacinamide 10% dan Collagen untuk kulit glowing dan kenyal.",
      price: 99000,
      stock: 120,
      sku: "SKU-SERUM-001",
      category: "Skincare",
      image: "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80",
      link: "https://shopee.co.id/serum-brightening-premium",
    },
    {
      id: "prod_02_moisturizer_glow",
      name: "Moisturizer Glow Natural",
      description: "Pelembab wajah harian dengan Ceramide dan Hyaluronic Acid untuk hidrasi 24 jam.",
      price: 129000,
      stock: 85,
      sku: "SKU-MOIST-002",
      category: "Skincare",
      image: "https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400&h=400&fit=crop&q=80",
      link: "https://shopee.co.id/moisturizer-glow-natural",
    },
    {
      id: "prod_03_sunscreen_daily",
      name: "Sunscreen Daily Protection",
      description: "Tabir surya SPF 50+ PA++++ tekstur ringan tanpa whitecast, aman untuk kulit berjerawat.",
      price: 79000,
      stock: 200,
      sku: "SKU-SUN-003",
      category: "Skincare",
      image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop&q=80",
      link: "https://tiktok.com/@toko/sunscreen-daily",
    },
    {
      id: "prod_04_paket_glowing",
      name: "Paket Glowing Ultimate",
      description: "Paket lengkap 4 in 1: Facial Wash, Toner, Serum, dan Moisturizer harga hemat.",
      price: 199000,
      stock: 60,
      sku: "SKU-PAKET-004",
      category: "Paket",
      image: "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=400&h=400&fit=crop&q=80",
      link: "https://shopee.co.id/paket-glowing-ultimate",
    },
    {
      id: "prod_05_hydrating_toner",
      name: "Hydrating Essence Toner",
      description: "Toner penyegar dengan Centella Asiatica untuk menenangkan kemerahan dan melembabkan.",
      price: 110000,
      stock: 75,
      sku: "SKU-TONER-005",
      category: "Skincare",
      image: "https://images.unsplash.com/photo-1608248597359-0d12e6900f6b?w=400&h=400&fit=crop&q=80",
      link: "https://shopee.co.id/hydrating-essence-toner",
    },
    {
      id: "prod_06_vitaminc_booster",
      name: "Vitamin C Bright Booster",
      description: "Serum Vitamin C murni 15% untuk menyamarkan flek hitam dan meratakan warna kulit.",
      price: 89000,
      stock: 140,
      sku: "SKU-VITC-006",
      category: "Skincare",
      image: "https://images.unsplash.com/photo-1601049541289-9b1b7bbbfe19?w=400&h=400&fit=crop&q=80",
      link: "https://tiktok.com/@toko/vitaminc-booster",
    },
  ];

  for (const prod of initialProducts) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Product" ("id", "name", "description", "price", "stock", "sku", "category", "image", "link", "updatedAt") 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) 
       ON CONFLICT ("id") DO UPDATE SET 
         "name" = EXCLUDED."name", 
         "price" = EXCLUDED."price", 
         "stock" = EXCLUDED."stock", 
         "category" = EXCLUDED."category", 
         "image" = EXCLUDED."image", 
         "link" = EXCLUDED."link";`,
      prod.id,
      prod.name,
      prod.description,
      prod.price,
      prod.stock,
      prod.sku,
      prod.category,
      prod.image,
      prod.link
    );
    console.log(`✅ Seeded Product: ${prod.name} (DB ID: ${prod.id})`);
  }

  const all: any = await prisma.$queryRawUnsafe(`SELECT "id", "name", "price", "stock", "sku", "category", "image", "link" FROM "Product" ORDER BY "createdAt" ASC;`);
  console.log(`=== DATABASE AUDIT & SEED SUCCESS: Total ${all.length} products in DB ===`);
  console.log(all);

  // 4. Seed avatars if none exist
  const avatarCount = await prisma.avatar.count();
  if (avatarCount === 0) {
    console.log("Seeding avatars...");
    await prisma.avatar.createMany({
      data: [
        {
          id: "1",
          name: "Namira",
          type: "3d",
          style: "realistic",
          language: "id",
          voice: "id-ID-GadisNeural",
          isActive: true,
          description: "Host 3D dinamis - Namira",
        },
        {
          id: "2",
          name: "Nana",
          type: "2d",
          style: "anime",
          language: "id",
          voice: "id-ID-GadisNeural",
          isActive: true,
          description: "Host 2D statis - Nana",
        },
      ],
    });
    console.log("✅ Seeded 2 avatars (id=1: Namira 3D, id=2: Nana 2D)");
  } else {
    console.log(`Avatars already exist: ${avatarCount} records`);
  }
}

main()
  .catch((e) => {
    console.error("Migration/Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
