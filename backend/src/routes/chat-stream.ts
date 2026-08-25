import { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { generateLunaResponse } from "../services/luna-brain.js";
import { generateVisemesFromText } from "../services/viseme-generator.js";
import { forwardToRunPodGPU } from "../services/runpod-bridge.js";
import {
  acquireGpuForJob,
  releaseGpuForJob,
} from "../services/runpod-manager.js";
import { liveSessionManager } from "../services/live-session-manager.js";

const chatStreamRequestSchema = z.object({
  comment: z.string().min(1, "Comment is required"),
  activeProduct: z.any().optional(),
  avatarName: z.string().optional().default("Namira"),
  tone: z.string().optional().default("Persuasif"),
  voice: z.string().optional().default("id-ID-GadisNeural"),
  mode: z.literal("3D").default("3D"),
  avatarImagePath: z.string().optional().default("avatars/namira.png"),
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

    const {
      comment,
      activeProduct,
      avatarName,
      tone,
      voice,
      mode,
      avatarImagePath,
    } = parsed.data;

    try {
      // Step 1: Generate Structured Persona Host Response via LLM
      const lunaResponse = await generateLunaResponse(
        comment,
        activeProduct,
        avatarName,
        tone,
      );

      // Step 2: Generate Visemes & Timestamps for 3D WebGL / Three.js
      const visemeData = generateVisemesFromText(lunaResponse.speech);

      // Step 3: Map linked product (Frontend manages DB now)
      let linkedProduct = null;
      if (
        lunaResponse.target_product_id &&
        activeProduct &&
        activeProduct.id === lunaResponse.target_product_id
      ) {
        linkedProduct = activeProduct;
      }

      // Step 4: Render the Namira 3D response on the GPU Worker.
      let videoUrl: string | undefined = undefined;
      if (mode === "3D") {
        const activeSession = await prisma.liveSession.findFirst({
          where: { status: "live" },
          select: { id: true },
        });

        const isActuallyLive = activeSession !== null;
        const temporaryGpuJob = !isActuallyLive;
        if (temporaryGpuJob) await acquireGpuForJob();
        try {
          const gpuRes = await forwardToRunPodGPU({
            avatarImagePath,
            text: lunaResponse.speech,
            voice: voice || "id-ID-GadisNeural",
            speed: lunaResponse.action === "TALK_EXPRESSIVE" ? 1.08 : 1.0,
          });
          videoUrl = gpuRes.videoUrl;
        } finally {
          if (temporaryGpuJob) await releaseGpuForJob();
        }
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
