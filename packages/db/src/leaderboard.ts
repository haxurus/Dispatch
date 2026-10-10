import type { PrismaClient } from '@prisma/client';

/*
 * Raw moderator activity of a leaderboard period [start, end), read with the
 * same queries by the API preview and the bot scheduler. The shape matches
 * LeaderboardActivity in @dispatch/shared, which ranks it (pure function).
 * Guild-scoped, ids and numbers only: no encrypted column is read.
 */
export type LeaderboardActivityRows = {
  handled: string[];
  feedback: Array<{ staffId: string; rating: number }>;
  firstResponses: Array<{ staffId: string; minutes: number }>;
  claims: string[];
};

const LIMIT = 50_000;

export async function loadLeaderboardActivity(
  db: PrismaClient,
  guildId: string,
  start: Date,
  end: Date
): Promise<LeaderboardActivityRows> {
  const range = { gte: start, lt: end };
  const [handled, feedback, responses, claims] = await Promise.all([
    // Credited closures: handledById is set at close, cleared on reopen.
    db.ticket.findMany({
      where: { guildId, status: 'CLOSED', handledById: { not: null }, closedAt: range },
      select: { handledById: true },
      take: LIMIT
    }),
    db.ticketFeedback.findMany({
      where: { guildId, staffUserId: { not: null }, createdAt: range },
      select: { staffUserId: true, rating: true },
      take: LIMIT
    }),
    // The audit records who answered first and when.
    db.ticketAudit.findMany({
      where: { guildId, action: 'ticket.first_staff_response', actorId: { not: null }, createdAt: range },
      select: { actorId: true, createdAt: true, ticket: { select: { createdAt: true } } },
      take: LIMIT
    }),
    db.ticketAudit.findMany({
      where: { guildId, action: { in: ['ticket.claim', 'ticket.assign'] }, createdAt: range },
      select: { actorId: true, action: true, details: true },
      take: LIMIT
    })
  ]);

  return {
    handled: handled.flatMap((row) => (row.handledById ? [row.handledById] : [])),
    feedback: feedback.flatMap((row) => (row.staffUserId ? [{ staffId: row.staffUserId, rating: row.rating }] : [])),
    firstResponses: responses.flatMap((row) => (row.actorId
      ? [{ staffId: row.actorId, minutes: Math.max(0, (row.createdAt.getTime() - row.ticket.createdAt.getTime()) / 60_000) }]
      : [])),
    claims: claims.flatMap((row) => {
      if (row.action === 'ticket.assign') {
        const details = row.details && typeof row.details === 'object' && !Array.isArray(row.details)
          ? row.details as Record<string, unknown>
          : null;
        return typeof details?.assigneeId === 'string' ? [details.assigneeId] : [];
      }
      return row.actorId ? [row.actorId] : [];
    })
  };
}
