#!/usr/bin/env bash
set -euo pipefail

# Jalankan di VPS: bash /root/deploy.sh
# Atau dari laptop: ssh root@<IP> "bash /root/deploy.sh"
# Sinkronkan skrip ini: scp deploy.sh root@<IP>:/root/deploy.sh

# ==================== CONFIGURATION ====================
REPO_DIR="/var/www/app"
BRANCH="main"
BACKEND_DIR="$REPO_DIR/backend"
FRONTEND_DIR="$REPO_DIR/frontend"
PM2_BACKEND_NAME="api"
PM2_FRONTEND_NAME="frontend"
DOMAINS="livio.id www.livio.id"
# ======================================================

echo "=== Auto-redeploy started: $(date) ==="

cd "$REPO_DIR"
echo "Fetching latest changes from origin/$BRANCH ..."
git fetch --prune
git reset --hard "origin/$BRANCH"
echo "HEAD: $(git log -1 --oneline)"

echo "▶ Backend: npm install"
cd "$BACKEND_DIR"
npm install

echo "▶ Backend: npx prisma generate"
npx prisma generate

echo "▶ Backend: clean dist + build"
rm -rf "$BACKEND_DIR/dist"
npm run build

echo "▶ Frontend: npm install"
cd "$FRONTEND_DIR"
npm install

echo "▶ Frontend: npm run build"
npm run build

echo "▶ Restarting PM2 services"
pm2 restart "$PM2_BACKEND_NAME" --update-env
pm2 restart "$PM2_FRONTEND_NAME" --update-env
pm2 save

echo "▶ Testing Nginx configuration"
nginx -t
echo "▶ Reloading Nginx"
systemctl reload nginx

echo "▶ Checking SSL renewal"
certbot renew --quiet --no-self-upgrade || true

echo "=== Auto-redeploy finished: $(date) ==="
echo "Frontend build: $(cat "$FRONTEND_DIR/.next/BUILD_ID" 2>/dev/null || echo 'missing')"
pm2 status
