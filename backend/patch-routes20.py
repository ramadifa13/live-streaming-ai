import sys

with open("backend/src/routes/live-session.ts", "r") as f:
    content = f.read()

content = content.replace("""  // GET /api/live-session/metrics
  server.get("/api/live-session/metrics", async () => {
    const session = await prisma.liveSession.findFirst({
      where: { status: { in: ["starting", "pending", "live"] } },
      orderBy: { createdAt: "desc" },
      include: { avatar: true },
    });

    const streamStatus = getStreamStatus();
    const workerBroadcast = await getRunPodBroadcastStatus(managedSession?.podId).catch(() => null);
    const metrics = livePlatformConnector.getMetricsSnapshot(sessionId || '');
    const managedSession = session?.id ? liveSessionManager.getSession(session.id) : null;""", """  // GET /api/live-session/metrics
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
    const managedSession = sessionId ? liveSessionManager.getSession(sessionId) : null;
    const streamStatus = getStreamStatus();
    const workerBroadcast = await getRunPodBroadcastStatus(managedSession?.podId).catch(() => null);
    const metrics = livePlatformConnector.getMetricsSnapshot(sessionId);""")


with open("backend/src/routes/live-session.ts", "w") as f:
    f.write(content)
