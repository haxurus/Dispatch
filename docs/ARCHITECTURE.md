# Architecture

## Components

| Service | Role |
|---|---|
| `bot` | discord.js Gateway client: ticket and form interactions, ticket activity, automations, retention, leaderboards, ticket logs, status notices; internal RPC server on port 3002 |
| `api` | Fastify: Discord OAuth2, sessions, RBAC, configuration, tickets, transcripts, analytics, super console, post-removal purge |
| `web` | Next.js: public site, dashboard, super console; proxies `/backend/*` to the API |
| `edge` | Nginx in front of `web`, the only service reachable from the reverse proxy |
| `postgres` | PostgreSQL 17, the single source of truth |
| `migrate`, `secure-db` | One-shot jobs: `prisma migrate deploy` as the database owner, then the role and grant policy |

## Event flow

```text
Discord interaction (button, select menu, modal)
    |
    v
apps/bot/src/index.ts  --> forms.ts (form customIds) | tickets.ts (everything else)
    |
    v
ingress limiter (5 opening interactions per 5 seconds)
    |
    v
open-guard.ts: single-use reservation in TicketUserGuard / TicketOpenAttempt
    +--> cooldowns, attempt windows, progressive blocks
    +--> open-ticket limit, blacklist (re-checked before creation)
    v
ticket channel created on Discord (state CREATING persisted first)
    |
    v
Ticket row committed (PostgreSQL) --> TicketAudit --> ticket log channel (optional)
```

Each opening is bound to a random single-use nonce persisted in PostgreSQL and tied to server, user, category, source and form version. A serialised transaction orders concurrent requests, so duplicates, replays, expired or changed forms and nonces belonging to other users are rejected. A Discord mutation with an uncertain outcome is never released automatically: the `CREATING` state stays persisted so that a second channel is never created. Details: [TICKET_PROTECTIONS.md](TICKET_PROTECTIONS.md).

Messages posted in ticket channels (`MessageCreate`) update the ticket activity used for the first staff response, SLAs and inactivity. Messages in private staff threads are not ticket activity.

Background cycles in the bot, each never overlapping with itself:

- ticket automations (SLA, escalation, inactivity warning and auto-close): every minute;
- retention (tickets, transcripts, channels, expired reservations and form sessions): at startup and every 6 hours;
- moderator leaderboards: at startup and every 15 minutes.

## Dashboard

```text
Browser
  |
  v
edge (Nginx) --> Next.js (web)
                   |  /backend/*
                   v
                 Fastify API
                   +--> Discord OAuth2 (identify, guilds)
                   +--> PostgreSQL (dispatch_api role)
                   +--> bot internal RPC (bot_rpc network, bearer key)
                          +--> live member access, channels and roles
                          +--> publish main menu / panels / form panels
                          +--> ticket actions (close, reopen, assign, transfer, reply, transcript, delete channel, ...)
                          +--> ticket log test, leaderboard send, status channel
```

The API never holds the bot token. Every action that touches Discord goes through the bot RPC, which accepts only requests carrying `BOT_INTERNAL_API_KEY` (compared through fixed-length digests in constant time), validates snowflakes and internal IDs, and limits request bodies to 16 KiB. Only stable error codes from the bot are passed back to the browser.

### Sessions

- A random 256-bit session token is stored in an HttpOnly cookie (`__Host-dispatch_session` in production); only its HMAC-SHA256, keyed with `SESSION_SECRET`, is stored in `PanelSession`.
- Sessions last 8 hours; expired sessions are deleted at startup and every hour.
- The OAuth2 `state` lives in a 10-minute HttpOnly cookie and is compared in constant time.
- The list of the user's servers obtained at login is stored encrypted in the session.

### RBAC

Precedence:

```text
OWNER > ADMIN > MODERATOR > VIEWER
```

For every request the API checks that the server is in the user's session, that the bot is installed there (`GuildSettings` exists), then resolves the access level from the member's **current** state, read through the bot and cached for 60 seconds:

- the Discord server owner is `OWNER`;
- Administrator or Manage Server grant `ADMIN`;
- otherwise the highest level among the member's roles mapped in the dashboard (`PanelRoleBinding`); `@everyone` cannot be mapped;
- no match: no access.

