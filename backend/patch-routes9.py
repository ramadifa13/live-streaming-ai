import sys
import re

with open("backend/src/routes/live-session.ts", "r") as f:
    content = f.read()

content = content.replace("const session = sessionId \n      ? await prisma.liveSession.findUnique({ where: { id: sessionId }, include: { avatar: true } })", "const session = sessionId \n      ? await prisma.liveSession.findUnique({ where: { id: sessionId as string }, include: { avatar: true } })")

content = content.replace("liveHostOrchestrator.stop(sessionId);", "if (sessionId) liveHostOrchestrator.stop(sessionId as string);")
content = content.replace("await liveSessionManager.stopSession(sessionId, {", "await liveSessionManager.stopSession(sessionId as string, {")

content = content.replace("const result = await startRunPodBroadcast(managedSession?.podId, { rtmpUrl, streamKey });", "const result = await startRunPodBroadcast(managedSession?.podId, { rtmpUrl, streamKey });")
content = content.replace("await liveSessionManager.markBroadcastLive(sessionId);", "await liveSessionManager.markBroadcastLive(sessionId as string);")

content = content.replace("if (sessionId) await liveSessionManager.stopSession(sessionId).catch(() => {});", "if (sessionId) await liveSessionManager.stopSession(sessionId as string).catch(() => {});")
content = content.replace("where: { id: sessionId, status: { in: [\"starting\", \"pending\"] } },", "where: { id: sessionId as string, status: { in: [\"starting\", \"pending\"] } },")


with open("backend/src/routes/live-session.ts", "w") as f:
    f.write(content)


with open("backend/src/routes/providers.ts", "r") as f:
    content2 = f.read()

content2 = content2.replace("await getGpuControlStatus()", "await getGpuControlStatus(null)")
content2 = content2.replace("const podId = await startPodAndWait();", "const podId = await startPodAndWait();")
content2 = content2.replace("await getGpuControlStatus(podId)", "await getGpuControlStatus(podId)")

with open("backend/src/routes/providers.ts", "w") as f:
    f.write(content2)
