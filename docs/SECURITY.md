# Security model

## Goal

Minimize attack surface, lateral movement, secret exposure, and the impact of a compromise of a single component. Dispatch stores private support conversations, form answers and staff notes, so a compromise of one container must not expose everything else.

## Trust boundaries

Production runs the services of [`deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml):

| Service | Networks | Secrets |
|---|---|---|
| `postgres` | `api_db`, `bot_db`, `migrate_db` | `postgres_admin_password` |
| `redis` (uid 999) | `bot_queue` | `redis_password` |
| `migrate` | `migrate_db` | `postgres_admin_password` |
| `secure-db` | `migrate_db` | `postgres_admin_password`, `api_db_password`, `bot_db_password` |
| `api` | `backend`, `api_db`, `bot_rpc`, `api_egress` | `discord_client_secret`, `session_secret`, `data_encryption_key`, `bot_internal_api_key`, `api_db_password` |
| `bot` | `bot_db`, `bot_queue`, `bot_rpc`, `bot_egress` | `discord_token`, `bot_internal_api_key`, `data_encryption_key`, `bot_db_password`, `redis_password` |
| `web` | `frontend`, `backend` | none |
| `edge` (Nginx, uid 101) | `frontend`, `proxy_net` | none |

- `web`: no application secrets, reaches only the API on `backend`.
- `edge`: the only service on the external `proxy_net` shared with Nginx Proxy Manager; it forwards to `web` and holds no secrets.
- `api`: OAuth, sessions, configuration and dashboard reads. It does not possess the bot's Discord token.
- `bot`: possesses the Discord token and can access only the tables required by tickets and forms.
- `postgres`: no published port; separate database networks for API, bot and migrations.
- `redis`: visible only to the bot, authenticated, no published port.
- `bot_rpc`: internal network shared only by API and bot. Every RPC call except the health check needs `BOT_INTERNAL_API_KEY`, compared in constant time; request bodies are limited to 16 KiB and every ID is validated.

All networks except `api_egress`, `bot_egress` and `proxy_net` are `internal` (no route outside Docker). No port is published on the host. The networks use fixed `/28` subnets in `10.251.0.0/24`; the egress bridges are named `dispatch-api-eg` and `dispatch-bot-eg` and have inter-container communication disabled.

## Secrets

Secrets are files under `/srv/docker/dispatch/secrets/` (directory `700 root:root`) mounted at `/run/secrets`. Services read them through `*_FILE` variables; they are not passed to the frontend and are not embedded in the Compose file. `postgres_admin_password` is `600 root:root`; secrets read by the application containers are `640 root:1000`, readable by the non-root `node` user (gid 1000) inside the containers.

The installer generates `session_secret`, `bot_internal_api_key`, `data_encryption_key` and the database and Redis passwords; the Discord token and the OAuth client secret are entered by hand on the VPS. GitHub Actions never receives any of them.

Never store `secrets/` in the same backup as the database. Keep `data_encryption_key` separate from PostgreSQL dumps.

A full host compromise or root/Docker daemon access can still read mounted secrets. Never mount `/var/run/docker.sock` into project containers.

## Data encryption

Sensitive application data is encrypted with AES-256-GCM, a random 96-bit nonce per value and a 128-bit authentication tag. The key is `data_encryption_key` (32 random bytes, base64); API and bot refuse to start without a valid key.

Encrypted data:

- transcripts (`Transcript.contentEncrypted`);
- form answers (`FormSubmission.answersEncrypted`, partial answers in `FormSession.answersEncrypted`);
- answers to ticket opening questions (`Ticket.formDataEncrypted`, and `TicketOpenAttempt.reservationAnswersEncrypted` while the ticket is being opened);
- staff notes (`TicketNote.contentEncrypted`);
- close reasons (`Ticket.closeReason`);
- feedback comments (`TicketFeedback.commentEncrypted`);
- server blacklist reasons (`GuildBlacklist.reasonEncrypted`);
- response templates (`ResponseTemplate.contentEncrypted`);
- dashboard and super console audit details (`PanelAudit.details`, `SuperAdminAudit.details`);
- the list of the user's servers stored in dashboard sessions (`PanelSession.guilds`).

IDs required for queries and relationships, timestamps, statuses, configuration, ticket audit actions and super console blacklist reasons remain in plaintext. Session tokens are stored only as HMAC-SHA256 hashes and client IP addresses in audit logs only as keyed hashes. Ticket log messages never include encrypted fields.

Do not lose the key: encrypted data and backups cannot be recovered without it.

## Database least privilege

[`deploy/runtime/harden-users.sh`](../deploy/runtime/harden-users.sh) runs as the one-shot `secure-db` job after every migration. It revokes `CREATE` on the `public` schema and all default table privileges from `PUBLIC`, and creates two login roles with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`. Passwords are passed through stdin, never on the command line.

`dispatch_api` has `SELECT, INSERT, UPDATE, DELETE` on the application tables used by the dashboard: tickets and their categories, panels, members, audit, transcripts, sessions, role bindings, panel audit, notes, templates, feedback, blacklist, forms and their panels, submissions, sessions and permission bindings, the installation blacklist, super-admin audit and the status channel. It cannot create tables.

`dispatch_bot` has:

- `SELECT, INSERT, UPDATE, DELETE` on `GuildSettings`, `TicketCategory`, `TicketPanel`, `Ticket`, `TicketMember`, `TicketAudit`, `Transcript`, `TicketFeedback`, `TicketOpenAttempt`, `TicketUserGuard`, `FormSession`;
- `SELECT, INSERT, UPDATE` on `FormSubmission`; `SELECT, UPDATE` on `FormPanel`;
- `SELECT` only on `GuildBlacklist`, `FormDefinition`, `FormPermissionBinding`, `InstallBlock`, `StatusChannel`.

The bot has no access to dashboard sessions (`PanelSession`), role bindings (`PanelRoleBinding`), panel audit, super-admin audit, staff notes, response templates or `_prisma_migrations`, and cannot modify the installation blacklist or the status channel. CI applies the same script to a fresh database and verifies these restrictions on every change ([VALIDATION.md](VALIDATION.md)).

PostgreSQL owner credentials are used only by the one-shot `migrate` and `secure-db` jobs on the internal `migrate_db` network.

## Web/API protections

- production `__Host-` cookies for the session and the OAuth state;
- `Secure` (production), `HttpOnly`, `SameSite=Lax`; sessions expire after 8 hours;
- only an HMAC-SHA256 of the session token is stored;
- OAuth `state` compared in constant time;
- `Origin` must equal `WEB_URL` on every request other than GET/HEAD/OPTIONS (`CSRF_ORIGIN_REJECTED`);
- global rate limit of 120 requests per minute per client address; super console changes limited to 30 per minute per session;
- maximum body size of 32 KiB at the API, 1 MiB at the edge proxy and 16 KiB at the bot RPC;
- request timeout of 15 s at the API, 8 s timeouts on calls to Discord OAuth and 15 s on calls to the bot RPC;
- snowflake validation of `guildId` and `roleId` parameters, schema validation (zod) of every body and query, guild membership, installation and access level checked on every guild request;
- HTTPS-only panel images and thumbnails;
- `Cache-Control: no-store` on every API response;
- Helmet security headers on the API; on the web: a strict CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self' https://discord.com`, images only from the site and Discord's CDN), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, a restrictive Permissions Policy, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`, `noindex` on the dashboard and super console ([`apps/web/next.config.mjs`](../apps/web/next.config.mjs));
- cookies, authorization headers and secret-like fields redacted from API logs;
- transcripts are generated with HTML escaping; bot mentions in logs, leaderboards and closing messages never notify (`allowedMentions: { parse: [] }`);
- the edge proxy accepts the client address from `CF-Connecting-IP` only when the request comes from a private Docker address (Nginx Proxy Manager).

If the origin is reachable without going through Cloudflare, anyone can forge `CF-Connecting-IP` and evade the per-address rate limit: restrict inbound 80/443 to Cloudflare's ranges or use Authenticated Origin Pulls.

## Container isolation

For API, bot and web:

- non-root user (`node`);
- `no-new-privileges`;
- `cap_drop: ALL`;
- read-only root filesystem;
- `/tmp` on tmpfs with `noexec`;
- CPU, memory and PID limits;
- `init: true`; Node.js runs with `--disable-proto=throw`.

Redis (uid 999), the edge proxy (uid 101), `migrate` and `secure-db` also drop all capabilities and run read-only; PostgreSQL runs read-only with `no-new-privileges` and a PID limit. No API, database or Redis port is published on the host and no container mounts the Docker socket.

## Egress and exfiltration

Absolute zero exfiltration cannot be guaranteed for the bot process: to work, it must receive data from Discord and have outbound connectivity to Discord. If that process were compromised, malicious code would simultaneously have access to ticket data and to a network connection required by the service.

The configuration reduces impact as follows:

- the bot does not possess OAuth secrets or web sessions;
- the bot cannot read dashboard sessions, notes, templates or administrative tables;
- API and bot use separate database networks and credentials;
- web and edge have no secrets, and web has no route outside Docker;
- no component can reach host services or private networks, except for the explicitly required Internet egress of API and bot.

### Blocking host/LAN access

[`security/host-firewall.sh`](../security/host-firewall.sh) is installed as `/usr/local/sbin/dispatch-egress-firewall.sh` and applied at boot by `dispatch-firewall.service`. For the `dispatch-api-eg` and `dispatch-bot-eg` bridges it:

- drops traffic to the host (`INPUT`);
- rejects forwarded traffic (`DOCKER-USER`) to `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `224.0.0.0/4` and `240.0.0.0/4`.

