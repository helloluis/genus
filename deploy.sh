#!/bin/bash
set -e

VPS="kamai"
REMOTE_DIR="/opt/genus"

echo "=== Genus Deploy ==="

# 1. Build game client
echo "Building game client..."
pnpm --filter game build

# 2. Create tarball (exclude heavy/unnecessary dirs)
echo "Creating deploy archive..."
tar czf /tmp/genus-deploy.tar.gz \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.claude' \
  --exclude='samples' \
  -C "$(pwd)" \
  package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .env.local \
  packages/shared packages/db packages/server packages/maker packages/game/dist packages/game/package.json packages/game/index.html

# 3. Upload and extract
echo "Uploading to VPS..."
scp /tmp/genus-deploy.tar.gz $VPS:/tmp/genus-deploy.tar.gz

echo "Setting up on VPS..."
ssh $VPS "bash -s" << 'REMOTE'
set -e

# Install pnpm if needed
if ! command -v pnpm &>/dev/null; then
  echo "Installing pnpm..."
  npm install -g pnpm
fi

# Extract
mkdir -p /opt/genus
cd /opt/genus
tar xzf /tmp/genus-deploy.tar.gz
rm /tmp/genus-deploy.tar.gz

# Install deps
echo "Installing dependencies..."
pnpm install --prod=false 2>&1 | tail -3

# Create systemd service for game server
sudo tee /etc/systemd/system/genus-server.service > /dev/null << 'SVC'
[Unit]
Description=Genus Game Server
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/genus
Environment=PORT=3001
Environment=HOST=0.0.0.0
EnvironmentFile=/opt/genus/.env.local
ExecStart=/usr/bin/node --import /opt/genus/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/esm/index.mjs packages/server/src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVC

# Create systemd service for feedback worker
sudo tee /etc/systemd/system/genus-feedback.service > /dev/null << 'SVC'
[Unit]
Description=Genus Feedback Worker
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/genus/packages/maker
Environment=DATABASE_URL=postgresql://genus:genus_prod_2024@localhost:5432/genus
EnvironmentFile=/opt/genus/.env.local
ExecStart=/usr/bin/node --import /opt/genus/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/esm/index.mjs src/feedback-worker.ts
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
SVC

sudo systemctl daemon-reload
sudo systemctl enable genus-server genus-feedback
sudo systemctl restart genus-server
sudo systemctl restart genus-feedback

sleep 2

echo ""
echo "=== Service Status ==="
sudo systemctl status genus-server --no-pager -l | head -8
echo ""
sudo systemctl status genus-feedback --no-pager -l | head -8
REMOTE

rm /tmp/genus-deploy.tar.gz 2>/dev/null || true

echo ""
echo "=== Deploy complete ==="
echo "Game: http://78.141.226.70:3001"
echo "API:  http://78.141.226.70:3001/api/health"
