#!/bin/sh
set -eu

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
STATE_DIR=/srv/docker/dispatch
DEPLOY_USER=dispatch-deploy
KEY_FILE=${1:-}

log() { printf '[dispatch-install] %s\n' "$*"; }
die() { printf '[dispatch-install] ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die 'run with sudo/root'
command -v docker >/dev/null 2>&1 || die 'Docker is required'
command -v openssl >/dev/null 2>&1 || die 'OpenSSL is required'
command -v visudo >/dev/null 2>&1 || die 'sudo/visudo is required'
docker compose version >/dev/null 2>&1 || die 'Docker Compose plugin is required'

if command -v sshd >/dev/null 2>&1; then
  allow_users=$(sshd -T 2>/dev/null | awk '$1 == "allowusers" { for (i=2; i<=NF; i++) print $i }' || true)
  if [ -n "$allow_users" ] && ! printf '%s\n' "$allow_users" | grep -Fxq "$DEPLOY_USER"; then
    die "sshd AllowUsers is active but does not include $DEPLOY_USER"
  fi
fi

deploy_key=''
if [ -n "$KEY_FILE" ]; then
  [ -f "$KEY_FILE" ] || die 'deploy public key file not found'
  deploy_key=$(cat "$KEY_FILE")
  printf '%s\n' "$deploy_key" | grep -Eq '^ssh-ed25519 [A-Za-z0-9+/=]+' || die 'only an Ed25519 deploy public key is accepted'
fi

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/dispatch-deploy --shell /bin/sh "$DEPLOY_USER"
fi

install -d -o root -g root -m 700 "$STATE_DIR" "$STATE_DIR/secrets" "$STATE_DIR/runtime" "$STATE_DIR/backups"
install -o root -g root -m 600 "$REPO_DIR/deploy/docker-compose.prod.yml" "$STATE_DIR/docker-compose.yml"
install -o root -g root -m 644 "$REPO_DIR/deploy/runtime/nginx.conf" "$STATE_DIR/runtime/nginx.conf"
install -o root -g root -m 755 "$REPO_DIR/deploy/runtime/harden-users.sh" "$STATE_DIR/runtime/harden-users.sh"
install -o root -g root -m 755 "$REPO_DIR/ops/dispatch-deploy" /usr/local/sbin/dispatch-deploy
install -d -o root -g root -m 755 /usr/local/libexec
install -o root -g root -m 755 "$REPO_DIR/ops/dispatch-deploy-entrypoint" /usr/local/libexec/dispatch-deploy-entrypoint
install -o root -g root -m 755 "$REPO_DIR/security/host-firewall.sh" /usr/local/sbin/dispatch-egress-firewall.sh

if [ ! -f "$STATE_DIR/.env" ]; then
  install -o root -g root -m 600 "$REPO_DIR/deploy/.env.production.example" "$STATE_DIR/.env"
  log "created $STATE_DIR/.env from template"
fi

umask 077
secret_if_missing() {
  file="$STATE_DIR/secrets/$1"
  generator="$2"
  if [ ! -s "$file" ]; then
    sh -c "$generator" > "$file"
    chown root:root "$file"
    chmod 600 "$file"
  fi
}

secret_if_missing session_secret "openssl rand -base64 48 | tr -d '\\n'"
secret_if_missing bot_internal_api_key "openssl rand -base64 48 | tr -d '\\n'"
secret_if_missing data_encryption_key "openssl rand -base64 32 | tr -d '\\n'"
for name in postgres_admin_password api_db_password bot_db_password redis_password; do
  secret_if_missing "$name" "openssl rand -hex 32 | tr -d '\\n'"
done

for name in discord_token discord_client_secret; do
  file="$STATE_DIR/secrets/$name"
  [ -e "$file" ] || install -o root -g root -m 600 /dev/null "$file"
done

for name in discord_token discord_client_secret session_secret data_encryption_key bot_internal_api_key api_db_password bot_db_password redis_password; do
  file="$STATE_DIR/secrets/$name"
  chown root:1000 "$file"
  chmod 640 "$file"
done
chown root:root "$STATE_DIR/secrets/postgres_admin_password"
chmod 600 "$STATE_DIR/secrets/postgres_admin_password"

home=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 700 "$home/.ssh"
if [ -n "$deploy_key" ]; then
  printf 'restrict,command="/usr/local/libexec/dispatch-deploy-entrypoint" %s\n' "$deploy_key" > "$home/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$home/.ssh/authorized_keys"
  chmod 600 "$home/.ssh/authorized_keys"
elif [ ! -s "$home/.ssh/authorized_keys" ]; then
  die 'first install requires the deploy public key'
fi

cat > /etc/sudoers.d/dispatch-deploy <<'SUDOEOF'
Defaults:dispatch-deploy !setenv
dispatch-deploy ALL=(root) NOPASSWD: /usr/local/sbin/dispatch-deploy *
SUDOEOF
chmod 440 /etc/sudoers.d/dispatch-deploy
visudo -cf /etc/sudoers.d/dispatch-deploy >/dev/null

cat > /etc/systemd/system/dispatch-firewall.service <<'UNITEOF'
[Unit]
Description=Dispatch Docker egress firewall
Requires=docker.service
After=docker.service docker-firewall.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/dispatch-egress-firewall.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNITEOF

systemctl daemon-reload
systemctl enable dispatch-firewall.service >/dev/null
systemctl restart dispatch-firewall.service

docker network inspect proxy_net >/dev/null 2>&1 || die 'Docker network proxy_net does not exist'

log 'installation complete'
log "edit $STATE_DIR/.env"
log "fill $STATE_DIR/secrets/discord_token and discord_client_secret"
log 'configure Nginx Proxy Manager to forward to dispatch-edge:8080'
