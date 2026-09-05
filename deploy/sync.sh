#!/bin/bash
# sync.sh — satu pintu sync/redeploy AI worker di RunPod.
#
# Usage (di pod):
#   bash deploy/sync.sh                      # salin deploy/ → worker
#   bash deploy/sync.sh --restart            # git pull + sync + restart API (default)
#   bash deploy/sync.sh --pull --restart     # sama (eksplisit)
#   SKIP_PULL=1 bash deploy/sync.sh --restart  # restart tanpa git pull
#   FORCE_ASSETS=1 bash deploy/sync.sh --restart
#   FORCE_GIT_RESET=1 bash deploy/sync.sh --pull --restart
#
# Diimpor juga oleh start.sh (fungsi sync_worker_files / bootstrap_worker_env).

set -euo pipefail

REPO_DIR="${REPO_DIR:-/workspace/live-streaming-ai}"
WORKER_DIR="${WORKER_DIR:-/workspace/ai_live_worker}"
DEPLOY_DIR="${DEPLOY_DIR:-$REPO_DIR/deploy}"
REPO_URL="${REPO_URL:-https://github.com/ramadifa13/live-streaming-ai.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
# 0 = jangan timpa asset yang sudah ada, 1 = timpa semua asset
FORCE_ASSETS="${FORCE_ASSETS:-0}"

export_cuda_env() {
	export PATH="/usr/local/cuda-11.8/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
	export CUDA_HOME="${CUDA_HOME:-/usr/local/cuda-11.8}"
	export LD_LIBRARY_PATH="/usr/local/cuda-11.8/lib64:${LD_LIBRARY_PATH:-}"
	export TMPDIR="${TMPDIR:-/workspace/tmp}"
	export PIP_CACHE_DIR="${PIP_CACHE_DIR:-/workspace/tmp/pip_cache}"
	mkdir -p "$TMPDIR" "$PIP_CACHE_DIR" 2>/dev/null || true
}

# Pastikan $REPO_DIR adalah git repo (clone / restore .git jika folder copy-paste).
ensure_git_repo() {
	mkdir -p "$(dirname "$REPO_DIR")"
	if [ -d "$REPO_DIR/.git" ]; then
		return 0
	fi

	if [ ! -d "$REPO_DIR" ]; then
		echo "[git] Clone $REPO_URL → $REPO_DIR (branch $REPO_BRANCH)"
		git clone --branch "$REPO_BRANCH" "$REPO_URL" "$REPO_DIR"
		DEPLOY_DIR="$REPO_DIR/deploy"
		return 0
	fi

	echo "[git] $REPO_DIR ada tapi BUKAN git repo — restore dari origin/$REPO_BRANCH"
	echo "      (file lokal akan ditimpa oleh remote; cocok untuk pod deploy)"
	cd "$REPO_DIR"
	git init
	git remote remove origin 2>/dev/null || true
	git remote add origin "$REPO_URL"
	git fetch --depth 1 origin "$REPO_BRANCH"
	git checkout -f -B "$REPO_BRANCH" "origin/$REPO_BRANCH"
	DEPLOY_DIR="$REPO_DIR/deploy"
	echo "[git] Repo OK: $(git rev-parse --short HEAD 2>/dev/null || echo '?') @ $REPO_BRANCH"
}

pull_repo() {
	ensure_git_repo || return 1
	cd "$REPO_DIR"
	echo "[pull] fetch/pull origin $REPO_BRANCH ..."
	git fetch origin "$REPO_BRANCH" 2>/dev/null || git fetch origin || true
	local br
	br="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
	if [ "$br" != "$REPO_BRANCH" ]; then
		git checkout -B "$REPO_BRANCH" "origin/$REPO_BRANCH" 2>/dev/null \
			|| git checkout "$REPO_BRANCH" 2>/dev/null \
			|| true
	fi
	if [ "${FORCE_GIT_RESET:-0}" = "1" ]; then
		echo "[pull] FORCE_GIT_RESET=1 — hard reset ke origin/$REPO_BRANCH"
		git reset --hard "origin/$REPO_BRANCH"
	else
		if ! git pull --ff-only origin "$REPO_BRANCH" 2>/dev/null; then
			echo "[WARN] ff-only pull gagal — hard reset ke origin/$REPO_BRANCH"
			git reset --hard "origin/$REPO_BRANCH" || true
		fi
	fi
	DEPLOY_DIR="$REPO_DIR/deploy"
	echo "[pull] HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo '?') branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
}

