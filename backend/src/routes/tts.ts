import { FastifyInstance } from "fastify";
import { z } from "zod";
import { INDONESIAN_VOICES, synthesizeSpeech } from "../services/tts.js";

const synthesizeSchema = z.object({
  text: z.string().min(1),
  voice: z.string().optional(),
  avatarName: z.string().optional().default("Namira"),
  speed: z.number().optional().default(1.0),
  pitch: z.number().optional().default(1.0),
});

export async function ttsRoutes(server: FastifyInstance) {
  // GET /api/tts/voices - List all available Indonesian Neural voices
  server.get("/api/tts/voices", async () => {
    return {
      success: true,
      data: INDONESIAN_VOICES,
    };
  });

  // POST /api/tts/synthesize - Synthesize speech from text
  server.post("/api/tts/synthesize", async (request, reply) => {
    const parsed = synthesizeSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const result = await synthesizeSpeech(parsed.data);

    if (result.audioBuffer) {
      const isWav =
        result.audioBuffer.length >= 4 &&
        result.audioBuffer.toString("ascii", 0, 4) === "RIFF";
      const contentType = isWav ? "audio/wav" : "audio/mpeg";
      reply.header("Content-Type", contentType);
      reply.header(
        "X-Voice-Duration-Est",
        result.durationEstimateSeconds.toString(),
      );
      return reply.send(result.audioBuffer);
    }

    return {
      success: true,
      data: result,
    };
  });
}
