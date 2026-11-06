#!/usr/bin/env bash
# One-time setup on the FTR server:  curl -fsSL https://raw.githubusercontent.com/theFTRchef/ftr-app/main/deploy/install-autodeploy.sh | bash
set -euo pipefail
U=$(whoami); H=$HOME/ftrbot
[ -d "$H/dose-in-a-box-bot" ] || { echo "Can't find $H/dose-in-a-box-bot"; exit 1; }
sudo -n true 2>/dev/null || { echo "This account needs password-free sudo to restart the bot."; exit 1; }
command -v git >/dev/null || sudo apt-get install -y -q git
NODE=$(command -v node); NPM=$(command -v npm)
curl -fsSL https://raw.githubusercontent.com/theFTRchef/ftr-app/main/deploy/autodeploy.sh -o "$H/autodeploy.sh"
chmod +x "$H/autodeploy.sh"
sudo tee /etc/systemd/system/ftr-autodeploy.service >/dev/null <<UNIT
[Unit]
Description=FTR bot auto-update from GitHub
After=network-online.target
[Service]
Type=oneshot
User=$U
Environment=FTR_HOME=$H FTR_NODE=$NODE FTR_NPM=$NPM HOME=$HOME
ExecStart=$H/autodeploy.sh
UNIT
sudo tee /etc/systemd/system/ftr-autodeploy.timer >/dev/null <<UNIT
[Unit]
Description=Check for FTR bot updates every 5 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now ftr-autodeploy.timer
echo "Checking for an update now..."
sudo systemctl start ftr-autodeploy.service || true
tail -n 5 "$H/autodeploy.log" 2>/dev/null
echo; echo "Auto-update is on. Log: $H/autodeploy.log"
