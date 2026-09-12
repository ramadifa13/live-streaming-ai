import { FastifyInstance } from "fastify";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { HOST_VOICES, resolveVoiceId, synthesizeSpeech } from "../services/tts.js";

const synthesizeSchema = z.object({
  text: z.string().min(1),
  voiceId: z.string().optional(),
  host: z.string().optional(),
  voice: z.string().optional(),
  avatarName: z.string().optional().default("Namira"),
  speed: z.number().optional().default(1.0),
  pitch: z.number().optional().default(1.0),
  tone: z.string().optional(),
  emotion: z.string().optional(),
  style: z.string().optional(),
  lang: z.string().optional(),
  sessionId: z.string().optional(),
  requestId: z.string().optional(),
  allowOfflineSynth: z.boolean().optional(),
});

const voiceRoot = path.resolve(process.cwd(), "voices");

export async function ttsRoutes(server: FastifyInstance) {
  server.get("/api/tts/voices", async () => {
    return {
      success: true,
      data: HOST_VOICES.map((h) => ({
        id: h.id,
        name: h.name,
        gender: h.gender,
        locale: h.locale,
        style: h.style,
        engine: "pocket-tts-indonesian",
        voiceId: h.id,
        avatarMatch: h.name,
      })),
    };
  });

  server.get<{ Params: { host: string } }>("/api/tts/sample/:host", async (request) => {
    const voiceId = resolveVoiceId(request.params.host);
    const referencePath = path.join(voiceRoot, voiceId, "reference.wav");
    return {
      success: true,
      data: {
        host: voiceId,
        voiceId,
        sampleAudioUrl: `/api/tts/voices/${voiceId}/reference`,
        sampleAudioUrlEn: `/api/tts/voices/${voiceId}/reference`,
        note: "Preview dan live memakai Pocket TTS di backend.",
        referenceAvailable: await fs
          .stat(referencePath)
          .then(() => true)
          .catch(() => false),
      },
    };
  });

  server.get<{ Params: { voiceId: string } }>("/api/tts/voices/:voiceId/reference", async (request, reply) => {
    const voiceId = resolveVoiceId(request.params.voiceId);
    if (!HOST_VOICES.some((voice) => voice.id === voiceId)) {
      reply.code(404);
      return { error: "Voice tidak ditemukan" };
    }
    const audio = await fs.readFile(path.join(voiceRoot, voiceId, "reference.wav"));
    return reply.type("audio/wav").send(audio);
  });

  server.post<{ Params: { voiceId: string } }>("/api/tts/voices/:voiceId/reference", async (request, reply) => {
    const voiceId = resolveVoiceId(request.params.voiceId);
    if (!HOST_VOICES.some((voice) => voice.id === voiceId)) {
      reply.code(404);
      return { error: "Voice tidak ditemukan" };
    }
    const upload = await request.file();
    if (!upload) {
      reply.code(400);
      return { error: "Kirim file reference WAV pada multipart field 'file'" };
    }
    const buffer = await upload.toBuffer();
    if (!buffer.length) {
      reply.code(400);
      return { error: "File reference kosong" };
    }
    await fs.mkdir(path.join(voiceRoot, voiceId), { recursive: true });
    await fs.writeFile(path.join(voiceRoot, voiceId, "reference.wav"), buffer);
    return { success: true, voiceId, engine: "pocket-tts-indonesian" };
  });

  server.post("/api/tts/synthesize", async (request, reply) => {
    const parsed = synthesizeSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const voiceId = resolveVoiceId(
      parsed.data.voiceId || parsed.data.host || parsed.data.voice,
      parsed.data.avatarName,
    );

    const result = await synthesizeSpeech({
      ...parsed.data,
      voiceId,
      host: voiceId,
      voice: voiceId,
      style: parsed.data.style || parsed.data.tone,
      allowOfflineSynth: true,
    });

    if (result.success && result.audioBuffer && result.audioBuffer.length > 0) {
      reply.header("Content-Type", "audio/wav");
      reply.header("X-Voice-Duration-Est", result.durationEstimateSeconds.toString());
      reply.header("X-TTS-Voice-Id", voiceId);
      reply.header("X-TTS-Engine", "pocket-tts-indonesian");
      if (result.metrics?.latencyMs != null) {
        reply.header("X-TTS-Latency-Ms", String(result.metrics.latencyMs));
      }
      if (result.metrics?.rtf != null) {
        reply.header("X-TTS-RTF", String(result.metrics.rtf));
      }
      if (result.metrics?.audioDuration != null) {
        reply.header("X-TTS-Audio-Duration", String(result.metrics.audioDuration));
      }
      return reply.send(result.audioBuffer);
    }

    reply.code(502);
    return {
      success: false,
      error: "Gagal menyiapkan suara host.",
      engine: "pocket-tts-indonesian",
      voiceId,
    };
  });
}
