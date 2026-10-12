# Bot directory listings

Copy for the public bot directories, ready to paste, and the website's search engine setup. Keep it in sync with the product: features in the README, per-server limits in `packages/shared/src/quotas.ts`.

> Character limits change from site to site and over time: every description below states its length, so pick the variant that fits the form.

## Before submitting

- **Public Bot** must be enabled in the Discord Developer Portal, otherwise reviewers cannot add the bot.
- Privacy policy: https://dispatch.haxurus.com/en/legal#privacy
- Terms of service: https://dispatch.haxurus.com/en/legal#terms
- Support server: https://discord.gg/P7ycBcBqtn
- In **Developer Portal → General Information**, set the description, tags and the *Terms of Service* / *Privacy Policy URL* (required by the App Directory).

## Common fields

| Field | Value |
|---|---|
| Name | Dispatch |
| Tagline (45) | Every request on your server, taken care of. |
| Library | discord.js (TypeScript) |
| Prefix / commands | None: tickets and forms are opened from buttons and menus, everything is configured from the web dashboard |
| Website | https://dispatch.haxurus.com/en |
| Dashboard | https://dispatch.haxurus.com/dashboard |
| Privacy policy | https://dispatch.haxurus.com/en/legal#privacy |
| Terms of service | https://dispatch.haxurus.com/en/legal#terms |
| Source code | https://github.com/haxurus/Dispatch |
| Licence | AGPL-3.0 (open source) |
| Contact | haxurus@icloud.com |
| Support server | https://discord.gg/P7ycBcBqtn |
| Languages | English and Italian (bot messages per server, website, dashboard) |
| Price | Free |
| Invite URL | `https://dispatch.haxurus.com/backend/bot/invite` (redirects to Discord's authorisation page, scopes `bot applications.commands`, permissions `361045814288`) |

Permissions in the invite (no Administrator): View Channels, Manage Channels, Manage Roles, Send Messages, Manage Messages, Embed Links, Attach Files, Read Message History, Manage Threads, Create Private Threads, Send Messages in Threads.

Privileged intents: Server Members (staff members added to private staff threads), Message Content (complete transcripts). No Presence intent.

## Short descriptions

**87 characters**

> Discord ticket bot with panels, forms, SLAs, encrypted transcripts and a web dashboard.

**115 characters**

> Discord ticket bot with panels, forms, claims, SLAs, encrypted transcripts, staff ratings and a full web dashboard.

**195 characters**

> Dispatch is a Discord ticket bot for support teams: ticket panels and menus, forms and staff applications, claims, SLAs, private staff threads, encrypted transcripts, ratings and a web dashboard.

## Long description (Markdown)

```markdown
# Dispatch — the Discord ticket bot

**Every request on your server, taken care of.** Dispatch opens private ticket channels from panels and menus, collects details with forms, routes each request to the right staff and keeps an eye on SLAs. On close, transcripts and feedback are archived and encrypted. Everything is configured from a web dashboard — no commands to learn.

## Features

- **Ticket panels and menus:** buttons or a select menu, one category per topic, each with its own staff roles, limits and closed-ticket category.
- **Forms and staff applications:** validated questions, in-chat or DM, schedules, role restrictions, and answers that can open a ticket.
- **Claims, priorities and private staff threads:** claim, assign, transfer and prioritise tickets; the Staff thread button opens a private thread with every moderator of the category.
- **SLAs and escalation:** first-response and resolution targets, escalation to roles, inactivity warnings and auto-close.
- **Transcripts:** HTML transcripts on close, by DM, to an archive channel or kept encrypted, with configurable retention.
- **Ratings and leaderboards:** members rate the moderator who handled their ticket; weekly or monthly moderator leaderboards are posted automatically.
- **Ticket logs, analytics and a web dashboard** with Viewer, Moderator, Admin and Owner access levels.

## Why Dispatch

- **Built to be safe.** No Administrator permission. Transcripts, form answers, notes and close reasons are encrypted with AES-256-GCM.
- **No duplicate tickets.** Double clicks, restarts and replays never open two channels; anti-spam with progressive blocks and a blacklist keep abuse out.
- **Your language.** The bot speaks English or Italian, chosen per server.
- **Open source.** The full code is public under AGPL-3.0, and you can self-host it with Docker.

## Getting started

1. Add Dispatch to your server.
2. Open https://dispatch.haxurus.com/dashboard and sign in with Discord.
3. Create a ticket category with its staff roles, then publish a panel or the main menu in a channel.
```

## Getting started

The three steps at the end of the long description are also the short onboarding text for directories that ask for one:

1. Add Dispatch to your server: https://dispatch.haxurus.com/backend/bot/invite
2. Open https://dispatch.haxurus.com/dashboard and sign in with Discord.
3. Create a ticket category with its staff roles, then publish a panel or the main menu in a channel.

## Per-directory notes

Registering on the directories needs personal accounts. Most users look for bots there rather than on search engines.

### top.gg

- Short description: the 115-character version.
- Long description: the Markdown above.
- Tags: Tickets, Support, Moderation, Utility, Web Dashboard.
- Prefix: `none — buttons, menus and web dashboard`.
- Add a few dashboard screenshots: ticket queue, panel editor with preview, and a ticket channel with its controls.

### discordbotlist.com

- Short description: the 87-character version.
- Long description: the Markdown above.
- Tags: tickets, support, moderation, forms, utility.

### discord.bots.gg

- Short description: the 115-character version.
- Library: discord.js. Prefix: none.
- Long description: the Markdown above, plus the website and GitHub links.

### Discord App Directory (official)

Requires a verified application (Discord asks for verification once the bot is in 75+ servers) plus the privacy policy and terms links above.

- Short description: the 87-character version.
- Detailed description: the Markdown above without the H1 title.
- Categories: Utilities (primary), Moderation.
- Search tags: tickets, support, forms, transcripts, staff applications.
- Links: website, privacy policy, terms of service, support server.

Other directories worth a listing, with the same texts: discords.com. Use `https://dispatch.haxurus.com/en` as the website everywhere.

## Search keywords

Use naturally in descriptions and posts: Discord ticket bot, Discord ticket system, Discord support bot, ticket tool for Discord, Discord forms bot, Discord staff applications, ticket transcripts, Discord modmail, Discord bot dashboard. These match the keywords of the website (`homeCopy.en.meta` in `apps/web/app/i18n.ts`).

## Website SEO

The public website targets an international audience: English is the default language (`x-default`), Italian is a complete mirror.

### What the code does

| Element | Where | Notes |
| --- | --- | --- |
| Redirect `/` by language | `apps/web/middleware.ts` | Server-side 307 based on `Accept-Language`, English by default (crawlers send no language → `/en`). |
| Correct `<html lang>` | `apps/web/app/layout.tsx` | `en` on `/en/**`, `it` elsewhere. |
| Title, description, keywords | `apps/web/app/i18n.ts` (`homeCopy.*.meta`) | Target "Discord ticket bot", "ticket system", "forms", "transcripts". |
| Canonical + hreflang | `apps/web/app/site.ts` (`publicPageMetadata`) | `en`, `it`, `x-default` on every public page. |
| Open Graph / Twitter | `apps/web/app/{en,it}/opengraph-image.tsx` | Localized 1200×630 preview, also used by Discord embeds. |
| Structured data | `PublicHome.tsx` | JSON-LD `WebApplication` + `FAQPage`. |
| Visible FAQ | `PublicHome.tsx`, `i18n.ts` | Answers typical searches ("how do I add a ticket system to my Discord server"). |
| `robots.txt`, `sitemap.xml` | `apps/web/app/robots.ts`, `sitemap.ts` | Dashboard, super console and `/backend/` excluded. |
| Favicon, apple icon, manifest | `apps/web/app/icon.svg`, `apple-icon.tsx`, `manifest.ts` | |
| Bot custom status | `apps/bot/src/config.ts` | `BOT_STATUS_TEXT` (default `Discord tickets · dispatch.haxurus.com`, empty = disabled). |

For a different domain set `SITE_URL` (also at build time, because the sitemap and the images are generated statically).

### Manual steps (once)

1. **Google Search Console:** add the *Domain* property `dispatch.haxurus.com`, verify it with the TXT record on Cloudflare, then submit `https://dispatch.haxurus.com/sitemap.xml`.
2. **Bing Webmaster Tools:** import the property from Search Console (it also covers DuckDuckGo, Yahoo and Ecosia) and submit the same sitemap.
3. **Check the previews:** paste `https://dispatch.haxurus.com/en` into a Discord channel and into the [Rich Results Test](https://search.google.com/test/rich-results).
4. **Discord Developer Portal → General Information:** description, tags and the Terms of Service / Privacy Policy URLs (see [Before submitting](#before-submitting)).
5. **Bot directories:** see [Per-directory notes](#per-directory-notes).
