#!/bin/bash
# ---------------------------------------------------------------
# Procurement Agent — One-shot Ubuntu VPS Deploy
#
# Tested on: Ubuntu 22.04 / 24.04 LTS (Hostinger KVM)
#
# What this installs:
#   - Node.js 22 LTS
#   - MongoDB 7.0
#   - Redis 7
#   - Nginx (reverse proxy)
#   - PM2 (process manager, auto-restart on reboot)
#   - Playwright system deps + Chromium
#   - UFW firewall (allows 22, 80, 443)
#   - Optional: Let's Encrypt SSL via certbot
#
# Run as root on a fresh Ubuntu install:
#   ssh root@your-vps-ip
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/scripts/deploy-vps.sh -o deploy.sh
#   chmod +x deploy.sh
#   ./deploy.sh
#
# OR copy the script up and run it:
#   scp scripts/deploy-vps.sh root@your-vps-ip:/root/
#   ssh root@your-vps-ip
#   ./deploy-vps.sh
# ---------------------------------------------------------------

set -euo pipefail

# ---- Config (edit these before running) ----
APP_DIR="/opt/procurement-agent"
APP_USER="procurement"
APP_PORT="3000"
GIT_REPO=""        # e.g. "https://github.com/you/procurement-agent.git" — leave blank to upload manually
DOMAIN=""          # e.g. "procurement.example.com" — leave blank for IP-only access
ANTHROPIC_KEY=""   # paste your sk-ant-... key (or leave blank to fill in later via /opt/procurement-agent/.env.local)

# ---- Helpers ----
say() { echo -e "\n\033[1;34m==>\033[0m $1"; }
ok()  { echo -e "    \033[1;32m✓\033[0m $1"; }
die() { echo -e "\033[1;31mERROR:\033[0m $1" >&2; exit 1; }

[ "$EUID" -eq 0 ] || die "Run this as root (or with sudo)."

# ---- 1. System update ----
say "Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl wget gnupg ca-certificates lsb-release software-properties-common ufw build-essential git
ok "System updated."

# ---- 2. Node.js 22 ----
say "Installing Node.js 22 LTS..."
if ! command -v node >/dev/null || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
ok "Node $(node -v), npm $(npm -v)"

# ---- 3. MongoDB 7 ----
say "Installing MongoDB 7..."
if ! command -v mongod >/dev/null; then
  curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
  UBUNTU_CODENAME=$(lsb_release -cs)
  # Mongo 7 doesn't have noble (24.04) repo yet — fall back to jammy on 24.04
  case "$UBUNTU_CODENAME" in
    noble) MONGO_REPO="jammy" ;;
    *)     MONGO_REPO="$UBUNTU_CODENAME" ;;
  esac
  echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu $MONGO_REPO/mongodb-org/7.0 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-7.0.list
  apt-get update -qq
  apt-get install -y -qq mongodb-org
fi
systemctl enable --now mongod
ok "MongoDB running on 27017."

# ---- 4. Redis ----
say "Installing Redis..."
apt-get install -y -qq redis-server
systemctl enable --now redis-server
ok "Redis running on 6379."

# ---- 5. Nginx ----
say "Installing Nginx..."
apt-get install -y -qq nginx
systemctl enable --now nginx
ok "Nginx installed."

# ---- 6. Playwright system deps + Chromium ----
say "Installing Playwright system dependencies..."
# These are the libs Chromium needs to render headless
apt-get install -y -qq \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 libasound2t64 2>/dev/null || \
apt-get install -y -qq \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 libasound2
ok "Playwright system libs installed."

# ---- 7. App user ----
say "Creating $APP_USER user..."
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$APP_USER"
fi
ok "User $APP_USER ready."

# ---- 8. App code ----
say "Setting up app at $APP_DIR..."
mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"

if [ -n "$GIT_REPO" ]; then
  if [ ! -d "$APP_DIR/.git" ]; then
    sudo -u "$APP_USER" git clone "$GIT_REPO" "$APP_DIR"
  else
    sudo -u "$APP_USER" git -C "$APP_DIR" pull
  fi
