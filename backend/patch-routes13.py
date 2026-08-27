import sys

with open("backend/src/routes/live-session.ts", "r") as f:
    content = f.read()

content = content.replace("""  // GET /api/live-session/active
  server.get("/api/live-session/active", async () => {
    const session = await prisma.liveSession.findFirst({
      where: { status: { in: ["starting", "pending", "live"] } },
      orderBy: { createdAt: "desc" },
      include: { avatar: true },
    });

    const activeManaged = liveSessionManager.getActiveSession();
    const effectiveStatus = activeManaged?.state || session?.status || "ended";

    return {
      data: session
        ? session
        : {
            status: effectiveStatus,
          },
    };
  });""", """  // GET /api/live-session/active
  server.get("/api/live-session/active", async (request) => {
    const sessionId = (request.query as any).sessionId;
    const session = sessionId
      ? await prisma.liveSession.findUnique({ where: { id: sessionId }, include: { avatar: true } })
      : await prisma.liveSession.findFirst({
        where: { status: { in: ["starting", "pending", "live"] } },
        orderBy: { createdAt: "desc" },
        include: { avatar: true },
      });

    const activeManaged = session ? liveSessionManager.getSession(session.id) : null;
    const effectiveStatus = activeManaged?.state || session?.status || "ended";

    return {
      data: session
        ? session
        : {
            status: effectiveStatus,
          },
    };
  });""")

content = content.replace("""  // POST /api/live-session/stop
  server.post("/api/live-session/stop", async (request, reply) => {
    const parsed = liveStopSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const managedSession = liveSessionManager.getActiveSession();
    liveHostOrchestrator.stop();
    await stopRunPodBroadcast(managedSession?.podId).catch(() => {});
    stopBroadcast();
    const result = await liveSessionManager.stopSession({""", """  // POST /api/live-session/stop
  server.post("/api/live-session/stop", async (request, reply) => {
    const parsed = liveStopSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    const sessionId = parsed.data.sessionId || '';
    const managedSession = sessionId ? liveSessionManager.getSession(sessionId) : null;
    liveHostOrchestrator.stop(sessionId);
    await stopRunPodBroadcast(managedSession?.podId).catch(() => {});
    stopBroadcast();
    const result = await liveSessionManager.stopSession(sessionId, {""")

content = content.replace("""    const managedSession = liveSessionManager.getActiveSession();
    const liveSession = sessionId
      ? await prisma.liveSession.findUnique({ where: { id: sessionId } })
      : null;

    if (sessionId && managedSession && liveSession) {
      try {
        await warmupWorker(managedSession.podId);
        await liveHostOrchestrator.start({
          productId: liveSession.productId,
          avatarName: managedSession.avatarName,
          tone: managedSession.tone,
          rtmpUrl,
          streamKey,
          voice: liveSession.voice || undefined,
          podId: managedSession.podId,
        });
      } catch (error) {
        liveHostOrchestrator.stop();
        await liveSessionManager.stopSession().catch(() => {});
        reply.code(502);
        return {
          success: false,
          error: `AI Worker pre-buffer gagal: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    const result = await startRunPodBroadcast(managedSession?.podId, { rtmpUrl, streamKey });

    if (result.success && sessionId) {
      await liveSessionManager.markBroadcastLive();
    }

    if (!result.success) {
      reply.code(502);
      await liveSessionManager.stopSession().catch(() => {});
      if (sessionId) {""", """    const managedSession = sessionId ? liveSessionManager.getSession(sessionId) : null;
    const liveSession = sessionId
      ? await prisma.liveSession.findUnique({ where: { id: sessionId } })
      : null;

    if (sessionId && managedSession && liveSession) {
      try {
        await warmupWorker(managedSession.podId);
        await liveHostOrchestrator.start({
          productId: liveSession.productId,
          avatarName: managedSession.avatarName,
          tone: managedSession.tone,
          rtmpUrl,
          streamKey,
          voice: liveSession.voice || undefined,
          podId: managedSession.podId,
          sessionId: sessionId
        });
      } catch (error) {
        liveHostOrchestrator.stop(sessionId);
        await liveSessionManager.stopSession(sessionId).catch(() => {});
        reply.code(502);
        return {
          success: false,
          error: `AI Worker pre-buffer gagal: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    const result = await startRunPodBroadcast(managedSession?.podId, { rtmpUrl, streamKey });

    if (result.success && sessionId) {
      await liveSessionManager.markBroadcastLive(sessionId);
    }

    if (!result.success) {
      reply.code(502);
      if (sessionId) await liveSessionManager.stopSession(sessionId).catch(() => {});
      if (sessionId) {""")

