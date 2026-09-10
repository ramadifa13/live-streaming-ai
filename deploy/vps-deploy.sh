#!/usr/bin/env bash
# vps-deploy.sh — deploy FE + BE ke VPS, buang sisa Piper/Supertonic/VoxCPM.
#
# Dari laptop (password SSH diketik sendiri, jangan taruh di file):
#   bash deploy/vps-deploy.sh
#   VPS_SSH=root@202.10.35.186 bash deploy/vps-deploy.sh
#   SSHPASS='...' bash deploy/vps-deploy.sh          # butuh sshpass
#
# Sudah SSH di VPS:
#   cd /var/www/app && git pull origin main && bash deploy/vps-deploy.sh --on-vps
#
# Opsi:
#   --on-vps          jalankan di mesin ini (bukan lewat SSH)
#   --skip-pull       jangan git pull
#   --refresh-tts     rebuild venv Pocket TTS
#   --clean-deps      hapus node_modules + .next + dist lalu npm ci

set -euo pipefail

APP="${APP_DIR:-/var/www/app}"
BRANCH="${DEPLOY_BRANCH:-main}"
VPS_SSH="${VPS_SSH:-root@202.10.35.186}"
ON_VPS=0
SKIP_PULL=0
REFRESH_TTS=0
CLEAN_DEPS=0

for _a in "$@"; do
	case "$_a" in
		--on-vps) ON_VPS=1 ;;
		--skip-pull) SKIP_PULL=1 ;;
		--refresh-tts) REFRESH_TTS=1 ;;
		--clean-deps) CLEAN_DEPS=1 ;;
		--help|-h)
			sed -n '2,20p' "$0"
			exit 0
			;;
	esac
done

ssh_cmd() {
	if [ -n "${SSHPASS:-}" ] && command -v sshpass >/dev/null 2>&1; then
		sshpass -e ssh -o StrictHostKeyChecking=accept-new "$@"
	else
		ssh -o StrictHostKeyChecking=accept-new "$@"
	fi
}

if [ "$ON_VPS" != "1" ] && [ ! -d "$APP/backend" ]; then
	echo "[INFO] Menjalankan deploy di $VPS_SSH ..."
	echo "[INFO] Password SSH diketik di prompt (atau set SSHPASS). Jangan commit password."
	_flags="--on-vps"
	[ "$SKIP_PULL" = "1" ] && _flags="$_flags --skip-pull"
	[ "$REFRESH_TTS" = "1" ] && _flags="$_flags --refresh-tts"
	[ "$CLEAN_DEPS" = "1" ] && _flags="$_flags --clean-deps"
	ssh_cmd "$VPS_SSH" "cd $APP && git pull origin $BRANCH && bash deploy/vps-deploy.sh $_flags"
	exit $?
fi

if [ ! -d "$APP/backend" ]; then
	echo "[ERROR] $APP/backend tidak ada. Clone repo dulu (lihat DEPLOYMENT_GUIDE.md)."
	exit 1
fi

cd "$APP"

echo "============================================================"
echo "  Deploy FE+BE  ($APP)"
echo "============================================================"

if [ "$SKIP_PULL" != "1" ]; then
	echo "[1/6] git pull origin $BRANCH"
	git fetch origin "$BRANCH"
	git pull --ff-only origin "$BRANCH"
else
	echo "[1/6] skip git pull"
fi

echo "[2/6] Hentikan proses TTS lama (Piper / Supertonic / VoxCPM)"
pkill -f '[p]iper_tts|[p]iper --|[p]iper-tts' 2>/dev/null || true
pkill -f '[s]upertonic' 2>/dev/null || true
pkill -f '[v]oxcpm' 2>/dev/null || true
sleep 1

echo "[3/6] Hapus data/model TTS lama agar VPS tidak berat"
# Jangan sentuh backend/pocket_tts — itu engine yang dipakai sekarang.
_legacy_paths=(
	"$APP/backend/piper_tts"
	"$APP/backend/piper_data"
	"$APP/backend/supertonic_tts"
	"$APP/backend/supertonic_data"
	"$APP/backend/voxcpm2_tts"
	"$APP/backend/voxcpm2_data"
	"$APP/deploy/piper_tts"
	"$APP/deploy/supertonic_tts"
	"$APP/deploy/voxcpm2_tts"
	"$APP/piper_tts"
	"$APP/supertonic_tts"
	"$HOME/.local/share/piper"
	"$HOME/.cache/piper"
	"$HOME/.cache/supertonic"
	"/opt/piper"
	"/usr/local/piper"
)
for p in "${_legacy_paths[@]}"; do
	if [ -e "$p" ]; then
		echo "  rm -rf $p"
		rm -rf "$p"
	fi
done

# Model/onnx sisa Piper di tree app (bukan pocket_tts)
while IFS= read -r -d '' f; do
	echo "  rm $f"
	rm -f "$f"
done < <(find "$APP" \( -path "$APP/backend/pocket_tts" -o -path "$APP/frontend/node_modules" -o -path "$APP/backend/node_modules" \) -prune -o \
	\( -iname '*piper*.onnx' -o -iname '*piper*.onnx.json' -o -iname 'en_US-*.onnx' -o -iname 'id_ID-*.onnx' \) -print0 2>/dev/null || true)

# Paket apt Piper jika pernah diinstall
if command -v dpkg >/dev/null 2>&1 && dpkg -l 2>/dev/null | grep -qiE '^ii\s+piper'; then
	echo "  apt remove piper"
	apt-get remove -y --purge piper 2>/dev/null || true
fi

if [ "$CLEAN_DEPS" = "1" ]; then
	echo "  hapus node_modules / dist / .next"
	rm -rf "$APP/backend/node_modules" "$APP/backend/dist"
	rm -rf "$APP/frontend/node_modules" "$APP/frontend/.next"
fi

# Jangan hapus .env, prisma db, pocket_tts/env (kecuali --refresh-tts)
if [ "$REFRESH_TTS" = "1" ]; then
	echo "  rebuild pocket_tts/env"
	rm -rf "$APP/backend/pocket_tts/env"
fi

echo "[4/6] Build backend + Pocket TTS"
cd "$APP/backend"
if [ -f package-lock.json ]; then npm ci; else npm install; fi
npx prisma generate
npx prisma migrate deploy
npm run build

if [ ! -x pocket_tts/env/bin/python ]; then
	python3 -m venv pocket_tts/env
fi
pocket_tts/env/bin/python -m pip install --upgrade pip
pocket_tts/env/bin/python -m pip install -r pocket_tts/requirements.txt

echo "[5/6] Build frontend"
cd "$APP/frontend"
if [ -f package-lock.json ]; then npm ci; else npm install; fi
npm run build

echo "[6/6] Restart PM2"
cd "$APP/backend"
if pm2 describe api >/dev/null 2>&1; then
	pm2 restart api --update-env
else
	pm2 start dist/server.js --name api
fi
cd "$APP/frontend"
if pm2 describe frontend >/dev/null 2>&1; then
	pm2 restart frontend --update-env
else
	pm2 start npm --name frontend -- start
fi
pm2 save

echo ""
echo "[OK] Deploy selesai. TTS aktif = Pocket TTS. Piper/Supertonic/VoxCPM sudah dibersihkan."
echo "     Health: curl -s http://127.0.0.1:4000/health"
pm2 ls
curl -sf http://127.0.0.1:4000/health || echo "[WARN] backend /health belum merespons"
