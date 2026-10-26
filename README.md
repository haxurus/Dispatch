# Dispatch — Discord ticket bot

[![CI](https://github.com/haxurus/Dispatch/actions/workflows/ci.yml/badge.svg)](https://github.com/haxurus/Dispatch/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-f5a524)](LICENSE)

**An open-source Discord ticket bot for support teams: panels, forms, SLAs, transcripts and a web dashboard.**

Dispatch opens private ticket channels from menus, panels and forms, lets staff claim, assign, prioritise and close them, keeps encrypted transcripts and form answers, and measures response times, ratings and moderator activity. Everything is configured from a web dashboard.

**[Add to Discord](https://dispatch.haxurus.com/backend/bot/invite)** · [Website](https://dispatch.haxurus.com/en) · [Support server](https://discord.gg/P7ycBcBqtn) · [Privacy & terms](https://dispatch.haxurus.com/en/legal)

- **Hosted instance:** [dispatch.haxurus.com](https://dispatch.haxurus.com) — free and open to every server
- **Self-hosting:** run your own copy with Docker — see the [distribution rules](docs/DISTRIBUTION.md)
- **Open source:** the bot, the API, the dashboard and the deployment scripts are all in this repository under the [AGPL-3.0](LICENSE) licence

> No Discord token, database password, encryption key or other secret is ever stored in this repository.

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Security model](#security-model)
- [Repository layout](#repository-layout)
- [Local development](#local-development)
- [Self-hosting and deployment](#self-hosting-and-deployment)
- [Discord application setup](#discord-application-setup)
- [Plans](#plans)
- [Super console](#super-console)
- [Discord limitations](#discord-limitations)
- [Support and contributing](#support-and-contributing)
- [Licence and distribution](#licence-and-distribution)

## Features

| Area | What Dispatch does |
|---|---|
| Opening tickets | Main menu (one *Open a ticket* button and a private selector of up to 25 request types), ticket panels with a select menu or buttons, forms that open a ticket on submit |
| Ticket categories | Discord category for open and closed tickets, staff roles, up to 5 opening questions, per-user open limit, cooldowns, transcript and feedback options |
| Handling | Claim, unclaim, assign, status, priority, transfer between categories, add or remove members, close with a reason, reopen, delete the channel with confirmation |
| Staff tools | Private staff threads per ticket, staff notes and canned replies (their own dashboard page, for every ticket or only some categories and forms, sent from the ticket page) |
| Automation | First-response and resolution SLAs, optional escalation to roles, inactivity warning and auto-close |
| Transcripts | HTML transcript on close, sent by DM to the opener, to an archive channel and/or kept as an encrypted copy; manual generation from the dashboard |
| Forms | Up to 25 validated questions (text, number, email, URL, date, yes/no, single and multiple choice, Discord ID), in-chat or DM, schedule, limits and per-role permissions |
| Ratings and leaderboards | 1–5 ratings attributed to the moderator who handled the ticket, weekly or monthly moderator leaderboard posted automatically |
| Ticket logs | 13 event types (opens, claims, closes, transcripts, feedback, staff threads, automations, form submissions, blacklist…) posted to a channel, never with encrypted content |
| Protection | Anti-spam with progressive temporary blocks, single-use opening reservations, per-server user blacklist with expiry and reason |
| Retention | Separate retention for transcripts and closed tickets, optional deletion of the Discord channel |

**Dashboard**

- Discord sign-in, access levels **Owner / Admin / Moderator / Viewer** verified live against the server, role-based access mapping.
- Ticket queue with filters, ticket detail with actions, notes and transcript download; analytics (daily volume, categories, staff, SLA breaches, ratings) and the moderator leaderboard preview.
- Panel editor with a live Discord-style preview, form builder and blacklist; every configuration change is recorded in an encrypted dashboard audit log.
- The website, the dashboard and the super console are in English and Italian (the dashboard follows the language chosen on the site or with its IT/EN toggle, stored in the `dispatch_locale` cookie). The bot speaks English or Italian, chosen per server.

Per-server limits on the hosted instance depend on the server's plan (categories, panels, forms, canned replies, dashboard roles, retention: see [Plans](#plans)); 2,000 blacklist entries and 50 form role bindings apply to every plan ([`packages/shared/src/plans.ts`](packages/shared/src/plans.ts)).

Functional details: [ticket protections, logs, ratings and retention](docs/TICKET_PROTECTIONS.md), [forms](docs/FORMS.md), [panels](docs/PANELS.md).

## How it works

```text
Discord interaction (button, select menu, modal)
    │
    ▼
bot ─► ingress limiter ─► single-use reservation (PostgreSQL) ─► blacklist, limits, cooldowns
    │
    ▼
private ticket channel ─► Ticket row ─► ticket log channel (optional)

Messages in ticket channels ─► activity tracking (first response, SLA, inactivity)
Bot timers ─► automations every minute · retention every 6 hours · leaderboards every 15 minutes
```

A ticket is created only after a reservation has been committed in a serialised transaction: double clicks, replays and concurrent requests never create two channels.

```text
Browser ──► edge (Nginx) ──► Next.js (web) ──/backend/*──► Fastify API ──► PostgreSQL
                                                                │
                                                                └─internal RPC─► bot ──► Discord
```

The dashboard never talks to Discord with the bot token: every action that touches Discord (publishing a panel, closing a ticket, reading roles and channels) goes from the API to the bot over an authenticated internal RPC.

More: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Security model

A ticket bot handles private conversations, so Dispatch is designed to limit what a compromised component could do.

- **Least-privilege Discord permissions.** No Administrator, Manage Server, Manage Webhooks, Mention Everyone, Kick/Ban or Manage Nicknames: the bot only manages ticket channels, their permission overwrites, messages and threads.
- **Separated secrets.** The Discord token exists only in the bot container, the OAuth client secret only in the API; the web container has no application secrets; secrets live in root-only files on the host.
- **Encryption at rest.** Transcripts, form answers, staff notes, close reasons, feedback comments, blacklist reasons, response templates and audit details are encrypted with AES-256-GCM.
- **Least-privilege database.** Distinct PostgreSQL roles for API and bot; the bot cannot read dashboard sessions, role bindings, staff notes, response templates or audit tables. CI verifies these grants on every change.
- **Isolation.** Segmented Docker networks, read-only non-root containers with `cap_drop: ALL` and resource limits, no Docker socket, egress blocked towards host/LAN.
- **Web hardening.** HttpOnly/Secure session cookies (HMAC-hashed in the database), OAuth `state`, Origin-based CSRF checks, strict CSP, rate limiting, input validation, guild membership and access checks on every request.
- **Restricted deployment.** GitHub Actions reaches the VPS through a dedicated SSH key with a forced command that can only run `deploy`, `rollback` and `status`; images are deployed by immutable SHA-256 digest.

Details: [`docs/SECURITY.md`](docs/SECURITY.md). To report a vulnerability, see [`SECURITY.md`](SECURITY.md).

## Repository layout

| Path | Contents |
|---|---|
| `apps/bot` | Discord Gateway client, ticket and form interactions, automations, retention, leaderboards, ticket logs, internal RPC |
| `apps/api` | Fastify API: OAuth2, sessions, RBAC, configuration, tickets, transcripts, analytics, super console, post-removal purge |
| `apps/web` | Next.js dashboard, super console and public site |
| `packages/db` | Prisma schema and migrations (PostgreSQL) |
| `packages/shared` | Constants and pure helpers shared by bot, API and web (log events, panels, leaderboards, quotas) |
| `tests` | Integration tests run in CI against a disposable PostgreSQL |
| `deploy` | Production Compose file, edge Nginx config, database role hardening |
| `ops` | VPS installer, restricted deploy wrapper, SSH forced-command entrypoint |
| `security` | Host firewall rules |
| `scripts` | On-demand database backup |
| `docs` | Architecture, security, deployment, validation and feature guides |

## Local development

Requirements: Node.js 22+, a PostgreSQL database, a Discord test application.

```bash
npm install
npm run db:generate
npm run build
```

`npm run build` compiles every workspace (TypeScript for shared, db, api and bot, `next build` for web). To run the services from source, apply the migrations (`npm run db:migrate`, with `DATABASE_URL` set) and start them with `npm run dev:bot`, `npm run dev:api` and `npm run dev:web`; each reads its configuration and secrets from environment variables or `*_FILE` paths (see [`.env.example`](.env.example) and [`secrets/README.md`](secrets/README.md)).

The integration tests need a disposable database named `dispatch_test` with the production role policy applied; CI shows the exact setup ([`docs/VALIDATION.md`](docs/VALIDATION.md)):

```bash
DISPATCH_TEST_DATABASE=1 node --import tsx --test --test-concurrency=1 tests/ticket-protections.test.ts
```

## Self-hosting and deployment

Production runs as immutable Docker images built by GitHub Actions; nothing is built or `git pull`ed on the server.

```text
pull request ──► CI: build and typecheck, migrations on PostgreSQL, database privilege policy,
                     integration tests, shell and Compose validation, image builds

merge to main ──► same CI ──► build & push images (SBOM + provenance) to GHCR
              ──► SSH forced command on the VPS:
                    disk-space guard ─► database backup ─► pull by digest ─► migrate
                    ─► database role hardening ─► start ─► health checks
                    ─► automatic rollback on failure ─► prune images older than the previous release
```

Step-by-step guide (VPS install, reverse proxy, OAuth, GitHub secrets, rollback, backups and restore): [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). What CI verifies: [`docs/VALIDATION.md`](docs/VALIDATION.md).

Useful commands on the VPS:

```bash
sudo /usr/local/sbin/dispatch-deploy status
sudo /usr/local/sbin/dispatch-deploy rollback
```

Rollback is also available as the **Rollback production** GitHub Actions workflow. Migrations must stay backward-compatible with the previous release (expand/contract) so that rollback remains safe.

## Discord application setup

Gateway intents requested by the bot: **Guilds**, **Guild Messages** and the two privileged intents below. Enable both privileged intents in the Developer Portal: Discord rejects the connection if either is disabled.

- **Server Members Intent** — lists the members of staff roles, who are added to private staff threads
- **Message Content Intent** — complete transcripts and ticket activity tracking

The Presence Intent is not used.

Bot permissions (no `Administrator`), as requested by the install link (`apps/api/src/super.ts`, bitfield `361112923152`): View Channels, Manage Channels, Manage Roles, Change Nickname, Send Messages, Manage Messages, Embed Links, Attach Files, Read Message History, Manage Threads, Create Private Threads, Send Messages in Threads. Manage Roles is needed to set permission overwrites on ticket channels; the thread permissions are needed for private staff threads, because the bot can only grant in channel overwrites what it has itself.

OAuth2 redirect URL (dashboard sign-in, scopes `identify` and `guilds`):

```text
<PUBLIC_BASE_URL>/auth/discord/callback
```

With the usual layout that is `https://<your-hostname>/backend/auth/discord/callback`. The install link (`/backend/bot/invite`, scopes `bot applications.commands`) does not use a redirect URI.

Anyone can add the hosted bot: **Public Bot** must be enabled in the Developer Portal. The bot still leaves servers, and servers added by users, that are on the super console blacklist, and reports it in the status channel.

## Plans

The hosted instance has a Free plan and three paid plans, defined once in [`packages/shared/src/plans.ts`](packages/shared/src/plans.ts) and shown on the [pricing page](https://dispatch.haxurus.com/en/pricing):

| | Free | Plus | Pro | Brand |
|---|---|---|---|---|
| Price (Discord, monthly) | free | $1.99 | $4.99 | $8.99 |
| Ticket categories | 3 | 10 | 30 | 50 |
| Ticket panels | 2 | 5 | 15 | 25 |
| Forms / form panels | 2 / 2 | 5 / 5 | 15 / 25 | 30 / 25 |
| Canned replies | 5 | 15 | 25 | 50 |
| Dashboard role bindings | 1 | 3 | 10 | 10 |
| Longest retention | 15 days | 30 days | 60 days | 90 days |
| Tickets, forms, transcripts, ticket log, ratings | ✓ | ✓ | ✓ | ✓ |
| SLAs, escalation, inactivity warning and auto-close | | ✓ | ✓ | ✓ |
| Private staff threads | | ✓ | ✓ | ✓ |
| Moderator leaderboard | | | ✓ | ✓ |
| Closed-ticket category | | | ✓ | ✓ |
| Bot nickname and banner per server, custom panel footer | | | | ✓ |
| Priority support | | ✓ | ✓ | ✓ |

Paid plans are sold **only through Discord**, as monthly guild subscriptions ([Premium Apps](https://docs.discord.com/developers/monetization/overview)): the pricing page, the dashboard and the bot's *Subscribe* buttons open the Dispatch store on Discord. Discord sets the price in US dollars and localises it at checkout; the SKUs are set in the super console and the API mirrors each server's subscription every two minutes (`apps/api/src/discord-billing.ts`). The operator can also give a plan from the super console (a gift, optionally with an expiry); the higher of the two applies. When a plan ends or is lowered, the server returns to the lower plan: features above it stop working in the bot (their settings are kept), retention is capped, extra dashboard role bindings are removed and the bot branding is reset. Servers that used Dispatch before plans existed received Brand as a gift.

## Super console

The super console (`/super`, API `/api/super/*`) is available only to the Discord user set in `SUPER_ADMIN_USER_ID`; every route checks it on the server. It has the same layout as Sentinel's, in tabs:

- **Servers & plans**: metrics and the connected servers, live from the bot, with their ticket counts and plan (Discord subscription, read-only, and gift); give a gift plan with expiry and internal note, leave a server, or block it and leave;
- **Monitoring**: the bot watchdog (checked every 30 seconds; "bot down" after about two minutes goes to an optional Discord webhook, stored encrypted, and to `/health/bot` for an external monitor), open and recent **incidents** with reminders until acknowledged, **alert routing** per category (status channel, another channel, daily digest or log only, with a mention for critical alerts, quiet hours and the digest time) and the **instance events** of the last 90 days. Alerts are rendered in the bot language of the server they are posted to;
- **Logs**: the latest bot and API log lines, kept in memory and redacted;
- **Contacts** shown on the pricing page, **Discord subscriptions** (the SKU of each paid plan, the last sync and *Sync now*), **Notifications** (the status channel, with a test message), the **installation blacklist** (a blocked user is recognised only where the bot can read the server's audit log) and the **audit** of every super console and system action (details encrypted, IP addresses stored as keyed hashes). Changes are limited to 30 per minute per session.

Status notices never contain ticket content.

When the bot is removed from a server, the API deletes all of that server's data 30 days later, unless the bot is added again in the meantime.

## Discord limitations

Dispatch works only with what Discord exposes to the bot through the Gateway and REST with the granted intents and permissions. Transcripts contain the messages of the ticket channel (and, for staff, of the staff thread) that the bot can read; attachments are referenced by their Discord URL, not downloaded. A member with Manage Threads at server level can see private staff threads. Moving a closed ticket fails when the destination category already holds 50 channels: the ticket is closed anyway and the failure is audited. Discord's own message retention, exported copies and backups are outside Dispatch's retention settings.

## Support and contributing

- **Questions and help:** the [Discord server](https://discord.gg/P7ycBcBqtn) — see [SUPPORT.md](.github/SUPPORT.md).
- **Bugs and feature requests:** [open an issue](https://github.com/haxurus/Dispatch/issues/new/choose) using the forms.
- **Security vulnerabilities:** report them [privately](https://github.com/haxurus/Dispatch/security/advisories/new), never in a public issue — see [SECURITY.md](SECURITY.md).
- **Pull requests:** read [CONTRIBUTING.md](.github/CONTRIBUTING.md) first, including the project scope. Every pull request runs the full CI.

Everyone taking part follows the [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## Licence and distribution

Dispatch is free software released under the **GNU Affero General Public License v3.0 only** — see [`LICENSE`](LICENSE).

You may use, study, modify and self-host it. If you offer a modified version to other people over a network, the AGPL requires you to give them the source code of your version; public instances must also use their own name and branding. The details are in [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).

Copyright © 2026 Haxurus.