content = content.replace("""  // POST /api/live-stream/stop-broadcast
  server.post("/api/live-stream/stop-broadcast", async () => {
    const managedSession = liveSessionManager.getActiveSession();
    liveHostOrchestrator.stop();
    await stopRunPodBroadcast(managedSession?.podId).catch(() => {});
    const res = stopBroadcast();
    return {
      success: true,
      data: res,
    };
  });""", """  // POST /api/live-stream/stop-broadcast
  server.post("/api/live-stream/stop-broadcast", async (request, reply) => {
    const sessionId = (request.body as any)?.sessionId;
    if (!sessionId) { reply.code(400); return { error: "Missing sessionId" }; }

    const managedSession = liveSessionManager.getSession(sessionId);
    liveHostOrchestrator.stop(sessionId);
    await stopRunPodBroadcast(managedSession?.podId).catch(() => {});
    const res = stopBroadcast();
    return {
      success: true,
      data: res,
    };
  });""")

content = content.replace("""  // POST /api/webhooks/platform-events
  server.post("/api/webhooks/platform-events", async (request, reply) => {
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
    await livePlatformConnector.ingestEvent(platform, eventType, data);
    const metrics = livePlatformConnector.getMetricsSnapshot();""", """  // POST /api/webhooks/platform-events
  server.post("/api/webhooks/platform-events", async (request, reply) => {
    const sessionId = (request.query as any).sessionId;
    if (!sessionId) { reply.code(400); return { error: "Missing sessionId in query" }; }
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
    await livePlatformConnector.ingestEvent(sessionId, platform, eventType, data);
    const metrics = livePlatformConnector.getMetricsSnapshot(sessionId);""")

content = content.replace("""  // GET /api/live-session/metrics
  server.get("/api/live-session/metrics", async () => {
    const session = await prisma.liveSession.findFirst({
      where: { status: { in: ["starting", "pending", "live"] } },
      orderBy: { createdAt: "desc" },
      include: { avatar: true },
    });

    const managedSession = liveSessionManager.getActiveSession();
    const streamStatus = getStreamStatus();
    const workerBroadcast = await getRunPodBroadcastStatus(managedSession?.podId).catch(() => null);
    const metrics = livePlatformConnector.getMetricsSnapshot();""", """  // GET /api/live-session/metrics
  server.get("/api/live-session/metrics", async (request) => {
    const querySessionId = (request.query as any).sessionId;
    const session = querySessionId ? await prisma.liveSession.findUnique({
      where: { id: querySessionId },
      include: { avatar: true },
    }) : await prisma.liveSession.findFirst({
      where: { status: { in: ["starting", "pending", "live"] } },
      orderBy: { createdAt: "desc" },
      include: { avatar: true },
    });

    const sessionId = session?.id || '';
    const managedSession = liveSessionManager.getSession(sessionId);
    const streamStatus = getStreamStatus();
    const workerBroadcast = await getRunPodBroadcastStatus(managedSession?.podId).catch(() => null);
    const metrics = livePlatformConnector.getMetricsSnapshot(sessionId);""")

with open("backend/src/routes/live-session.ts", "w") as f:
    f.write(content)
