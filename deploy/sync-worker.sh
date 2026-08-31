#!/bin/bash
# Sinkronkan skrip deploy + assets dari repo ke /workspace/ai_live_worker.
# Dipakai oleh start.sh dan redeploy-worker.sh.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/workspace/live-streaming-ai}"
WORKER_DIR="${WORKER_DIR:-/workspace/ai_live_worker}"
DEPLOY_DIR="${DEPLOY_DIR:-$REPO_DIR/deploy}"
# 0 = jangan timpa asset yang sudah ada (start biasa), 1 = timpa semua asset (redeploy)
FORCE_ASSETS="${FORCE_ASSETS:-0}"

# Buat worker .env dari deploy/.env (jika ada) atau .env.example.
bootstrap_worker_env() {
	if [ -f "$WORKER_DIR/.env" ]; then
		return 0
	fi

	mkdir -p "$WORKER_DIR"

	if [ -f "$DEPLOY_DIR/.env" ]; then
		echo "[ENV] Membuat $WORKER_DIR/.env dari deploy/.env ..."
		cp -f "$DEPLOY_DIR/.env" "$WORKER_DIR/.env"
		return 0
	fi

	if [ -f "$DEPLOY_DIR/.env.example" ]; then
		echo "[ENV] deploy/.env tidak ada — membuat $WORKER_DIR/.env dari .env.example ..."
		cp -f "$DEPLOY_DIR/.env.example" "$WORKER_DIR/.env"
		return 0
	fi

	echo "[WARN] Tidak ada deploy/.env atau .env.example — worker memakai default env."
}

# Pastikan fastapi/uvicorn terpasang di venv worker (ringan, idempotent).
ensure_worker_python_deps() {
	local py="${1:-}"
	if [ -z "$py" ]; then
		if [ -f "$WORKER_DIR/env/bin/python" ]; then
			py="$WORKER_DIR/env/bin/python"
		else
			echo "[ERROR] Venv tidak ditemukan di $WORKER_DIR/env"
			echo "        Jalankan setup penuh:"
			echo "          cd $REPO_DIR/deploy && export HF_TOKEN=hf_... && bash setup-safe.sh"
			return 1
		fi
	fi

	if "$py" -c "import fastapi, uvicorn" 2>/dev/null; then
		return 0
	fi

	echo "[DEPS] fastapi/uvicorn belum terpasang — menginstall requirements worker ..."
	local req="$WORKER_DIR/requirements-worker.txt"
	if [ ! -f "$req" ] && [ -f "$DEPLOY_DIR/requirements-worker.txt" ]; then
		cp -f "$DEPLOY_DIR/requirements-worker.txt" "$req"
	fi

	if [ -f "$req" ]; then
		"$py" -m pip install --no-cache-dir -r "$req"
	else
		"$py" -m pip install --no-cache-dir "fastapi>=0.104.0" "uvicorn>=0.24.0" "pydantic>=2.0.0"
	fi

	if ! "$py" -c "import fastapi, uvicorn" 2>/dev/null; then
		echo "[ERROR] Gagal menginstall fastapi. Coba setup penuh: bash $DEPLOY_DIR/setup-safe.sh"
		return 1
	fi

	echo "[DEPS] Python API dependencies OK."
}

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
