import sys
import re

with open("backend/src/services/runpod-manager.ts", "r") as f:
    content = f.read()

content = content.replace("export async function startPodAndWait(timeoutMs = 120000): Promise<string | null> {", "export async function startPodAndWait(timeoutMs = 120000): Promise<string | null> {")

with open("backend/src/services/runpod-manager.ts", "w") as f:
    f.write(content)
