import prisma from "./lib/prisma.js";

async function fix() {
  const existing1 = await prisma.avatar.findUnique({ where: { id: "1" } });

  if (!existing1) {
    await prisma.avatar.create({
      data: {
        id: "1",
        name: "Namira",
        type: "3d",
        style: "realistic",
        language: "id",
        voice: "namira",
        sampleAudioUrl: "/avatars/namira_voice_sample.mp3",
        isActive: true,
        description: "Host 3D dinamis - Namira",
      },
    });
    console.log("Created avatar id=1 (Namira)");
  } else {
    await prisma.avatar.update({
      where: { id: "1" },
      data: {
        voice: "namira",
        sampleAudioUrl: "/avatars/namira_voice_sample.mp3",
      },
    });
    console.log("Updated avatar id=1 voice + sampleAudioUrl");
  }

  const all = await prisma.avatar.findMany();
  console.log(
    "\nAll avatars:",
    all.map((a: any) => ({ id: a.id, name: a.name })),
  );

  await prisma.$disconnect();
}

fix().catch((e) => {
  console.error(e);
  process.exit(1);
});