Authorization is enforced by the API on every request, not only by the UI. Typical requirements: Viewer reads, Moderator acts on tickets and sees analytics, Admin/Owner configure the server, panels, forms and permissions. Forms add their own per-role bindings (Manage, View, Review, Submit): see [FORMS.md](FORMS.md).

The super console is separate from RBAC: only the user in `SUPER_ADMIN_USER_ID` can use it, and the API checks it on every route.

## Bot language

Each server has a bot language, `GuildSettings.locale` (`en` or `it`, `en` by default for new servers), chosen in the dashboard under **Sistema e menu → Lingua del bot** (*System and menu → Bot language*). It applies to everything the bot posts in that server: ticket channels, ephemeral replies, logs, transcripts and leaderboards.

The texts live in [`apps/bot/src/i18n.ts`](../apps/bot/src/i18n.ts): both dictionaries have the same shape, so a missing translation is a type error, and a test checks that their keys match. The locale is cached for 30 seconds per server. Default main menu texts follow the server language; texts customised by the server never change. Owner-facing status notices stay in Italian.

The dashboard and the super console have no `/en` and `/it` URLs (they are not indexed): `middleware.ts` picks the language from the `dispatch_locale` cookie (set when the visitor opens `/en` or `/it`, or uses the IT/EN toggle), otherwise from `Accept-Language`, English by default. Each page keeps its own `it`/`en` copy objects read through `useCopy` ([`apps/web/app/_components/locale-context.tsx`](../apps/web/app/_components/locale-context.tsx)).

## Data lifecycle

| Data | Lifetime |
|---|---|
| Closed tickets and their notes, members, feedback and audit | `closedTicketRetentionDays` per server, counted from the close and never shorter than the user's reopen window; unset = kept |
| Transcripts of closed tickets | `transcriptRetentionDays` per server; one-shot copies are deleted when downloaded; always deleted with their ticket |
| Ticket channels on Discord | deleted by retention only if `retentionDeleteDiscordChannel` is enabled, or by staff on demand |
| Opening reservations and attempts | an abandoned opening questionnaire expires after 10 minutes; attempts and idle guards deleted after 2 days |
| Form sessions | expire 30 minutes after the last answer; answers of finished sessions cleared after 1 day, rows deleted after 7 days |
| Form submissions | kept until an Admin deletes them or the server is purged |
| Dashboard sessions | 8 hours |
| Servers the bot left | everything deleted 30 days after removal |

Retention runs in the bot at startup and every 6 hours, paginated. New installations delete nothing until a duration is set. Details and safety rules (deletion markers, repurposed channels, Unknown Channel handling): [TICKET_PROTECTIONS.md](TICKET_PROTECTIONS.md#retention).

### Post-removal purge

When the bot is removed from a server (or the server is deleted), the bot stamps `GuildSettings.leftAt`; servers that removed the bot while it was offline are stamped at the next startup, while temporarily unavailable servers are not. Adding the bot again clears the stamp.

[`apps/api/src/guild-purge.ts`](../apps/api/src/guild-purge.ts) runs in the API one minute after startup and then every hour. For each server whose `leftAt` is older than 30 days (`DEFAULT_POST_REMOVAL_RETENTION_DAYS`), in batches of 20, it locks the `GuildSettings` row, deletes tickets and form submissions, then deletes the server row and everything that cascades from it. The row lock makes a concurrent re-add wait and then start from a clean row. The purge runs in the API because the bot's database role deliberately cannot delete dashboard data (forms, submissions, role bindings, audit).

Entries of the super console (installation blacklist, super-admin audit, status channel) are instance-wide and are not part of the purge.

## Scalability

For the current workload a single Docker Compose deployment is sufficient: one bot process, one API replica, one PostgreSQL instance. If volume grows:

1. introduce Discord sharding for the bot;
2. move the per-session super console mutation budget and the access cache out of process memory before running several API replicas;
3. move automations, retention and leaderboard cycles to a dedicated worker (adding a job queue such as Redis at that point);
4. move heavy exports and transcript generation to controlled asynchronous jobs;
5. partition audit tables by date.

Ticket openings are already safe with several bot processes: reservations, leaderboard periods and staff thread creation are claimed with conditional updates in PostgreSQL, not in memory.
