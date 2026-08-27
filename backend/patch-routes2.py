import sys

with open("backend/src/routes/live-session.ts", "r") as f:
    content = f.read()

# Fix sessionId references in live-session.ts
content = content.replace("const managedSession = sessionId ? liveSessionManager.getSession(sessionId) : null;", "const managedSession = session?.id ? liveSessionManager.getSession(session.id) : null;")
content = content.replace("const managedSession = liveSessionManager.getSession(sessionId);", "const managedSession = session?.id ? liveSessionManager.getSession(session.id) : null;")
content = content.replace("liveSessionManager.stopSession(parsed.data.sessionId || '', {", "liveSessionManager.stopSession(parsed.data.sessionId || '', {")
content = content.replace("if (sessionId) liveHostOrchestrator.stop(sessionId);", "if (parsed.data.sessionId) liveHostOrchestrator.stop(parsed.data.sessionId);")
content = content.replace("if (sessionId) await liveSessionManager.stopSession(sessionId).catch(() => {});", "if (parsed.data.sessionId) await liveSessionManager.stopSession(parsed.data.sessionId).catch(() => {});")
content = content.replace("if (!sessionId) { reply.code(400); return { error: \"Missing sessionId\" }; }", "const sessionIdStr = Array.isArray(sessionId) ? sessionId[0] : sessionId;\n    if (!sessionIdStr) { reply.code(400); return { error: \"Missing sessionId\" }; }")
content = content.replace("liveHostOrchestrator.stop(sessionId);", "liveHostOrchestrator.stop(sessionIdStr);")

content = content.replace("const managedSession = liveSessionManager.getSession(sessionIdStr);", "const managedSession = liveSessionManager.getSession(sessionIdStr);")
content = content.replace("liveHostOrchestrator.start({\n          productId: liveSession.productId,\n          avatarName: managedSession.avatarName,\n          tone: managedSession.tone,\n          rtmpUrl,\n          streamKey,\n          voice: liveSession.voice || undefined,\n          podId: managedSession.podId,\n        });", "liveHostOrchestrator.start({\n          productId: liveSession.productId,\n          avatarName: managedSession.avatarName,\n          tone: managedSession.tone,\n          rtmpUrl,\n          streamKey,\n          voice: liveSession.voice || undefined,\n          podId: managedSession.podId,\n          sessionId: sessionId\n        });")

content = content.replace("const res = stopBroadcast();", "const res = stopBroadcast();")

with open("backend/src/routes/live-session.ts", "w") as f:
    f.write(content)

with open("backend/src/services/live-session-manager.ts", "r") as f:
    content2 = f.read()

content2 = content2.replace("podId: podId,", "podId: podId || null,")
content2 = content2.replace("this.clearTimers(sessionId);", "this.clearTimers(sessionId);")
content2 = content2.replace("liveHostOrchestrator.stop(sessionId);", "liveHostOrchestrator.stop(sessionId);")
content2 = content2.replace("livePlatformConnector.stopSession(sessionId);", "livePlatformConnector.stopSession(sessionId);")
content2 = content2.replace("setLiveSessionActive(false);", "setLiveSessionActive(false);")


with open("backend/src/services/live-session-manager.ts", "w") as f:
    f.write(content2)


with open("backend/src/services/live-host-orchestrator.ts", "r") as f:
    content3 = f.read()

content3 = content3.replace("await forwardToRunPodGPU(config.podId, {", "await forwardToRunPodGPU({")
content3 = content3.replace("requireWorker: true,\n    });", "requireWorker: true,\n    });")

with open("backend/src/services/live-host-orchestrator.ts", "w") as f:
    f.write(content3)

with open("backend/src/services/live-platform-connector.ts", "r") as f:
    content4 = f.read()

content4 = content4.replace("import { generateLunaResponse, LunaStructuredOutput } from \"./llm-brain.js\";", "import { generateLunaResponse } from \"./llm-brain.js\";")
content4 = content4.replace("const response: LunaStructuredOutput = await generateLunaResponse(", "const response: any = await generateLunaResponse(")

with open("backend/src/services/live-platform-connector.ts", "w") as f:
    f.write(content4)
