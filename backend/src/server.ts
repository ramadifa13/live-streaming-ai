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
import { productsRoutes } from "./routes/products.js";

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
await productsRoutes(server);

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
          voice: "id-ID-GadisNeural",
          description: "AI host utama untuk demo live streaming",
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
    console.warn(
      "[Database] Database notice (will use fallback store if offline):",
      dbErr,
    );
  }
  await server.listen({ port, host });
  console.log(`Backend ready at http://${host}:${port}`);

  // Start GPU idle monitor
  import("./services/runpod-manager.js").then((m) => m.startIdleMonitor());

  // Piper-TTS dipakai offline — tidak perlu warmup network seperti Edge-TTS.
  // Model akan di-load otomatis pada request TTS pertama.

  // Warm up Ollama AI Brain in background
  setTimeout(() => {
    import("./services/groq-brain.js")
      .then((m) => m.checkOllamaHealth())
      .then((health) => {
        if (health.online) {
          console.log(`[Ollama-Brain] 🧠 Local Ollama AI Brain connected & ready (Model: ${health.model}) - 100% Free`);
        } else {
          console.warn("[Ollama-Brain] ⚠️ Ollama tidak terdeteksi di localhost:11434. Pastikan aplikasi Ollama aktif.");
        }
      })
      .catch((err) =>
        console.warn("[Ollama-Brain] Ollama warmup notice:", err?.message || err),
      );
  }, 2000);
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
