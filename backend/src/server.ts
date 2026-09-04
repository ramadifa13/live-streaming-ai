import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import dotenv from "dotenv";
import prisma from "./lib/prisma.js";

import { avatarsRoutes } from "./routes/avatars.js";
import { liveSessionRoutes } from "./routes/live-session.js";
import { providersRoutes } from "./routes/providers.js";
import { aiBrainRoutes } from "./routes/ai-brain.js";
import { ttsRoutes } from "./routes/tts.js";
import { avatarVideoRoutes } from "./routes/avatar-video.js";
import { chatStreamRoutes } from "./routes/chat-stream.js";
import { oauthRoutes } from "./routes/oauth.js";
dotenv.config();

const server = Fastify({
  logger: true,
  bodyLimit: 25 * 1024 * 1024, // 25MB body limit for image uploads and bulk CSV
});

await server.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
});

await server.register(multipart, {
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB â€“ matches bodyLimit
  },
});

server.get("/health", async () => ({
  ok: true,
  status: "healthy",
  timestamp: new Date().toISOString(),
}));

await avatarsRoutes(server);
await liveSessionRoutes(server);
await providersRoutes(server);
await aiBrainRoutes(server);
await ttsRoutes(server);
await avatarVideoRoutes(server);
await chatStreamRoutes(server);
await oauthRoutes(server);

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
          voice: "girl_cute_kids",
          sampleAudioUrl: null,
          description: "AI host utama untuk demo live streaming",
        },
      ],
    });
  } else {
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
        voice: "girl_cute_kids",
        sampleAudioUrl: null,
      },
    });
  }
}

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  try {
    await seedDatabase();
    console.log("Database seeded successfully.");
  } catch (dbErr) {
    console.warn(
      "[Database] Database notice (will use fallback store if offline):",
      dbErr,
    );
  }
  await server.listen({ port, host });
  console.log(`Backend ready at http://${host}:${port}`);
  console.log(
    `[TTS] Engine=VoxCPM2 voice_id=${process.env.VOICE_ID || "girl_cute_kids"} (AI Worker GPU)`,
  );

  import("./services/runpod-manager.js").then((m) => m.startIdleMonitor());
  import("./services/tts.js").then((m) => m.warmUpTTS());
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
