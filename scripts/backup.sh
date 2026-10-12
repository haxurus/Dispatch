#!/bin/sh
# On-demand PostgreSQL backup of a production Dispatch install.
# Run as root on the VPS: sudo sh scripts/backup.sh
# Writes /srv/docker/dispatch/backups/dispatch-<UTC stamp>.dump (pg_dump -Fc, mode 600).
set -eu
umask 077

STATE_DIR=/srv/docker/dispatch
PROJECT=dispatch

[ "$(id -u)" -eq 0 ] || { echo 'Run as root (sudo).' >&2; exit 1; }
cd "$STATE_DIR"
[ -f docker-compose.yml ] && [ -f .env ] || { echo "Missing docker-compose.yml or .env in $STATE_DIR" >&2; exit 1; }

# The Compose file requires the image references of the running release.
APP_IMAGE=''
MIGRATE_IMAGE=''
if [ -f .release ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      APP_IMAGE) APP_IMAGE="$value" ;;
      MIGRATE_IMAGE) MIGRATE_IMAGE="$value" ;;
    esac
  done < .release
fi
[ -n "$APP_IMAGE" ] && [ -n "$MIGRATE_IMAGE" ] || { echo 'No release recorded yet: nothing to back up.' >&2; exit 1; }

mkdir -p backups
chmod 700 backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="backups/dispatch-${stamp}.dump"

if DISPATCH_APP_IMAGE="$APP_IMAGE" DISPATCH_MIGRATE_IMAGE="$MIGRATE_IMAGE" \
  docker compose --project-name "$PROJECT" --env-file .env -f docker-compose.yml exec -T postgres sh -c \
  'export PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"; exec pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$out"; then
  chmod 600 "$out"
  echo "Backup created: $STATE_DIR/$out"
else
  rm -f "$out"
  echo 'Backup failed.' >&2
  exit 1
fi
