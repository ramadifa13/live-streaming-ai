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
          voice: "namira",
          sampleAudioUrl: "/avatars/namira_voice_sample.mp3",
          description: "AI host utama untuk live streaming",
        },
      ],
    });
    console.log("Seeded default avatar Namira");
  } else {
    // Align existing hosts ke Piper host-id + sample pra-live
    await prisma.avatar.updateMany({
      where: {
        OR: [
          { name: { contains: "Namira" } },
          { voice: { contains: "Gadis" } },
          { voice: { contains: "Neural" } },
          { sampleAudioUrl: null },
        ],
      },
      data: {
        voice: "namira",
        sampleAudioUrl: "/avatars/namira_voice_sample.mp3",
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
