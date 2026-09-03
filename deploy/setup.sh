#!/bin/bash
# setup.sh — alias kompatibel untuk setup-safe.sh (full MuseTalk + venv di RunPod).
# Usage: export HF_TOKEN=hf_... && bash setup.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/setup-safe.sh" "$@"
