import prisma from "./lib/prisma.js";

async function main() {
  console.log("=== EXECUTING DATABASE MIGRATION & SEEDING ===");

  // 1. Add 'link' column if it doesn't exist yet (SQLite compatible)
  try {
    const cols = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `PRAGMA table_info("Product")`,
    );
    const hasLink = cols.some((c) => c.name === "link");
    if (!hasLink) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Product" ADD COLUMN "link" TEXT;`,
      );
      console.log("Added column 'link' to Product table.");
    } else {
      console.log("Column 'link' already exists.");
    }
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
  const all = await prisma.product.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`=== SEED SUCCESS: ${all.length} products in DB ===`);

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
      ],
    });
    console.log("Seeded Namira AI Host");
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
