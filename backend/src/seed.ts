import prisma from "./lib/prisma.js";

async function seedDatabase() {
  const avatarCount = await prisma.avatar.count();
  if (avatarCount === 0) {
    await prisma.avatar.createMany({
      data: [
        {
          name: "Namira",
          type: "3D",
          style: "Energetic",
          language: "Indonesia",
          voice: "id-ID-GadisNeural",
          description: "AI host utama untuk live streaming",
        },
      ],
    });
    console.log("Seeded default avatar Namira");
  }
}

seedDatabase()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
