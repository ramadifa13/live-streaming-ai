import sys

with open("backend/src/routes/live-session.ts", "r") as f:
    content = f.read()

content = content.replace("if (sessionId) liveHostOrchestrator.stop(parsed.data.sessionId as string);", "if (parsed.data.sessionId) liveHostOrchestrator.stop(parsed.data.sessionId);")
content = content.replace("const managedSession = session?.id ? liveSessionManager.getSession(session.id) : null;", "const managedSession = sessionId ? liveSessionManager.getSession(sessionId as string) : null;")
content = content.replace("const managedSession = sessionId ? liveSessionManager.getSession(sessionId as string) : null;\n    const liveSession = sessionId", "const managedSession = sessionId ? liveSessionManager.getSession(sessionId) : null;\n    const liveSession = sessionId")
content = content.replace("liveSessionManager.markBroadcastLive(sessionId as string);", "liveSessionManager.markBroadcastLive(sessionId);")
content = content.replace("if (parsed.data.sessionId) liveHostOrchestrator.stop(parsed.data.sessionId as string);", "if (sessionId) liveHostOrchestrator.stop(sessionId);")
content = content.replace("if (sessionId) liveHostOrchestrator.stop(parsed.data.sessionId);", "if (sessionId) liveHostOrchestrator.stop(sessionId);")
content = content.replace("const result = await liveSessionManager.stopSession(parsed.data.sessionId as string, {", "const result = await liveSessionManager.stopSession(sessionId, {")

content = content.replace("const sessionId = (request.body as any)?.sessionId;\n    if (!sessionId) { reply.code(400); return { error: \"Missing sessionId\" }; }\n    \n    const managedSession = session?.id ? liveSessionManager.getSession(session.id) : null;\n    if (sessionId) liveHostOrchestrator.stop(sessionId);\n    await stopRunPodBroadcast(managedSession?.podId).catch(() => {});", "const sessionId = (request.body as any)?.sessionId;\n    if (!sessionId) { reply.code(400); return { error: \"Missing sessionId\" }; }\n    \n    const managedSession = liveSessionManager.getSession(sessionId);\n    liveHostOrchestrator.stop(sessionId);\n    await stopRunPodBroadcast(managedSession?.podId).catch(() => {});")

content = content.replace("const metrics = livePlatformConnector.getMetricsSnapshot(sessionId as string);", "const metrics = livePlatformConnector.getMetricsSnapshot(sessionId || '');")
content = content.replace("const sessionId = session?.id || '';\n    const managedSession = sessionId ? liveSessionManager.getSession(sessionId as string) : null;", "const sessionId = session?.id || '';\n    const managedSession = liveSessionManager.getSession(sessionId);")

with open("backend/src/routes/live-session.ts", "w") as f:
    f.write(content)

with open("backend/src/routes/providers.ts", "r") as f:
    content2 = f.read()

content2 = content2.replace("const stopped = await stopPod((request.query as any).podId);", "const stopped = await stopPod((_request.query as any).podId);")

with open("backend/src/routes/providers.ts", "w") as f:
    f.write(content2)
