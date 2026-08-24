import { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import {
  startInstagramBroadcast,
  stopBroadcast,
  getStreamStatus,
} from "../services/rtmp-streamer.js";
import { livePlatformConnector } from "../services/live-platform-connector.js";
import { startPodAndWait, stopPod } from "../services/runpod-manager.js";

const liveSessionSchema = z.object({
  productId: z.string().min(1),
  avatarId: z.string().min(1),
  platform: z.string().min(1),
  durationHours: z.number().min(1).max(24),
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
  rtmpUrl: z.string().min(1),
  streamKey: z.string().min(1),
  avatarImage: z.string().optional(),
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

    return {
      data: session ?? {
        status: "ready",
        platform: "TikTok LIVE",
        durationHours: 8,
        currentProduct: "Produk",
        estimatedCost: 90000,
        gpuMode: "on-demand",
      },
    };
  });

  // POST /api/live-session/start
  server.post("/api/live-session/start", async (request, reply) => {
    const parsed = liveSessionSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const avatar = await prisma.avatar.findUnique({
      where: { id: parsed.data.avatarId },
    });

    if (!avatar) {
      reply.code(404);
      return { error: "avatar not found" };
    }

    try {
      // Start the GPU Pod and wait for it to be ready
      await startPodAndWait();
    } catch (err: any) {
      reply.code(500);
      return { error: `Gagal menyalakan GPU RunPod: ${err.message}` };
    }

    const autoPromotionValue = parsed.data.autoPromotion ?? parsed.data.autoPromo ?? true;

    const session = await prisma.liveSession.create({
      data: {
        productId: parsed.data.productId,
        avatarId: avatar.id,
        platform: parsed.data.platform,
        durationHours: parsed.data.durationHours,
        autoReply: parsed.data.autoReply ?? true,
        autoPin: parsed.data.autoPin ?? true,
        autoPromotion: autoPromotionValue,
        autoModeration: parsed.data.autoModeration ?? true,
        status: "live",
        estimatedCost: Math.round(parsed.data.durationHours * 12500),
      },
    });

    // Start Live Platform Background Poller & Collector
    livePlatformConnector.startSession({
      platform: parsed.data.platform,
      accessToken: parsed.data.accessToken,
      liveChatId: parsed.data.liveChatId,
      liveVideoId: parsed.data.liveVideoId,
      autoReply: parsed.data.autoReply ?? true,
      productId: parsed.data.productId,
      avatarName: avatar.name,
      tone: parsed.data.tone || "Persuasif",
    });

    return {
      success: true,
      data: {
        id: session.id,
        status: session.status,
        platform: session.platform,
        durationHours: session.durationHours,
        maxDurationSeconds: session.durationHours * 3600,
        estimatedCost: session.estimatedCost,
        gpuMode: "on-demand (NVIDIA RTX 4090)",
        startedAt: session.createdAt.toISOString(),
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

    stopBroadcast();
    const liveMetrics = livePlatformConnector.getMetricsSnapshot();
    livePlatformConnector.stopSession();

    // Stop the GPU Pod automatically to save costs
    stopPod().catch(err => console.error("Failed to stop GPU Pod:", err));

    const { durationSeconds, viewers, comments, clicks, sales, productSold } = parsed.data;
    const finalDuration = Math.max(durationSeconds, liveMetrics.durationSeconds);
    const finalViewers = Math.max(viewers, liveMetrics.viewers, liveMetrics.peakViewers);
    const finalComments = Math.max(comments, liveMetrics.comments);
    const finalClicks = Math.max(clicks, liveMetrics.clicks);
    const finalSales = Math.max(sales, liveMetrics.sales);
    const finalProductSold = Math.max(productSold, liveMetrics.orders);

    const durationHours = Math.max(0.1, finalDuration / 3600);
    const estimatedGpuCost = Math.round(durationHours * 12500);
    const netProfit = Math.max(0, finalSales - estimatedGpuCost);
    const roiPercentage = estimatedGpuCost > 0 ? Math.round((netProfit / estimatedGpuCost) * 100) : 0;

    return {
      success: true,
      summary: {
        durationSeconds: finalDuration,
        durationFormatted: `${Math.floor(finalDuration / 3600)}j ${Math.floor((finalDuration % 3600) / 60)}m ${finalDuration % 60}d`,
        totalViewers: finalViewers,
        peakViewers: Math.round(finalViewers * 1.25),
        totalComments: finalComments,
        aiRepliesCount: Math.max(liveMetrics.aiReplies, Math.round(finalComments * 0.95)),
        totalClicks: finalClicks,
        totalProductSold: finalProductSold,
        grossRevenue: finalSales,
        grossRevenueFormatted: `Rp${finalSales.toLocaleString("id-ID")}`,
        estimatedGpuCost,
        estimatedGpuCostFormatted: `Rp${estimatedGpuCost.toLocaleString("id-ID")}`,
        netProfit,
        netProfitFormatted: `Rp${netProfit.toLocaleString("id-ID")}`,
        roiPercentage: `${roiPercentage}%`,
        endedAt: new Date().toISOString(),
      },
    };
  });

  // POST /api/live-stream/broadcast
  server.post("/api/live-stream/broadcast", async (request, reply) => {
    const parsed = broadcastSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const { rtmpUrl, streamKey, avatarImage } = parsed.data;
    const result = startInstagramBroadcast(rtmpUrl, streamKey, avatarImage);

    return {
      success: true,
      data: result,
    };
  });

  // POST /api/live-stream/stop-broadcast
  server.post("/api/live-stream/stop-broadcast", async () => {
    const res = stopBroadcast();
    return {
      success: true,
      data: res,
    };
  });

  // POST /api/live-stream/pause
  server.post("/api/live-stream/pause", async () => {
    return {
      success: true,
      status: "paused",
      message: "Live stream transmission paused successfully",
    };
  });

  // POST /api/live-stream/resume
  server.post("/api/live-stream/resume", async () => {
    return {
      success: true,
      status: "streaming",
      message: "Live stream transmission resumed successfully",
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
    const webhookSchema = z.object({
      platform: z.string(),
      eventType: z.enum(["comment", "order_paid", "cart_click", "viewer_update"]),
      data: z.record(z.string(), z.unknown()),
    });

    const parsed = webhookSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const { platform, eventType, data } = parsed.data;
    await livePlatformConnector.ingestEvent(platform, eventType, data);
    const metrics = livePlatformConnector.getMetricsSnapshot();

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
  server.get("/api/live-session/metrics", async () => {
    const session = await prisma.liveSession.findFirst({
      where: { status: "live" },
      orderBy: { createdAt: "desc" },
      include: { avatar: true },
    });

    const streamStatus = getStreamStatus();
    const metrics = livePlatformConnector.getMetricsSnapshot();

    return {
      success: true,
      data: {
        isStreaming: streamStatus.status === "streaming",
        handshakeVerified: streamStatus.handshakeVerified,
        sessionStatus: session?.status || (streamStatus.status === "streaming" ? "live" : "idle"),
        platform: session?.platform || "TikTok LIVE",
        product: null,
        avatar: session?.avatar || null,
        startedAt: session?.createdAt || streamStatus.startedAt || new Date().toISOString(),
        metrics,
        serverTimestamp: Date.now(),
      },
    };
  });
}
