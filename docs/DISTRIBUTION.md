# Distribution and self-hosting rules

Dispatch is free software under the [GNU AGPL-3.0-only](../LICENSE). You can use it in three ways; the rules below explain what each one allows and requires. Where this page and the licence differ, the licence prevails: this page summarises it and adds the project's branding rules.

## 1. Use the hosted instance

The official instance is **[dispatch.haxurus.com](https://dispatch.haxurus.com)**, run by the project maintainer.

- Add it to your server from the website or the bot's profile in Discord.
- The [privacy policy and terms of service](https://dispatch.haxurus.com/en/legal) apply.
- It is free; each server has the limits described in the terms (categories, panels, forms, templates, blacklist entries).

## 2. Self-host it for your own servers

You may run your own copy for servers you manage, privately or in your organisation, with or without changes.

- Create **your own Discord application** and bot token: never reuse credentials from another instance.
- Generate your own secrets as described in [DEPLOYMENT.md](DEPLOYMENT.md); never commit them.
- Build your own container images from your fork. The images under `ghcr.io/haxurus/dispatch` are built for the official instance and come with no guarantee.
- Keep the instance updated: security fixes land on `main`.

## 3. Offer your own instance to other people

If people outside your organisation can use your instance (for example, a public bot that anyone can add), the AGPL and these rules apply.

### Source code (AGPL §13)

- Users of your instance must be able to get **the complete source code of the version you run**, including your changes, under the AGPL-3.0. A public fork that matches what you deploy is the simplest way.
- Point the website's source link to your fork: `REPO_URL` in `apps/web/app/site.ts` (used by the footer and the legal pages).
- Keep `LICENSE` and the existing copyright notices, and mark your modifications (for example in your fork's README or commit history).
- You may charge for your instance; the source obligations stay the same.

### Name and branding

The **Dispatch** name and logo identify the official project and the hosted instance at dispatch.haxurus.com. So that users are never confused about who runs the bot they add:

- give your public instance **its own bot name, avatar and website**;
- do not present it as the official Dispatch, as run by Haxurus, or as endorsed by the project;
- do not use `dispatch.haxurus.com`, the official Discord server or the maintainer's contacts as yours (`SITE_URL`, `CONTACT_EMAIL` in `apps/web/app/site.ts`, `BOT_STATUS_TEXT` for the bot).

An attribution such as *"based on Dispatch (github.com/haxurus/Dispatch)"* is welcome. Self-hosted instances used only for your own servers may keep the name.

### Your responsibilities as operator

- You are the operator of your instance and responsible for the data it processes, including ticket transcripts and form answers. Publish **your own privacy policy and terms of service** with your own contact details: do not reuse the official ones.
- Comply with Discord's [Terms of Service](https://discord.com/terms) and [Developer Policy](https://discord.com/developers/docs/policies-and-agreements/developer-policy), including bot verification and the privileged intents review when your bot grows.
- Do not weaken the least-privilege permissions or the encryption to collect more data than the features need.
- Report vulnerabilities you find in Dispatch itself privately through [GitHub](https://github.com/haxurus/Dispatch/security/advisories/new), so that every instance can be fixed.

## No warranty

Dispatch is provided without any warranty, as stated in sections 15 and 16 of the licence. The maintainer does not operate, support or answer for third-party instances.
