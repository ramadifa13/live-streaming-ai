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
  updateRunPodBroadcastProduct,
  stopRunPodBroadcast,
  warmupWorker,
  ensureWorkerReachable,
} from "../services/runpod-bridge.js";
import { livePlatformConnector } from "../services/live-platform-connector.js";
import { setLiveSessionActive, stopPod } from "../services/runpod-manager.js";
import { liveSessionManager } from "../services/live-session-manager.js";
import { liveHostOrchestrator, durationHoursToPlan, normalizeClientProduct } from "../services/live-host-orchestrator.js";
import { assertRtmpCredentials } from "../utils/rtmp.js";

const productSnapshotSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  price: z.union([z.string(), z.number()]).optional(),
  stock: z.number().optional(),
  tag: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  benefits: z.string().optional(),
  usage: z.string().optional(),
  faq: z.string().optional(),
  copywriting: z.string().optional(),
  targetAudience: z.string().optional(),
  image: z.string().optional(),
  bannerImage: z.string().optional(),
  scriptBank: z.array(z.any()).optional(),
  faqPack: z.array(z.any()).optional(),
});

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
  product: productSnapshotSchema.optional(),
  products: z.array(productSnapshotSchema).optional(),
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
    .min(5, "RTMP URL tidak boleh kosong")
    .transform((value) => value.trim())
    .refine(
      (value) => /^rtmps?:\/\/.+/i.test(value),
      "RTMP URL harus diawali rtmp:// atau rtmps://",
    ),
  streamKey: z
    .string()
    .min(1, "Stream key tidak boleh kosong")
    .transform((value) => value.replace(/[\r\n\s]/g, ""))
    .refine((value) => value.length > 0, "Stream key tidak boleh kosong"),
  sessionId: z.string().optional(),
  avatarImage: z.string().optional(),
  avatarVideo: z.string().optional(),
  productName: z.string().optional(),
  productPrice: z.string().optional(),
  productImageUrl: z.string().optional(),
  bannerImageUrl: z.string().optional(),
  // Preview-sync fields — used to replicate Step 4 overlay in FFmpeg
  platform: z.string().optional(),
  stockCount: z.number().optional(),
  ctaLabel: z.string().optional(),
  avatarName: z.string().optional(),
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

    const avatarId = parsed.data.avatarId.trim();
    const avatarName = parsed.data.avatarName?.trim();
    const slugName =
      avatarId && avatarId !== "1"
        ? avatarId.charAt(0).toUpperCase() + avatarId.slice(1).toLowerCase()
        : "";

    const avatarById = await prisma.avatar.findUnique({
      where: { id: avatarId },
    });
    const avatar =
      avatarById ||
      (avatarName
        ? await prisma.avatar.findFirst({
            where: { name: avatarName },
          })
        : null) ||
      (slugName
        ? await prisma.avatar.findFirst({
            where: { name: slugName },
          })
        : null) ||
      (await prisma.avatar.findFirst({ orderBy: { createdAt: "asc" } }));

    if (!avatar) {
      reply.code(404);
      return {
        error:
          "Avatar tidak ditemukan. Jalankan seed DB atau kirim avatarName (mis. Namira).",
      };
    }
    try {
      const catalog = (parsed.data.products || [])
        .map((item) => normalizeClientProduct(item))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      const product =
        normalizeClientProduct(parsed.data.product) ||
        catalog.find((item) => item.id === parsed.data.productId) ||
        catalog[0];

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
        product: product || undefined,
        catalog,
      });

      // Balas segera — boot GPU RunPod berjalan async di background.
      reply.code(201);
      return {
        success: true,
        data: {
          id: result.sessionId,
          status: result.state,
          podBooting: true,
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
  // Tahap 1: Kirim stream RTMP ke platform + mulai pipeline generate V1, V2, dst di background.
  // AI host BELUM bicara — worker masih putar idle video.
  // User harus klik "Go Live"/"Mulai Siaran" di Instagram, lalu konfirmasi di dashboard.
  server.post("/api/live-stream/broadcast", async (request, reply) => {
    const parsed = broadcastSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const {
      rtmpUrl: rawRtmpUrl,
      streamKey: rawStreamKey,
      avatarImage,
      avatarVideo,
      sessionId,
      productName,
      productPrice,
      productImageUrl,
      bannerImageUrl,
      platform,
      stockCount,
      ctaLabel,
    } = parsed.data;

    let rtmpUrl: string;
    let streamKey: string;
    try {
      ({ rtmpUrl, streamKey } = assertRtmpCredentials(rawRtmpUrl, rawStreamKey));
    } catch (err) {
      reply.code(400);
      return {
        success: false,
        error: err instanceof Error ? err.message : "RTMP URL / Stream Key tidak valid.",
      };
    }
    const managedSession = parsed.data.sessionId
      ? liveSessionManager.getSession(parsed.data.sessionId)
      : null;
    const liveSession = parsed.data.sessionId
      ? await prisma.liveSession.findUnique({
          where: { id: parsed.data.sessionId },
        })
      : null;

    const sessionIdForBoot = parsed.data.sessionId;
    if (sessionIdForBoot && managedSession) {
      const boot = liveSessionManager.getSessionBootStatus(sessionIdForBoot);
      if (boot && !boot.podReady) {
        if (boot.podFailed) {
          reply.code(502);
          return {
            success: false,
            error: boot.stageText || "GPU RunPod gagal dihidupkan",
            podFailed: true,
          };
        }
        reply.code(409);
        return {
          success: false,
          error:
            "GPU RunPod masih booting. Tunggu hingga siap (polling pipeline-status).",
          podBooting: true,
          stageText: boot.stageText,
        };
      }
    }

    const podId =
      managedSession?.podId ?? process.env.RUNPOD_POD_ID?.trim() ?? null;
    if (managedSession && !podId) {
      reply.code(409);
      return {
        success: false,
        error: "Pod GPU belum dialokasikan untuk sesi ini.",
        podBooting: true,
      };
    }

    // Verifikasi cepat — bootstrap sudah menunggu health penuh di startPodAndWait
    if (podId) {
      try {
        await ensureWorkerReachable(podId, 60);
      } catch (err) {
        reply.code(502);
        return {
          success: false,
          error:
            err instanceof Error
              ? err.message
              : "AI Worker RunPod belum merespons",
        };
      }
    }

    // Jangan kirim data-URL base64 ke worker (bisa >5MB → timeout POST).
    const httpMediaOnly = (url?: string) =>
      url && /^https?:\/\//i.test(url) ? url : undefined;

    // Daftarkan orchestrator dulu agar pipeline-status bisa poll saat MuseTalk boot.
    if (managedSession && liveSession && parsed.data.sessionId) {
      liveHostOrchestrator.startPipelineBackground({
        productId: liveSession.productId,
        avatarName: managedSession.avatarName,
        tone: managedSession.tone,
        voice: liveSession.voice || undefined,
        podId: managedSession.podId ?? podId ?? undefined,
        sessionId: parsed.data.sessionId,
        rtmpUrl,
        streamKey,
        plan: durationHoursToPlan(managedSession.durationHours ?? 2),
        maxDurationMs: (managedSession.durationHours ?? 2) * 3600 * 1000,
        product: managedSession.product,
        catalog: managedSession.catalog,
      });
    }

    // Kickoff RTMP — worker boot MuseTalk async; frontend poll pipeline-status.
    const result = await startRunPodBroadcast(podId, {
      rtmpUrl,
      streamKey,
      productName,
      productPrice,
      productImageUrl: httpMediaOnly(productImageUrl),
      bannerImageUrl: httpMediaOnly(bannerImageUrl),
      platform,
      stockCount,
      ctaLabel,
      hostName:
        parsed.data.avatarName?.trim() ||
        managedSession?.avatarName ||
        "namira",
      waitForReady: false,
    });

    if (!result.success) {
      reply.code(502);
      if (parsed.data.sessionId)
        liveHostOrchestrator.stop(parsed.data.sessionId);
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
      return { success: false, data: result };
    }

    // Update DB ke "pending" — menunggu konfirmasi Go Live
    if (parsed.data.sessionId) {
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
      success: true,
      waitingForGoLive: true,
      message:
        "RTMP aktif — idle video berjalan. Pipeline sedang generate V1+V2 di background. " +
        "Silakan klik 'Siarkan Langsung' / 'Go Live' di " +
        (platform || "platform") +
        ", lalu konfirmasi di dashboard.",
      data: result,
    };
  });

  // POST /api/live-stream/go-live-confirm
  // Tahap 2: Dipanggil setelah user klik "Go Live" di platform dan kembali ke dashboard.
  // Menunggu V1+V2 siap → flush ke GPU queue → AI host mulai bicara.
  server.post("/api/live-stream/go-live-confirm", async (request, reply) => {
    const schema = z.object({
      sessionId: z.string().min(1),
      rtmpUrl: z.string().optional(),
      streamKey: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const { sessionId } = parsed.data;
    const managedSession = liveSessionManager.getSession(sessionId);
    const liveSession = await prisma.liveSession.findUnique({
      where: { id: sessionId },
    });

    if (!managedSession || !liveSession) {
      reply.code(404);
      return { error: "Sesi live tidak ditemukan atau sudah berakhir." };
    }

    try {
      // Pastikan status pipeline sudah siap (RTMP terhubung dan 2 video selesai di-render)
      const pipelineStatus =
        await liveHostOrchestrator.getPipelineStatus(sessionId);
      if (!pipelineStatus.ready) {
        reply.code(400);
        const realtime = /ai_worker|ai-worker|realtime|visual_worker/i.test(
          String(pipelineStatus.broadcastMode || ""),
        );
        const bufferLabel = realtime
          ? `buffer ucapan ${pipelineStatus.utteranceQueueCount ?? pipelineStatus.videosQueued}/2`
          : `video ${pipelineStatus.generationCount}/2`;
        return {
          success: false,
          error: `Belum siap untuk Go Live: pastikan RTMP terhubung dan ${bufferLabel} siap (RTMP: ${pipelineStatus.isRtmpConnected ? "Terhubung" : "Belum Terhubung"}, buffer: ${pipelineStatus.bufferSeconds ?? 0}s).`,
        };
      }

      // markBroadcastLive handles worker playback + startLivePipeline + DB update
      await liveSessionManager.markBroadcastLive(sessionId);

      console.log(
        `[GoLiveConfirm] ✅ Session ${sessionId}: AI Host aktif! Live streaming dimulai.`,
      );
      return {
        success: true,
        message: "AI Host aktif! V1+V2 sudah diputar, pipeline terus berjalan.",
        sessionId,
        startedAt: new Date().toISOString(),
        pipelineStatus: await liveHostOrchestrator.getPipelineStatus(sessionId),
      };
    } catch (error) {
      reply.code(502);
      return {
        success: false,
        error: `Gagal memulai AI Host: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  // GET /api/live-stream/pipeline-status?sessionId=xxx
  // Polling endpoint untuk frontend: cek apakah RTMP aktif dan 2 video sudah selesai dirender di GPU.
  server.get("/api/live-stream/pipeline-status", async (request) => {
    const { sessionId } = request.query as { sessionId?: string };
    if (!sessionId) {
      return {
        ready: false,
        generationCount: 0,
        videosQueued: 0,
        pendingCount: 0,
        isLive: false,
        isBroadcasting: false,
      };
    }

    const status = await liveHostOrchestrator.getPipelineStatus(sessionId);
    const boot = liveSessionManager.getSessionBootStatus(sessionId);

    if (boot && !boot.podReady && boot.podBooting) {
      return {
        ready: false,
        generationCount: 0,
        videosQueued: 0,
        pendingCount: 0,
        isLive: false,
        isBroadcasting: false,
        isRtmpConnected: false,
        stageIndex: 0,
        stageText: boot.stageText,
        podReady: false,
        podBooting: true,
        podFailed: false,
      };
    }

    if (boot?.podFailed) {
      return {
        ready: false,
        generationCount: 0,
        videosQueued: 0,
        pendingCount: 0,
        isLive: false,
        isBroadcasting: false,
        isRtmpConnected: false,
        stageIndex: 0,
        stageText: boot.stageText,
        podReady: false,
        podBooting: false,
        podFailed: true,
      };
    }

    if (
      status.stageText === "Session tidak ditemukan." &&
      liveSessionManager.getSession(sessionId)
    ) {
      return {
        ready: false,
        generationCount: 0,
        videosQueued: 0,
        pendingCount: 0,
        isLive: false,
        isBroadcasting: false,
        isRtmpConnected: false,
        workerOffline: false,
        stageIndex: 1,
        stageText:
          boot?.podReady === false
            ? boot.stageText || "Menghubungkan ke Cloud GPU..."
            : "Memulai broadcast RTMP — memuat model MuseTalk ke GPU...",
        podReady: boot?.podReady ?? true,
        podBooting: boot?.podBooting ?? false,
        podFailed: boot?.podFailed ?? false,
      };
    }
    return {
      ...status,
      podReady: boot?.podReady ?? true,
      podBooting: boot?.podBooting ?? false,
      podFailed: boot?.podFailed ?? false,
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
      sessionId: z.string().optional(),
      product: productSnapshotSchema.optional(),
    });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    try {
      const latestSession = parsed.data.sessionId
        ? await prisma.liveSession.findFirst({
            where: { id: parsed.data.sessionId },
          })
        : await prisma.liveSession.findFirst({
            where: { status: "live" },
            orderBy: { createdAt: "desc" },
          });
      if (latestSession) {
        await prisma.liveSession.update({
          where: { id: latestSession.id },
          data: { productId: parsed.data.productId },
        });
        const snapshot = normalizeClientProduct(parsed.data.product);
        liveHostOrchestrator.switchProduct(
          latestSession.id,
          parsed.data.productId,
          snapshot || undefined,
        );

        const managedSession = liveSessionManager.getSession(latestSession.id);
        if (snapshot && managedSession) {
          managedSession.product = snapshot;
          const exists = managedSession.catalog.some((item) => item.id === snapshot.id);
          if (!exists) managedSession.catalog.push(snapshot);
        }
        const switchedProd = snapshot || managedSession?.product;
        if (switchedProd) {
          const podId = managedSession?.podId;
          updateRunPodBroadcastProduct(podId, {
            productName: switchedProd.name,
            productPrice: String(switchedProd.price),
            productImageUrl: switchedProd.image || undefined,
            bannerImageUrl: switchedProd.bannerImage || undefined,
          }).catch(() => {});
        }
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
        sessionId: sessionId || null,
        platform: session?.platform || "TikTok LIVE",
        product: managedSession?.product ?? null,
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
