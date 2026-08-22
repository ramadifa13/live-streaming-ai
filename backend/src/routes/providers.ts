import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  avatarProvider,
  gpuProvider,
  llmProvider,
  ttsProvider,
} from "../providers/mock-providers.js";

const orchestrationSchema = z.object({
  prompt: z.string().min(1),
  productName: z.string().optional(),
  sellerContext: z.string().optional(),
  avatarId: z.string().optional(),
  platform: z.string().optional(),
});

export async function providersRoutes(server: FastifyInstance) {
  server.get("/api/providers/status", async () => {
    const [llm, tts, avatar, gpu] = await Promise.all([
      llmProvider.getHealth(),
      ttsProvider.getHealth(),
      avatarProvider.getHealth(),
      gpuProvider.getHealth(),
    ]);

    return {
      data: {
        llm,
        tts,
        avatar,
        gpu,
      },
    };
  });

  server.get("/api/providers/avatars", async () => {
    const avatars = await avatarProvider.listAvatars();

    return {
      data: avatars,
      total: avatars.length,
    };
  });

  server.post("/api/providers/orchestrate", async (request, reply) => {
    const parsed = orchestrationSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const avatar = parsed.data.avatarId
      ? await avatarProvider.getAvatar(parsed.data.avatarId)
      : await avatarProvider.getAvatar("alya");

    const llmResponse = await llmProvider.generateResponse({
      prompt: parsed.data.prompt,
      productName: parsed.data.productName,
      sellerContext: parsed.data.sellerContext,
    });

    const voiceConfig = {
      text: llmResponse.text,
      voice: avatar?.voice ?? "Wanita Natural",
      language: avatar?.language ?? "Indonesia",
    };

    const ttsResponse = await ttsProvider.synthesize(voiceConfig);
    const gpuAllocation = await gpuProvider.acquire(
      `${parsed.data.platform ?? "TikTok Live"}-session`,
    );

    return {
      success: true,
      data: {
        pipeline: ["knowledge-base", "llm", "tts", "avatar", "stream"],
        script: llmResponse.text,
        voice: voiceConfig,
        audio: ttsResponse,
        avatar,
        gpu: gpuAllocation,
        estimatedCost:
          llmResponse.cost + ttsResponse.cost + gpuAllocation.costPerMinute * 2,
        etaSeconds: 45,
      },
    };
  });
}
