import { Client, GatewayIntentBits } from 'discord.js';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const tokenFile = process.env.DISCORD_TOKEN_FILE;
if (!tokenFile) throw new Error('DISCORD_TOKEN_FILE is required');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once('ready', () => log.info({ user: client.user?.tag }, 'Dispatch bot ready'));

const port = Number(process.env.BOT_INTERNAL_PORT ?? 3002);
createServer((_req, res) => {
  res.writeHead(client.isReady() ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: client.isReady() }));
}).listen(port, '0.0.0.0');

await client.login(readFileSync(tokenFile, 'utf8').trim());
