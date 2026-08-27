import sys
import re

with open("backend/src/services/live-session-manager.ts", "r") as f:
    content = f.read()

content = content.replace("public getActiveSession(): ManagedSession | null {", "public getSession(sessionId: string): ManagedSession | null {")
content = content.replace("return this.activeSession;", "return this.activeSessions.get(sessionId) || null;")


content = content.replace("if (this.activeSession?.state === \"pending\") {", "const currentSession = this.activeSessions.get(session.id);\n      if (currentSession?.state === \"pending\") {")
content = content.replace("this.activeSession.sessionId", "session.id")
content = content.replace("await this.transitionState(\"live\");", "await this.transitionState(\"live\", session.id);")
content = content.replace("await this.transitionState(\"pending\");", "await this.transitionState(\"pending\", session.id);")
content = content.replace("this.startPlatformLivePoll(params.liveVideoId, params.accessToken);", "this.startPlatformLivePoll(session.id, params.liveVideoId, params.accessToken);")


with open("backend/src/services/live-session-manager.ts", "w") as f:
    f.write(content)
