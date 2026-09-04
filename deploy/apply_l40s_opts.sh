#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/cuda-11.8/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

python3 <<'PY'
from pathlib import Path
p = Path("/workspace/ai_live_worker/.env")
text = p.read_text(encoding="utf-8", errors="replace")
lines = []
seen = set()
updates = {
    "MUSETALK_BATCH_SIZE": "16",
    "MUSETALK_USE_FLOAT16": "1",
    "VOXCPM2_INFERENCE_TIMESTEPS": "8",
}
for line in text.splitlines():
    if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
        lines.append(line)
        continue
    key = line.split("=", 1)[0].strip()
    if key in updates:
        if key in seen:
            continue
        lines.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        lines.append(line)
for k, v in updates.items():
    if k not in seen:
        lines.append(f"{k}={v}")
p.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("[OK] env patched")
for k, v in updates.items():
    print(f"  {k}={v}")
PY

cp -f /workspace/live-streaming-ai/deploy/voxcpm2_tts/tts_service.py \
  /workspace/ai_live_worker/voxcpm2_tts/tts_service.py
cp -f /workspace/live-streaming-ai/deploy/gpu_compat.py \
  /workspace/ai_live_worker/gpu_compat.py

cd /workspace/live-streaming-ai/deploy
bash sync.sh --restart
echo "[OK] optimize+restart finished"
curl -sf --max-time 10 http://127.0.0.1:8000/health || true
echo
curl -sf --max-time 10 http://127.0.0.1:8000/tts/health || true
echo
