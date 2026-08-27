import sys
import re

with open("backend/src/routes/live-session.ts", "r") as f:
    content = f.read()

content = content.replace("await stopRunPodBroadcast().catch(() => {});", "await stopRunPodBroadcast(managedSession?.podId).catch(() => {});")
content = content.replace("await warmupWorker();", "await warmupWorker(managedSession?.podId);")
content = content.replace("const workerBroadcast = await getRunPodBroadcastStatus().catch(() => null);", "const workerBroadcast = await getRunPodBroadcastStatus(managedSession?.podId).catch(() => null);")
content = content.replace("const metrics = livePlatformConnector.getMetricsSnapshot(sessionId);", "const metrics = livePlatformConnector.getMetricsSnapshot(sessionIdStr);")


with open("backend/src/routes/live-session.ts", "w") as f:
    f.write(content)


with open("backend/src/services/live-host-orchestrator.ts", "r") as f:
    content2 = f.read()

content2 = content2.replace("await forwardToRunPodGPU({", "await forwardToRunPodGPU(config.podId, {")

with open("backend/src/services/live-host-orchestrator.ts", "w") as f:
    f.write(content2)
