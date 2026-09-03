import { FastifyInstance } from "fastify";
import { z } from "zod";
import { generateLunaResponse } from "../services/groq-brain.js";
import { generateVisemesFromText } from "../services/viseme-generator.js";
import { getHostSampleUrl, resolveHostId } from "../services/tts.js";

const chatStreamRequestSchema = z.object({
  comment: z.string().min(1, "Comment is required"),
  activeProduct: z.any().optional(),
  avatarName: z.string().optional().default("Namira"),
  tone: z.string().optional().default("Persuasif"),
  voice: z.string().optional().default("namira"),
  mode: z.literal("3D").default("3D"),
  avatarImagePath: z.string().optional().default("avatars/namira.png"),
});

export async function chatStreamRoutes(server: FastifyInstance) {
  server.post("/api/chat-stream", async (request, reply) => {
    const parsed = chatStreamRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { success: false, error: parsed.error.flatten() };
    }

    const { comment, activeProduct, avatarName, tone, voice, mode } =
      parsed.data;

    try {
      const lunaResponse = await generateLunaResponse(
        comment,
        activeProduct,
        avatarName,
        tone,
      );
      const visemeData = generateVisemesFromText(lunaResponse.speech);
      let linkedProduct = null;
      if (
        lunaResponse.target_product_id &&
        activeProduct &&
        activeProduct.id === lunaResponse.target_product_id
      ) {
        linkedProduct = activeProduct;
      }

      const host = resolveHostId(voice, avatarName);
      const sampleAudioUrl = getHostSampleUrl(host);

      // Pra-live / studio chat: jangan hit Piper. FE putar sampleAudioUrl.
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
            voice: host,
            host,
            durationMs: visemeData.durationMs,
            sampleAudioUrl,
            audioBase64: undefined,
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
        error: err?.message || "chat-stream failed",
      };
    }
  });
}