The rules cover IPv4 only; the Dispatch networks do not enable IPv6, and IPv6 must not be enabled without equivalent `ip6tables` rules. The firewall does not replace an egress proxy with a domain allowlist and cannot prevent compromised code from reaching a public Internet host.

## Discord permissions

Do not grant `Administrator` to the bot. The install link requests only View Channels, Manage Channels, Manage Roles, Send Messages, Manage Messages, Embed Links, Attach Files, Read Message History, Manage Threads, Create Private Threads and Send Messages in Threads (bitfield `361045814288`, [`apps/api/src/super.ts`](../apps/api/src/super.ts)). Do not grant Manage Server, Manage Webhooks, Mention Everyone, Kick/Ban Members or Manage Nicknames. View Audit Log is not requested either; where a server grants it, the bot uses it only to recognise blacklisted installers.

Ticket channels deny `@everyone`, and deny thread creation to the opener and participants; staff roles may write in threads but not create them. A member with Manage Threads at server level can see private staff threads: do not grant it to users who open tickets.

Moderation actions (bans, kicks, timeouts, server role changes) are out of the project's scope by design ([CONTRIBUTING.md](../.github/CONTRIBUTING.md#project-scope)).

## Backups

- before every deployment after the first one, a `pg_dump -Fc` is written to `/srv/docker/dispatch/backups/predeploy-<UTC>.dump` (`600`, directory `700 root:root`) and the deployment aborts if it fails; dumps older than 14 days are pruned only after a successful backup;
- on-demand dumps are taken with [`scripts/backup.sh`](../scripts/backup.sh) (`dispatch-<UTC>.dump`, `600`, not pruned automatically);
- copy backups off the host, encrypted, and keep them separate from `data_encryption_key` and `secrets/`;
- test the restore procedure regularly ([DEPLOYMENT.md](DEPLOYMENT.md#restoring-a-backup));
- rotate Discord tokens, OAuth secrets, the RPC key and deployment keys after an incident.

Logs of a failed deployment may contain personal data: they stay on the VPS in `/srv/docker/dispatch/logs/` (`700 root:root`, 30 days) and never reach the GitHub Actions output.

## Host

Project security does not protect against an already compromised host. On the VPS, use at least:

- SSH key-only authentication, with `AllowUsers`;
- a non-root administrative user with sudo, outside the `docker` group;
- deny-by-default inbound firewall;
- automatic or regular security updates;
- Docker socket not exposed;
- encrypted filesystem/volume if the threat model includes disk theft;
- inbound HTTP(S) limited to the CDN/reverse proxy where possible.

## Supply-chain and deployment security

- GitHub Actions does not receive Discord tokens, database passwords, session secrets or the encryption key.
- `GITHUB_TOKEN` is read-only by default; only the image build job can write packages. Every action is pinned to a full commit SHA.
- Images are built by GitHub Actions with BuildKit SBOM and provenance attestations, published to `ghcr.io/haxurus/dispatch` and deployed by immutable `sha256` digest, never by tag. Both the SSH entrypoint and the wrapper reject any other reference.
- The `dispatch-deploy` SSH user has a dedicated Ed25519 key installed with `restrict,command="/usr/local/libexec/dispatch-deploy-entrypoint"`; its home, `.ssh` and `authorized_keys` are owned by root, so it cannot remove the forced command. The installer accepts exactly one key.
- The entrypoint accepts only `deploy <app@sha256> <migrate@sha256>`, `rollback` and `status`; it does not provide a shell. Sudo allows only `/usr/local/sbin/dispatch-deploy`, without `setenv`.
- One operation runs at a time (`flock` on `/run/dispatch-deploy.lock`). The wrapper refuses to deploy with less than 3 GiB free on `/var/lib/docker`.
- Deployment is gated by the `production` environment (deployable only from `main`) and by the repository variable `ENABLE_VPS_DEPLOY`.
- The privileged wrapper, the Compose file, the Nginx configuration, the role hardening script and the firewall are root-owned copies installed by `ops/install-vps.sh`; the application deploy never updates them. After a reviewed change to `deploy/`, `ops/` or `security/`, re-run the installer **before** deploying the commit that needs it.
- A database backup is taken before every deployment after the first one.

This separates compromise of the repository or application from full administrative control of the VPS. An attacker with write access to `main` could still try to deploy malicious application code: for this reason `main` is protected by a ruleset, required CI checks and the `production` environment ([DEPLOYMENT.md](DEPLOYMENT.md#10-repository-protection)).
