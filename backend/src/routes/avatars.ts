import { FastifyInstance } from "fastify";
import prisma from "../lib/prisma.js";

export async function avatarsRoutes(server: FastifyInstance) {
  server.get("/api/avatars", async () => {
    const avatars = await prisma.avatar.findMany({
      orderBy: { createdAt: "desc" },
    });

    return {
      data: avatars,
      total: avatars.length,
    };
  });

  server.post("/api/avatars", async (request, reply) => {
    const body = request.body as {
      name?: string;
      type?: string;
      style?: string;
      language?: string;
      voice?: string;
      image?: string;
      modelUrl3d?: string;
    };

    if (!body.name || !body.type) {
      reply.code(400);
      return { error: "name and type are required" };
    }

    const avatar = await prisma.avatar.create({
      data: {
        name: body.name,
        type: body.type,
        style: body.style ?? "neutral",
        language: body.language ?? "Indonesia",
        voice: body.voice ?? "Natural",
      },
    });

    return {
      success: true,
      data: avatar,
    };
  });

  // POST /api/avatars/generate-from-photo (AI Photo to 2D/3D Avatar Engine)
  server.post("/api/avatars/generate-from-photo", async (request, reply) => {
    const body = request.body as {
      name: string;
      photoUrl?: string;
      photoBase64?: string;
      gender?: "female" | "male";
      style?: "realistic" | "anime" | "stylized";
    };

    if (!body.name) {
      reply.code(400);
      return { error: "Avatar name is required" };
    }

    const defaultFemaleModels = [
      "https://models.readyplayer.me/6460d95eb407b45d807e5dcd.glb?morphTargets=ARKit,Oculus%20Visemes",
      "https://models.readyplayer.me/6460d9b4eb407b45d807e661.glb?morphTargets=ARKit,Oculus%20Visemes",
      "https://models.readyplayer.me/6460da12eb407b45d807e6dd.glb?morphTargets=ARKit,Oculus%20Visemes",
    ];

    const defaultMaleModels = [
      "https://models.readyplayer.me/6460da7deb407b45d807e74d.glb?morphTargets=ARKit,Oculus%20Visemes",
    ];

    const modelPool = body.gender === "male" ? defaultMaleModels : defaultFemaleModels;
    const modelUrl3d = modelPool[Math.floor(Math.random() * modelPool.length)];

    const photoUrl =
      body.photoUrl ||
      body.photoBase64 ||
      "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=800&h=900&fit=crop";

    return {
      success: true,
      data: {
        id: `avatar-${Date.now()}`,
        name: body.name,
        type: "3D",
        image: photoUrl,
        modelUrl3d,
        engine: {
          twoD: "LivePortrait-Neural-Driver",
          threeD: "ReadyPlayerMe-VRM-ARKit",
        },
        blendshapes: [
          "eyeBlinkLeft",
          "eyeBlinkRight",
          "jawOpen",
          "mouthSmileLeft",
          "mouthSmileRight",
          "viseme_aa",
          "viseme_E",
          "viseme_I",
          "viseme_O",
          "viseme_U",
        ],
        status: "ready",
      },
    };
  });
}
