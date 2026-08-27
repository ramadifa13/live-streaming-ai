import sys
import re

with open("backend/src/services/runpod-manager.ts", "r") as f:
    content = f.read()

# fix the dangling brace
content = re.sub(r'if \(!status \|\| status\.desiredStatus !== "RUNNING"\) \{\n      throw new Error\(\n        `\[RunPodManager\] Timeout waiting for pod \$\{currentPodId\} to start after \$\{timeoutMs\}ms`,\n      \);\n    }\n  }', 'if (!status || status.desiredStatus !== "RUNNING") {\n    throw new Error(\n      `[RunPodManager] Timeout waiting for pod ${currentPodId} to start after ${timeoutMs}ms`,\n    );\n  }', content)

with open("backend/src/services/runpod-manager.ts", "w") as f:
    f.write(content)
