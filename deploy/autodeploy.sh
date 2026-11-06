#!/usr/bin/env bash
# FTR WhatsApp bot auto-update. Runs every 5 minutes (ftr-autodeploy.timer).
# When the server-live branch on GitHub has a new server version, it:
#   checks every file for syntax errors, backs up the live code, copies the new
#   src/ public/ fonts/ in (data/ is never touched), installs packages if they
#   changed, restarts the bot and checks it answers. If the check fails it puts
#   the backup back and restarts again. Log: ~/ftrbot/autodeploy.log
set -uo pipefail
REPO=https://github.com/theFTRchef/ftr-app.git
BRANCH=server-live
HOME_DIR=${FTR_HOME:-$HOME/ftrbot}
LIVE=$HOME_DIR/dose-in-a-box-bot
WORK=$HOME_DIR/deploy-src
STATE=$HOME_DIR/.deployed-commit
LOG=$HOME_DIR/autodeploy.log
NODE=${FTR_NODE:-$(command -v node)}
NPM=${FTR_NPM:-$(command -v npm)}
exec 9>"$HOME_DIR/.autodeploy.lock"; flock -n 9 || exit 0
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

if [ ! -d "$WORK/.git" ]; then
  git clone -q --depth 1 --filter=blob:none --sparse -b "$BRANCH" "$REPO" "$WORK" || { log "clone failed"; exit 1; }
  git -C "$WORK" sparse-checkout set server deploy
fi
git -C "$WORK" fetch -q --depth 1 origin "$BRANCH" || { log "fetch failed (no internet?)"; exit 1; }
NEW=$(git -C "$WORK" rev-parse FETCH_HEAD)
OLD=$(cat "$STATE" 2>/dev/null || true)
[ "$NEW" = "$OLD" ] && exit 0
git -C "$WORK" reset -q --hard "$NEW"
S=$WORK/server
log "new version $NEW (was ${OLD:-none})"

# 1. Syntax check before touching anything live.
for f in "$S"/src/*.js; do
  "$NODE" --check "$f" 2>>"$LOG" || { log "STOPPED: syntax error in $(basename "$f"); live bot not changed"; echo "$NEW" > "$STATE"; exit 1; }
done
if [ -f "$S/public/admin.html" ]; then
  T=$(mktemp --suffix=.js)
  "$NODE" -e 'const h=require("fs").readFileSync(process.argv[1],"utf8");const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join("\n;\n");require("fs").writeFileSync(process.argv[2],m)' "$S/public/admin.html" "$T"
  "$NODE" --check "$T" 2>>"$LOG" || { rm -f "$T"; log "STOPPED: admin page script error; live bot not changed"; echo "$NEW" > "$STATE"; exit 1; }
  rm -f "$T"
fi

# 2. Back up, copy in.
B=$HOME_DIR/backups/$(date +%Y%m%d-%H%M%S)
mkdir -p "$B"
cp -a "$LIVE/src" "$LIVE/public" "$B/" ; [ -d "$LIVE/fonts" ] && cp -a "$LIVE/fonts" "$B/"
cp -a "$LIVE/package.json" "$LIVE/package-lock.json" "$B/" 2>/dev/null
cp -r "$S/src/." "$LIVE/src/"; cp -r "$S/public/." "$LIVE/public/"; [ -d "$S/fonts" ] && mkdir -p "$LIVE/fonts" && cp -r "$S/fonts/." "$LIVE/fonts/"
if ! cmp -s "$S/package-lock.json" "$LIVE/package-lock.json"; then
  cp "$S/package.json" "$S/package-lock.json" "$LIVE/"
  (cd "$LIVE" && "$NPM" ci --omit=dev --no-audit --no-fund >>"$LOG" 2>&1) || log "npm install failed"
fi

# 3. Restart and check; roll back if it doesn't come up.
healthy() { for i in $(seq 1 15); do sleep 2; [ "$(curl -s -m 3 localhost:3000/healthz)" = "ok" ] && return 0; done; return 1; }
sudo -n systemctl restart ftrbot
if healthy; then
  echo "$NEW" > "$STATE"; log "LIVE: $NEW (backup in $B)"
  ls -1dt "$HOME_DIR"/backups/* | tail -n +11 | xargs -r rm -rf   # keep the last 10 backups
else
  log "FAILED health check - rolling back to $B"
  cp -a "$B/src/." "$LIVE/src/"; cp -a "$B/public/." "$LIVE/public/"; [ -d "$B/fonts" ] && cp -a "$B/fonts/." "$LIVE/fonts/"
  if [ -f "$B/package-lock.json" ] && ! cmp -s "$B/package-lock.json" "$LIVE/package-lock.json"; then
    cp "$B/package.json" "$B/package-lock.json" "$LIVE/"; (cd "$LIVE" && "$NPM" ci --omit=dev --no-audit --no-fund >>"$LOG" 2>&1)
  fi
  sudo -n systemctl restart ftrbot
  healthy && log "rolled back OK" || log "ROLLBACK ALSO UNHEALTHY - check: sudo journalctl -u ftrbot -n 50"
  echo "$NEW" > "$STATE"
  exit 1
fi
