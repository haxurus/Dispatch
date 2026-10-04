import crypto from 'node:crypto';
import http from 'node:http';
import type { Client } from 'discord.js';

const SNOWFLAKE = /^\d{17,20}$/;

function authorized(header: string | undefined, secret: string) {
  const expected = `Bearer ${secret}`;
  if (!header || header.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

export function startInternalApi(client: Client, secret: string, port = 3002) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'GET' && req.url === '/healthz') {
      const ready = client.isReady();
      res.statusCode = ready ? 200 : 503;
      res.end(JSON.stringify({ ok: ready, service: 'dispatch-bot', guilds: client.guilds.cache.size }));
      return;
    }

    if (!authorized(req.headers.authorization, secret)) {
      res.statusCode = 401;
      res.end('{"error":"UNAUTHORIZED"}');
      return;
    }

    try {
      const url = new URL(req.url ?? '/', 'http://internal');

      let match = url.pathname.match(/^\/guilds\/(\d{17,20})\/resources$/);
      if (req.method === 'GET' && match) {
        const guildId = match[1]!;
        const guild = client.guilds.cache.get(guildId);
        if (!guild) throw new Error('GUILD_NOT_FOUND');

        const [channels, roles] = await Promise.all([
          guild.channels.fetch(),
          guild.roles.fetch()
        ]);

        res.end(JSON.stringify({
          channels: [...channels.values()]
            .filter(Boolean)
            .map((channel: any) => ({
              id: channel.id,
              name: channel.name,
              type: channel.type,
              parentId: channel.parentId ?? null,
              position: channel.position ?? 0
            }))
            .sort((a, b) => a.position - b.position),
          roles: [...roles.values()]
            .map((role) => ({
              id: role.id,
              name: role.name,
              color: role.color,
              position: role.position,
              permissions: role.permissions.bitfield.toString()
            }))
            .sort((a, b) => b.position - a.position)
        }));
        return;
      }

      match = url.pathname.match(/^\/guilds\/(\d{17,20})\/members\/(\d{17,20})\/access$/);
      if (req.method === 'GET' && match) {
        const guildId = match[1]!;
        const userId = match[2]!;
        if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(userId)) throw new Error('INVALID_ID');

        const guild = client.guilds.cache.get(guildId);
        if (!guild) throw new Error('GUILD_NOT_FOUND');

        const member = await guild.members.fetch(userId);
        res.end(JSON.stringify({
          owner: guild.ownerId === userId,
          permissions: member.permissions.bitfield.toString(),
          roles: [...member.roles.cache.keys()]
        }));
        return;
      }

      res.statusCode = 404;
      res.end('{"error":"NOT_FOUND"}');
    } catch (error) {
      res.statusCode = 404;
      res.end(JSON.stringify({
        error: error instanceof Error ? error.message : 'INTERNAL_ERROR'
      }));
    }
  });

  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 6_000;
  server.requestTimeout = 10_000;
  server.listen(port, '0.0.0.0');
  return server;
}
