#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$APP_DIR"
git pull --ff-only
npm ci
npm run build
npm prune --omit=dev
systemctl --user restart weave

for _ in {1..20}; do
  if curl --fail --silent http://127.0.0.1:3210/api/health >/dev/null; then
    echo "Weave updated successfully."
    exit 0
  fi
  sleep 1
done

systemctl --user status weave --no-pager
exit 1
