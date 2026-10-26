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

## Instance alerts and monitoring

- **Recording**: the bot records its notices (startup, client errors, Gateway disconnections, failed interactions, servers added, removed or rejected) as `InstanceEvent` rows with a category, a severity and a message key (`apps/bot/src/status.ts`; the bot may only insert). The API records its own (plan sync, purge, watchdog) through `alert-store.ts`, and opens or resolves `Incident` rows by key (`bot.down`, `discord.sync`).
- **Routing** ([`apps/api/src/alerting.ts`](../apps/api/src/alerting.ts), rules in [`alert-rules.ts`](../apps/api/src/alert-rules.ts)): every 20 seconds pending events go where the super console says for their category — the status channel, another channel, the daily digest or the log only. Identical alerts within 10 minutes are merged; non-critical ones wait during quiet hours; critical ones can mention the owner. Messages are posted by the bot (`POST /alerts/deliver`) and rendered in the bot language of the destination server (`packages/shared/src/alert-messages.ts`). Open incidents are reminded after 15 minutes, 1 hour and then every 6 hours until acknowledged.
- **Watchdog** ([`apps/api/src/monitoring.ts`](../apps/api/src/monitoring.ts)): the API checks the bot every 30 seconds; after about two minutes without an answer it opens `bot.down` (log only: the bot cannot post it) and posts to the optional alarm webhook; `/health/bot` serves the state to an external monitor. Events are kept 90 days.
- **Logs**: the bot and the API keep their latest 2,000 log lines in memory, redacted (`packages/shared/src/log-buffer.ts`), for the super console's Logs tab. Docker log files are capped at 5 × 10 MB per service.

## Bot language

Each server has a bot language, `GuildSettings.locale` (`en` or `it`, `en` by default for new servers), chosen in the dashboard under **Sistema e menu → Lingua del bot** (*System and menu → Bot language*). It applies to everything the bot posts in that server: ticket channels, ephemeral replies, logs, transcripts and leaderboards.

The texts live in [`apps/bot/src/i18n.ts`](../apps/bot/src/i18n.ts): both dictionaries have the same shape, so a missing translation is a type error, and a test checks that their keys match. The locale is cached for 30 seconds per server. Default main menu texts follow the server language; texts customised by the server never change. Owner-facing status notices stay in Italian.

The dashboard and the super console have no `/en` and `/it` URLs (they are not indexed): `middleware.ts` picks the language from the `dispatch_locale` cookie (set when the visitor opens `/en` or `/it`, or uses the IT/EN toggle), otherwise from `Accept-Language`, English by default. Each page keeps its own `it`/`en` copy objects read through `useCopy` ([`apps/web/app/_components/locale-context.tsx`](../apps/web/app/_components/locale-context.tsx)).

## Plans

`packages/shared/src/plans.ts` is the single source of truth: limits (categories, panels, forms, form panels, canned replies, dashboard role bindings, longest retention) and features (automations, staff threads, leaderboard, closed-ticket category, custom branding) for Free, Plus, Pro and Brand.

- **Sales**: only through Discord, as monthly guild subscription SKUs (Premium Apps). The SKU of each paid plan is set in the super console (`InstanceConfig.discordSkus`); `PLAN_CURRENCY` is USD (Discord SKU prices), localised by Discord at checkout.
- **Storage**: `GuildSettings.subscriptionTier`, `subscriptionEndsAt`, `subscriptionEntitlementId`, `subscriptionSyncedAt` (the Discord subscription, written by the API sync), `planTier`, `planExpiresAt`, `planNote` (a gift from the super console) and `planLimitsTier` (the plan whose limits were last applied). `effectiveTier()` returns the higher of the running gift and the running subscription.
- **Sync** ([`apps/api/src/discord-billing.ts`](../apps/api/src/discord-billing.ts)): every two minutes the API reads the application's active entitlements through the bot (`GET /entitlements`, read-only REST) and `bestEntitlement()` picks each server's highest running plan. If they cannot be read nothing changes (an outage never downgrades); after three failures in a row a `discord.sync` incident opens. New, changed, cancelled and ended subscriptions are recorded as billing alerts, and a lower plan is applied straight away (`settleGuildPlan()`). Plan gates in the bot answer with Discord's premium button for the required SKU (the bot may read only that column of `InstanceConfig`).
- **API** ([`apps/api/src/plan-service.ts`](../apps/api/src/plan-service.ts), [`plan-routes.ts`](../apps/api/src/plan-routes.ts)): quotas on create (`409 QUOTA_EXCEEDED`), retention capped on save, `403 PLAN_REQUIRED` for the leaderboard "send now" and branding, `/bot/store?plan=` redirecting to the Discord store, the public catalogue at `/api/public/info`, gifts and contacts for the super console. Every 15 minutes `sweepPlans()` clears ended gifts and cancelled subscriptions past their end and, when the plan in force dropped below `planLimitsTier`, runs `applyPlanLimits()` (retention capped, extra role bindings removed, branding reset — nothing else is deleted).
- **Gates** ([`apps/bot/src/plan.ts`](../apps/bot/src/plan.ts), cached 30 seconds): automations and staff threads need Plus, the leaderboard and the closed-ticket category need Pro, a custom panel footer needs Brand; retention uses the setting capped by the plan (`effectiveRetentionDays`). Gated settings stay saved and start working after an upgrade.

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
