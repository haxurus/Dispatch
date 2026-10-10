import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@dispatch/db';
import { config } from './config.js';
import { getSession, requireSession, type SessionInfo } from './auth.js';
import {
  getBotGuilds,
  getBotStatus,
  leaveBotGuild,
  type BotGuild,
  type BotStatus
} from './discord.js';
import { superAdminAudit, type SuperAuditSubject } from './super-audit.js';
import { unprotectJson } from './security.js';

/*
 * Super console: instance-owner endpoints plus the gated bot invite.
 *
 * Every route re-checks the super admin on the server (the UI flag from
 * /api/me only toggles a nav link). Mutations additionally go through a
 * per-session budget and are written to SuperAdminAudit. CSRF (Origin check),
 * Cache-Control: no-store, the global rate limit and the guildId snowflake
 * preValidation are inherited from the root hooks registered in index.ts.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);
const blockParams = z.object({ kind: z.enum(['USER', 'GUILD']), subjectId: snowflake });
const blockBody = z.object({ reason: z.string().trim().max(500).nullable().optional() });

/** Ticket states that still need staff attention (everything but CLOSED). */
const OPEN_TICKET_STATUSES: string[] = ['OPEN', 'WAITING', 'IN_PROGRESS', 'RESOLVED', 'REOPENING'];

/*
 * Permissions requested when the hosted bot is installed. Must stay in sync
 * with docs/DEPLOYMENT.md: View Channels, Manage Channels, Manage Roles,
 * Send Messages, Manage Messages, Embed Links, Attach Files, Read Message
 * History, Manage Threads, Create Private Threads, Send Messages in Threads
 * (private staff threads: the bot can only grant in channel overwrites what
 * it has itself). Bitfield 361045814288.
 */
const INSTALL_PERMISSIONS = [
  1n << 10n, // View Channels
  1n << 4n, // Manage Channels
  1n << 28n, // Manage Roles
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

async function requireSuperMutation(request: FastifyRequest, reply: FastifyReply) {
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

async function isUserInstallBlocked(userId: string) {
  const block = await prisma.installBlock.findUnique({
    where: { kind_subjectId: { kind: 'USER', subjectId: userId } },
    select: { id: true }
  });
  return Boolean(block);
}

async function canInstallBot(userId: string) {
  // The super admin can never be blocked (PUT refuses it), so it can always install.
  if (isSuperAdminUserId(userId)) return true;
  if (!config.inviteAllowedUserIds.includes(userId)) return false;
  return !(await isUserInstallBlocked(userId));
}

export function registerSuperRoutes(app: FastifyInstance) {
  app.get('/bot/invite', async (request, reply) => {
    const query = z.object({ lang: z.enum(['it', 'en']).optional() }).safeParse(request.query);
    const lang = query.success ? (query.data.lang ?? 'it') : 'it';

    const session = await getSession(request);
    if (!session) {
      // Sign in first; the OAuth callback lands on the dashboard, where the
      // "Aggiungi a Discord" action is available again.
      return reply.redirect(`${config.publicBaseUrl}/auth/discord`);
    }

    if (!(await canInstallBot(session.userId))) {
      return reply.redirect(`${config.webUrl}/${lang}/development`);
    }

    return reply.redirect(botInstallUrl());
  });

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

    const [openTickets, ticketsLast7Days, forms, guildBlacklistEntries, blocks, auditRows, settings] = await Promise.all([
      prisma.ticket.count({ where: { status: { in: OPEN_TICKET_STATUSES } } }),
      prisma.ticket.count({ where: { createdAt: { gte: since } } }),
      prisma.formDefinition.count(),
      prisma.guildBlacklist.count(),
      prisma.installBlock.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
      prisma.superAdminAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
      prisma.guildSettings.findMany({
        where: { guildId: { in: guildIds } },
        select: { guildId: true, createdAt: true }
      })
    ]);

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
}