else
  echo "    (no GIT_REPO set — upload your code to $APP_DIR manually before continuing)"
  echo "    Example: scp -r ./procurement-agent/* root@<vps>:$APP_DIR/"
  if [ ! -f "$APP_DIR/package.json" ]; then
    die "$APP_DIR/package.json not found. Upload code first, then re-run this script."
  fi
fi
ok "App code in place."

# ---- 9. .env.local ----
say "Writing $APP_DIR/.env.local..."
cat > "$APP_DIR/.env.local" <<EOF
MONGODB_URI=mongodb://127.0.0.1:27017/procurement
REDIS_URL=redis://127.0.0.1:6379
ANTHROPIC_API_KEY=$ANTHROPIC_KEY
NODE_ENV=production
PORT=$APP_PORT
BROWSER_MAX_CONTEXTS=3
VENDOR_MAX_CONCURRENCY=4
EOF
chown "$APP_USER:$APP_USER" "$APP_DIR/.env.local"
chmod 600 "$APP_DIR/.env.local"
ok ".env.local written (edit later if needed)."

# ---- 10. Install app deps + Playwright Chromium + build ----
say "Installing npm packages (this takes a few minutes)..."
sudo -u "$APP_USER" bash -c "cd $APP_DIR && npm ci --no-audit --no-fund"
ok "npm packages installed."

say "Installing Playwright Chromium browser..."
sudo -u "$APP_USER" bash -c "cd $APP_DIR && npx playwright install chromium"
ok "Chromium installed."

say "Building Next.js production bundle..."
sudo -u "$APP_USER" bash -c "cd $APP_DIR && npm run build"
ok "Build complete."

say "Seeding database (vendors + categories)..."
sudo -u "$APP_USER" bash -c "cd $APP_DIR && npm run seed"
ok "DB seeded."

# ---- 11. PM2 process manager ----
say "Setting up PM2..."
npm install -g pm2 --silent
sudo -u "$APP_USER" bash -c "cd $APP_DIR && pm2 start npm --name procurement -- start"
sudo -u "$APP_USER" pm2 save
# Generate the systemd startup unit so PM2 (and the app) auto-start on reboot
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/tmp/pm2-startup.sh
bash /tmp/pm2-startup.sh || true
ok "App running under PM2 on port $APP_PORT."

# ---- 12. Nginx reverse proxy ----
say "Configuring Nginx reverse proxy..."
SERVER_NAME="${DOMAIN:-_}"
cat > /etc/nginx/sites-available/procurement <<EOF
server {
    listen 80;
    server_name $SERVER_NAME;

    client_max_body_size 25M;

    # Long timeouts for streaming search responses
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    proxy_buffering off;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sf /etc/nginx/sites-available/procurement /etc/nginx/sites-enabled/procurement
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
ok "Nginx proxying :80 → :$APP_PORT"

# ---- 13. Firewall ----
say "Configuring UFW firewall..."
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ok "Firewall: 22, 80, 443 open."

# ---- 14. Optional: SSL via Let's Encrypt (only if DOMAIN is set) ----
if [ -n "$DOMAIN" ]; then
  say "Requesting Let's Encrypt SSL for $DOMAIN..."
  apt-get install -y -qq certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" --redirect || \
    echo "    (certbot failed — check DNS A record points to this VPS, then run: certbot --nginx -d $DOMAIN)"
  ok "SSL configured."
fi

# ---- Done ----
PUBLIC_IP=$(curl -s ifconfig.me || echo "<your-vps-ip>")
say "Deploy complete!"
echo ""
echo "    App is live at:  http://$PUBLIC_IP/"
[ -n "$DOMAIN" ] && echo "    Domain:          https://$DOMAIN/"
echo ""
echo "    Useful commands:"
echo "      pm2 status                                  # running processes"
echo "      pm2 logs procurement                        # tail logs"
echo "      pm2 restart procurement                     # restart after env change"
echo "      systemctl status mongod redis-server nginx  # service health"
echo "      tail -f /var/log/nginx/error.log            # nginx errors"
echo ""
echo "    Edit env vars:  nano $APP_DIR/.env.local && pm2 restart procurement"
echo ""
