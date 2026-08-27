import sys
import re

with open("backend/src/services/live-session-manager.ts", "r") as f:
    content = f.read()

content = content.replace("public async stopSession(summary?: {", "public async stopSession(sessionId: string, summary?: {")
content = content.replace("""    if (!this.activeSession) {
      return { success: false };
    }

    const session = this.activeSession;
    this.clearTimers();""", """    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { success: false };
    }

    this.clearTimers(sessionId);""")

content = content.replace("liveHostOrchestrator.stop();", "liveHostOrchestrator.stop(sessionId);")
content = content.replace("await this.transitionState(\"ended\");", "await this.transitionState(\"ended\", sessionId);")
content = content.replace("const metrics = livePlatformConnector.getMetricsSnapshot();", "const metrics = livePlatformConnector.getMetricsSnapshot(sessionId);")
content = content.replace("livePlatformConnector.stopSession();", "livePlatformConnector.stopSession(sessionId);")
content = content.replace("if (this.activeSession.podId)", "if (session.podId)")
content = content.replace("this.activeSession.podId", "session.podId")
content = content.replace("this.activeSession = null;", "this.activeSessions.delete(sessionId);")

content = content.replace("public isLive(): boolean {", "public isLive(sessionId: string): boolean {")
content = content.replace("return this.activeSession?.state === \"live\";", "return this.activeSessions.get(sessionId)?.state === \"live\";")

content = content.replace("public isPending(): boolean {", "public isPending(sessionId: string): boolean {")
content = content.replace("return this.activeSession?.state === \"pending\";", "return this.activeSessions.get(sessionId)?.state === \"pending\";")

content = content.replace("public async markBroadcastLive(): Promise<void> {", "public async markBroadcastLive(sessionId: string): Promise<void> {")
content = content.replace("if (this.activeSession?.state === \"pending\") {\n      await this.transitionState(\"live\");", "if (this.activeSessions.get(sessionId)?.state === \"pending\") {\n      await this.transitionState(\"live\", sessionId);")

content = content.replace("public getRemainingDurationSeconds(): number {", "public getRemainingDurationSeconds(sessionId: string): number {")
content = content.replace("if (!this.activeSession) return 0;", "const session = this.activeSessions.get(sessionId);\n    if (!session) return 0;")
content = content.replace("this.activeSession.deadlineAt", "session.deadlineAt")

content = content.replace("private async transitionState(newState: SessionState): Promise<void> {", "private async transitionState(newState: SessionState, sessionId: string): Promise<void> {")
content = content.replace("if (!this.activeSession) return;", "const session = this.activeSessions.get(sessionId);\n    if (!session) return;")
content = content.replace("const previousState = this.activeSession.state;", "const previousState = session.state;")
content = content.replace("this.activeSession.state = newState;", "session.state = newState;")
content = content.replace("this.startDurationWatchdog();", "this.startDurationWatchdog(sessionId);")
content = content.replace("this.clearWatchdog();", "this.clearWatchdog(sessionId);")
content = content.replace("this.activeSession.sessionId", "session.sessionId")
content = content.replace("this.activeSession.onStateChange?.(newState, this.activeSession.sessionId);", "session.onStateChange?.(newState, session.sessionId);")

with open("backend/src/services/live-session-manager.ts", "w") as f:
    f.write(content)
