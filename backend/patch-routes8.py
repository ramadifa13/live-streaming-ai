import sys

with open("backend/src/services/live-session-manager.ts", "r") as f:
    content = f.read()

content = content.replace("stopPod(session.podId)", "stopPod(session.podId)")

# Oh, the error was: src/services/live-session-manager.ts(155,16): error TS2554: Expected 0 arguments, but got 1.
# Which means stopPod STILL expects 0 arguments in runpod-manager.ts because I somehow reverted runpod-manager.ts! Let me check runpod-manager.ts
