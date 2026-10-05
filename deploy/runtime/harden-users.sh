#!/bin/sh
set -eu
: "${PGHOST:?}" "${PGDATABASE:?}" "${PGUSER:?}" "${POSTGRES_ADMIN_PASSWORD_FILE:?}" "${API_DB_PASSWORD_FILE:?}" "${BOT_DB_PASSWORD_FILE:?}"
export PGPASSWORD="$(cat "$POSTGRES_ADMIN_PASSWORD_FILE")"
API_DB_PASSWORD="$(cat "$API_DB_PASSWORD_FILE")"
BOT_DB_PASSWORD="$(cat "$BOT_DB_PASSWORD_FILE")"

# Passwords go through stdin, never argv (visible to host `ps`). The installer
# generates hex; the charset check keeps them safe inside the quoted \set.
case "$API_DB_PASSWORD$BOT_DB_PASSWORD" in *[!0-9A-Za-z_]*) echo 'DB passwords must match [0-9A-Za-z_]' >&2; exit 1 ;; esac
{
cat <<VARS
\\set api_password '$API_DB_PASSWORD'
\\set bot_password '$BOT_DB_PASSWORD'
VARS
cat <<'SQL'
SELECT 'CREATE ROLE dispatch_api LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dispatch_api') \gexec
SELECT 'CREATE ROLE dispatch_bot LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dispatch_bot') \gexec
SELECT format('ALTER ROLE dispatch_api PASSWORD %L', :'api_password') \gexec
SELECT format('ALTER ROLE dispatch_bot PASSWORD %L', :'bot_password') \gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
SELECT format('GRANT CONNECT ON DATABASE %I TO dispatch_api, dispatch_bot', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO dispatch_api, dispatch_bot;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM dispatch_api, dispatch_bot;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "GuildSettings", "TicketCategory", "TicketPanel", "Ticket", "TicketMember", "TicketAudit", "Transcript",
  "PanelSession", "PanelRoleBinding", "PanelAudit", "TicketNote", "ResponseTemplate", "TicketFeedback", "GuildBlacklist"
TO dispatch_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "GuildSettings", "TicketCategory", "TicketPanel", "Ticket", "TicketMember", "TicketAudit", "Transcript", "TicketFeedback", "TicketOpenAttempt", "TicketUserGuard"
TO dispatch_bot;
GRANT SELECT ON TABLE "GuildBlacklist" TO dispatch_bot;
REVOKE ALL ON TABLE "PanelSession", "PanelRoleBinding", "PanelAudit" FROM dispatch_bot;
ALTER ROLE dispatch_api NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
ALTER ROLE dispatch_bot NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
SQL
} | psql -v ON_ERROR_STOP=1
unset PGPASSWORD API_DB_PASSWORD BOT_DB_PASSWORD
