import sys
import re

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

content = content.replace("liveSessionManager.stopSession({", "liveSessionManager.stopSession(parsed.data.sessionId || '', {")

content = content.replace("const managedSession = liveSessionManager.getActiveSession();", "const managedSession = sessionId ? liveSessionManager.getSession(sessionId) : null;")
content = content.replace("liveHostOrchestrator.stop();", "if (sessionId) liveHostOrchestrator.stop(sessionId);")
content = content.replace("await liveSessionManager.stopSession().catch(() => {});", "if (sessionId) await liveSessionManager.stopSession(sessionId).catch(() => {});")

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
  server.post("/api/webhooks/platform-events", async (request, reply) => {""", """  // POST /api/webhooks/platform-events
  server.post("/api/webhooks/platform-events", async (request, reply) => {
    const sessionId = (request.query as any).sessionId;
    if (!sessionId) { reply.code(400); return { error: "Missing sessionId in query" }; }""")
content = content.replace("await livePlatformConnector.ingestEvent(platform, eventType, data);", "await livePlatformConnector.ingestEvent(sessionId, platform, eventType, data);")
content = content.replace("const metrics = livePlatformConnector.getMetricsSnapshot();", "const metrics = livePlatformConnector.getMetricsSnapshot(sessionId);")

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
