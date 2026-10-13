import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@dispatch/db';
import { config } from './config.js';
import { requireSession, type SessionInfo } from './auth.js';
import {
  getBotGuilds,
  getBotStatus,
  getGuildResources,
  leaveBotGuild,
  refreshStatusChannel,
  sendStatusTest,
  type BotGuild,
  type BotStatus
} from './discord.js';
import { superAdminAudit, type SuperAuditSubject } from './super-audit.js';
import { unprotectJson } from './security.js';
import { planOverview } from './plan-routes.js';

/*
 * Super console: instance-owner endpoints plus the public bot invite.
 *
 * Every route re-checks the super admin on the server (the UI flag from
 * /api/me only toggles a nav link). Mutations additionally go through a
 * per-session budget and are written to SuperAdminAudit. CSRF (Origin check),
 * Cache-Control: no-store, the global rate limit and the guildId snowflake
 * preValidation are inherited from the root hooks registered in index.ts.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);
// Text and announcement channels: the only ones a status embed can go to.
const SENDABLE_CHANNEL_TYPES = new Set([0, 5]);
const blockParams = z.object({ kind: z.enum(['USER', 'GUILD']), subjectId: snowflake });
const blockBody = z.object({ reason: z.string().trim().max(500).nullable().optional() });

/** Ticket states that still need staff attention (everything but CLOSED). */
const OPEN_TICKET_STATUSES: string[] = ['OPEN', 'WAITING', 'IN_PROGRESS', 'RESOLVED', 'REOPENING'];

/*
 * Permissions requested when the hosted bot is installed. Must stay in sync
 * with docs/DEPLOYMENT.md and the Developer Portal install link: View
 * Channels, Manage Channels, Manage Roles, Change Nickname (Brand plan bot
 * nickname), Send Messages, Manage Messages, Embed Links, Attach Files, Read
 * Message History, Manage Threads, Create Private Threads, Send Messages in
 * Threads (private staff threads: the bot can only grant in channel
 * overwrites what it has itself). Bitfield 361112923152.
 */
const INSTALL_PERMISSIONS = [
  1n << 10n, // View Channels
  1n << 4n, // Manage Channels
  1n << 28n, // Manage Roles
  1n << 26n, // Change Nickname
  1n << 11n, // Send Messages
  1n << 13n, // Manage Messages
  1n << 14n, // Embed Links
  1n << 15n, // Attach Files
  1n << 16n, // Read Message History
  1n << 34n, // Manage Threads
  1n << 36n, // Create Private Threads
  1n << 38n // Send Messages in Threads
].reduce((all, flag) => all | flag, 0n);

const botInstallUrl = () =>
  `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(config.clientId)}` +
  `&scope=bot%20applications.commands&permissions=${INSTALL_PERMISSIONS.toString()}`;

export function isSuperAdminUserId(userId: string) {
  return Boolean(config.superAdminUserId) && userId === config.superAdminUserId;
}

export async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply) {
  const session = await requireSession(request, reply);
  if (!session) return null;
  if (!isSuperAdminUserId(session.userId)) {
    reply.code(403).send({ error: 'SUPER_ADMIN_REQUIRED' });
    return null;
  }
  return session;
}

// Per-session mutation budget (in memory, single API replica): 30 changes/minute.
const MUTATION_LIMIT = 30;
const MUTATION_WINDOW_MS = 60_000;
const mutationBudgets = new Map<string, number[]>();

function consumeMutationBudget(sessionId: string) {
  const now = Date.now();
  const recent = (mutationBudgets.get(sessionId) ?? []).filter((at) => now - at < MUTATION_WINDOW_MS);
  if (recent.length >= MUTATION_LIMIT) {
    mutationBudgets.set(sessionId, recent);
    return false;
  }
  recent.push(now);
  mutationBudgets.set(sessionId, recent);

  if (mutationBudgets.size > 500) {
    for (const [key, stamps] of mutationBudgets) {
      if (!stamps.some((at) => now - at < MUTATION_WINDOW_MS)) mutationBudgets.delete(key);
    }
  }
  return true;
}

export async function requireSuperMutation(request: FastifyRequest, reply: FastifyReply) {
  const session = await requireSuperAdmin(request, reply);
  if (!session) return null;
  if (!consumeMutationBudget(session.id)) {
    reply.code(429).send({ error: 'RATE_LIMITED' });
    return null;
  }
  return session;
}

/** A failed audit write is logged loudly but never undoes or fails the action. */
async function audit(
  request: FastifyRequest,
  session: SessionInfo,
  action: string,
  subjectType: SuperAuditSubject | null,
  subjectId: string | null,
  details: Record<string, unknown> = {}
) {
  try {
    await superAdminAudit(request, session, action, subjectType, subjectId, details);
  } catch (error) {
    request.log.error({ err: error, action, subjectType, subjectId }, 'Super-admin audit write failed');
  }
}

