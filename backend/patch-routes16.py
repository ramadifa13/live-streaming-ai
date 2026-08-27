import sys
import re

with open("backend/src/routes/live-session.ts", "r") as f:
    content = f.read()

content = content.replace("await startRunPodBroadcast(managedSession?.podId, { rtmpUrl, streamKey });", "await startRunPodBroadcast(managedSession?.podId, { rtmpUrl, streamKey });")

content = content.replace("const metrics = livePlatformConnector.getMetricsSnapshot(session?.id || '');", "const metrics = livePlatformConnector.getMetricsSnapshot(sessionId || '');")
content = content.replace("const metrics = livePlatformConnector.getMetricsSnapshot(sessionId || '');", "const metrics = livePlatformConnector.getMetricsSnapshot(sessionId);")

with open("backend/src/routes/live-session.ts", "w") as f:
    f.write(content)
