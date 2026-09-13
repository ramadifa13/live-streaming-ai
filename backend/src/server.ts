import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import dotenv from "dotenv";
import prisma from "./lib/prisma.js";

import { corsAllowlist, isAllowedOrigin } from "./lib/cors.js";
import { avatarsRoutes } from "./routes/avatars.js";
import { liveSessionRoutes } from "./routes/live-session.js";
import { orderRoutes } from "./routes/orders.js";
import { providersRoutes } from "./routes/providers.js";
import { aiBrainRoutes } from "./routes/ai-brain.js";
import { ttsRoutes } from "./routes/tts.js";
import { avatarVideoRoutes } from "./routes/avatar-video.js";
import { chatStreamRoutes } from "./routes/chat-stream.js";
import { oauthRoutes } from "./routes/oauth.js";
import { liveSessionManager } from "./services/live-session-manager.js";
dotenv.config();

const server = Fastify({
  logger: true,
  bodyLimit: 25 * 1024 * 1024,
});

const allowedOrigins = corsAllowlist();
await server.register(cors, {
  origin: (origin, callback) => {
    callback(null, isAllowedOrigin(origin, allowedOrigins));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
});

await server.register(multipart, {
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

server.get("/health", async () => ({
  ok: true,
  status: "healthy",
  timestamp: new Date().toISOString(),
}));

server.get("/api/health", async () => {
  let db: "ok" | "error" = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "error";
  }

  let tts: "ok" | "warming" | "error" = "warming";
  try {
    const { isPocketTtsReady } = await import("./services/tts.js");
    tts = isPocketTtsReady() ? "ok" : "warming";
  } catch {
    tts = "error";
  }

  const latest = liveSessionManager.getLatestActiveSession();
  return {
    ok: db === "ok",
    status: db === "ok" ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    db,
    tts,
    liveActive: Boolean(latest),
  };
});

await avatarsRoutes(server);
await orderRoutes(server);
await liveSessionRoutes(server);
await providersRoutes(server);
await aiBrainRoutes(server);
await ttsRoutes(server);

process.once("SIGINT", () => {
  import("./services/tts.js").then(({ stopTTS }) => stopTTS());
});
process.once("SIGTERM", () => {
  import("./services/tts.js").then(({ stopTTS }) => stopTTS());
});
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
    console.warn("[Database] Database notice (will use fallback store if offline):", dbErr);
  }
  await server.listen({ port, host });
  console.log(`Backend ready at http://${host}:${port}`);
  await liveSessionManager.rehydrateActiveSessions().catch((err) => {
    console.error("[LiveSessionManager] Startup reconciliation failed:", err);
  });
  console.log(`[TTS] Engine=Pocket TTS Indonesian voice_id=${process.env.VOICE_ID || "girl_cute_kids"} (backend)`);

  import("./services/runpod-manager.js").then((m) => m.startIdleMonitor());
  import("./services/tts.js")
    .then((m) => m.warmUpTTS())
    .catch((ttsErr) => {
      console.error("[TTS] Pocket TTS warmup gagal; backend tetap berjalan:", ttsErr);
    });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
