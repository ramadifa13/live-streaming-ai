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
        voice: "girl_cute_kids",
        sampleAudioUrl: null,
        isActive: true,
        description: "Host 3D dinamis - Namira (VoxCPM2 girl_cute_kids)",
      },
    });
    console.log("Created avatar id=1 (Namira)");
  } else {
    await prisma.avatar.update({
      where: { id: "1" },
      data: {
        voice: "girl_cute_kids",
        sampleAudioUrl: null,
      },
    });
    console.log("Updated avatar id=1 â€” voice=girl_cute_kids (VoxCPM2)");
  }

  await prisma.avatar.updateMany({
    where: { sampleAudioUrl: { not: null } },
    data: { sampleAudioUrl: null },
  });

  const all = await prisma.avatar.findMany();
  console.log(
    "\nAll avatars:",
    all.map((a: { id: string; name: string; sampleAudioUrl: string | null }) => ({
      id: a.id,
      name: a.name,
      sampleAudioUrl: a.sampleAudioUrl,
    })),
  );

  await prisma.$disconnect();
}

fix().catch((e) => {
  console.error(e);
  process.exit(1);
});
