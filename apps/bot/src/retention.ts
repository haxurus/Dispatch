import { ChannelType, type Client } from 'discord.js';
import { prisma, type Prisma } from '@dispatch/db';
import { logTicketEvent } from './ticket-log.js';

const DAY = 86_400_000;
export function retentionDue(closedAt: Date | null, days: number | null, reopenHours: number | null, now = Date.now()) {
  return closedAt !== null && days !== null && days >= 1 &&
    now >= closedAt.getTime() + Math.max(days * DAY, (reopenHours ?? 0) * 3_600_000);
}

export async function lockTicket(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${id} FOR UPDATE`;
}

export async function assertTranscriptRetention(ticket: {
  guildId: string; status: string; closedAt: Date | null;
  category: { reopenWindowHours: number | null };
}) {
  if (ticket.status !== 'CLOSED') return;
  const settings = await prisma.guildSettings.findUniqueOrThrow({ where: { guildId: ticket.guildId } });
  if (retentionDue(ticket.closedAt, settings.transcriptRetentionDays, ticket.category.reopenWindowHours)) {
    throw new Error('TRANSCRIPT_RETENTION_EXPIRED');
  }
}

async function expireTranscript(id: string) {
  return prisma.$transaction(async (tx) => {
    await lockTicket(tx, id);
    const ticket = await tx.ticket.findUnique({ where: { id }, include: { category: true, guild: true } });
    if (!ticket || ticket.status !== 'CLOSED' ||
        !retentionDue(ticket.closedAt, ticket.guild.transcriptRetentionDays, ticket.category.reopenWindowHours)) return 0;
    const result = await tx.transcript.deleteMany({ where: { ticketId: id } });
    return result.count;
  });
}

async function claimDeletion(id: string) {
  return prisma.$transaction(async (tx) => {
    await lockTicket(tx, id);
    const ticket = await tx.ticket.findUnique({ where: { id }, include: { category: true, guild: true } });
    if (!ticket || ticket.status !== 'CLOSED') return null;
    if (!ticket.retentionPendingAt &&
        !retentionDue(ticket.closedAt, ticket.guild.closedTicketRetentionDays, ticket.category.reopenWindowHours)) return null;
    if (!ticket.retentionPendingAt) {
      return tx.ticket.update({ where: { id }, data: {
        retentionPendingAt: new Date(), retentionDeleteChannel: ticket.guild.retentionDeleteDiscordChannel
      } });
    }
    return ticket;
  });
}

const unknownChannel = (error: unknown) => (error as { code?: number })?.code === 10003;

async function deleteExpiredTicket(client: Client, id: string) {
  const ticket = await claimDeletion(id);
  if (!ticket) return { deleted: 0, channels: 0, failed: 0 };
  let channels = 0;
  // A channel already deleted by the staff is treated as absent.
  if (ticket.retentionDeleteChannel && !ticket.channelDeletedAt) {
    const guild = client.guilds.cache.get(ticket.guildId);
    if (!guild || !guild.available) return { deleted: 0, channels: 0, failed: 1 };
    try {
      const channel = await guild.channels.fetch(ticket.channelId, { force: true });
      if (channel) {
        // Never delete a repurposed channel, another guild's channel, or an
        // arbitrary ID supplied by an API caller.
        if (channel.id !== ticket.channelId || channel.guildId !== ticket.guildId ||
            channel.type !== ChannelType.GuildText ||
            !channel.topic?.startsWith('Dispatch ticket #' + ticket.ticketNumber + ' - ')) {
          return { deleted: 0, channels: 0, failed: 1 };
        }
        await channel.delete('Dispatch retention ticket #' + ticket.ticketNumber);
        channels = 1;
      }
    } catch (error) {
      // Only Discord's explicit Unknown Channel permits database cleanup.
      // Forbidden, rate limits and network failures leave a durable retry row.
      if (!unknownChannel(error)) return { deleted: 0, channels: 0, failed: 1 };
    }
  }
  const result = await prisma.ticket.deleteMany({ where: {
    id: ticket.id, status: 'CLOSED', retentionPendingAt: { not: null }
  } });
  if (channels) {
    await logTicketEvent(client, ticket.guildId, 'TICKET_DELETE', {
      title: 'Canale eliminato dalla retention',
      ticket: { id: ticket.id, ticketNumber: ticket.ticketNumber, channelId: ticket.channelId },
      fields: [{ name: 'Canale', value: ticket.channelId, inline: true }]
    });
  }
  return { deleted: result.count, channels, failed: 0 };
}

export async function runTicketRetention(client: Client) {
  const totals = { transcriptsDeleted: 0, ticketsDeleted: 0, channelsDeleted: 0, failed: 0 };
  if (!client.isReady()) return totals;
  let guildCursor: string | undefined;
  for (;;) {
    const settingsRows = await prisma.guildSettings.findMany({
      where: { ...(guildCursor ? { guildId: { gt: guildCursor } } : {}), OR: [
        { transcriptRetentionDays: { not: null } }, { closedTicketRetentionDays: { not: null } },
        { tickets: { some: { retentionPendingAt: { not: null } } } }
      ] }, orderBy: { guildId: 'asc' }, take: 100
    });
    if (!settingsRows.length) break;
    for (const settings of settingsRows) {
      let cursor: string | undefined;
      for (;;) {
        const rows = await prisma.ticket.findMany({ where: {
          guildId: settings.guildId, status: 'CLOSED',
          ...(cursor ? { id: { gt: cursor } } : {})
        }, select: { id: true }, orderBy: { id: 'asc' }, take: 100 });
        if (!rows.length) break;
        for (const row of rows) {
          try {
            totals.transcriptsDeleted += await expireTranscript(row.id);
            const result = await deleteExpiredTicket(client, row.id);
            totals.ticketsDeleted += result.deleted;
            totals.channelsDeleted += result.channels;
            totals.failed += result.failed;
          } catch {
            totals.failed++;
          }
        }
        cursor = rows[rows.length - 1]!.id;
      }
    }
    guildCursor = settingsRows[settingsRows.length - 1]!.guildId;
  }
  // Keep at least the maximum configurable 24-hour rate window/cooldown.
  const cutoff = new Date(Date.now() - 2 * DAY);
  await prisma.ticketOpenAttempt.deleteMany({ where: { createdAt: { lt: cutoff } } });
  const now = new Date();
  await prisma.ticketUserGuard.updateMany({ where: {
    reservationPhase: 'FORM', pendingUntil: { lte: now }
  }, data: {
    reservationToken: null, reservationCategoryId: null, reservationSourceKey: null,
    reservationFormVersion: null, reservationPhase: null, pendingUntil: null
  } });
  await prisma.ticketUserGuard.deleteMany({ where: {
    updatedAt: { lt: cutoff }, reservationPhase: null,
    AND: [
      { OR: [{ blockedUntil: null }, { blockedUntil: { lte: cutoff } }] },
      { OR: [{ lastOpenedAt: null }, { lastOpenedAt: { lte: cutoff } }] }
    ]
  } });
  // Form sessions hold encrypted partial answers. Finished, cancelled and
  // abandoned ones lose their answers after one day and the row itself after
  // the longest configurable attempt window (7 days), which counts sessions.
  // SUBMITTING rows are left alone while a submission is in flight.
  const finished = ['COMPLETED', 'CANCELLED', 'EXPIRED'];
  await prisma.formSession.updateMany({
    where: { state: 'ACTIVE', expiresAt: { lte: now } },
    data: { state: 'EXPIRED' }
  });
  await prisma.formSession.updateMany({
    where: { state: { in: finished }, updatedAt: { lt: new Date(Date.now() - DAY) }, answersEncrypted: { not: null } },
    data: { answersEncrypted: null }
  });
  await prisma.formSession.deleteMany({ where: {
    state: { in: finished }, createdAt: { lt: new Date(Date.now() - 7 * DAY) }
  } });
  return totals;
}
