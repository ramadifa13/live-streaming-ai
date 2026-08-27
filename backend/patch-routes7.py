import sys
import re

with open("backend/src/routes/live-session.ts", "r") as f:
    content = f.read()

# Fix compilation errors caused by bad find/replace
content = content.replace("sessionIdStr", "sessionId")
content = content.replace("const session = sessionId \n      ? await prisma", "const session = sessionId \n      ? await prisma")
content = content.replace("liveSessionManager.markBroadcastLive(sessionId)", "liveSessionManager.markBroadcastLive(sessionId)")

with open("backend/src/routes/live-session.ts", "w") as f:
    f.write(content)

with open("backend/src/services/live-session-manager.ts", "r") as f:
    content2 = f.read()

content2 = content2.replace("setLiveSessionActive(false);", "") # Remove global active setter to simplify or we can just leave it

with open("backend/src/services/live-session-manager.ts", "w") as f:
    f.write(content2)
