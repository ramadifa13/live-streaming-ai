import { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import {
  stopBroadcast,
  pauseBroadcast,
  resumeBroadcast,
  getStreamStatus,
} from "../services/rtmp-streamer.js";
import {
  getRunPodBroadcastStatus,
  startRunPodBroadcast,
  stopRunPodBroadcast,
  warmupWorker,
} from "../services/runpod-bridge.js";
import { livePlatformConnector } from "../services/live-platform-connector.js";
import { setLiveSessionActive, stopPod } from "../services/runpod-manager.js";
import { liveSessionManager } from "../services/live-session-manager.js";
import { liveHostOrchestrator } from "../services/live-host-orchestrator.js";

const liveSessionSchema = z.object({
  productId: z.string().min(1),
  avatarId: z.string().min(1),
  voice: z.string().optional(),
  platform: z.string().min(1),
  durationHours: z.number().int().min(1).default(1),
  autoReply: z.boolean().optional(),
  autoPin: z.boolean().optional(),
  autoPromotion: z.boolean().optional(),
  autoPromo: z.boolean().optional(),
  autoModeration: z.boolean().optional(),
  accessToken: z.string().optional(),
  liveChatId: z.string().optional(),
  liveVideoId: z.string().optional(),
  avatarName: z.string().optional(),
  tone: z.string().optional(),
});

const liveStopSchema = z.object({
  sessionId: z.string().optional(),
  durationSeconds: z.number().optional().default(0),
  viewers: z.number().optional().default(0),
  comments: z.number().optional().default(0),
  clicks: z.number().optional().default(0),
  sales: z.number().optional().default(0),
  productSold: z.number().optional().default(0),
});

const broadcastSchema = z.object({
  rtmpUrl: z
    .string()
    .url()
    .refine(
      (value) => /^rtmps?:\/\//i.test(value),
      "RTMP URL harus diawali rtmp:// atau rtmps://",
    ),
  streamKey: z
    .string()
    .min(1)
    .refine((value) => !/[\r\n/]/.test(value), "Stream key tidak valid"),
  sessionId: z.string().optional(),
  avatarImage: z.string().optional(),
  avatarVideo: z.string().optional(),
  productName: z.string().optional(),
  productPrice: z.string().optional(),
  productImageUrl: z.string().optional(),
  // Preview-sync fields — used to replicate Step 4 overlay in FFmpeg
  platform: z.string().optional(),
  stockCount: z.number().optional(),
  ctaLabel: z.string().optional(),
});

export async function liveSessionRoutes(server: FastifyInstance) {
  // GET /api/live-session
  server.get("/api/live-session", async () => {
    const session = await prisma.liveSession.findFirst({
      orderBy: { createdAt: "desc" },
      include: {
        avatar: true,
      },
    });

    const managedSession = session?.id
      ? liveSessionManager.getSession(session.id)
      : null;
    const effectiveStatus = managedSession?.state || session?.status || "ready";

    return {
      data: session
        ? session
        : {
            status: effectiveStatus,
          },
    };
  });

  server.post("/api/live-session/start", async (request, reply) => {
    const parsed = liveSessionSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const avatarById = await prisma.avatar.findUnique({
      where: { id: parsed.data.avatarId },
    });
    const avatar =
      avatarById ||
      (parsed.data.avatarName
        ? await prisma.avatar.findFirst({
            where: { name: parsed.data.avatarName },
          })
        : null);

    if (!avatar) {
      reply.code(404);
      return { error: "avatar not found" };
    }
    if (avatar.name.toLowerCase() !== "namira") {
      reply.code(400);
      return { error: "Demo hanya mendukung AI Host Namira" };
    }

    try {
      const result = await liveSessionManager.startSession({
        productId: parsed.data.productId,
        avatarId: avatar.id,
        platform: parsed.data.platform,
        durationHours: parsed.data.durationHours,
        autoReply: parsed.data.autoReply ?? true,
        autoPin: parsed.data.autoPin ?? true,
        autoPromotion:
          parsed.data.autoPromotion ?? parsed.data.autoPromo ?? true,
        autoModeration: parsed.data.autoModeration ?? true,
        accessToken: parsed.data.accessToken,
        liveChatId: parsed.data.liveChatId,
        liveVideoId: parsed.data.liveVideoId,
        avatarName: avatar.name,
        voice: parsed.data.voice || avatar.voice || undefined,
        tone: parsed.data.tone || "Persuasif",
      });

      return {
        success: true,
        data: {
          id: result.sessionId,
          status: result.state,
          platform: parsed.data.platform,
          voice: parsed.data.voice || avatar.voice || null,
          durationHours: parsed.data.durationHours,
          maxDurationSeconds: parsed.data.durationHours * 3600,
          estimatedCost: Math.round(parsed.data.durationHours * 12500),
          gpuMode: "on-demand (NVIDIA RTX 4090)",
          startedAt: new Date().toISOString(),
        },
      };
    } catch (err: any) {
      reply.code(500);
      return { error: `Gagal memulai sesi live: ${err.message}` };
    }
  });

  // POST /api/live-session/preferences
  server.post("/api/live-session/preferences", async (request, reply) => {
    const bodySchema = z.object({
      voice: z.string().min(1).optional(),
    });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    liveSessionManager.setPendingVoicePreference(parsed.data.voice ?? null);
    return {
      success: true,
      data: {
        voice: liveSessionManager.getPendingVoicePreference(),
      },
    };
  });

  // POST /api/live-session/stop
  server.post("/api/live-session/stop", async (request, reply) => {
    const parsed = liveStopSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    if (parsed.data.sessionId) liveHostOrchestrator.stop(parsed.data.sessionId);
    const sessionObj = liveSessionManager.getSession(
      parsed.data.sessionId || "",
    );
    await stopRunPodBroadcast(sessionObj?.podId).catch(() => {});
    stopBroadcast();
    const result = await liveSessionManager.stopSession(
      parsed.data.sessionId || "",
      {
        durationSeconds: parsed.data.durationSeconds,
        viewers: parsed.data.viewers,
        comments: parsed.data.comments,
        clicks: parsed.data.clicks,
        sales: parsed.data.sales,
        productSold: parsed.data.productSold,
      },
    );

    return {
      success: result.success,
      summary: result.summary,
    };
  });

  // POST /api/live-stream/broadcast
  server.post("/api/live-stream/broadcast", async (request, reply) => {
    const parsed = broadcastSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const {
      rtmpUrl,
      streamKey,
      avatarImage,
      avatarVideo,
      sessionId,
      productName,
      productPrice,
      platform,
      stockCount,
      ctaLabel,
    } = parsed.data;
    const managedSession = parsed.data.sessionId
      ? liveSessionManager.getSession(parsed.data.sessionId)
      : null;
    const liveSession = parsed.data.sessionId
      ? await prisma.liveSession.findUnique({
          where: { id: parsed.data.sessionId },
        })
      : null;

    if (parsed.data.sessionId && managedSession && liveSession) {
      try {
        await warmupWorker(managedSession?.podId);

        const hostConfig = {
          productId: liveSession.productId,
          avatarName: managedSession.avatarName,
          tone: managedSession.tone,
          rtmpUrl,
          streamKey,
          voice: liveSession.voice || undefined,
          podId: managedSession.podId,
          sessionId: parsed.data.sessionId,
        };

        // Pastikan 2 video awal AI sudah 100% selesai di-render sebelum RTMP siaran dimulai
        await liveHostOrchestrator.prepareInitialVideos(hostConfig, 2);

        // Mulai background orchestrator untuk siaran langsung berkelanjutan
        liveHostOrchestrator.start(hostConfig);
      } catch (error) {
        if (parsed.data.sessionId)
          liveHostOrchestrator.stop(parsed.data.sessionId);
        if (parsed.data.sessionId)
          await liveSessionManager
            .stopSession(parsed.data.sessionId)
            .catch(() => {});
        reply.code(502);
        return {
          success: false,
          error: `AI Worker pre-buffer gagal (2 video awal belum siap): ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    const result = await startRunPodBroadcast(managedSession?.podId, {
      rtmpUrl,
      streamKey,
    });

    if (result.success && parsed.data.sessionId) {
      if (parsed.data.sessionId)
        await liveSessionManager.markBroadcastLive(parsed.data.sessionId);
    }

    if (!result.success) {
      reply.code(502);
      if (parsed.data.sessionId)
        await liveSessionManager
          .stopSession(parsed.data.sessionId)
          .catch(() => {});
      if (sessionId) {
        await prisma.liveSession
          .updateMany({
            where: {
              id: sessionId as string,
              status: { in: ["starting", "pending"] },
            },
            data: { status: "ended" },
          })
          .catch(() => {});
      }
    } else if (parsed.data.sessionId) {
      await prisma.liveSession
        .updateMany({
          where: {
            id: sessionId as string,
            status: { in: ["starting", "pending"] },
          },
          data: { status: "pending" },
        })
        .catch(() => {});
    }

    return {
      success: result.success,
      data: result,
    };
  });

  // POST /api/live-stream/stop-broadcast
  server.post("/api/live-stream/stop-broadcast", async (request, reply) => {
    const parsed = liveStopSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }
    if (parsed.data.sessionId) liveHostOrchestrator.stop(parsed.data.sessionId);
    const sessionObj = liveSessionManager.getSession(
      parsed.data.sessionId || "",
    );
    await stopRunPodBroadcast(sessionObj?.podId).catch(() => {});
    const res = stopBroadcast();
    return {
      success: true,
      data: res,
    };
  });

  // POST /api/live-stream/pause
  server.post("/api/live-stream/pause", async () => {
    const result = pauseBroadcast();
    if (!result.success) {
      return { success: false, data: result };
    }
    return {
      success: result.success,
      data: result,
    };
  });

  // POST /api/live-stream/resume
  server.post("/api/live-stream/resume", async () => {
    const result = await resumeBroadcast();
    if (!result.success) {
      return { success: false, data: result };
    }
    return {
      success: result.success,
      data: result,
    };
  });

  // POST /api/live-session/switch-product
  server.post("/api/live-session/switch-product", async (request, reply) => {
    const bodySchema = z.object({
      productId: z.string().min(1),
      productName: z.string().optional(),
    });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    try {
      const latestSession = await prisma.liveSession.findFirst({
        where: { status: "live" },
        orderBy: { createdAt: "desc" },
      });
      if (latestSession) {
        await prisma.liveSession.update({
          where: { id: latestSession.id },
          data: { productId: parsed.data.productId },
        });
      }
    } catch {}

    return {
      success: true,
      activeProductId: parsed.data.productId,
      message: `Active live product switched to ${parsed.data.productName || parsed.data.productId}`,
    };
  });

  // POST /api/webhooks/platform-events
  server.post("/api/webhooks/platform-events", async (request, reply) => {
    const sessionId = (request.query as any).sessionId;
    if (!sessionId) {
      reply.code(400);
      return { error: "Missing sessionId in query" };
    }
    const webhookSchema = z.object({
      platform: z.string(),
      eventType: z.enum([
        "comment",
        "order_paid",
        "cart_click",
        "viewer_update",
      ]),
      data: z.record(z.string(), z.unknown()),
    });

    const parsed = webhookSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const { platform, eventType, data } = parsed.data;
    await livePlatformConnector.ingestEvent(
      sessionId,
      platform,
      eventType,
      data,
    );
    const metrics = livePlatformConnector.getMetricsSnapshot(sessionId || "");

    return {
      success: true,
      receivedAt: new Date().toISOString(),
      eventType,
      currentMetrics: {
        viewers: metrics.viewers,
        comments: metrics.comments,
        clicks: metrics.clicks,
        sales: metrics.sales,
      },
    };
  });

  // GET /api/live-session/metrics
  server.get("/api/live-session/metrics", async (request) => {
    const querySessionId = (request.query as any).sessionId;
    const session = querySessionId
      ? await prisma.liveSession.findUnique({
          where: { id: querySessionId },
          include: { avatar: true },
        })
      : await prisma.liveSession.findFirst({
          where: { status: { in: ["starting", "pending", "live"] } },
          orderBy: { createdAt: "desc" },
          include: { avatar: true },
        });

    const sessionId = session?.id || "";
    const managedSession = sessionId
      ? liveSessionManager.getSession(sessionId)
      : null;
    const streamStatus = getStreamStatus();
    const workerBroadcast = await getRunPodBroadcastStatus(
      managedSession?.podId,
    ).catch(() => null);
    const metrics = livePlatformConnector.getMetricsSnapshot(sessionId);

    const sessionStatus = managedSession?.state || session?.status || "idle";

    return {
      success: true,
      data: {
        isStreaming:
          workerBroadcast?.status === "streaming" ||
          streamStatus.status === "streaming",
        handshakeVerified:
          workerBroadcast?.status === "streaming" ||
          streamStatus.handshakeVerified,
        sessionStatus,
        platform: session?.platform || "TikTok LIVE",
        product: null,
        avatar: session?.avatar || null,
        startedAt:
          session?.createdAt ||
          streamStatus.startedAt ||
          new Date().toISOString(),
        metrics,
        serverTimestamp: Date.now(),
      },
    };
  });
}
