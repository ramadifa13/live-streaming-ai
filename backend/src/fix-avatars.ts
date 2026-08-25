import prisma from "./lib/prisma.js";

async function fix() {
  const count = await prisma.avatar.count();
  console.log("Avatar count:", count);

  if (count === 0) {
    await prisma.avatar.createMany({
      data: [
        { id: "1", name: "Namira", type: "3d", voice: "id-ID-GadisNeural", isActive: true, description: "Host 3D" },
        { id: "2", name: "Nana", type: "2d", voice: "id-ID-GadisNeural", isActive: true, description: "Host 2D" },
      ],
    });
    console.log("Created avatars!");
  }

  const all = await prisma.avatar.findMany();
  console.log("Avatars:", all);

  await prisma.$disconnect();
}

fix().catch((e) => {
  console.error(e);
  process.exit(1);
});
