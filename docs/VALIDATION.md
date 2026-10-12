# Validation

Every pull request runs [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). The **Build and deploy** workflow calls the same pipeline (`workflow_call`) and builds and pushes images only after it passes, so nothing reaches the VPS untested. Both jobs are required checks on `main`.

## `Typecheck, tests and migrations` job

Runs against a disposable PostgreSQL 17 service (`dispatch_test` database, test-only credentials):

1. **Compile all applications:** `docker build --target migrate`, which installs the dependencies, generates the Prisma client and builds every workspace (TypeScript for shared, db, api and bot, `next build` for web). A type error fails the job.
2. **Apply migrations:** `npm run db:migrate` (`prisma migrate deploy`) from that image against the empty database.
3. **Apply the production database privilege policy:** runs [`deploy/runtime/harden-users.sh`](../deploy/runtime/harden-users.sh) with the `postgres:17-alpine` image, creating `dispatch_api` and `dispatch_bot` with test passwords exactly as in production.
4. **Integration tests:** `node --import tsx --test --test-concurrency=1 tests/ticket-protections.test.ts`. The test file refuses to run unless `DISPATCH_TEST_DATABASE=1` is set and the database is named `dispatch_test`.

## `Compose and container images` job

1. **Validate shell scripts:** `sh -n` on every `*.sh` under `ops/`, `security/`, `deploy/runtime/` and `scripts/`, plus `ops/dispatch-deploy` and `ops/dispatch-deploy-entrypoint`.
2. **Validate production Compose:** `docker compose config -q` on `deploy/docker-compose.prod.yml` with `deploy/.env.production.example`, empty secret files and syntactically valid digest references.
3. **Build the runtime image** (`--target runtime`, with `--pull`).
4. **Build the migration image** (`--target migrate`).

## What the integration tests cover

[`tests/ticket-protections.test.ts`](../tests/ticket-protections.test.ts) runs against real migrations with a simulated Discord client. It covers:

- **Opening reservations:** only one parallel reservation and one consume (with and without anti-spam); nonces bound to user, server, category and source; expired or changed forms rejected; open-ticket limit enforced even without cooldowns; blacklist re-checked at consumption; failed creation transactions keep the reservation and commit nothing partial.
- **Anti-spam:** global cooldown across categories persisted in PostgreSQL, category cooldown surviving ticket deletion, progressive temporary blocks, bounded ingress limiter.
- **Retention:** reopen window respected, unconfigured retention and open tickets never purged, expired private data cascaded, deletion markers preserved on Discord failures, repurposed channels never deleted; abandoned form sessions expired and old ones purged.
- **Main menu and panels:** private request selector in the configured order, no duplicate publication after a forbidden edit, panel migration backfill and default look, emoji parsing, URL and override sanitising, select menu or 5×5 button layout within Discord limits, panel buttons re-checking the current message and category.
- **Forms:** submissions open tickets through the same guard (blacklist and open limit apply), only one active form session per user and form.
- **Closed tickets:** move to the closed category keeping overwrites and back on reopen, form override of the closed category, failed moves never blocking the close, staff channel deletion securing the transcript and blocking reopening, staff-only deletion with an expiring confirmation.
- **Ticket logs:** only enabled events posted, never throwing, never including encrypted content; the `BLACKLIST` RPC payload accepts only structured fields.
- **Ratings and leaderboards:** migration defaults, backfill and constraints; feedback attributed to the claimer or the staff closer, never to the opener or the auto-close; ranking, ISO weeks and months in the server time zone (DST and year boundaries), schedule, and one post per period even with concurrent workers.
- **Staff threads:** thread permissions on new ticket channels, staff-only button for active tickets with one thread per ticket, thread messages not counted as ticket activity, thread transcript sent to the archive channel, else the log channel, never to the opener.
- **Post-removal purge:** servers gone for longer than the retention purged with every dependent row; servers within the retention or added again never purged.
- **Database privileges:** the bot role can use reservations, guards, the blacklist and the installation blacklist, stamp `leftAt` and read the status channel, but cannot read dashboard sessions, staff notes, super-admin audit or `_prisma_migrations`, cannot modify the installation blacklist or the status channel, and has only the form privileges the runtime needs.
- **Bot language:** English and Italian dictionaries with identical keys, server language driving the bot texts with English as the default for new servers, localized main menu defaults, leaderboard titles and form validation.

The tests do not replace a live check on Discord or a verification of the VPS ([DEPLOYMENT.md](DEPLOYMENT.md#first-deployment-checklist)).

## Notes

- `deploy/runtime/harden-users.sh` is the single source of the database hardening script; CI and production run the same file.
- Files under `deploy/`, `ops/` and `security/` are installed on the VPS by `ops/install-vps.sh` and are **not** updated by the application deploy.
- Deployment to the VPS stays disabled until the repository variable `ENABLE_VPS_DEPLOY` is `true`; until then the workflow still builds and pushes the images.
