#!/bin/bash
# Compat wrapper — gunakan: bash sync.sh --pull --restart
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/sync.sh" --pull --restart "$@"
