#!/bin/bash
# Compat: source sync.sh (fungsi sync_worker_files / bootstrap_worker_env)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/sync.sh"
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	sync_worker_files
fi
