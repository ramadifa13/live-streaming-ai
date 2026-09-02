#!/bin/bash
# DEPRECATED — gunakan redeploy-worker.sh (wrapper ini tetap ada untuk kompatibilitas).
#
# Usage:
#   bash deploy/pod-restart.sh
#   STOP_BROADCAST=1 bash deploy/pod-restart.sh
#   VERIFY=1 bash deploy/pod-restart.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export VERIFY="${VERIFY:-1}"
export STOP_BROADCAST="${STOP_BROADCAST:-0}"
exec bash "$SCRIPT_DIR/redeploy-worker.sh"
