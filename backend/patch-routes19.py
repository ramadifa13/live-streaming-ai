import sys

with open("backend/src/routes/live-session.ts", "r") as f:
    content = f.read()

content = content.replace("await stopRunPodBroadcast(managedSession?.podId).catch(() => {});", "const sessionObj = liveSessionManager.getSession(parsed.data.sessionId || '');\n    await stopRunPodBroadcast(sessionObj?.podId).catch(() => {});")
content = content.replace("const metrics = livePlatformConnector.getMetricsSnapshot(sessionIdStr);", "const metrics = livePlatformConnector.getMetricsSnapshot(sessionId || '');")
content = content.replace("const workerBroadcast = await getRunPodBroadcastStatus(managedSession?.podId).catch(() => null);\n    const metrics = livePlatformConnector.getMetricsSnapshot(sessionIdStr);", "const workerBroadcast = await getRunPodBroadcastStatus(managedSession?.podId).catch(() => null);\n    const metrics = livePlatformConnector.getMetricsSnapshot(sessionId || '');")

with open("backend/src/routes/live-session.ts", "w") as f:
    f.write(content)
