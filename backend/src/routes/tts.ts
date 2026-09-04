import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  HOST_VOICES,
  getHostSampleUrl,
  resolveHostId,
  synthesizeSpeech,
} from "../services/tts.js";
import { liveSessionManager } from "../services/live-session-manager.js";

const synthesizeSchema = z.object({
  text: z.string().min(1),
  host: z.string().optional(),
  voice: z.string().optional(),
  avatarName: z.string().optional().default("Namira"),
  speed: z.number().optional().default(1.0),
  pitch: z.number().optional().default(1.0),
  tone: z.string().optional(),
  emotion: z.string().optional(),
  sessionId: z.string().optional(),
  /** Internal/dev only — FE jangan set ini untuk preview. */
  allowOfflineSynth: z.boolean().optional(),
});

function resolveLivePodId(sessionId?: string): string | null {
  if (sessionId) {
    const s = liveSessionManager.getSession(sessionId);
    if (s?.podId && (s.state === "live" || s.state === "pending")) {
      return s.podId;
    }
  }
  // Sesi live aktif mana pun
  // (single-session product — ambil dari env static bila ada)
  const staticId = (process.env.RUNPOD_POD_ID || "").trim();
  return staticId || null;
}

export async function ttsRoutes(server: FastifyInstance) {
  // GET /api/tts/voices — host voices + sample pra-live
  server.get("/api/tts/voices", async () => {
    return {
      success: true,
      data: HOST_VOICES.map((h) => ({
        id: h.id,
        name: h.name,
        gender: h.gender,
        locale: h.locale,
        style: h.style,
        engine: "piper",
        sampleAudioUrl: h.sampleAudioUrl,
        avatarMatch: h.name,
      })),
    };
  });

  // GET /api/tts/sample/:host — metadata sample pra-live (fallback)
  server.get<{ Params: { host: string } }>(
    "/api/tts/sample/:host",
    async (request) => {
      const host = resolveHostId(request.params.host);
      return {
        success: true,
        data: {
          host,
          sampleAudioUrl: getHostSampleUrl(host),
          note: "Fallback sample. Studio preview & live memakai Piper.",
        },
      };
    },
  );

  // POST /api/tts/synthesize — Piper (live + studio preview via allowOfflineSynth)
  server.post("/api/tts/synthesize", async (request, reply) => {
    const parsed = synthesizeSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const host = resolveHostId(
      parsed.data.host || parsed.data.voice,
      parsed.data.avatarName,
    );
    const sampleAudioUrl = getHostSampleUrl(host);

    const sessionPod = resolveLivePodId(parsed.data.sessionId);
    const allowOffline = parsed.data.allowOfflineSynth === true;
    if (!sessionPod && !allowOffline) {
      reply.code(403);
      return {
        success: false,
        error:
          "TTS Piper butuh sesi live atau allowOfflineSynth untuk preview studio.",
        host,
        sampleAudioUrl,
        engine: "sample",
      };
    }

    const result = await synthesizeSpeech({
      ...parsed.data,
      host,
      voice: host,
      podId: sessionPod,
      allowOfflineSynth: allowOffline || Boolean(sessionPod),
    });

    if (result.success && result.audioBuffer && result.audioBuffer.length > 0) {
      const isWav =
        result.audioBuffer.length >= 4 &&
        result.audioBuffer.toString("ascii", 0, 4) === "RIFF";
      reply.header("Content-Type", isWav ? "audio/wav" : "audio/mpeg");
      reply.header(
        "X-Voice-Duration-Est",
        result.durationEstimateSeconds.toString(),
      );
      reply.header("X-TTS-Host", host);
      reply.header("X-TTS-Engine", result.engine);
      return reply.send(result.audioBuffer);
    }

    reply.code(result.engine === "sample" ? 403 : 502);
    return {
      success: false,
      error: result.message || "TTS synthesis failed",
      engine: result.engine,
      host,
      sampleAudioUrl: result.sampleAudioUrl || sampleAudioUrl,
    };
  });
}
