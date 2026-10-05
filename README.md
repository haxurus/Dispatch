# Dispatch

Dispatch is a self-hosted Discord ticket management platform with a Discord bot, administrative web dashboard, API, PostgreSQL persistence, Redis-backed jobs, and hardened production deployment.

> Production repository. Discord tokens, OAuth secrets, database passwords, encryption keys, session secrets, and deployment private keys must never be committed to GitHub.

## Components

- `apps/bot` - Discord Gateway client and ticket interactions.
- `apps/api` - Discord OAuth2, RBAC, ticket configuration, transcripts, search, and administration.
- `apps/web` - Next.js dashboard.
- `packages/db` - Prisma/PostgreSQL schema and migrations.
- `packages/shared` - shared types and constants.
- `deploy` - production Docker Compose and edge configuration.
- `ops` - restricted VPS deployment and rollback tooling.
- `security` - host-side Docker egress hardening.

## Architecture

Production follows the same deployment model used by Sentinel:

```text
GitHub
  |
  v
GitHub Actions
  |
  +--> build runtime image
  +--> build migration image
  +--> SBOM + provenance
  +--> push GHCR
  |
  v
restricted SSH deploy user
  |
  v
/srv/docker/dispatch
  |
  +--> pre-deploy database backup
  +--> pull immutable images by SHA-256 digest
  +--> run migrations
  +--> start stack
  +--> health checks
  +--> rollback on failure
```

Application secrets stay on the VPS and are not passed through GitHub Actions.

## Initial scope

The first application milestone will provide:

- configurable ticket panels;
- ticket creation through Discord components;
- categories and per-category permissions;
- claim and unclaim;
- close and reopen;
- transcripts;
- staff audit trail;
- Discord OAuth2 dashboard;
- server-side RBAC.

## Local development

Requirements:

- Node.js 22+
- Docker + Docker Compose
- a Discord test application

```bash
npm install
npm run db:generate
npm run build
```

For the local hardened stack:

```bash
cp .env.example .env
mkdir -p secrets
# Populate the required secret files.
docker compose up -d --build
```

## Production

Production deployment is intentionally separate from local development. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for VPS installation, secrets, Nginx Proxy Manager, the GitHub `production` environment, deploy, rollback and restore.
