import sys

with open("backend/src/routes/live-session.ts", "r") as f:
    content = f.read()

content = content.replace("const managedSession = session?.id ? liveSessionManager.getSession(session.id) : null;", "const managedSession = sessionId ? liveSessionManager.getSession(sessionId) : null;")
content = content.replace("liveHostOrchestrator.start({\n          productId: liveSession.productId,\n          avatarName: managedSession.avatarName,\n          tone: managedSession.tone,\n          rtmpUrl,\n          streamKey,\n          voice: liveSession.voice || undefined,\n        });", "liveHostOrchestrator.start({\n          productId: liveSession.productId,\n          avatarName: managedSession.avatarName,\n          tone: managedSession.tone,\n          rtmpUrl,\n          streamKey,\n          voice: liveSession.voice || undefined,\n          podId: managedSession.podId,\n          sessionId: sessionId\n        });")
content = content.replace("const result = await startRunPodBroadcast({ rtmpUrl, streamKey });", "const result = await startRunPodBroadcast(managedSession?.podId, { rtmpUrl, streamKey });")
content = content.replace("if (parsed.data.sessionId) liveHostOrchestrator.stop(parsed.data.sessionId);", "if (sessionIdStr) liveHostOrchestrator.stop(sessionIdStr);")
content = content.replace("if (parsed.data.sessionId) await liveSessionManager.stopSession(parsed.data.sessionId).catch(() => {});", "if (sessionIdStr) await liveSessionManager.stopSession(sessionIdStr).catch(() => {});")
content = content.replace("const workerBroadcast = await getRunPodBroadcastStatus(managedSession?.podId).catch(() => null);", "const workerBroadcast = await getRunPodBroadcastStatus(managedSession?.podId).catch(() => null);")

with open("backend/src/routes/live-session.ts", "w") as f:
    f.write(content)

with open("backend/src/services/live-session-manager.ts", "r") as f:
    content2 = f.read()

content2 = content2.replace("podId: podId || null,", "podId: podId === true ? null : podId,")
content2 = content2.replace("podId: podId === true ? null : podId,", "podId: typeof podId === 'string' ? podId : null,")
content2 = content2.replace("setLiveSessionActive(false);", "setLiveSessionActive(false);")
content2 = content2.replace("const podId = await startPodAndWait();", "const podIdStr = await startPodAndWait();\n    const podId = typeof podIdStr === 'string' ? podIdStr : null;")

with open("backend/src/services/live-session-manager.ts", "w") as f:
    f.write(content2)

with open("backend/src/services/live-platform-connector.ts", "r") as f:
    content4 = f.read()

content4 = content4.replace("import { generateLunaResponse } from \"./llm-brain.js\";", "import { generateDynamicSalesResponse } from \"./llm-brain.js\";")
content4 = content4.replace("const response: any = await generateLunaResponse(", "const response: any = await generateDynamicSalesResponse(")

with open("backend/src/services/live-platform-connector.ts", "w") as f:
    f.write(content4)