# Hapus TTS engine lama (Piper/Supertonic) — VoxCPM2 adalah satu-satunya TTS.
purge_legacy_tts() {
	echo "[TTS] Membersihkan sisa Piper/Supertonic di pod…"
	pkill -f "[p]iper_tts/server.py|uvicorn.*8090|[s]upertonic" 2>/dev/null || true
	if [ -f /workspace/piper_tts/piper.pid ]; then
		old="$(cat /workspace/piper_tts/piper.pid 2>/dev/null || true)"
		if [ -n "${old:-}" ]; then
			kill "$old" 2>/dev/null || true
		fi
	fi
	sleep 0.3
	rm -rf /workspace/piper_tts \
		"${DEPLOY_DIR:-}/piper_tts" \
		"${WORKER_DIR:-}/piper_tts" \
		/workspace/supertonic_tts \
		"${DEPLOY_DIR:-}/supertonic_tts" \
		"${WORKER_DIR:-}/supertonic_tts" \
		2>/dev/null || true

	_strip_legacy_tts_env() {
		local envf="$1"
		[ -f "$envf" ] || return 0
		if grep -qE '^(export[[:space:]]+)?(PIPER_|TTS_PIPER|PIPER_TTS|SUPERTONIC_|TTS_ENGINE=supertonic)' "$envf" 2>/dev/null; then
			grep -vE '^(export[[:space:]]+)?(PIPER_|TTS_PIPER|PIPER_TTS|SUPERTONIC_|TTS_ENGINE=supertonic)' "$envf" > "${envf}.notts" || true
			if [ -s "${envf}.notts" ] || [ -f "${envf}.notts" ]; then
				mv -f "${envf}.notts" "$envf"
				echo "[TTS] Variabel Piper/Supertonic dihapus dari $envf"
			fi
		fi
	}
	_strip_legacy_tts_env "${WORKER_DIR:-}/.env"
	_strip_legacy_tts_env "${DEPLOY_DIR:-}/.env"
	echo "[TTS] Sisa Piper/Supertonic dihapus. TTS aktif = VoxCPM2."
}

sync_girl_voices() {
	local src_root=""
	if [ -d "$DEPLOY_DIR/voices" ]; then
		src_root="$DEPLOY_DIR/voices"
	elif [ -d "$WORKER_DIR/voices" ]; then
		src_root="$WORKER_DIR/voices"
	else
		return 0
	fi
	mkdir -p /workspace/voices "$WORKER_DIR/voices"
	local vid
	for vid in girl_cute_kids girl_warm_youthful girl_warm_friendly girl_calm_professional; do
		mkdir -p "/workspace/voices/$vid" "$WORKER_DIR/voices/$vid"
		if [ -f "$src_root/$vid/reference.wav" ]; then
			cp -n "$src_root/$vid/reference.wav" "/workspace/voices/$vid/reference.wav" 2>/dev/null || true
			cp -n "$src_root/$vid/reference.wav" "$WORKER_DIR/voices/$vid/reference.wav" 2>/dev/null || true
		fi
	done
	rm -rf /workspace/voices/default_host "$WORKER_DIR/voices/default_host" 2>/dev/null || true
}

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

	echo "[DEPS] Python API dependencies OK (venv: $py)."
}

