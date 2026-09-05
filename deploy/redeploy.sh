#!/usr/bin/env bash
# redeploy.sh — satu perintah update worker di pod:
#   git pull (atau restore .git) + sync file + restart api_server (venv)
#
# Usage:
#   bash /workspace/live-streaming-ai/deploy/redeploy.sh
#   FORCE_ASSETS=1 bash .../redeploy.sh
#   FORCE_GIT_RESET=1 bash .../redeploy.sh
#   SKIP_PULL=1 bash .../redeploy.sh   # tanpa git pull
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/sync.sh" --pull --restart "$@"
