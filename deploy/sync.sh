#!/bin/bash
# sync.sh — satu pintu sync/redeploy AI worker di RunPod.
#
# Usage (di pod):
#   bash deploy/sync.sh              # salin file deploy → /workspace/ai_live_worker
#   bash deploy/sync.sh --restart    # sync + restart api (tanpa git pull)
#   bash deploy/sync.sh --pull --restart   # git pull + sync + restart
#   FORCE_ASSETS=1 bash deploy/sync.sh --restart   # timpa assets
#
# Diimpor juga oleh start.sh (fungsi sync_worker_files / bootstrap_worker_env).

set -euo pipefail

REPO_DIR="${REPO_DIR:-/workspace/live-streaming-ai}"
WORKER_DIR="${WORKER_DIR:-/workspace/ai_live_worker}"
DEPLOY_DIR="${DEPLOY_DIR:-$REPO_DIR/deploy}"
# 0 = jangan timpa asset yang sudah ada (start biasa), 1 = timpa semua asset (redeploy)
FORCE_ASSETS="${FORCE_ASSETS:-0}"

bootstrap_worker_env() {
	mkdir -p "$WORKER_DIR"

	if [ ! -f "$WORKER_DIR/.env" ]; then
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
		return 0
	fi

	local src=""
	if [ -f "$DEPLOY_DIR/.env" ]; then
		src="$DEPLOY_DIR/.env"
	elif [ -f "$DEPLOY_DIR/.env.example" ]; then
		src="$DEPLOY_DIR/.env.example"
	else
		return 0
	fi

	python3 - "$src" "$WORKER_DIR/.env" <<'PY' || true
import sys
src, dest = sys.argv[1], sys.argv[2]
def parse(path):
    data = {}
    order = []
    with open(path, "r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[7:].strip()
            key, val = line.split("=", 1)
            key = key.strip()
            if key and key not in data:
                data[key] = raw if raw.endswith("\n") else raw + "\n"
                order.append(key)
    return data, order
src_data, src_order = parse(src)
dest_data, _ = parse(dest)
missing = [k for k in src_order if k not in dest_data]
if not missing:
    sys.exit(0)
with open(dest, "a", encoding="utf-8") as fh:
    fh.write("\n# merged from deploy .env\n")
    for key in missing:
        fh.write(src_data[key])
print("[ENV] Ditambah ke worker .env:", ", ".join(missing))
PY
	dedupe_worker_env
}

dedupe_worker_env() {
	local env_file="$WORKER_DIR/.env"
	[ -f "$env_file" ] || return 0
	python3 - "$env_file" <<'PY' || true
import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as fh:
    lines = fh.readlines()
seen = {}
out = []
for raw in lines:
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        out.append(raw)
        continue
    key = line.split("=", 1)[0].strip()
    if key.startswith("export "):
        key = key[7:].strip().split("=", 1)[0].strip()
    if key in seen:
        out[seen[key]] = raw
    else:
        seen[key] = len(out)
        out.append(raw)
with open(path, "w", encoding="utf-8") as fh:
    fh.writelines(out)
PY
}

ensure_venv_pip() {
	local py="${1:-}"
	if [ -z "$py" ]; then
		py="$WORKER_DIR/env/bin/python"
	fi

	if "$py" -m pip --version >/dev/null 2>&1; then
		return 0
	fi

	echo "[DEPS] pip tidak ada di venv — memulihkan ..."
	if "$py" -m ensurepip --upgrade >/dev/null 2>&1; then
		:
	else
		local tmp
		tmp="$(mktemp /tmp/get-pip.XXXXXX.py)"
		if command -v curl >/dev/null 2>&1; then
			curl -fsSL https://bootstrap.pypa.io/get-pip.py -o "$tmp"
		elif command -v wget >/dev/null 2>&1; then
			wget -q -O "$tmp" https://bootstrap.pypa.io/get-pip.py
		else
			echo "[ERROR] curl/wget tidak tersedia untuk bootstrap pip."
			return 1
		fi
		"$py" "$tmp"
		rm -f "$tmp"
	fi

	if ! "$py" -m pip --version >/dev/null 2>&1; then
		echo "[ERROR] Gagal memulihkan pip di $py"
		echo "        Coba setup penuh: cd $DEPLOY_DIR && export HF_TOKEN=hf_... && bash setup.sh"
		return 1
	fi

	echo "[DEPS] pip OK."
}

ensure_worker_python_deps() {
	local py="${1:-}"
	if [ -z "$py" ]; then
		if [ -f "$WORKER_DIR/env/bin/python" ]; then
			py="$WORKER_DIR/env/bin/python"
		else
			echo "[ERROR] Venv tidak ditemukan di $WORKER_DIR/env"
			echo "        Jalankan setup penuh:"
			echo "          cd $REPO_DIR/deploy && export HF_TOKEN=hf_... && bash setup.sh"
			return 1
		fi
	fi

	if "$py" -c "import fastapi, uvicorn" 2>/dev/null; then
		return 0
	fi

	ensure_venv_pip "$py"

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
		echo "[ERROR] Gagal menginstall fastapi. Coba setup penuh: bash $DEPLOY_DIR/setup.sh"
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
	if [ "${START_SH_RUNNING:-0}" = "1" ]; then
		for shf in "$DEPLOY_DIR"/*.sh; do
			[ -f "$shf" ] || continue
			base="$(basename "$shf")"
			if [ "$base" = "start.sh" ]; then
				echo "[SYNC] Skip start.sh (sedang dijalankan — di-update di akhir start.sh)"
				continue
			fi
			cp -f "$shf" "$WORKER_DIR/$base"
		done
	else
		cp -f "$DEPLOY_DIR"/*.sh "$WORKER_DIR/" 2>/dev/null || true
	fi

	if [ -f "$DEPLOY_DIR/requirements-worker.txt" ]; then
		cp -f "$DEPLOY_DIR/requirements-worker.txt" "$WORKER_DIR/requirements-worker.txt" 2>/dev/null || true
	fi
	if [ -f "$DEPLOY_DIR/.env.example" ]; then
		cp -f "$DEPLOY_DIR/.env.example" "$WORKER_DIR/.env.example" 2>/dev/null || true
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

	fix_shell_eol "$WORKER_DIR"
	fix_shell_eol "$DEPLOY_DIR"

	echo "[SYNC] Selesai."
}

fix_shell_eol() {
	local dir="${1:-}"
	[ -n "$dir" ] && [ -d "$dir" ] || return 0
	local f
	for f in "$dir"/*.sh; do
		[ -f "$f" ] || continue
		if grep -q $'\r' "$f" 2>/dev/null; then
			sed -i 's/\r$//' "$f"
			echo "[SYNC] CRLF→LF: $(basename "$f")"
		fi
	done
}

_cli_pull=0
_cli_restart=0
for _arg in "$@"; do
	case "$_arg" in
		--pull) _cli_pull=1 ;;
		--restart) _cli_restart=1 ;;
		-h|--help)
			echo "Usage: bash sync.sh [--pull] [--restart]"
			echo "  (no flags)   sync files only"
			echo "  --restart    sync + FORCE_RESTART start.sh"
			echo "  --pull       git pull origin main before sync"
			exit 0
			;;
	esac
done

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	echo "============================================================"
	echo " AI Live Worker — sync.sh"
	echo "============================================================"

	if [ "$_cli_pull" = "1" ]; then
		if [ -d "$REPO_DIR/.git" ]; then
			cd "$REPO_DIR"
			echo "[pull] git fetch/pull origin main ..."
			git fetch origin main 2>/dev/null || true
			if [ "${FORCE_GIT_RESET:-0}" = "1" ]; then
				git reset --hard origin/main
			else
				git pull origin main 2>/dev/null || echo "[WARN] git pull gagal — lanjut sync lokal"
			fi
		else
			echo "[WARN] Repo git tidak ada di $REPO_DIR — lewati --pull"
		fi
	fi

	if [ "$_cli_restart" = "1" ]; then
		FORCE_ASSETS="${FORCE_ASSETS:-1}"
	fi
	export REPO_DIR WORKER_DIR DEPLOY_DIR FORCE_ASSETS

	sync_worker_files
	bootstrap_worker_env
	dedupe_worker_env
	ensure_worker_python_deps || true

	if [ "$_cli_restart" = "1" ]; then
		echo "[restart] FORCE_RESTART=1 SKIP_WATCHDOG=1 bash start.sh ..."
		for f in "$WORKER_DIR"/*.sh "$DEPLOY_DIR"/*.sh; do
			[ -f "$f" ] && sed -i 's/\r$//' "$f" 2>/dev/null || true
		done
		cd "$WORKER_DIR"
		SKIP_WATCHDOG=1 FORCE_RESTART=1 bash start.sh
		echo "[OK] Sync + restart selesai."
		echo "     Health: curl -s http://127.0.0.1:\${PORT:-8000}/health"
		echo "     Log:    tail -f $WORKER_DIR/api_server.log"
	else
		echo "[OK] Sync selesai (tanpa restart)."
		echo "     Restart: bash $DEPLOY_DIR/sync.sh --restart"
	fi
fi
