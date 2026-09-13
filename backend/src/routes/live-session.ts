import { createHmac } from "node:crypto";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { getPlanById } from "../config/plans.js";
import { requireOrderForSession, requireStartableOrder, sendEntitlementError } from "../lib/entitlement.js";
import { EntitlementError, safeEqualString } from "../lib/order-ticket.js";
import { rateLimitPreHandler } from "../lib/rate-limit.js";
import { stopBroadcast, pauseBroadcast, resumeBroadcast, getStreamStatus } from "../services/rtmp-streamer.js";
import {
  getRunPodBroadcastStatusOnce,
  startRunPodBroadcast,
  updateRunPodBroadcastProduct,
  stopRunPodBroadcast,
  ensureWorkerReachable,
  pauseRunPodBroadcast,
  resumeRunPodBroadcast,
  resolveMediaAsDataUrl,
} from "../services/runpod-bridge.js";
import { livePlatformConnector } from "../services/live-platform-connector.js";
import { liveSessionManager } from "../services/live-session-manager.js";
import { liveHostOrchestrator, durationHoursToPlan, normalizeClientProduct } from "../services/live-host-orchestrator.js";
import { assertRtmpCredentials } from "../utils/rtmp.js";

function verifyPlatformWebhook(request: { headers: Record<string, unknown>; body: unknown }): boolean {
  const secret = (process.env.PLATFORM_WEBHOOK_SECRET || "").trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = request.headers["x-livio-signature"];
  if (typeof header !== "string" || !header) return false;
  const expected = createHmac("sha256", secret).update(JSON.stringify(request.body || {})).digest("hex");
  return safeEqualString(header, expected);
}

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
  voiceId: z.string().optional(),
  style: z.string().optional(),
  lang: z.string().optional(),
  speechSpeed: z.number().optional(),
  platform: z.string().min(1),
  orderId: z.string().optional(),
  resumeCode: z.string().optional(),
  durationHours: z.number().int().min(1).optional(),
  autoReply: z.boolean().optional(),
  autoPin: z.boolean().optional(),
  autoPromotion: z.boolean().optional(),
  autoPromo: z.boolean().optional(),
  autoModeration: z.boolean().optional(),
  liveChatId: z.string().optional(),
  liveVideoId: z.string().optional(),
  avatarName: z.string().optional(),
  tone: z.string().optional(),
  product: productSnapshotSchema.optional(),
  products: z.array(productSnapshotSchema).optional(),
  backgroundImage: z.string().optional(),
  clientRequestId: z.string().min(8).max(128).optional(),
});

const liveStopSchema = z.object({
  sessionId: z.string().min(1),
  orderId: z.string().optional(),
  resumeCode: z.string().optional(),
  endedReason: z.enum(["user_ended", "prepare_failed"]).optional(),
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
    .min(5, "Alamat server siaran tidak boleh kosong")
    .transform((value) => value.trim())
    .refine((value) => /^rtmps?:\/\/.+/i.test(value), "Alamat server siaran tidak valid. Salin persis dari aplikasi live Anda."),
  streamKey: z
    .string()
    .min(1, "Kode siaran tidak boleh kosong")
    .transform((value) => value.replace(/[\r\n\s]/g, ""))
    .refine((value) => value.length > 0, "Kode siaran tidak boleh kosong"),
  sessionId: z.string().optional(),
  avatarImage: z.string().optional(),
  avatarVideo: z.string().optional(),
  productName: z.string().optional(),
  productPrice: z.string().optional(),
  productImageUrl: z.string().optional(),
  bannerImageUrl: z.string().optional(),
  backgroundImage: z.string().optional(),
  platform: z.string().optional(),
  stockCount: z.number().optional(),
  ctaLabel: z.string().optional(),
  avatarName: z.string().optional(),
});

