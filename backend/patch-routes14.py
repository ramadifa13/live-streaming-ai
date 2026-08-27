import sys
import re

with open("backend/src/routes/live-session.ts", "r") as f:
    content = f.read()

content = content.replace("const session = sessionId \n      ? await prisma.liveSession.findUnique({ where: { id: sessionId }, include: { avatar: true } })", "const session = sessionId \n      ? await prisma.liveSession.findUnique({ where: { id: sessionId as string }, include: { avatar: true } })")
content = content.replace("liveSessionManager.markBroadcastLive(sessionId);", "liveSessionManager.markBroadcastLive(sessionId as string);")

content = content.replace("const sessionId = parsed.data.sessionId || '';\n    const managedSession = sessionId ? liveSessionManager.getSession(sessionId) : null;\n    liveHostOrchestrator.stop(sessionId);\n    await stopRunPodBroadcast(managedSession?.podId).catch(() => {});\n    stopBroadcast();\n    const result = await liveSessionManager.stopSession(sessionId, {", "const sessionId = parsed.data.sessionId || '';\n    const managedSession = sessionId ? liveSessionManager.getSession(sessionId) : null;\n    if (sessionId) liveHostOrchestrator.stop(sessionId);\n    await stopRunPodBroadcast(managedSession?.podId).catch(() => {});\n    stopBroadcast();\n    const result = await liveSessionManager.stopSession(sessionId, {")

# Ensure parsed is correct inside /api/live-stream/broadcast
content = content.replace("""    const sessionId = parsed.data.sessionId || '';
    const managedSession = sessionId ? liveSessionManager.getSession(sessionId) : null;
    if (sessionId) liveHostOrchestrator.stop(sessionId);
    await stopRunPodBroadcast(managedSession?.podId).catch(() => {});
    stopBroadcast();
    const result = await liveSessionManager.stopSession(sessionId, {""", """    const sessionId = parsed.data.sessionId || '';
    const managedSession = sessionId ? liveSessionManager.getSession(sessionId) : null;
    if (sessionId) liveHostOrchestrator.stop(sessionId);
    await stopRunPodBroadcast(managedSession?.podId).catch(() => {});
    stopBroadcast();
    const result = await liveSessionManager.stopSession(sessionId, {""")

content = content.replace("const metrics = livePlatformConnector.getMetricsSnapshot(sessionId);", "const metrics = livePlatformConnector.getMetricsSnapshot(sessionId as string);")

content = content.replace("const sessionId = session?.id || '';\n    const managedSession = liveSessionManager.getSession(sessionId);", "const sessionId = session?.id || '';\n    const managedSession = liveSessionManager.getSession(sessionId as string);")

with open("backend/src/routes/live-session.ts", "w") as f:
    f.write(content)
