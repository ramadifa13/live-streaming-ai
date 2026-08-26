import { FastifyInstance } from "fastify";
import { z } from "zod";
import { generateLunaResponse } from "../services/luna-brain.js";
import { generateVisemesFromText } from "../services/viseme-generator.js";
import { synthesizeSpeech } from "../services/tts.js";

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
 * 3. Preview mode must stay idle and never trigger RunPod rendering
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

      // Step 4: Preview mode only. Generate audio + visemes, but never render video.
      const tts = await synthesizeSpeech({
        text: lunaResponse.speech,
        avatarName,
        voice: voice || "id-ID-GadisNeural",
      });
      const audioBase64 = tts.audioBuffer
        ? tts.audioBuffer.toString("base64")
        : undefined;
      if (!audioBase64) {
        throw new Error("Backend TTS gagal menghasilkan audio untuk preview");
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
            voice: voice || "id-ID-GadisNeural",
            durationMs: visemeData.durationMs,
          },
          visemes: visemeData.visemes,
          mode,
          videoUrl: null,
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
