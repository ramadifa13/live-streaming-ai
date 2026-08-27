import sys

with open("backend/src/routes/live-session.ts", "r") as f:
    content = f.read()

content = content.replace("const managedSession = sessionId ? liveSessionManager.getSession(sessionId) : null;", "const managedSession = session?.id ? liveSessionManager.getSession(session.id) : null;")
content = content.replace("if (sessionId) liveHostOrchestrator.stop(sessionId as string);", "if (parsed.data.sessionId) liveHostOrchestrator.stop(parsed.data.sessionId as string);")
content = content.replace("const result = await liveSessionManager.stopSession(sessionId as string, {", "const result = await liveSessionManager.stopSession(parsed.data.sessionId as string, {")

content = content.replace("liveSessionManager.markBroadcastLive(sessionId as string);", "liveSessionManager.markBroadcastLive(sessionId as string);")
content = content.replace("if (sessionId) await liveSessionManager.stopSession(sessionId as string).catch(() => {});", "if (sessionId) await liveSessionManager.stopSession(sessionId as string).catch(() => {});")
content = content.replace("where: { id: sessionId as string, status: { in: [\"starting\", \"pending\"] } },", "where: { id: sessionId as string, status: { in: [\"starting\", \"pending\"] } },")


content = content.replace("const metrics = livePlatformConnector.getMetricsSnapshot(sessionId);", "const metrics = livePlatformConnector.getMetricsSnapshot(sessionId as string);")
content = content.replace("const managedSession = liveSessionManager.getSession(sessionId);", "const managedSession = session?.id ? liveSessionManager.getSession(session.id) : null;")

with open("backend/src/routes/live-session.ts", "w") as f:
    f.write(content)

with open("backend/src/routes/providers.ts", "r") as f:
    content2 = f.read()

content2 = content2.replace("const stopped = await stopPod();", "const stopped = await stopPod((request.query as any).podId);")

with open("backend/src/routes/providers.ts", "w") as f:
    f.write(content2)
