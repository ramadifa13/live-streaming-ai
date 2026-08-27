import sys

with open("backend/src/routes/live-session.ts", "r") as f:
    content = f.read()

content = content.replace("const result = await startRunPodBroadcast(managedSession?.podId, { rtmpUrl, streamKey });", "const result = await startRunPodBroadcast(managedSession?.podId, { rtmpUrl, streamKey });")

# Let's fix the remaining issues:
# src/routes/live-session.ts(260,70): error TS2554: Expected 1 arguments, but got 2.
# src/routes/live-session.ts(384,62): error TS2552: Cannot find name 'session'. Did you mean 'sessionId'?

with open("backend/src/services/runpod-bridge.ts", "r") as f:
    content2 = f.read()

# wait, runpod-bridge startRunPodBroadcast expects 2 arguments in my modified version, let me check that file.
