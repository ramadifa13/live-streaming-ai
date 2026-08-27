import sys
import re

with open("backend/src/services/live-session-manager.ts", "r") as f:
    content = f.read()

content = content.replace("private startDurationWatchdog(): void {", "private startDurationWatchdog(sessionId: string): void {")
content = content.replace("this.clearWatchdog();", "this.clearWatchdog(sessionId);")
content = content.replace("const session = this.activeSessions.get(sessionId || '');", "const session = this.activeSessions.get(sessionId);")
content = content.replace("this.activeSession.watchdogTimer", "session.watchdogTimer")
content = content.replace("if (!this.activeSession) return;", "const session = this.activeSessions.get(sessionId);\n    if (!session) return;")
content = content.replace("this.getRemainingDurationSeconds();", "this.getRemainingDurationSeconds(sessionId);")
content = content.replace("this.activeSession?.sessionId", "session?.sessionId")
content = content.replace("await this.stopSession();", "await this.stopSession(sessionId);")
content = content.replace("this.activeSession.state", "session.state")
content = content.replace("this.activeSession.startedAt", "session.startedAt")
content = content.replace("this.activeSession.durationHours", "session.durationHours")

content = content.replace("private clearWatchdog(): void {", "private clearWatchdog(sessionId: string): void {")
content = content.replace("if (this.activeSession?.watchdogTimer) {\n      clearInterval(this.activeSession.watchdogTimer);\n      this.activeSession.watchdogTimer = undefined;\n    }", "const session = this.activeSessions.get(sessionId);\n    if (session?.watchdogTimer) {\n      clearInterval(session.watchdogTimer);\n      session.watchdogTimer = undefined;\n    }")

content = content.replace("private clearLivePoll(): void {", "private clearLivePoll(sessionId: string): void {")
content = content.replace("if (this.activeSession?.livePollTimer) {\n      clearTimeout(this.activeSession.livePollTimer);\n      this.activeSession.livePollTimer = undefined;\n    }", "const session = this.activeSessions.get(sessionId);\n    if (session?.livePollTimer) {\n      clearTimeout(session.livePollTimer);\n      session.livePollTimer = undefined;\n    }")

content = content.replace("private clearTimers(): void {", "private clearTimers(sessionId: string): void {")
content = content.replace("this.clearWatchdog(sessionId);", "this.clearWatchdog(sessionId);")
content = content.replace("this.clearLivePoll();", "this.clearLivePoll(sessionId);")

content = content.replace("private startPlatformLivePoll(", "private startPlatformLivePoll(sessionId: string, ")
content = content.replace("this.clearLivePoll(sessionId);", "this.clearLivePoll(sessionId);")
content = content.replace("if (!this.activeSession || !liveVideoId || !accessToken) return;", "const session = this.activeSessions.get(sessionId);\n    if (!session || !liveVideoId || !accessToken) return;")
content = content.replace("this.activeSession.platform", "session.platform")
content = content.replace("if (!this.activeSession || this.activeSession.state !== \"pending\") {", "const currentSession = this.activeSessions.get(sessionId);\n      if (!currentSession || currentSession.state !== \"pending\") {")
content = content.replace("this.activeSession.livePollTimer", "session.livePollTimer")

content = content.replace("private async forceStopSession(): Promise<void> {", "private async forceStopSession(sessionId: string): Promise<void> {")
content = content.replace("const sessionId = this.activeSession.sessionId;", "")

with open("backend/src/services/live-session-manager.ts", "w") as f:
    f.write(content)
