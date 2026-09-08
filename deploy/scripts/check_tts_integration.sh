#!/usr/bin/env bash
set -euo pipefail

API="${API:-http://127.0.0.1:8000}"
WORKER_DIR="${WORKER_DIR:-/workspace/ai_live_worker}"

echo "=== Backend-owned TTS worker preflight ==="
test -f "$WORKER_DIR/api_server.py"
echo "[OK] worker API exists"

health="$(curl -fsS --max-time 5 "$API/health")"
echo "$health"
echo "$health" | grep -q 'backend-pocket-tts'
echo "[OK] worker advertises backend Pocket-TTS"

if grep -R -n -E 'voxcpm2|VoxCPM2|VOICE_ROOT|/workspace/voices' "$WORKER_DIR" \
  --exclude-dir=MuseTalk --exclude='*.log' >/tmp/worker_tts_refs 2>/dev/null; then
  cat /tmp/worker_tts_refs
  echo "[FAIL] worker still contains local TTS or voice references"
  exit 1
fi

echo "[OK] worker has no local TTS or voice catalog"
