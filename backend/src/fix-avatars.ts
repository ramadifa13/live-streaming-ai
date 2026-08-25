import prisma from "./lib/prisma.js";

async function fix() {
  // Add avatars with simple numeric IDs that frontend expects
  const existing1 = await prisma.avatar.findUnique({ where: { id: "1" } });
  const existing2 = await prisma.avatar.findUnique({ where: { id: "2" } });

  if (!existing1) {
    await prisma.avatar.create({
      data: {
        id: "1",
        name: "Namira",
        type: "3d",
        style: "realistic",
        language: "id",
        voice: "id-ID-GadisNeural",
        isActive: true,
        description: "Host 3D dinamis - Namira",
      },
    });
    console.log("Created avatar id=1 (Namira)");
  } else {
    console.log("Avatar id=1 already exists");
  }

  if (!existing2) {
    await prisma.avatar.create({
      data: {
        id: "2",
        name: "Nana",
        type: "2d",
        style: "anime",
        language: "id",
        voice: "id-ID-GadisNeural",
        isActive: true,
        description: "Host 2D statis - Nana",
      },
    });
    console.log("Created avatar id=2 (Nana)");
  } else {
    console.log("Avatar id=2 already exists");
  }

  const all = await prisma.avatar.findMany();
  console.log("\nAll avatars:", all.map(a => ({ id: a.id, name: a.name })));

  await prisma.$disconnect();
}

fix().catch((e) => {
  console.error(e);
  process.exit(1);
});
