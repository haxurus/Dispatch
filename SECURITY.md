# Security Policy

## Reporting vulnerabilities

Do not publish tokens, credentials, database dumps, ticket transcripts, sensitive logs, or working exploit details in public issues.

Report vulnerabilities privately through GitHub: **[Report a vulnerability](https://github.com/haxurus/Dispatch/security/advisories/new)** (Security → Advisories). If you cannot use GitHub, write to haxurus@icloud.com. Please allow time for a fix before any public disclosure.

In case of a suspected compromise:

1. temporarily disable automatic deployment by setting `ENABLE_VPS_DEPLOY=false`;
2. rotate affected Discord tokens, OAuth secrets, the bot internal API key and deployment keys;
3. revoke dashboard sessions;
4. inspect host/container logs;
5. restore from a known-good release and backup.

The security model is described in [docs/SECURITY.md](docs/SECURITY.md).

## Secrets

Never commit:

- real `.env` files;
- `secrets/*`;
- Discord tokens;
- OAuth client secrets;
- PostgreSQL passwords;
- `data_encryption_key`, `session_secret`, `bot_internal_api_key`;
- private SSH keys;
- database dumps, transcripts or log exports.

The repository contains only example files without real credentials.
