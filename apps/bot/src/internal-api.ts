import crypto from 'node:crypto';
import http from 'node:http';
import type { Client } from 'discord.js';
import { publishTicketPanel } from './tickets.js';
import {
  addTicketMember,
  assignTicket,
  closeTicket,
  generateTranscript,
  removeTicketMember,
  reopenTicket,
  sendTicketReply,
  setTicketPriority,
  setTicketStatus,
  transferTicketCategory,
  unclaimTicket
} from './ticket-operations.js';

const SNOWFLAKE = /^\d{17,20}$/;
const CUID = /^[a-z0-9]{20,32}$/i;

async function readJson(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16 * 1024) throw new Error('BODY_TOO_LARGE');
    chunks.push(buffer);
  }

  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_BODY');
  return value as Record<string, unknown>;
}

function bodySnowflake(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== 'string' || !SNOWFLAKE.test(value)) throw new Error(`INVALID_${key.toUpperCase()}`);
  return value;
}

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

      match = url.pathname.match(/^\/guilds\/(\d{17,20})\/panels\/([a-z0-9]{20,32})\/publish$/i);
      if (req.method === 'POST' && match) {
        const guildId = match[1]!;
        const panelId = match[2]!;
        if (!SNOWFLAKE.test(guildId) || !CUID.test(panelId)) throw new Error('INVALID_ID');

        const result = await publishTicketPanel(client, guildId, panelId);
        res.end(JSON.stringify(result));
        return;
      }


      match = url.pathname.match(/^\/guilds\/(\d{17,20})\/tickets\/([a-z0-9]{20,32})\/(unclaim|assign|transfer|member-add|member-remove|close|reopen|transcript|status|priority|reply)$/i);
      if (req.method === 'POST' && match) {
        const guildId = match[1]!;
        const ticketId = match[2]!;
        const action = match[3]!;
        if (!SNOWFLAKE.test(guildId) || !CUID.test(ticketId)) throw new Error('INVALID_ID');

        const body = await readJson(req);
        const actorId = bodySnowflake(body, 'actorId');

        let result;
        switch (action) {
          case 'unclaim':
            result = await unclaimTicket(client, guildId, ticketId, actorId);
            break;
          case 'assign':
            result = await assignTicket(client, guildId, ticketId, actorId, bodySnowflake(body, 'assigneeId'));
            break;
          case 'transfer': {
            const categoryId = body.categoryId;
            if (typeof categoryId !== 'string' || !CUID.test(categoryId)) throw new Error('INVALID_CATEGORY_ID');
            result = await transferTicketCategory(client, guildId, ticketId, actorId, categoryId);
            break;
          }
          case 'member-add':
            result = await addTicketMember(client, guildId, ticketId, actorId, bodySnowflake(body, 'userId'));
            break;
          case 'member-remove':
            result = await removeTicketMember(client, guildId, ticketId, actorId, bodySnowflake(body, 'userId'));
            break;
          case 'close': {
            const reason = body.reason;
            if (reason !== undefined && reason !== null && typeof reason !== 'string') throw new Error('INVALID_REASON');
            result = await closeTicket(client, guildId, ticketId, actorId, typeof reason === 'string' ? reason : null);
            break;
          }
          case 'reopen':
            result = await reopenTicket(client, guildId, ticketId, actorId);
            break;
          case 'transcript':
            result = await generateTranscript(client, guildId, ticketId, actorId);
            break;
          case 'status': {
            const status = body.status;
            if (!['OPEN', 'WAITING', 'IN_PROGRESS', 'RESOLVED'].includes(String(status))) {
              throw new Error('INVALID_STATUS');
            }
            result = await setTicketStatus(
              client,
              guildId,
              ticketId,
              actorId,
              status as 'OPEN' | 'WAITING' | 'IN_PROGRESS' | 'RESOLVED'
            );
            break;
          }
          case 'priority': {
            const priority = body.priority;
            if (!['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(String(priority))) {
              throw new Error('INVALID_PRIORITY');
            }
            result = await setTicketPriority(
              client,
              guildId,
              ticketId,
              actorId,
              priority as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
            );
            break;
          }
          case 'reply': {
            const content = body.content;
            const templateId = body.templateId;
            if (typeof content !== 'string' || !content.trim() || content.length > 2000) {
              throw new Error('INVALID_REPLY');
            }
            if (templateId !== undefined && templateId !== null && (typeof templateId !== 'string' || !CUID.test(templateId))) {
              throw new Error('INVALID_TEMPLATE_ID');
            }
            result = await sendTicketReply(
              client,
              guildId,
              ticketId,
              actorId,
              content,
              typeof templateId === 'string' ? templateId : null
            );
            break;
          }
          default:
            throw new Error('ACTION_NOT_ALLOWED');
        }

        res.end(JSON.stringify(result));
        return;
      }

      if (!['GET', 'POST'].includes(req.method ?? '')) {
        res.statusCode = 405;
        res.end('{"error":"METHOD_NOT_ALLOWED"}');
        return;
      }

      res.statusCode = 404;
      res.end('{"error":"NOT_FOUND"}');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
      res.statusCode = message.endsWith('_NOT_FOUND') ? 404
        : message === 'TICKET_CLOSED' || message === 'TICKET_NOT_CLOSED' || message === 'CANNOT_REMOVE_OPENER' ? 409
        : 400;
      res.end(JSON.stringify({ error: message }));
    }
  });

  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 6_000;
  server.requestTimeout = 10_000;
  server.listen(port, '0.0.0.0');
  return server;
}
