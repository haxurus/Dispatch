import fs from 'node:fs';

const required = (name: string) => {
  const file = process.env[`${name}_FILE`]?.trim();
  const value = file ? fs.readFileSync(file, 'utf8').trim() : process.env[name]?.trim();
  if (!value) throw new Error(`Missing secret/config: ${name} or ${name}_FILE`);
  return value;
};

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  internalApiKey: required('BOT_INTERNAL_API_KEY'),
  internalApiPort: Number(process.env.BOT_INTERNAL_PORT ?? 3002),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  // Empty BOT_STATUS_TEXT disables the custom status.
  statusText: (process.env.BOT_STATUS_TEXT ?? 'Discord tickets · dispatch.haxurus.com').trim().slice(0, 128)
};
