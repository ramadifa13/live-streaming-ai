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
export WORKER_SHARED_ROOT="${WORKER_SHARED_ROOT:-$WORKER_DIR}"
export WORKER_RUNTIME_ROOT="${WORKER_RUNTIME_ROOT:-/tmp/ai_live_worker}"
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

# Hapus engine TTS lama dari worker; sintesis berjalan di backend.
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

	echo "[TTS] Sisa Piper/Supertonic dihapus. Worker hanya menerima audio backend."
}

cleanup_legacy_env() {
	echo "[ENV] Membersihkan sisa konfigurasi lama untuk zero-config..."
	true
	echo "[ENV] Zero-config aktif — worker menggunakan defaults code optimal."
}

bootstrap_worker_env() {
	cleanup_legacy_env
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

	# TTS dan voice references dimiliki backend; worker hanya menerima WAV.
	# Helper scripts (ops) — tetap flat di worker agar path lama tetap jalan
	_tts_check=""
	if [ -f "$DEPLOY_DIR/scripts/check_tts_integration.sh" ]; then
		_tts_check="$DEPLOY_DIR/scripts/check_tts_integration.sh"
	elif [ -f "$DEPLOY_DIR/check_tts_integration.sh" ]; then
		_tts_check="$DEPLOY_DIR/check_tts_integration.sh"
	fi
	if [ -n "$_tts_check" ]; then
		cp -f "$_tts_check" "$WORKER_DIR/check_tts_integration.sh"
		chmod +x "$WORKER_DIR/check_tts_integration.sh" 2>/dev/null || true
	fi
	if [ -f "$DEPLOY_DIR/scripts/validate_idle_assets.py" ]; then
		cp -f "$DEPLOY_DIR/scripts/validate_idle_assets.py" "$WORKER_DIR/validate_idle_assets.py"
	fi
	if [ -f "$DEPLOY_DIR/scripts/compile_continuous_timeline.py" ]; then
		cp -f "$DEPLOY_DIR/scripts/compile_continuous_timeline.py" "$WORKER_DIR/compile_continuous_timeline.py"
	fi
	if [ -f "$DEPLOY_DIR/scripts/_start_worker.sh" ]; then
		cp -f "$DEPLOY_DIR/scripts/_start_worker.sh" "$WORKER_DIR/_start_worker.sh"
		chmod +x "$WORKER_DIR/_start_worker.sh" 2>/dev/null || true
	fi
	# Voice references are owned by the backend and never copied to this worker.

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
	fix_shell_eol "$DEPLOY_DIR/scripts"
	chmod +x "$WORKER_DIR"/*.sh "$DEPLOY_DIR"/*.sh 2>/dev/null || true
	chmod +x "$DEPLOY_DIR/scripts"/*.sh 2>/dev/null || true

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
	cleanup_legacy_env
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