sync_worker_files() {
	if [ ! -d "$DEPLOY_DIR" ]; then
		echo "[ERROR] Folder deploy tidak ditemukan: $DEPLOY_DIR"
		return 1
	fi

	mkdir -p "$WORKER_DIR"

	echo "[SYNC] Menyalin skrip Python & shell ke $WORKER_DIR ..."
	cp -f "$DEPLOY_DIR"/*.py "$WORKER_DIR/" 2>/dev/null || true

	# VoxCPM2 TTS package + voice assets
	if [ -d "$DEPLOY_DIR/voxcpm2_tts" ]; then
		echo "[SYNC] Menyalin voxcpm2_tts/ ..."
		mkdir -p "$WORKER_DIR/voxcpm2_tts"
		cp -rf "$DEPLOY_DIR/voxcpm2_tts/." "$WORKER_DIR/voxcpm2_tts/"
	fi
	if [ -f "$DEPLOY_DIR/check_tts_integration.sh" ]; then
		cp -f "$DEPLOY_DIR/check_tts_integration.sh" "$WORKER_DIR/check_tts_integration.sh"
		chmod +x "$WORKER_DIR/check_tts_integration.sh" 2>/dev/null || true
	fi
	if [ -d "$DEPLOY_DIR/voices" ]; then
		echo "[SYNC] Menyalin voices/ ..."
		mkdir -p "$WORKER_DIR/voices" /workspace/voices
		cp -rf "$DEPLOY_DIR/voices/." "$WORKER_DIR/voices/"
		cp -rn "$DEPLOY_DIR/voices/." /workspace/voices/ 2>/dev/null || true
	fi
	sync_girl_voices

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

	purge_legacy_tts
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
	chmod +x "$WORKER_DIR"/*.sh "$DEPLOY_DIR"/*.sh 2>/dev/null || true
	chmod +x "$WORKER_DIR/voxcpm2_tts"/*.sh "$DEPLOY_DIR/voxcpm2_tts"/*.sh 2>/dev/null || true

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
_cli_already_pulled=0
for _arg in "$@"; do
	case "$_arg" in
		--pull) _cli_pull=1 ;;
		--restart) _cli_restart=1 ;;
		--already-pulled) _cli_already_pulled=1 ;;
		-h|--help)
			echo "Usage: bash sync.sh [--pull] [--restart]"
			echo "  (no flags)     sync files only"
			echo "  --restart      git pull (default) + sync + start.sh"
			echo "  --pull         git pull eksplisit (juga default saat --restart)"
			echo "  SKIP_PULL=1    lewati git pull saat --restart"
			echo "  FORCE_ASSETS=1 timpa assets"
			echo "  FORCE_GIT_RESET=1  hard reset ke origin/main"
			exit 0
			;;
	esac
done

# --restart selalu pull, kecuali SKIP_PULL=1 atau sudah di-pull di re-exec.
if [ "$_cli_restart" = "1" ] && [ "${SKIP_PULL:-0}" != "1" ] && [ "$_cli_already_pulled" != "1" ]; then
	_cli_pull=1
fi

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	export_cuda_env
	echo "============================================================"
	echo " AI Live Worker — sync.sh"
	echo " REPO=$REPO_DIR  WORKER=$WORKER_DIR"
	echo "============================================================"

	if [ "$_cli_pull" = "1" ]; then
		pull_repo || echo "[WARN] pull_repo gagal — lanjut sync dari file lokal"
		# Re-exec script TERBARU dari repo setelah pull (hindari jalanin sync.sh usang).
		if [ "$_cli_already_pulled" != "1" ] && [ -f "$REPO_DIR/deploy/sync.sh" ]; then
			_self="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || realpath "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
			_new="$(readlink -f "$REPO_DIR/deploy/sync.sh" 2>/dev/null || realpath "$REPO_DIR/deploy/sync.sh" 2>/dev/null || echo "$REPO_DIR/deploy/sync.sh")"
			if [ "$_self" != "$_new" ] || [ "$_cli_restart" = "1" ]; then
				echo "[pull] Re-exec sync.sh terbaru dari repo ..."
				_flags=()
				[ "$_cli_restart" = "1" ] && _flags+=(--restart)
				_flags+=(--already-pulled)
				exec bash "$REPO_DIR/deploy/sync.sh" "${_flags[@]}"
			fi
		fi
	fi

	if [ "$_cli_restart" = "1" ]; then
		FORCE_ASSETS="${FORCE_ASSETS:-1}"
	fi
	export REPO_DIR WORKER_DIR DEPLOY_DIR FORCE_ASSETS REPO_URL REPO_BRANCH

	sync_worker_files
	bootstrap_worker_env
	dedupe_worker_env
	ensure_worker_python_deps || true

	echo "[check] invariant worker ..."
	_inv_py="$WORKER_DIR/env/bin/python"
	[ -x "$_inv_py" ] || _inv_py="python3"
	if [ -f "$WORKER_DIR/check_invariants.py" ]; then
		"$_inv_py" "$WORKER_DIR/check_invariants.py" || {
			echo "[ERROR] Invariant gagal — batalkan restart. Perbaiki kode lalu sync lagi."
			exit 1
		}
	fi

	if [ "$_cli_restart" = "1" ]; then
		echo "[restart] FORCE_RESTART=1 SKIP_WATCHDOG=1 bash start.sh ..."
		for f in "$WORKER_DIR"/*.sh "$DEPLOY_DIR"/*.sh; do
			[ -f "$f" ] && sed -i 's/\r$//' "$f" 2>/dev/null || true
		done
		cd "$WORKER_DIR"
		SKIP_WATCHDOG=1 FORCE_RESTART=1 bash start.sh
		echo "[OK] Sync + restart selesai."
		echo "     Health: curl -s http://127.0.0.1:\${PORT:-8000}/health"
		echo "     TTS:    curl -s http://127.0.0.1:\${PORT:-8000}/tts/health"
		echo "     Log:    tail -f $WORKER_DIR/api_server.log"
		echo "     Python: $WORKER_DIR/env/bin/python   ← JANGAN pakai python3 sistem"
	else
		echo "[OK] Sync selesai (tanpa restart)."
		echo "     Restart: bash $DEPLOY_DIR/sync.sh --restart"
	fi
fi