export async function liveSessionRoutes(server: FastifyInstance) {
  server.get("/api/live-session", { preHandler: rateLimitPreHandler("live-session-get", 30, 60_000) }, async (request, reply) => {
    try {
      const order = await requireStartableOrder(request);
      const session = order.sessionId
        ? await prisma.liveSession.findUnique({
            where: { id: order.sessionId },
            include: { avatar: true },
          })
        : null;
      const managedSession = session?.id ? liveSessionManager.getSession(session.id) : null;
      return {
        data: session
          ? { ...session, status: managedSession?.state || session.status }
          : { status: "ready", orderId: order.id },
      };
    } catch (err) {
      return sendEntitlementError(reply, err);
    }
  });

  server.post("/api/live-session/start", { preHandler: rateLimitPreHandler("live-session-start", 6, 10 * 60_000) }, async (request, reply) => {
    const parsed = liveSessionSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const avatarId = parsed.data.avatarId.trim();
    const avatarName = parsed.data.avatarName?.trim();
    const slugName = avatarId && avatarId !== "1" ? avatarId.charAt(0).toUpperCase() + avatarId.slice(1).toLowerCase() : "";

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
        error: "Host AI tidak ditemukan. Pilih host lain, lalu coba lagi.",
      };
    }
    try {
      const order = await requireStartableOrder(request);
      const plan = getPlanById(order.planId);
      if (!plan) {
        reply.code(409);
        return { error: "Paket order tidak valid." };
      }
      const catalog = (parsed.data.products || [])
        .map((item) => normalizeClientProduct(item))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      const product = normalizeClientProduct(parsed.data.product) || catalog.find((item) => item.id === parsed.data.productId) || catalog[0];

      const result = await liveSessionManager.startSession({
        productId: parsed.data.productId,
        avatarId: avatar.id,
        platform: parsed.data.platform,
        durationHours: order.durationHours,
        autoReply: plan.automations.autoReply,
        autoPin: plan.automations.autoPin,
        autoPromotion: plan.automations.autoPromo,
        autoModeration: plan.automations.autoModeration,
        liveChatId: parsed.data.liveChatId,
        liveVideoId: parsed.data.liveVideoId,
        orderId: order.id,
        avatarName: avatar.name,
        voice: parsed.data.voice || avatar.voice || undefined,
        voiceId: parsed.data.voiceId || process.env.VOICE_ID || "girl_cute_kids",
        style: parsed.data.style || undefined,
        ttsLang: parsed.data.lang || "id",
        speechSpeed: parsed.data.speechSpeed ?? 1,
        tone: parsed.data.tone || "Persuasif",
        product: product || undefined,
        catalog,
        backgroundImage: parsed.data.backgroundImage,
        clientRequestId: parsed.data.clientRequestId,
      });

      reply.code(201);
      return {
        success: true,
        data: {
          id: result.sessionId,
          status: result.state,
          podBooting: true,
          platform: parsed.data.platform,
          voice: parsed.data.voice || avatar.voice || null,
          durationHours: order.durationHours,
          maxDurationSeconds: order.durationHours * 3600,
          estimatedCost: Math.round(order.durationHours * 12500),
          orderId: order.id,
          resumeCode: order.resumeCode,
          startedAt: new Date().toISOString(),
        },
      };
    } catch (err: any) {
      if (err instanceof EntitlementError) {
        return sendEntitlementError(reply, err);
      }
      reply.code(500);
      return { error: err instanceof Error ? err.message : "Gagal memulai siaran. Coba lagi." };
    }
  });

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

  server.post("/api/live-session/stop", { preHandler: rateLimitPreHandler("live-session-stop", 20, 60_000) }, async (request, reply) => {
    const parsed = liveStopSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    try {
      await requireOrderForSession(request, parsed.data.sessionId);
    } catch (err) {
      return sendEntitlementError(reply, err);
    }

    const sessionId = parsed.data.sessionId;
    if (sessionId) liveHostOrchestrator.stop(sessionId);
    const sessionObj = liveSessionManager.getSession(sessionId);
    void stopRunPodBroadcast(sessionObj?.podId).catch(() => {});
    stopBroadcast();
    const result = await liveSessionManager.stopSession(sessionId, {
      durationSeconds: parsed.data.durationSeconds,
      viewers: parsed.data.viewers,
      comments: parsed.data.comments,
      clicks: parsed.data.clicks,
      sales: parsed.data.sales,
      productSold: parsed.data.productSold,
    }, {
      endedReason: parsed.data.endedReason === "prepare_failed" ? "prepare_failed" : parsed.data.endedReason || "user_ended",
    });

    if (!result.success) {
      reply.code(404);
      return { error: "Sesi live tidak ditemukan." };
    }
    return {
      success: true,
      summary: result.summary,
      gpuTerminated: result.gpuTerminated,
      gpuWarning: result.gpuWarning,
    };
  });

  server.post("/api/live-stream/broadcast", { preHandler: rateLimitPreHandler("live-broadcast", 10, 60_000) }, async (request, reply) => {
    const parsed = broadcastSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    try {
      await requireOrderForSession(request, parsed.data.sessionId);
    } catch (err) {
      return sendEntitlementError(reply, err);
    }

    if (!parsed.data.sessionId) {
      reply.code(401);
      return { success: false, error: "Sesi pembayaran tidak valid." };
    }

    const {
      rtmpUrl: rawRtmpUrl,
      streamKey: rawStreamKey,
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
        error: err instanceof Error ? err.message : "Alamat server atau kode siaran tidak valid.",
      };
    }
    const managedSession = parsed.data.sessionId ? liveSessionManager.getSession(parsed.data.sessionId) : null;
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
            error: boot.stageText || "Gagal menyiapkan host AI.",
            podFailed: true,
          };
        }
        reply.code(409);
        return {
          success: false,
          error: "Host AI masih disiapkan. Tunggu sebentar, lalu coba lagi.",
          podBooting: true,
          stageText: boot.stageText,
        };
      }
    }

    const podId = managedSession?.podId ?? null;
    const configuredWorkerUrl =
      process.env.NODE_ENV === "production" ? "" : (process.env.RUNPOD_WORKER_URL || process.env.AVATAR_WORKER_URL || "").trim();
    if (!managedSession || (!podId && !configuredWorkerUrl)) {
      reply.code(409);
      return {
        success: false,
        error: "Host AI belum siap. Tunggu sebentar, lalu coba lagi.",
        podBooting: true,
      };
    }

    if (podId || configuredWorkerUrl) {
      try {
        await ensureWorkerReachable(podId, 60);
      } catch (err) {
        reply.code(502);
        return {
          success: false,
          error: "Host AI belum merespons. Tunggu sebentar, lalu coba lagi.",
        };
      }
    }
    const liveOverlayMedia = (url?: string) => resolveMediaAsDataUrl(url);
    const effectiveBg = parsed.data.backgroundImage || managedSession?.backgroundImage;
    const effectiveProduct = managedSession?.product;
    const effectiveProductName = parsed.data.productName || effectiveProduct?.name;
    const effectiveProductPrice =
      parsed.data.productPrice || (effectiveProduct?.price ? String(effectiveProduct.price).replace(/\D/g, "") : undefined);
    const effectiveProductImg = parsed.data.productImageUrl || effectiveProduct?.image;
    const effectiveBanner = parsed.data.bannerImageUrl || effectiveProduct?.bannerImage;

    const mergedProduct = effectiveProduct
      ? {
          ...effectiveProduct,
          name: effectiveProductName || effectiveProduct.name || "",
          price: effectiveProductPrice || (effectiveProduct.price ? String(effectiveProduct.price) : ""),
          image: effectiveProductImg || effectiveProduct.image,
          bannerImage: effectiveBanner || effectiveProduct.bannerImage,
        }
      : undefined;
    if (managedSession && mergedProduct) {
      managedSession.product = mergedProduct;
    }

    if (managedSession && liveSession && parsed.data.sessionId) {
      liveHostOrchestrator.startPipelineBackground({
        productId: liveSession.productId,
        avatarName: managedSession.avatarName,
        tone: managedSession.tone,
        voice: liveSession.voice || undefined,
        voiceId: managedSession.voiceId || process.env.VOICE_ID || "girl_cute_kids",
        style: managedSession.style,
        ttsLang: managedSession.ttsLang || "id",
        speechSpeed: managedSession.speechSpeed ?? 1,
        podId: managedSession.podId ?? podId ?? undefined,
        sessionId: parsed.data.sessionId,
        rtmpUrl,
        streamKey,
        plan: durationHoursToPlan(managedSession.durationHours ?? 2),
        maxDurationMs: (managedSession.durationHours ?? 2) * 3600 * 1000,
        product: mergedProduct,
        catalog: managedSession.catalog,
        backgroundImage: liveOverlayMedia(effectiveBg),
      });
    }

    const result =
      managedSession && liveSession && parsed.data.sessionId
        ? { success: true, status: "starting", async: true }
        : await startRunPodBroadcast(podId, {
            rtmpUrl,
            streamKey,
            productName: effectiveProductName,
            productPrice: effectiveProductPrice,
            productImageUrl: liveOverlayMedia(effectiveProductImg),
            bannerImageUrl: liveOverlayMedia(effectiveBanner),
            backgroundImage: liveOverlayMedia(effectiveBg),
            platform,
            stockCount: stockCount ?? effectiveProduct?.stock,
            ctaLabel,
            hostName: parsed.data.avatarName?.trim() || managedSession?.avatarName || "namira",
            waitForReady: false,
          });

    if (!result.success) {
      reply.code(502);
      if (parsed.data.sessionId) liveHostOrchestrator.stop(parsed.data.sessionId);
      if (parsed.data.sessionId) await liveSessionManager.stopSession(parsed.data.sessionId).catch(() => {});
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
        "Siaran sedang disiapkan. Mulai live di " +
        (platform || "aplikasi live Anda") +
        ", lalu konfirmasi di Livio jika diminta.",
      data: result,
    };
  });

  server.post("/api/live-stream/go-live-confirm", { preHandler: rateLimitPreHandler("go-live", 20, 60_000) }, async (request, reply) => {
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
    try {
      await requireOrderForSession(request, sessionId);
    } catch (err) {
      return sendEntitlementError(reply, err);
    }
    const managedSession = liveSessionManager.getSession(sessionId);
    const liveSession = await prisma.liveSession.findUnique({
      where: { id: sessionId },
    });

    if (!managedSession || !liveSession) {
      reply.code(404);
      return { error: "Sesi live tidak ditemukan atau sudah berakhir." };
    }

    try {
      const pipelineStatus = await liveHostOrchestrator.getPipelineStatus(sessionId);
      const realtime = /ai_worker|ai-worker|realtime|visual_worker/i.test(String(pipelineStatus.broadcastMode || ""));
      const minUtt = Number(pipelineStatus.goLiveMinUtterances || 1);
      const minSpeech = Number(pipelineStatus.goLiveMinSpeechSeconds || 0);
      const playable = realtime ? Number(pipelineStatus.readyUtteranceCount || 0) : Number(pipelineStatus.videosQueued || 0);
      const speechSeconds = Number(pipelineStatus.readySpeechSeconds ?? pipelineStatus.bufferSeconds ?? 0);
      const rtmpOk = pipelineStatus.isRtmpConnected === true;
      const speechOk = !realtime || minSpeech <= 0 || speechSeconds >= minSpeech;
      if (playable < minUtt || !rtmpOk || !speechOk) {
        reply.code(409);
        return {
          success: false,
          error: "Belum siap. Pastikan siaran terhubung dan host sudah menyiapkan sapaan pembuka.",
        };
      }

      await liveSessionManager.markBroadcastLive(sessionId);

      console.log(`[GoLiveConfirm] ✅ Session ${sessionId}: AI Host aktif! Live streaming dimulai.`);
      return {
        success: true,
        message: "AI Host aktif! Siaran live dimulai.",
        sessionId,
        startedAt: new Date().toISOString(),
        pipelineStatus: await liveHostOrchestrator.getPipelineStatus(sessionId),
      };
    } catch (error) {
      reply.code(502);
      return {
        success: false,
        error: "Gagal mengaktifkan host AI. Coba lagi.",
      };
    }
  });

  server.get("/api/live-stream/pipeline-status", { preHandler: rateLimitPreHandler("pipeline-status", 60, 60_000) }, async (request, reply) => {
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

    try {
      await requireOrderForSession(request, sessionId);
    } catch (err) {
      return sendEntitlementError(reply, err);
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

    if (status.stageText === "Session tidak ditemukan." && liveSessionManager.getSession(sessionId)) {
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
          boot?.podReady === false ? boot.stageText || "Menyiapkan studio AI…" : "Menyiapkan host AI…",
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

  server.post("/api/live-stream/stop-broadcast", { preHandler: rateLimitPreHandler("stop-broadcast", 20, 60_000) }, async (request, reply) => {
    const parsed = liveStopSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }
    try {
      await requireOrderForSession(request, parsed.data.sessionId);
    } catch (err) {
      return sendEntitlementError(reply, err);
    }
    const sessionId = parsed.data.sessionId;
    if (sessionId) liveHostOrchestrator.stop(sessionId);
    const sessionObj = liveSessionManager.getSession(sessionId);
    void stopRunPodBroadcast(sessionObj?.podId).catch(() => {});
    const res = stopBroadcast();
    return {
      success: true,
      data: res,
    };
  });

  server.post("/api/live-stream/pause", { preHandler: rateLimitPreHandler("live-pause", 20, 60_000) }, async (request, reply) => {
    const parsedBody = z.object({ sessionId: z.string().min(1), orderId: z.string().optional(), resumeCode: z.string().optional() }).safeParse(request.body || {});
    if (!parsedBody.success) {
      reply.code(400);
      return { success: false, error: "sessionId wajib diisi." };
    }
    try {
      await requireOrderForSession(request, parsedBody.data.sessionId);
    } catch (err) {
      return sendEntitlementError(reply, err);
    }
    const body = parsedBody.data;
    const managed = liveSessionManager.getSession(body.sessionId);

    const local = getStreamStatus();
    if (local.status === "streaming" || local.status === "connecting") {
      const result = pauseBroadcast();
      if (managed?.sessionId) liveHostOrchestrator.setPaused(managed.sessionId, true);
      return { success: result.success, data: result };
    }

    const podId = managed?.podId || null;
    if (podId) {
      const result = await pauseRunPodBroadcast(podId);
      if (result.success && managed?.sessionId) {
        liveHostOrchestrator.setPaused(managed.sessionId, true);
      }
      return {
        success: result.success,
        data: result.success
          ? { success: true, message: "Siaran dijeda." }
          : { success: false, error: "Gagal menjeda siaran." },
      };
    }

    return {
      success: false,
      data: {
        success: false,
        error: "Tidak ada siaran aktif untuk dijeda.",
      },
    };
  });

  server.post("/api/live-stream/resume", { preHandler: rateLimitPreHandler("live-resume", 20, 60_000) }, async (request, reply) => {
    const parsedBody = z.object({ sessionId: z.string().min(1), orderId: z.string().optional(), resumeCode: z.string().optional() }).safeParse(request.body || {});
    if (!parsedBody.success) {
      reply.code(400);
      return { success: false, error: "sessionId wajib diisi." };
    }
    try {
      await requireOrderForSession(request, parsedBody.data.sessionId);
    } catch (err) {
      return sendEntitlementError(reply, err);
    }
    const body = parsedBody.data;
    const managed = liveSessionManager.getSession(body.sessionId);

    const local = getStreamStatus();
    if (local.paused || local.status === "streaming") {
      const result = await resumeBroadcast();
      if (managed?.sessionId) liveHostOrchestrator.setPaused(managed.sessionId, false);
      return { success: result.success, data: result };
    }

    const podId = managed?.podId || null;
    if (podId) {
      const result = await resumeRunPodBroadcast(podId);
      if (result.success && managed?.sessionId) {
        liveHostOrchestrator.setPaused(managed.sessionId, false);
      }
      return {
        success: result.success,
        data: result.success ? { success: true, message: "Siaran dilanjutkan." } : { success: false, error: "Gagal melanjutkan siaran." },
      };
    }

    return {
      success: false,
      data: {
        success: false,
        error: "Tidak ada siaran aktif untuk dilanjutkan.",
      },
    };
  });

  server.post("/api/live-session/test-comment", { preHandler: rateLimitPreHandler("test-comment", 20, 60_000) }, async (request, reply) => {
    const schema = z.object({
      comment: z.string().min(1),
      sessionId: z.string().optional(),
      sender: z.string().optional().default("Tester"),
      avatarName: z.string().optional().default("Namira"),
      tone: z.string().optional().default("Persuasif"),
      voice: z.string().optional().default("namira"),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { success: false, error: parsed.error.flatten() };
    }

    let commentOrder;
    try {
      commentOrder = await requireStartableOrder(request);
    } catch (err) {
      return sendEntitlementError(reply, err);
    }

    const { comment, sender, avatarName, tone, voice } = parsed.data;
    const managed = parsed.data.sessionId
      ? liveSessionManager.getSession(parsed.data.sessionId)
      : commentOrder.sessionId
        ? liveSessionManager.getSession(commentOrder.sessionId)
        : null;
    const sessionId = managed?.sessionId || parsed.data.sessionId || "";
    const isLive = managed?.state === "live";

    if (isLive && sessionId) {
      const commentId = `test-${Date.now()}`;
      await livePlatformConnector.ingestEvent(sessionId, managed?.platform || "manual", "comment", {
        id: commentId,
        text: comment,
        message: comment,
        from: { username: sender },
        sender,
      });
      return {
        success: true,
        mode: "live",
        data: {
          speech: null,
          note: "Komentar dikirim ke host AI.",
          commentId,
        },
      };
    }

    const { generateLunaResponse } = await import("../services/llm.js");
    const { resolveHostId } = await import("../services/tts.js");
    const luna = await generateLunaResponse(comment, managed?.product || null, avatarName, tone);
    const host = resolveHostId(voice, avatarName);
    return {
      success: true,
      mode: "prelive",
      data: {
        speech: luna.speech,
        action: luna.action,
        emotion: luna.emotion,
        host,
      },
    };
  });

  server.post("/api/live-session/switch-product", { preHandler: rateLimitPreHandler("switch-product", 20, 60_000) }, async (request, reply) => {
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

    let order;
    try {
      order = await requireOrderForSession(request, parsed.data.sessionId);
    } catch (err) {
      return sendEntitlementError(reply, err);
    }

    const latestSession = parsed.data.sessionId
      ? await prisma.liveSession.findFirst({
          where: { id: parsed.data.sessionId, orderId: order.id },
        })
      : order.sessionId
        ? await prisma.liveSession.findFirst({
            where: { id: order.sessionId },
          })
        : null;
    if (!latestSession) {
      reply.code(404);
      return { error: "Tidak ada sesi live untuk ganti produk." };
    }

    await prisma.liveSession.update({
      where: { id: latestSession.id },
      data: { productId: parsed.data.productId },
    });
    const snapshot = normalizeClientProduct(parsed.data.product);
    liveHostOrchestrator.switchProduct(latestSession.id, parsed.data.productId, snapshot || undefined);

    const managedSession = liveSessionManager.getSession(latestSession.id);
    if (snapshot && managedSession) {
      managedSession.product = snapshot;
      const exists = managedSession.catalog.some((item) => item.id === snapshot.id);
      if (!exists) managedSession.catalog.push(snapshot);
    }
    const switchedProd = snapshot || managedSession?.product;
    let overlayUpdated = false;
    if (switchedProd) {
      const podId = managedSession?.podId;
      const overlayMedia = (url?: string) => resolveMediaAsDataUrl(url);
      const overlay = await updateRunPodBroadcastProduct(podId, {
        productName: switchedProd.name,
        productPrice: String(switchedProd.price),
        productImageUrl: overlayMedia(switchedProd.image),
        bannerImageUrl: overlayMedia(switchedProd.bannerImage),
        backgroundImage: overlayMedia(managedSession?.backgroundImage),
      });
      overlayUpdated = overlay.success === true;
      if (!overlayUpdated && podId) {
        reply.code(502);
        return {
          success: false,
          overlayUpdated: false,
          error: "Host sudah ganti produk, tetapi tampilan siaran belum berubah. Coba lagi.",
          activeProductId: parsed.data.productId,
        };
      }
    }

    return {
      success: true,
      overlayUpdated,
      activeProductId: parsed.data.productId,
      message: `Active live product switched to ${parsed.data.productName || parsed.data.productId}`,
    };
  });

  server.post("/api/webhooks/platform-events", async (request, reply) => {
    if (!verifyPlatformWebhook(request)) {
      reply.code(401);
      return { error: "Tanda tangan webhook tidak valid." };
    }
    const sessionId = (request.query as any).sessionId;
    if (!sessionId) {
      reply.code(400);
      return { error: "Missing sessionId in query" };
    }
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
    await livePlatformConnector.ingestEvent(sessionId, platform, eventType, data);
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

  server.get("/api/live-session/metrics", { preHandler: rateLimitPreHandler("live-metrics", 60, 60_000) }, async (request, reply) => {
    let order;
    try {
      order = await requireStartableOrder(request);
    } catch (err) {
      return sendEntitlementError(reply, err);
    }
    const querySessionId = (request.query as any).sessionId || order.sessionId;
    if (querySessionId && order.sessionId && querySessionId !== order.sessionId) {
      const linked = await prisma.liveSession.findFirst({
        where: { id: querySessionId, orderId: order.id },
        select: { id: true },
      });
      if (!linked) {
        reply.code(403);
        return { error: "Sesi ini bukan milik kode pembayaran Anda." };
      }
    }
    const session = querySessionId
      ? await prisma.liveSession.findUnique({
          where: { id: querySessionId },
          include: { avatar: true },
        })
      : null;

    const sessionId = session?.id || "";
    const managedSession = sessionId ? liveSessionManager.getSession(sessionId) : null;
    const streamStatus = getStreamStatus();
    const workerBroadcast =
      managedSession?.podId || (process.env.NODE_ENV !== "production" && (process.env.RUNPOD_WORKER_URL || "").trim())
        ? await getRunPodBroadcastStatusOnce(managedSession?.podId ?? null)
        : null;
    const metrics = livePlatformConnector.getMetricsSnapshot(sessionId);

    const sessionStatus = managedSession?.state || session?.status || "idle";
    const liveAnchor =
      session?.liveStartedAt ||
      (managedSession?.liveStartedAt ? new Date(managedSession.liveStartedAt) : null) ||
      null;
    const liveStartedAt = liveAnchor
      ? new Date(liveAnchor).toISOString()
      : streamStatus.startedAt || null;
    const startedAt =
      (session?.createdAt ? new Date(session.createdAt).toISOString() : null) ||
      liveStartedAt ||
      streamStatus.startedAt ||
      new Date().toISOString();
    const elapsedSeconds = liveStartedAt
      ? Math.max(0, Math.floor((Date.now() - Date.parse(liveStartedAt)) / 1000))
      : 0;
    const durationHours = managedSession?.durationHours || session?.durationHours || null;

    return {
      success: true,
      data: {
        isStreaming: workerBroadcast?.rtmp_connected === true || workerBroadcast?.status === "streaming" || streamStatus.status === "streaming",
        handshakeVerified: workerBroadcast?.rtmp_connected === true || streamStatus.handshakeVerified,
        sessionStatus,
        sessionId: sessionId || null,
        platform: session?.platform || "TikTok LIVE",
        product: managedSession?.product ?? null,
        avatar: session?.avatar || null,
        startedAt,
        liveStartedAt,
        elapsedSeconds,
        durationHours,
        metrics,
        serverTimestamp: Date.now(),
      },
    };
  });
}
