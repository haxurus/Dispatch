#!/bin/sh
# On-demand encrypted PostgreSQL backup of a production Dispatch install.
# Run as root on the VPS: sudo sh scripts/backup.sh
# Writes /srv/docker/dispatch/backups/dispatch-<UTC stamp>.dump.age (pg_dump -Fc
# encrypted with age to the keys in backup-recipients.txt, mode 600). The dump
# is streamed into age and never touches the disk in clear.
set -eu
umask 077

STATE_DIR=/srv/docker/dispatch
PROJECT=dispatch
RECIPIENTS="$STATE_DIR/backup-recipients.txt"

[ "$(id -u)" -eq 0 ] || { echo 'Run as root (sudo).' >&2; exit 1; }
cd "$STATE_DIR"
[ -f docker-compose.yml ] && [ -f .env ] || { echo "Missing docker-compose.yml or .env in $STATE_DIR" >&2; exit 1; }
command -v age >/dev/null 2>&1 || { echo 'age is not installed (apt install age).' >&2; exit 1; }
grep -Eq '^age1[0-9a-z]{58}$' "$RECIPIENTS" 2>/dev/null ||
  { echo "No age public key in $RECIPIENTS (see docs/DEPLOYMENT.md, Backups)." >&2; exit 1; }

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
out="backups/dispatch-${stamp}.dump.age"
status_file=$(mktemp)

# A POSIX pipeline only reports age's exit code, so pg_dump's is written to a file.
if {
  DISPATCH_APP_IMAGE="$APP_IMAGE" DISPATCH_MIGRATE_IMAGE="$MIGRATE_IMAGE" \
    docker compose --project-name "$PROJECT" --env-file .env -f docker-compose.yml exec -T postgres sh -c \
    'export PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"; exec pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"'
  echo "$?" > "$status_file"
} | age -R "$RECIPIENTS" -o "$out" && [ "$(cat "$status_file")" = 0 ] && [ -s "$out" ]; then
  rm -f "$status_file"
  chmod 600 "$out"
  echo "Encrypted backup created: $STATE_DIR/$out"
else
  rm -f "$out" "$status_file"
  echo 'Backup failed.' >&2
  exit 1
fi
