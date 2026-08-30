cat > /root/deploy.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

# ==================== CONFIGURATION ====================
REPO_DIR="/var/www/app"                     # where the repo is cloned
BRANCH="main"                               # change if you use another branch
BACKEND_DIR="$REPO_DIR/backend"
FRONTEND_DIR="$REPO_DIR/frontend"
PM2_BACKEND_NAME="api"
PM2_FRONTEND_NAME="frontend"
NGINX_SITE="/etc/nginx/sites-available/app"
DOMAINS="livio.id www.livio.id"             # add ai.livio.id if you use it
# ======================================================

echo "=== Auto‑redeploy started: $(date) ==="

# ---- 1. Pull latest code ----
cd "$REPO_DIR"
echo "Fetching latest changes from origin/$BRANCH ..."
git fetch --prune
git reset --hard origin/"$BRANCH"   # will prompt for credentials if needed

# ---- 2. Backend: install, generate Prisma, build ----
echo "▶ Backend: npm install"
cd "$BACKEND_DIR"
npm install --quiet
echo "▶ Backend: npx prisma generate"
npx prisma generate --quiet
echo "▶ Backend: npm run build"
npm run build --quiet   # adjust if your build script differs

# ---- 3. Frontend: install & build (Next.js) ----
echo "▶ Frontend: npm install"
cd "$FRONTEND_DIR"
npm install --quiet
echo "▶ Frontend: npm run build"
npm run build --quiet   # produces .next/

# ---- 4. Restart PM2 services ----
echo "▶ Restarting PM2 services"
pm2 restart "$PM2_BACKEND_NAME"
pm2 restart "$PM2_FRONTEND_NAME"
pm2 save

# ---- 5. Reload Nginx (if config changed) ----
echo "▶ Testing Nginx configuration"
nginx -t
echo "▶ Reloading Nginx"
systemctl reload nginx

# ---- 6. Renew SSL certificate (if needed) ----
echo "▶ Checking SSL renewal"
certbot renew --quiet --no-self-upgrade
# If you just added a domain/subdomain and want to force a new cert, uncomment:
# certbot --nginx -d $DOMAINS --force-renewal

echo "=== Auto‑redeploy finished: $(date) ==="
EOF