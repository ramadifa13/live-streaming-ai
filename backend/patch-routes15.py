import sys

with open("backend/src/routes/live-session.ts", "r") as f:
    content = f.read()

content = content.replace("const managedSession = sessionId ? liveSessionManager.getSession(sessionId as string) : null;", "const managedSession = session?.id ? liveSessionManager.getSession(session.id) : null;")
content = content.replace("if (sessionId) if (parsed.data.sessionId) liveHostOrchestrator.stop(parsed.data.sessionId);", "if (parsed.data.sessionId) liveHostOrchestrator.stop(parsed.data.sessionId);")
content = content.replace("const managedSession = sessionId ? liveSessionManager.getSession(sessionId) : null;\n    const liveSession = sessionId\n      ? await prisma.liveSession.findUnique({ where: { id: sessionId } })", "const managedSession = parsed.data.sessionId ? liveSessionManager.getSession(parsed.data.sessionId) : null;\n    const liveSession = parsed.data.sessionId\n      ? await prisma.liveSession.findUnique({ where: { id: parsed.data.sessionId } })")

content = content.replace("if (sessionId && managedSession && liveSession) {", "if (parsed.data.sessionId && managedSession && liveSession) {")
content = content.replace("sessionId: sessionId", "sessionId: parsed.data.sessionId")

content = content.replace("if (sessionId) if (parsed.data.sessionId) liveHostOrchestrator.stop(parsed.data.sessionId);", "if (parsed.data.sessionId) liveHostOrchestrator.stop(parsed.data.sessionId);")
content = content.replace("if (sessionId) await liveSessionManager.stopSession(sessionId as string).catch(() => {});", "if (parsed.data.sessionId) await liveSessionManager.stopSession(parsed.data.sessionId).catch(() => {});")
content = content.replace("if (result.success && sessionId) {", "if (result.success && parsed.data.sessionId) {")
content = content.replace("await liveSessionManager.markBroadcastLive();", "if (parsed.data.sessionId) await liveSessionManager.markBroadcastLive(parsed.data.sessionId);")
content = content.replace("} else if (sessionId) {", "} else if (parsed.data.sessionId) {")

content = content.replace("server.post(\"/api/live-stream/stop-broadcast\", async () => {", "server.post(\"/api/live-stream/stop-broadcast\", async (request, reply) => {\n    const parsed = liveStopSchema.safeParse(request.body);\n    if (!parsed.success) { reply.code(400); return { error: parsed.error.flatten() }; }")
content = content.replace("if (sessionId) if (parsed.data.sessionId) liveHostOrchestrator.stop(parsed.data.sessionId);", "if (parsed.data.sessionId) liveHostOrchestrator.stop(parsed.data.sessionId);")

content = content.replace("const metrics = livePlatformConnector.getMetricsSnapshot(sessionId || '');", "const metrics = livePlatformConnector.getMetricsSnapshot(session?.id || '');")

with open("backend/src/routes/live-session.ts", "w") as f:
    f.write(content)
