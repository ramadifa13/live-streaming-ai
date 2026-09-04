#!/usr/bin/env bash
# Preflight: cek integrasi VoxCPM2 di AI Worker SETELAH setup+sync.
# Usage (di pod):
#   bash /workspace/ai_live_worker/check_tts_integration.sh
#   # atau dari repo:
#   bash deploy/check_tts_integration.sh
set -euo pipefail

WORKER_DIR="${WORKER_DIR:-/workspace/ai_live_worker}"
API="${API:-http://127.0.0.1:8000}"
FAIL=0

ok()   { echo "  [OK]  $*"; }
warn() { echo "  [WARN] $*"; }
bad()  { echo "  [FAIL] $*"; FAIL=1; }

echo "=== VoxCPM2 integration preflight ==="
echo "WORKER_DIR=$WORKER_DIR  API=$API"
echo

echo "1) Files"
[ -f "$WORKER_DIR/api_server.py" ] && ok "api_server.py" || bad "api_server.py missing"
[ -f "$WORKER_DIR/voxcpm2_bridge.py" ] && ok "voxcpm2_bridge.py" || bad "voxcpm2_bridge.py missing"
[ -f "$WORKER_DIR/voxcpm2_tts/worker.py" ] && ok "voxcpm2_tts/worker.py" || bad "voxcpm2_tts/worker.py missing"
[ -f "$WORKER_DIR/voxcpm2_tts/tts_service.py" ] && ok "voxcpm2_tts/tts_service.py" || bad "tts_service.py missing"

echo
echo "2) Venv + model + voice"
VENV="${VOXCPM2_VENV:-/workspace/voxcpm2_env}"
MODEL="${VOXCPM2_MODEL_PATH:-/workspace/models/voxcpm2}"
VOICE_ROOT="${VOICE_ROOT:-/workspace/voices}"
VOICE_ID="${VOICE_ID:-default_host}"
[ -x "$VENV/bin/python" ] && ok "venv $VENV" || bad "venv missing — jalankan bash voxcpm2_tts/setup.sh"
if [ -d "$MODEL" ] && [ -n "$(ls -A "$MODEL" 2>/dev/null || true)" ]; then
  ok "model dir $MODEL"
else
  warn "model dir empty/missing ($MODEL) — worker akan download dari HF saat load (butuh jaringan)"
fi
if [ -f "$VOICE_ROOT/$VOICE_ID/reference.wav" ]; then
  ok "reference $VOICE_ROOT/$VOICE_ID/reference.wav ($(wc -c < "$VOICE_ROOT/$VOICE_ID/reference.wav") bytes)"
else
  warn "reference.wav belum ada — VOXCPM2_ALLOW_VOICE_DESIGN harus 1"
fi

echo
echo "3) Env keys (worker .env)"
ENVF="$WORKER_DIR/.env"
if [ -f "$ENVF" ]; then
  for k in TTS_ENABLED VOICE_ID VOXCPM2_MODEL_PATH VOICE_ROOT VOXCPM2_VENV; do
    if grep -qE "^[[:space:]]*(export[[:space:]]+)?${k}=" "$ENVF" 2>/dev/null; then
      ok "$k set"
    else
      warn "$k tidak di .env (default kode mungkin dipakai)"
    fi
  done
else
  warn "$ENVF belum ada — pakai default env di kode"
fi

echo
echo "4) HTTP health"
if curl -sf --max-time 5 "$API/health" >/tmp/vox_health.json 2>/dev/null; then
  ok "/health reachable"
  python3 - <<'PY' || true
import json
h=json.load(open("/tmp/vox_health.json"))
tts=h.get("tts") or {}
print("      status=", h.get("status"), " tts.ready=", tts.get("ready"), " tts=", tts)
PY
  READY=$(python3 -c "import json; print(json.load(open('/tmp/vox_health.json')).get('tts',{}).get('ready'))" 2>/dev/null || echo "")
  if [ "$READY" = "True" ] || [ "$READY" = "true" ]; then
    ok "tts.ready=true"
  else
    bad "tts.ready != true — cek log VoxCPM2 warm / setup.sh"
  fi
else
  bad "/health tidak reachable di $API — start API dulu"
fi

echo
echo "5) TTS synthesize smoke"
if curl -sf --max-time 5 "$API/tts/health" >/tmp/vox_tts_health.json 2>/dev/null; then
  ok "/tts/health reachable"
else
  bad "/tts/health gagal"
fi

if curl -sf --max-time 120 -X POST "$API/tts/synthesize" \
  -H "Content-Type: application/json" \
  -d '{"text":"Halo kak, ini tes VoxCPM2.","voice_id":"default_host","language":"id"}' \
  -o /tmp/vox_smoke.wav; then
  BYTES=$(wc -c < /tmp/vox_smoke.wav | tr -d ' ')
  HEAD=$(head -c 4 /tmp/vox_smoke.wav || true)
  if [ "$HEAD" = "RIFF" ] && [ "$BYTES" -gt 1000 ]; then
    ok "synthesize WAV OK ($BYTES bytes) → /tmp/vox_smoke.wav"
  else
    bad "synthesize response bukan WAV valid (bytes=$BYTES)"
  fi
else
  bad "POST /tts/synthesize gagal"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "=== PREFLIGHT PASS — siap dipakai dari backend ==="
  exit 0
else
  echo "=== PREFLIGHT FAIL — perbaiki item [FAIL] sebelum Go Live ==="
  exit 1
fi