const errorStatus = (error: unknown) => (error as { status?: unknown }).status;

export function registerSuperRoutes(app: FastifyInstance) {
  // The hosted bot is open to every server: the website's "Add" buttons land
  // here and go straight to Discord's authorisation page. Blacklisted servers
  // and installers are left by the bot on join (InstallBlock).
  app.get('/bot/invite', async (_request, reply) => reply.redirect(botInstallUrl()));

  app.get('/api/super/overview', async (request, reply) => {
    const session = await requireSuperAdmin(request, reply);
    if (!session) return;

    const [botGuilds, botStatus] = await Promise.all([
      getBotGuilds().then(
        (guilds): { reachable: boolean; guilds: BotGuild[] } => ({ reachable: true, guilds }),
        (error: unknown) => {
          request.log.warn({ err: error }, 'Bot guild list unavailable');
          return { reachable: false, guilds: [] as BotGuild[] };
        }
      ),
      getBotStatus().catch((): BotStatus | null => null)
    ]);

    const guildIds = botGuilds.guilds.map((guild) => guild.id);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const openByGuild = await prisma.ticket.groupBy({
      by: ['guildId'],
      where: { guildId: { in: guildIds }, status: { in: OPEN_TICKET_STATUSES } },
      _count: { _all: true }
    });
    const totalByGuild = await prisma.ticket.groupBy({
      by: ['guildId'],
      where: { guildId: { in: guildIds } },
      _count: { _all: true }
    });

    const [openTickets, ticketsLast7Days, forms, guildBlacklistEntries, blocks, auditRows, settings, statusChannel] = await Promise.all([
      prisma.ticket.count({ where: { status: { in: OPEN_TICKET_STATUSES } } }),
      prisma.ticket.count({ where: { createdAt: { gte: since } } }),
      prisma.formDefinition.count(),
      prisma.guildBlacklist.count(),
      prisma.installBlock.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
      prisma.superAdminAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
      prisma.guildSettings.findMany({
        where: { guildId: { in: guildIds } },
        select: { guildId: true, createdAt: true }
      }),
      // Until the VPS installer is re-run, the API role may lack the grant on
      // the new table: the console must keep working without the status channel.
      prisma.statusChannel.findUnique({ where: { id: 1 }, select: { guildId: true, channelId: true, updatedAt: true } })
        .catch(() => null)
    ]);
    // Plans, coupons and contacts (tables added with the plans migration).
    const plans = await planOverview(guildIds).catch((error: unknown) => {
      request.log.warn({ err: error }, 'Plan overview unavailable');
      return null;
    });

    const openMap = new Map(openByGuild.map((row) => [row.guildId, row._count._all]));
    const totalMap = new Map(totalByGuild.map((row) => [row.guildId, row._count._all]));
    const installedMap = new Map(settings.map((row) => [row.guildId, row.createdAt]));
    const blockedGuilds = new Set(blocks.filter((block) => block.kind === 'GUILD').map((block) => block.subjectId));

    return {
      bot: { reachable: botGuilds.reachable, status: botStatus },
      metrics: {
        connectedGuilds: botGuilds.guilds.length,
        openTickets,
        ticketsLast7Days,
        forms,
        guildBlacklistEntries,
        installBlocks: blocks.length
      },
      guilds: botGuilds.guilds.map((guild) => ({
        ...guild,
        installedAt: installedMap.get(guild.id)?.toISOString() ?? guild.joinedAt,
        openTickets: openMap.get(guild.id) ?? 0,
        totalTickets: totalMap.get(guild.id) ?? 0,
        blocked: blockedGuilds.has(guild.id)
      })),
      blocks,
      statusChannel,
      plans,
      audit: auditRows.map((row) => {
        let details: unknown = null;
        try {
          details = unprotectJson(row.details);
        } catch {
          details = null;
        }
        return { ...row, details };
      })
    };
  });

  app.put('/api/super/blocks/:kind/:subjectId', async (request, reply) => {
    const session = await requireSuperMutation(request, reply);
    if (!session) return;

    const params = blockParams.safeParse(request.params);
    const body = blockBody.safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ error: 'INVALID_BLOCK_REQUEST' });

    const { kind, subjectId } = params.data;
    if (kind === 'USER' && isSuperAdminUserId(subjectId)) {
      return reply.code(400).send({ error: 'CANNOT_BLOCK_SUPER_ADMIN' });
    }

    const reason = body.data.reason || null;
    const block = await prisma.installBlock.upsert({
      where: { kind_subjectId: { kind, subjectId } },
      update: { reason, createdByUserId: session.userId },
      create: { kind, subjectId, reason, createdByUserId: session.userId }
    });

    let left = false;
    let leaveError: string | null = null;
    if (kind === 'GUILD') {
      try {
        await leaveBotGuild(subjectId);
        left = true;
      } catch (error) {
        // 404: the bot is not in that guild (yet); the block still applies on join.
        if (errorStatus(error) !== 404) {
          leaveError = 'BOT_UNAVAILABLE';
          request.log.warn({ err: error, guildId: subjectId }, 'Unable to leave blocked guild immediately');
        }
      }
    }

    await audit(request, session, 'install_block.upsert', kind, subjectId, { reason, left, leaveError });
    return { ok: true, block, left, leaveError };
  });

  app.delete('/api/super/blocks/:kind/:subjectId', async (request, reply) => {
    const session = await requireSuperMutation(request, reply);
    if (!session) return;

    const params = blockParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_BLOCK_REQUEST' });

    const { kind, subjectId } = params.data;
    const removed = await prisma.installBlock.deleteMany({ where: { kind, subjectId } });
    await audit(request, session, 'install_block.delete', kind, subjectId, { removed: removed.count });
    return { ok: true, removed: removed.count };
  });

  app.post('/api/super/guilds/:guildId/leave', async (request, reply) => {
    const session = await requireSuperMutation(request, reply);
    if (!session) return;

    const params = z.object({ guildId: snowflake }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_DISCORD_ID', field: 'guildId' });
    const { guildId } = params.data;

    try {
      await leaveBotGuild(guildId);
    } catch (error) {
      if (errorStatus(error) === 404) {
        await audit(request, session, 'guild.leave', 'GUILD', guildId, { outcome: 'not_connected' });
        return reply.code(404).send({ error: 'GUILD_NOT_CONNECTED' });
      }
      request.log.error({ err: error, guildId }, 'Super console leave failed');
      await audit(request, session, 'guild.leave', 'GUILD', guildId, { outcome: 'failed' });
      return reply.code(502).send({ error: 'BOT_UNAVAILABLE' });
    }

    await audit(request, session, 'guild.leave', 'GUILD', guildId, { outcome: 'ok' });
    return { ok: true, guildId };
  });

  // ------------------------------------------------------- status channel
  // Where the bot posts instance notices: startup, servers added or removed,
  // rejected installations.
  app.get('/api/super/status-channel/channels', async (request, reply) => {
    const session = await requireSuperAdmin(request, reply);
    if (!session) return;
    const parsed = z.object({ guildId: snowflake }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY' });
    try {
      const resources = await getGuildResources(parsed.data.guildId);
      return resources.channels
        .filter((channel) => SENDABLE_CHANNEL_TYPES.has(channel.type))
        .sort((a, b) => a.position - b.position)
        .map((channel) => ({ id: channel.id, name: channel.name, type: channel.type }));
    } catch (error) {
      if (errorStatus(error) === 404) return reply.code(404).send({ error: 'GUILD_NOT_CONNECTED' });
      request.log.warn({ err: error }, 'Unable to list status channel candidates');
      return reply.code(502).send({ error: 'BOT_UNAVAILABLE' });
    }
  });

  app.put('/api/super/status-channel', async (request, reply) => {
    const session = await requireSuperMutation(request, reply);
    if (!session) return;
    const parsed = z.object({ guildId: snowflake, channelId: snowflake }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });
    const { guildId, channelId } = parsed.data;
    try {
      const resources = await getGuildResources(guildId);
      if (!resources.channels.some((channel) => channel.id === channelId && SENDABLE_CHANNEL_TYPES.has(channel.type))) {
        return reply.code(400).send({ error: 'CHANNEL_NOT_FOUND' });
      }
    } catch (error) {
      if (errorStatus(error) === 404) return reply.code(404).send({ error: 'GUILD_NOT_CONNECTED' });
      request.log.warn({ err: error }, 'Unable to verify status channel');
      return reply.code(502).send({ error: 'BOT_UNAVAILABLE' });
    }
    const row = await prisma.statusChannel.upsert({
      where: { id: 1 },
      update: { guildId, channelId, updatedByUserId: session.userId },
      create: { id: 1, guildId, channelId, updatedByUserId: session.userId }
    });
    await refreshStatusChannel().catch(() => null);
    await audit(request, session, 'status_channel.update', 'GUILD', guildId, { channelId });
    return { ok: true, statusChannel: { guildId: row.guildId, channelId: row.channelId, updatedAt: row.updatedAt } };
  });

  app.delete('/api/super/status-channel', async (request, reply) => {
    const session = await requireSuperMutation(request, reply);
    if (!session) return;
    const removed = await prisma.statusChannel.deleteMany({ where: { id: 1 } });
    await refreshStatusChannel().catch(() => null);
    await audit(request, session, 'status_channel.delete', null, null, { removed: removed.count });
    return { ok: true };
  });

  app.post('/api/super/status-channel/test', async (request, reply) => {
    const session = await requireSuperMutation(request, reply);
    if (!session) return;
    try {
      return await sendStatusTest();
    } catch (error) {
      request.log.warn({ err: error }, 'Status test failed');
      return reply.code(502).send({ error: 'BOT_UNAVAILABLE' });
    }
  });
}
