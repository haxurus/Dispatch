import { AuditLogEvent, PermissionFlagsBits, type Guild } from 'discord.js';
import { prisma } from '@dispatch/db';

/*
 * Installation blacklist managed from the super console (InstallBlock).
 * The bot role only has SELECT on that table.
 */

export async function isGuildInstallBlocked(guildId: string) {
  const block = await prisma.installBlock.findUnique({
    where: { kind_subjectId: { kind: 'GUILD', subjectId: guildId } },
    select: { id: true }
  });
  return Boolean(block);
}

export async function isUserInstallBlocked(userId: string) {
  const block = await prisma.installBlock.findUnique({
    where: { kind_subjectId: { kind: 'USER', subjectId: userId } },
    select: { id: true }
  });
  return Boolean(block);
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Best effort: the user who added the bot, from the BotAdd audit-log entry of
 * the last ~20 seconds. Dispatch is not granted View Audit Log, so on most
 * servers this returns null and only the guild block applies.
 */
export async function findInstallerId(guild: Guild, botUserId: string, maxAgeMs = 20_000) {
  try {
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
    await delay(700);
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 6 });
    const now = Date.now();
    const entry = logs.entries.find((candidate) => {
      const target = candidate.target as { id?: string } | null;
      return target?.id === botUserId && now - candidate.createdTimestamp <= maxAgeMs;
    });
    return entry?.executorId ?? null;
  } catch {
    return null;
  }
}

export type InstallVerdict = 'allowed' | 'blocked-guild' | 'blocked-installer';

/** Decide whether the bot may stay in a guild it has just joined. */
export async function checkInstall(guild: Guild, botUserId: string | null): Promise<InstallVerdict> {
  if (await isGuildInstallBlocked(guild.id)) return 'blocked-guild';
  if (!botUserId) return 'allowed';
  const installerId = await findInstallerId(guild, botUserId);
  if (installerId && await isUserInstallBlocked(installerId)) return 'blocked-installer';
  return 'allowed';
}
