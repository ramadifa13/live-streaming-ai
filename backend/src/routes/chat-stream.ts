import { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { generateLunaResponse } from "../services/luna-brain.js";
import { generateVisemesFromText } from "../services/viseme-generator.js";
import { forwardToRunPodGPU } from "../services/runpod-bridge.js";

const chatStreamRequestSchema = z.object({
  comment: z.string().min(1, "Comment is required"),
  activeProductId: z.string().optional(),
  avatarName: z.string().optional().default("Namira"),
  tone: z.string().optional().default("Persuasif"),
  voice: z.string().optional().default("id-ID-GadisNeural"),
  mode: z.enum(["2D", "3D"]).default("3D"),
  avatarImagePath: z.string().optional().default("avatars/host_3d_dinamis_namira.png"),
});

export async function chatStreamRoutes(server: FastifyInstance) {
  /**
   * POST /api/chat-stream
   * Main unified AI Streamer controller for Persona Host.
   * Handles:
   * 1. Structured JSON output from LLM (Speech + Action + Emotion + Product)
   * 2. Edge-TTS viseme / phoneme extraction for 3D WebGL mouth morph targets
   * 3. Mode 2D forwarding to RunPod GPU LivePortrait worker
   */
  server.post("/api/chat-stream", async (request, reply) => {
    const parsed = chatStreamRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { success: false, error: parsed.error.flatten() };
    }

    const { comment, activeProductId, avatarName, tone, voice, mode, avatarImagePath } = parsed.data;

    try {
      // Step 1: Generate Structured Persona Host Response via LLM
      const lunaResponse = await generateLunaResponse(comment, activeProductId, avatarName, tone);

      // Step 2: Generate Visemes & Timestamps for 3D WebGL / Three.js
      const visemeData = generateVisemesFromText(lunaResponse.speech);

      // Step 3: Fetch linked product details if targeted
      let linkedProduct = null;
      if (lunaResponse.target_product_id) {
        try {
          linkedProduct = await prisma.product.findUnique({
            where: { id: lunaResponse.target_product_id },
          });
        } catch {}
      }

      // Step 4: If Mode 2D, forward to GPU RunPod Worker (LivePortrait / MuseTalk)
      let videoUrl: string | undefined = undefined;
      if (mode === "2D") {
        const gpuRes = await forwardToRunPodGPU({
          avatarImagePath,
          text: lunaResponse.speech,
          voice: voice || "id-ID-GadisNeural",
          speed: lunaResponse.action === "TALK_EXPRESSIVE" ? 1.08 : 1.0,
        });
        videoUrl = gpuRes.videoUrl;
      }

      // Step 5: Return unified structured response
      return {
        success: true,
        data: {
          speech: lunaResponse.speech,
          action: lunaResponse.action,
          emotion: lunaResponse.emotion,
          target_product_id: lunaResponse.target_product_id,
          product: linkedProduct,
          audio: {
            text: lunaResponse.speech,
            voice: "id-ID-GadisNeural",
            durationMs: visemeData.durationMs,
          },
          visemes: visemeData.visemes,
          mode,
          videoUrl: videoUrl || null,
        },
      };
    } catch (err: any) {
      server.log.error(err);
      reply.code(500);
      return {
        success: false,
        error: "Failed to process chat stream",
        details: err?.message || String(err),
      };
    }
  });
}
