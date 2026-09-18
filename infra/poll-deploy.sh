#!/usr/bin/env bash
# BojxonaAvatar — build-on-server auto-deploy poller (ADR-007, 2-usul).
# git'da yangi commit bo'lsa → docker compose up -d --build. Idempotent (marker bilan).
#
# Cron (har daqiqa, ustma-ust ishlamasligi uchun flock):
#   * * * * * flock -n /tmp/bojxona-deploy.lock /opt/bojxonaavatar/infra/poll-deploy.sh >> /var/log/bojxona-deploy.log 2>&1
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/bojxonaavatar}"
BRANCH="${BRANCH:-main}"
LAST_FILE="infra/.last-deployed"

cd "$REPO_DIR"
git fetch --quiet origin "$BRANCH"
NEW=$(git rev-parse "origin/$BRANCH")
LAST=$(cat "$LAST_FILE" 2>/dev/null || echo none)

if [ "$NEW" = "$LAST" ]; then
  exit 0                              # o'zgarish yo'q
fi

echo "$(date '+%F %T') yangi commit ${NEW:0:8} — deploy boshlandi"
git reset --hard "origin/$BRANCH"

if docker compose -f infra/compose.prod.yml up -d --build; then
  docker image prune -f >/dev/null 2>&1 || true
  echo "$NEW" > "$LAST_FILE"
  echo "$(date '+%F %T') deploy OK"
else
  echo "$(date '+%F %T') deploy XATO — keyingi tekshiruvda qayta urinadi"
  exit 1                             # marker yozilmaydi → qayta urinadi
fi
