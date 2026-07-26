#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/weave"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/weave"
USER_SERVICE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ENV_FILE="$CONFIG_DIR/weave.env"
SERVICE_FILE="$USER_SERVICE_DIR/weave.service"
NPM_BIN="$(command -v npm)"

mkdir -p "$CONFIG_DIR" "$DATA_DIR" "$USER_SERVICE_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  cat >"$ENV_FILE" <<EOF
HOST=127.0.0.1
PORT=3210
WEAVE_DATA_DIR=$DATA_DIR
DATABASE_PATH=$DATA_DIR/weave.db
EOF
fi

sed \
  -e "s|__APP_DIR__|$APP_DIR|g" \
  -e "s|__ENV_FILE__|$ENV_FILE|g" \
  -e "s|__NPM_BIN__|$NPM_BIN|g" \
  "$APP_DIR/deploy/weave.service.in" >"$SERVICE_FILE"

cd "$APP_DIR"
npm ci
npm run build
npm prune --omit=dev

systemctl --user daemon-reload
systemctl --user enable --now weave

for _ in {1..20}; do
  if curl --fail --silent http://127.0.0.1:3210/api/health >/dev/null; then
    echo "Weave is running at http://127.0.0.1:3210"
    exit 0
  fi
  sleep 1
done

systemctl --user status weave --no-pager
exit 1
