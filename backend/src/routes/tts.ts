import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  HOST_VOICES,
  resolveVoiceId,
  synthesizeSpeech,
} from "../services/tts.js";
import { liveSessionManager } from "../services/live-session-manager.js";

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
  /** Studio preview — butuh AI Worker GPU (tidak ada TTS lokal). */
  allowOfflineSynth: z.boolean().optional(),
});

function resolveLivePodId(sessionId?: string): string | null {
  if (sessionId) {
    const s = liveSessionManager.getSession(sessionId);
    if (s?.podId && (s.state === "live" || s.state === "pending")) {
      return s.podId;
    }
  }
  const staticId = (process.env.RUNPOD_POD_ID || "").trim();
  return staticId || null;
}

export async function ttsRoutes(server: FastifyInstance) {
  // GET /api/tts/voices — voice_id profiles
  server.get("/api/tts/voices", async () => {
    return {
      success: true,
      data: HOST_VOICES.map((h) => ({
        id: h.id,
        name: h.name,
        gender: h.gender,
        locale: h.locale,
        style: h.style,
        engine: "voxcpm2",
        voiceId: h.id,
        avatarMatch: h.name,
      })),
    };
  });

  server.get<{ Params: { host: string } }>(
    "/api/tts/sample/:host",
    async (request) => {
      const voiceId = resolveVoiceId(request.params.host);
      return {
        success: true,
        data: {
          host: voiceId,
          voiceId,
          sampleAudioUrl: null,
          note: "Ganti reference di voices/<voice_id>/reference.wav. Preview memakai VoxCPM2 di AI Worker.",
        },
      };
    },
  );

  // POST /api/tts/synthesize — VoxCPM2 via AI Worker
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

    const sessionPod = resolveLivePodId(parsed.data.sessionId);
    const allowOffline = parsed.data.allowOfflineSynth === true;
    if (!sessionPod && !allowOffline) {
      reply.code(403);
      return {
        success: false,
        error:
          "TTS VoxCPM2 butuh sesi live atau allowOfflineSynth (dengan AI Worker GPU).",
        voiceId,
        engine: "voxcpm2",
      };
    }

    const result = await synthesizeSpeech({
      ...parsed.data,
      voiceId,
      host: voiceId,
      voice: voiceId,
      style: parsed.data.style || parsed.data.tone,
      podId: sessionPod,
      allowOfflineSynth: allowOffline || Boolean(sessionPod),
    });

    if (result.success && result.audioBuffer && result.audioBuffer.length > 0) {
      reply.header("Content-Type", "audio/wav");
      reply.header(
        "X-Voice-Duration-Est",
        result.durationEstimateSeconds.toString(),
      );
      reply.header("X-TTS-Voice-Id", voiceId);
      reply.header("X-TTS-Engine", "voxcpm2");
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

    reply.code(result.message.includes("Pra-live") ? 403 : 502);
    return {
      success: false,
      error: result.message || "TTS synthesis failed",
      engine: "voxcpm2",
      voiceId,
    };
  });
}
