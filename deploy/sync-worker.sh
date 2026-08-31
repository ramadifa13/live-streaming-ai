#!/bin/bash
# Sinkronkan skrip deploy + assets dari repo ke /workspace/ai_live_worker.
# Dipakai oleh start.sh dan redeploy-worker.sh.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/workspace/live-streaming-ai}"
WORKER_DIR="${WORKER_DIR:-/workspace/ai_live_worker}"
DEPLOY_DIR="${DEPLOY_DIR:-$REPO_DIR/deploy}"
# 0 = jangan timpa asset yang sudah ada (start biasa), 1 = timpa semua asset (redeploy)
FORCE_ASSETS="${FORCE_ASSETS:-0}"

sync_worker_files() {
	if [ ! -d "$DEPLOY_DIR" ]; then
		echo "[ERROR] Folder deploy tidak ditemukan: $DEPLOY_DIR"
		return 1
	fi

	mkdir -p "$WORKER_DIR"

	echo "[SYNC] Menyalin skrip Python & shell ke $WORKER_DIR ..."
	cp -f "$DEPLOY_DIR"/*.py "$WORKER_DIR/" 2>/dev/null || true
	cp -f "$DEPLOY_DIR"/*.sh "$WORKER_DIR/" 2>/dev/null || true

	if [ -f "$DEPLOY_DIR/requirements-worker.txt" ]; then
		cp -f "$DEPLOY_DIR/requirements-worker.txt" "$WORKER_DIR/requirements-worker.txt" 2>/dev/null || true
	fi

	if [ -d "$WORKER_DIR/MuseTalk" ]; then
		echo "[SYNC] Menyalin patch MuseTalk (inference + preprocessing) ..."
		mkdir -p "$WORKER_DIR/MuseTalk/scripts"
		mkdir -p "$WORKER_DIR/MuseTalk/musetalk/utils"
		cp -f "$DEPLOY_DIR/inference.py" "$WORKER_DIR/MuseTalk/scripts/inference.py" 2>/dev/null || true
		cp -f "$DEPLOY_DIR/preprocessing.py" "$WORKER_DIR/MuseTalk/musetalk/utils/preprocessing.py" 2>/dev/null || true
	fi

	if [ -f "$REPO_DIR/MuseTalk/musetalk/utils/face_detection/detection/sfd/sfd_detector.py" ]; then
		mkdir -p "$WORKER_DIR/MuseTalk/musetalk/utils/face_detection/detection/sfd"
		cp -f "$REPO_DIR/MuseTalk/musetalk/utils/face_detection/detection/sfd/sfd_detector.py" \
			"$WORKER_DIR/MuseTalk/musetalk/utils/face_detection/detection/sfd/sfd_detector.py" 2>/dev/null || true
	fi

	mkdir -p "$WORKER_DIR/assets/2d" "$WORKER_DIR/assets/3d"
	if [ -d "$DEPLOY_DIR/assets" ]; then
		if [ "$FORCE_ASSETS" = "1" ]; then
			echo "[SYNC] Menyalin assets (mode force — menimpa file lama) ..."
			cp -rf "$DEPLOY_DIR/assets/." "$WORKER_DIR/assets/"
		else
			echo "[SYNC] Menyalin assets baru saja (tidak menimpa yang sudah ada) ..."
			cp -rn "$DEPLOY_DIR/assets/." "$WORKER_DIR/assets/" 2>/dev/null || true
		fi
	fi

	echo "[SYNC] Selesai."
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	sync_worker_files
fi
