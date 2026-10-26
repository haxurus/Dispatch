import crypto from 'node:crypto';
import http from 'node:http';
import { EmbedBuilder, Routes, type APIEntitlement, type Client } from 'discord.js';
import { publishMainMenu, publishTicketPanel } from './tickets.js';
import { publishFormPanel } from './forms.js';
import { LEADERBOARD_LIMITS, LOG_LEVEL_RANK, parseBlacklistLogPayload, type LogLevelName } from '@dispatch/shared';
import { logBlacklistEvent, sendTicketLogTest } from './ticket-log.js';
import { sendLeaderboardNow } from './leaderboard.js';
import { sendToChannel, type StatusNotifier } from './status.js';
import { logBuffer } from './logger.js';
import { redactText } from './security.js';
import {
  addTicketMember,
  assignTicket,
  closeTicket,
  deleteTicketChannel,
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
const BANNER_URI = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const CUID = /^[a-z0-9]{20,32}$/i;
const MAX_ENTITLEMENT_PAGES = 50;

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/**
 * Active (not ended, not deleted) entitlements of the application, through a
 * read-only REST call, for the API's plan sync. The buyer's user ID is not
 * passed on.
 */
async function activeEntitlements(client: Client) {
  const applicationId = client.application?.id ?? client.user?.id;
  if (!applicationId) throw new Error('APPLICATION_UNAVAILABLE');
  const result: Array<{ id: string; skuId: string; guildId: string | null; type: number; startsAt: string | null; endsAt: string | null }> = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_ENTITLEMENT_PAGES; page += 1) {
    const query = new URLSearchParams({ exclude_ended: 'true', exclude_deleted: 'true', limit: '100' });
    if (after) query.set('after', after);
    const rows = await client.rest.get(Routes.entitlements(applicationId), { query }) as APIEntitlement[];
    for (const row of rows) {
      if (row.deleted) continue;
      result.push({ id: row.id, skuId: row.sku_id, guildId: row.guild_id ?? null, type: row.type, startsAt: row.starts_at ?? null, endsAt: row.ends_at ?? null });
    }
    if (rows.length < 100) return result;
    // Pages are ordered by ID; continue after the highest one seen.
    after = rows.reduce((max, row) => (BigInt(row.id) > BigInt(max) ? row.id : max), rows[0]!.id);
  }
  throw new Error('TOO_MANY_ENTITLEMENTS');
}

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
  if (!header) return false;
  // Fixed-length digests: never throws on byte-length mismatch and leaks no length.
  const digest = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest();
  return crypto.timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export function startInternalApi(client: Client, secret: string, port = 3002, status?: StatusNotifier) {
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

      // Super console: bot readiness for the overview.
      if (req.method === 'GET' && url.pathname === '/status') {
        const ready = client.isReady();
        const user = client.user;
        res.end(JSON.stringify({
          ready,
          uptimeMs: client.uptime ?? null,
          readyAt: client.readyAt?.toISOString() ?? null,
          guildCount: client.guilds.cache.size,
          pingMs: ready && client.ws.ping >= 0 ? Math.round(client.ws.ping) : null,
          user: user ? { id: user.id, username: user.username, avatarUrl: user.displayAvatarURL({ size: 64 }) } : null
        }));
        return;
      }

      // Super console: live list of the guilds the bot is connected to.
      if (req.method === 'GET' && url.pathname === '/guilds') {
        const guilds = [...client.guilds.cache.values()]
          .map((guild) => ({
            id: guild.id,
            name: guild.name,
            iconUrl: guild.iconURL({ size: 128 }),
            memberCount: guild.memberCount,
            ownerId: guild.ownerId,
            joinedAt: guild.joinedAt?.toISOString() ?? null
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        res.end(JSON.stringify(guilds));
        return;
      }

      // Super console: test message and cache refresh for the status channel.
      if (req.method === 'POST' && url.pathname === '/status/test') {
        if (!status) throw new Error('STATUS_UNAVAILABLE');
        status.invalidate();
        const result = await status.deliver({ level: 'info', category: 'availability', severity: 'info', key: 'status.test' });
        res.end(JSON.stringify(result));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/status/refresh') {
        status?.invalidate();
        res.end('{"ok":true}');
        return;
      }

      // Super console → Logs: the latest lines kept in memory (already redacted).
      if (req.method === 'GET' && url.pathname === '/logs') {
        const requested = url.searchParams.get('level') ?? 'info';
        const level = (requested in LOG_LEVEL_RANK ? requested : 'info') as LogLevelName;
        const limit = Math.min(1_000, Math.max(1, Number(url.searchParams.get('limit')) || 500));
        res.end(JSON.stringify(logBuffer.list(level, limit)));
        return;
      }

      // Discord subscriptions for the API's plan sync.
      if (req.method === 'GET' && url.pathname === '/entitlements') {
        res.end(JSON.stringify(await activeEntitlements(client)));
        return;
      }

      // Instance alerts routed by the API (super console → Monitoring).
      if (req.method === 'POST' && url.pathname === '/alerts/deliver') {
        const body = await readJson(req);
        const guildId = bodySnowflake(body, 'guildId');
        const channelId = bodySnowflake(body, 'channelId');
        const mention = body.mentionUserId == null ? null : bodySnowflake(body, 'mentionUserId');
        const embed = new EmbedBuilder()
          .setTitle(clip(String(body.title ?? 'Dispatch'), 256))
          .setColor(Number(body.color) || 0x38bdf8)
          .setFooter({ text: clip(String(body.footer ?? 'Dispatch'), 200) })
          .setTimestamp(new Date());
        if (body.description) embed.setDescription(clip(redactText(String(body.description)), 4000));
        const fields = Array.isArray(body.fields) ? body.fields as Array<{ name?: unknown; value?: unknown }> : [];
        const safeFields = fields.filter((field) => field?.value).slice(0, 20)
          .map((field) => ({ name: clip(String(field.name ?? '—'), 256), value: clip(redactText(String(field.value)), 1024), inline: true }));
        if (safeFields.length) embed.addFields(safeFields);
        try {
          await sendToChannel(client, guildId, channelId, embed, mention);
        } catch (error) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 64) : 'SEND_FAILED' }));
          return;
        }
        res.end('{"ok":true}');
        return;
      }

      let match = url.pathname.match(/^\/guilds\/(\d{17,20})\/branding$/);
      // Brand plan (checked by the API): the bot's own nickname and banner on one server.
      if (req.method === 'POST' && match) {
        const guildId = match[1]!;
        if (!client.guilds.cache.has(guildId)) throw new Error('GUILD_NOT_FOUND');
        const body = await readJson(req);
        const profile: { nick?: string | null; banner?: string | null } = {};
        if ('nick' in body) {
          if (body.nick !== null && (typeof body.nick !== 'string' || !body.nick.trim() || body.nick.length > 32)) throw new Error('INVALID_NICKNAME');
          profile.nick = body.nick === null ? null : (body.nick as string).trim();
        }
        if ('banner' in body) {
          if (body.banner !== null && (typeof body.banner !== 'string' || !BANNER_URI.test(body.banner))) throw new Error('INVALID_BANNER');
          profile.banner = body.banner as string | null;
        }
        try {
          await client.rest.patch(Routes.guildMember(guildId, '@me'), { body: profile });
        } catch (error) {
          const code = Number((error as { code?: unknown }).code);
          throw new Error(code === 50013 || code === 50001 ? 'BRANDING_MISSING_PERMISSION' : 'BRANDING_FAILED');
        }
        res.end(JSON.stringify({ ok: true, guildId }));
        return;
      }

      match = url.pathname.match(/^\/guilds\/(\d{17,20})\/leave$/);
      if (req.method === 'POST' && match) {
        const guildId = match[1]!;
        if (!SNOWFLAKE.test(guildId)) throw new Error('INVALID_ID');

        const guild = client.guilds.cache.get(guildId);
        if (!guild) throw new Error('GUILD_NOT_FOUND');

        await guild.leave();
        res.end(JSON.stringify({ ok: true, guildId }));
        return;
      }

      match = url.pathname.match(/^\/guilds\/(\d{17,20})\/resources$/);
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
              permissions: role.permissions.bitfield.toString(),
              managed: role.managed
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

      match = url.pathname.match(/^\/guilds\/(\d{17,20})\/main-menu\/publish$/i);
      if (req.method === 'POST' && match) {
        const guildId = match[1]!;
        if (!SNOWFLAKE.test(guildId)) throw new Error('INVALID_ID');

        const result = await publishMainMenu(client, guildId);
        res.end(JSON.stringify(result));
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


      match = url.pathname.match(/^\/guilds\/(\d{17,20})\/form-panels\/([a-z0-9]{20,32})\/publish$/i);
      if (req.method === 'POST' && match) {
        const guildId = match[1]!;
        const panelId = match[2]!;
        if (!SNOWFLAKE.test(guildId) || !CUID.test(panelId)) throw new Error('INVALID_ID');

        const result = await publishFormPanel(client, guildId, panelId);
        res.end(JSON.stringify(result));
        return;
      }


      match = url.pathname.match(/^\/guilds\/(\d{17,20})\/ticket-log\/test$/);
      if (req.method === 'POST' && match) {
        const guildId = match[1]!;
        if (!SNOWFLAKE.test(guildId)) throw new Error('INVALID_ID');
        const body = await readJson(req);
        const result = await sendTicketLogTest(client, guildId, bodySnowflake(body, 'actorId'));
        res.end(JSON.stringify(result));
        return;
      }

      // Events that happen only in the API (BLACKLIST). Structured payload
      // only: no free text ever reaches the log channel through this route.
      match = url.pathname.match(/^\/guilds\/(\d{17,20})\/ticket-log\/event$/);
      if (req.method === 'POST' && match) {
        const guildId = match[1]!;
        if (!SNOWFLAKE.test(guildId)) throw new Error('INVALID_ID');
        const payload = parseBlacklistLogPayload(await readJson(req));
        const sent = await logBlacklistEvent(client, guildId, payload);
        res.end(JSON.stringify({ ok: true, sent }));
        return;
      }

      // Dashboard "Invia ora": { actorId, period: 'week' | 'month', offset }.
      // Posts the leaderboard without touching the scheduler period keys.
      match = url.pathname.match(/^\/guilds\/(\d{17,20})\/leaderboard\/send$/);
      if (req.method === 'POST' && match) {
        const guildId = match[1]!;
        if (!SNOWFLAKE.test(guildId)) throw new Error('INVALID_ID');
        const body = await readJson(req);
        if (Object.keys(body).some((key) => !['actorId', 'period', 'offset'].includes(key))) throw new Error('INVALID_BODY');
        bodySnowflake(body, 'actorId');
        const period = body.period;
        if (period !== 'week' && period !== 'month') throw new Error('INVALID_PERIOD');
        const offset = body.offset ?? 1;
        if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > LEADERBOARD_LIMITS.maxOffset) {
          throw new Error('INVALID_OFFSET');
        }
        const result = await sendLeaderboardNow(client, guildId, period === 'week' ? 'week' : 'month', offset);
        res.end(JSON.stringify(result));
        return;
      }

      match = url.pathname.match(/^\/guilds\/(\d{17,20})\/tickets\/([a-z0-9]{20,32})\/(unclaim|assign|transfer|member-add|member-remove|close|reopen|transcript|status|priority|reply|delete-channel)$/i);
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
          case 'delete-channel':
            result = await deleteTicketChannel(client, guildId, ticketId, actorId);
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
      // Only stable codes leave the bot; Prisma/Discord exception text stays internal.
      const raw = error instanceof Error ? error.message : '';
      const message = /^[A-Z][A-Z0-9_]{1,63}$/.test(raw) ? raw : 'INTERNAL_ERROR';
      res.statusCode = message.endsWith('_NOT_FOUND') ? 404
        : message === 'TICKET_CLOSED' || message === 'TICKET_NOT_CLOSED' || message === 'TICKET_REOPENING'
          || message === 'CANNOT_REMOVE_OPENER' || message === 'TICKET_CHANNEL_DELETED'
          || message === 'TICKET_STATE_CONFLICT' ? 409
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
