import fs from 'node:fs';

const required = (name: string) => {
  const file = process.env[`${name}_FILE`]?.trim();
  const value = file ? fs.readFileSync(file, 'utf8').trim() : process.env[name]?.trim();
  if (!value) throw new Error(`Missing secret/config: ${name} or ${name}_FILE`);
  return value;
};

const optional = (name: string) => {
  const file = process.env[`${name}_FILE`]?.trim();
  return (file ? fs.readFileSync(file, 'utf8').trim() : process.env[name]?.trim()) ?? '';
};

const SNOWFLAKE = /^\d{17,20}$/;

// Single instance owner allowed into the super console. Empty = no super admin
// (the console and its API answer 403 to everyone). Fails closed at boot on a
// malformed value instead of silently granting nothing.
const superAdminUserId = optional('SUPER_ADMIN_USER_ID');
if (superAdminUserId && !SNOWFLAKE.test(superAdminUserId)) {
  throw new Error('SUPER_ADMIN_USER_ID must be a Discord user ID (17-20 digits) or empty');
}

// Accounts (besides the super admin) allowed to add the hosted bot to new servers.
const inviteAllowedUserIds = optional('INVITE_ALLOWED_USER_IDS')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
if (inviteAllowedUserIds.some((value) => !SNOWFLAKE.test(value))) {
  throw new Error('INVITE_ALLOWED_USER_IDS must contain comma-separated Discord user IDs');
}

const production = process.env.NODE_ENV === 'production';
const publicBaseUrl = required('PUBLIC_BASE_URL');
const webUrl = required('WEB_URL');
const sessionSecret = required('SESSION_SECRET');
const encryptionKey = required('DATA_ENCRYPTION_KEY');

if (production) {
  if (!publicBaseUrl.startsWith('https://') || !webUrl.startsWith('https://')) {
    throw new Error('PUBLIC_BASE_URL and WEB_URL must use HTTPS in production');
  }
  if (sessionSecret.length < 48) throw new Error('SESSION_SECRET must be at least 48 characters');
  if (Buffer.from(encryptionKey, 'base64').length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be 32 random bytes encoded as base64');
  }
}

export const config = {
  clientId: required('DISCORD_CLIENT_ID'),
  clientSecret: required('DISCORD_CLIENT_SECRET'),
  publicBaseUrl,
  webUrl,
  sessionSecret,
  superAdminUserId,
  inviteAllowedUserIds,
  port: Number(process.env.PORT ?? 3001),
  production
};
