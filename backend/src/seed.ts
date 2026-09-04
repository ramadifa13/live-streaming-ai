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
          voice: "default_host",
          sampleAudioUrl: null,
          description: "AI host utama untuk live streaming",
        },
      ],
    });
    console.log("Seeded default avatar Namira");
  } else {
    // Map legacy voice slugs → default_host; hapus sample MP3 statis
    await prisma.avatar.updateMany({
      where: {
        OR: [
          { name: { contains: "Namira" } },
          { voice: { contains: "Gadis" } },
          { voice: { contains: "Neural" } },
          { voice: { equals: "namira" } },
          { sampleAudioUrl: { not: null } },
        ],
      },
      data: {
        voice: "default_host",
        sampleAudioUrl: null,
      },
    });
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
