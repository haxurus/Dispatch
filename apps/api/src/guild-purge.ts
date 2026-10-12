import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '@dispatch/db';
import { DEFAULT_POST_REMOVAL_RETENTION_DAYS } from '@dispatch/shared';

/*
 * Data lifecycle after the bot leaves a server (privacy policy: "deleted 30
 * days after the bot is removed"). The bot stamps GuildSettings.leftAt on
 * GuildDelete and clears it when it is added again; this job deletes every
 * row of servers gone for longer than the retention.
 *
 * It runs in the API because the bot's database role deliberately cannot
 * delete dashboard data (forms, submissions, role bindings, audit).
 */

const DAY_MS = 86_400_000;
const INTERVAL_MS = 60 * 60_000;
const BATCH = 20;

/**
 * Deletes one departed server. The row lock makes a concurrent re-add wait:
 * the bot's upsert then recreates a clean GuildSettings row.
 */
export async function purgeDepartedGuild(guildId: string, cutoff: Date) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ guildId: string }>>`
      SELECT "guildId" FROM "GuildSettings"
      WHERE "guildId" = ${guildId} AND "leftAt" IS NOT NULL AND "leftAt" < ${cutoff}
      FOR UPDATE`;
    if (!rows.length) return false;
    // Restrict foreign keys (Ticket → TicketCategory, FormSubmission →
    // FormDefinition) must be cleared before the cascade from GuildSettings.
    await tx.ticket.deleteMany({ where: { guildId } });
    await tx.formSubmission.deleteMany({ where: { guildId } });
    await tx.guildSettings.delete({ where: { guildId } });
    return true;
  }, { timeout: 60_000 });
}

export async function purgeDepartedGuilds(now = Date.now(), retentionDays = DEFAULT_POST_REMOVAL_RETENTION_DAYS) {
  const cutoff = new Date(now - retentionDays * DAY_MS);
  const due = await prisma.guildSettings.findMany({
    where: { leftAt: { lt: cutoff } },
    select: { guildId: true },
    orderBy: { leftAt: 'asc' },
    take: BATCH
  });
  let purged = 0;
  for (const { guildId } of due) {
    if (await purgeDepartedGuild(guildId, cutoff)) purged += 1;
  }
  return purged;
}

export function startGuildPurge(log: FastifyBaseLogger) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const purged = await purgeDepartedGuilds();
      if (purged) log.info({ purged }, 'Purged data of servers the bot left');
    } catch (error) {
      log.error({ err: error }, 'Departed server purge failed');
    } finally {
      running = false;
    }
  };
  setTimeout(run, 60_000).unref();
  setInterval(run, INTERVAL_MS).unref();
}
