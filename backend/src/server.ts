import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import {
  dashboardSummary,
  hostOptions,
  inventoryRows,
  liveWorkflowSteps,
  pricing,
} from "./data/mock.js";
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

server.get("/health", async () => ({
  ok: true,
  status: "healthy",
  timestamp: new Date().toISOString(),
}));

server.get("/api/hosts", async () => ({
  data: hostOptions,
  total: hostOptions.length,
}));

server.get("/api/pricing", async () => ({
  data: pricing,
}));

server.get("/api/dashboard", async () => ({
  data: {
    ...dashboardSummary,
    inventoryRows,
  },
}));

server.get("/api/workflow", async () => ({
  data: liveWorkflowSteps,
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
          name: "Alya",
          type: "Friendly",
          style: "Friendly",
          language: "Indonesia",
          voice: "Wanita Natural",
          description: "AI host natural and warm",
        },
        {
          name: "Luna",
          type: "Energetic",
          style: "Energetic",
          language: "Indonesia",
          voice: "Energetic Promo",
          description: "AI host energetic and high conversion",
        },
        {
          name: "Cinta",
          type: "Professional",
          style: "Professional",
          language: "Indonesia",
          voice: "Soft Professional",
          description: "AI host professional and authoritative",
        },
      ],
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
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
