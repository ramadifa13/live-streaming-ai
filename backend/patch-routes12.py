import sys
import re

with open("backend/src/routes/live-session.ts", "r") as f:
    content = f.read()

content = content.replace("const session = sessionId \n      ? await prisma.liveSession.findUnique({ where: { id: sessionId as string }, include: { avatar: true } })", "const session = sessionId \n      ? await prisma.liveSession.findUnique({ where: { id: sessionId }, include: { avatar: true } })")
content = content.replace("const result = await liveSessionManager.stopSession(sessionId, {", "const sessionId = parsed.data.sessionId || '';\n    const result = await liveSessionManager.stopSession(sessionId, {")
content = content.replace("if (sessionId) liveHostOrchestrator.stop(sessionId);", "if (parsed.data.sessionId) liveHostOrchestrator.stop(parsed.data.sessionId);")

# We had a duplicate definition of sessionId that I overwrote
content = re.sub(r'const sessionId = parsed\.data\.sessionId \|\| \'\';\s+const sessionId = parsed\.data\.sessionId \|\| \'\';', 'const sessionId = parsed.data.sessionId || \'\';', content)

# "260,70): error TS2554: Expected 1 arguments, but got 2." refers to liveSessionManager.markBroadcastLive(sessionId as string); but I will fix all.
content = content.replace("const result = await startRunPodBroadcast(managedSession?.podId, { rtmpUrl, streamKey });", "const result = await startRunPodBroadcast(managedSession?.podId, { rtmpUrl, streamKey });")
content = content.replace("await liveSessionManager.markBroadcastLive(sessionId as string);", "await liveSessionManager.markBroadcastLive(sessionId as string);")

with open("backend/src/routes/live-session.ts", "w") as f:
    f.write(content)
