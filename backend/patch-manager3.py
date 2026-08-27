import sys
import re

with open("backend/src/services/live-session-manager.ts", "r") as f:
    content = f.read()

content = content.replace("""    this.activeSession = {
      sessionId: session.id,
      state: "starting",
      platform: params.platform,
      durationHours: params.durationHours,
      startedAt: Date.now(),
      deadlineAt: Date.now() + params.durationHours * 3600 * 1000,
      avatarName: params.avatarName || "Namira",
      voice: params.voice || this.pendingVoicePreference || undefined,
      tone: params.tone || "Persuasif",
      onStateChange: undefined,
    };""", """    const managedSession: ManagedSession = {
      sessionId: session.id,
      state: "starting",
      platform: params.platform,
      durationHours: params.durationHours,
      startedAt: Date.now(),
      deadlineAt: Date.now() + params.durationHours * 3600 * 1000,
      avatarName: params.avatarName || "Namira",
      voice: params.voice || this.pendingVoicePreference || undefined,
      tone: params.tone || "Persuasif",
      onStateChange: undefined,
    };
    this.activeSessions.set(session.id, managedSession);""")

content = content.replace("await startPodAndWait();", "const podId = await startPodAndWait();")
content = content.replace("this.activeSession.state", "managedSession.state")
content = content.replace("livePlatformConnector.startSession({", "livePlatformConnector.startSession({\n      sessionId: session.id,\n      podId: podId,")
content = content.replace("tone: params.tone || \"Persuasif\",\n      onStateChange: undefined,", "tone: params.tone || \"Persuasif\",\n      podId: podId,\n      onStateChange: undefined,")

with open("backend/src/services/live-session-manager.ts", "w") as f:
    f.write(content)
