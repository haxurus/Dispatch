import { createHash, randomBytes } from 'node:crypto';
import { prisma, type Prisma } from '@dispatch/db';

const ACTIVE = ['OPEN', 'WAITING', 'IN_PROGRESS', 'RESOLVED', 'REOPENING'];
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const FORM_TTL_MS = 10 * 60_000;
const STRIKE_DECAY_MS = 24 * 60 * 60_000;

export type TicketOpenReservationResult =
  | { ok: true; token: string }
  | { ok: false; code: string; retryAfterSeconds: number };

export const formVersion = (fields: unknown) =>
  createHash('sha256').update(JSON.stringify(fields)).digest('hex');

const deny = (code: string, seconds = 1): TicketOpenReservationResult => ({
  ok: false, code, retryAfterSeconds: Math.max(1, Math.ceil(seconds))
});

const cleared = {
  reservationToken: null, reservationCategoryId: null, reservationSourceKey: null,
  reservationFormVersion: null, reservationPhase: null, reservationAnswersEncrypted: null,
  reservationQuestionIndex: null, pendingUntil: null
};

// An actual UPDATE obtains a PostgreSQL row lock until the transaction commits.
// This works even when configurable cooldowns are disabled.
async function lockGuard(tx: Prisma.TransactionClient, guildId: string, userId: string) {
  return tx.ticketUserGuard.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { guildId, userId },
    update: { updatedAt: new Date() }
  });
}

async function transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { maxWait: 3000, timeout: 8000 });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (attempt >= 2 || (code !== 'P2034' && code !== 'P2002')) throw error;
    }
  }
}

async function isBlocked(tx: Prisma.TransactionClient, guildId: string, userId: string, now: Date) {
  return Boolean(await tx.guildBlacklist.findFirst({
    where: { guildId, userId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { id: true }
  }));
}

export async function reserveTicketOpen(
  guildId: string, userId: string, categoryId: string, sourceKey: string,
  version: string
): Promise<TicketOpenReservationResult> {
  if (!/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(userId) ||
      !/^[a-z0-9]{20,32}$/i.test(categoryId) || !/^(p_|m_|r_|f_)[a-z0-9]{17,32}$/i.test(sourceKey)) {
    return deny('INVALID_OPEN_REQUEST');
  }
  return transaction(async (tx) => {
    const guard = await lockGuard(tx, guildId, userId);
    const now = new Date();
    const settings = await tx.guildSettings.findUniqueOrThrow({ where: { guildId } });
    const category = await tx.ticketCategory.findFirst({ where: { id: categoryId, guildId, enabled: true } });
    if (!category) return deny('CATEGORY_NOT_FOUND');
    if (await isBlocked(tx, guildId, userId, now)) return deny('BLACKLISTED');
    if (guard.blockedUntil && guard.blockedUntil > now && settings.antiSpamEnabled) {
      return deny('TICKET_OPEN_BLOCKED', (guard.blockedUntil.getTime() - now.getTime()) / 1000);
    }
    // Never expire an in-flight Discord mutation automatically. An uncertain
    // network result needs reconciliation, not a second channel creation.
    if (guard.reservationPhase === 'CREATING' || (guard.pendingUntil && guard.pendingUntil > now)) {
      return deny('TICKET_OPEN_IN_PROGRESS', 5);
    }
    if (settings.antiSpamEnabled) {
      await tx.ticketOpenAttempt.create({ data: { guildId, userId, categoryId } });
      const [globalAttempts, categoryAttempts] = await Promise.all([
        tx.ticketOpenAttempt.count({ where: { guildId, userId, openedAt: null,
          createdAt: { gte: new Date(now.getTime() - settings.antiSpamWindowMinutes * 60_000) } } }),
        tx.ticketOpenAttempt.count({ where: { guildId, userId, categoryId, openedAt: null,
          createdAt: { gte: new Date(now.getTime() - category.antiSpamWindowMinutes * 60_000) } } })
      ]);
      if (globalAttempts > settings.antiSpamMaxAttempts || categoryAttempts > category.antiSpamMaxAttempts) {
        const previous = guard.lastViolationAt && now.getTime() - guard.lastViolationAt.getTime() < STRIKE_DECAY_MS
          ? guard.strikes : 0;
        const strikes = Math.min(8, previous + 1);
        const minutes = Math.min(10080, settings.antiSpamBlockMinutes * Math.min(8, 2 ** (strikes - 1)));
        await tx.ticketUserGuard.update({ where: { id: guard.id }, data: {
          ...cleared, strikes, lastViolationAt: now, blockedUntil: new Date(now.getTime() + minutes * 60_000)
        } });
        return deny(globalAttempts > settings.antiSpamMaxAttempts ? 'GLOBAL_ATTEMPT_LIMIT' : 'CATEGORY_ATTEMPT_LIMIT', minutes * 60);
      }
      if (guard.lastOpenedAt) {
        const remaining = guard.lastOpenedAt.getTime() + settings.antiSpamGlobalCooldownSeconds * 1000 - now.getTime();
        if (remaining > 0) return deny('GLOBAL_COOLDOWN', remaining / 1000);
      }
      // Attempts survive ticket retention, so deleting a closed ticket does not
      // erase the per-category cooldown.
      const latest = await tx.ticketOpenAttempt.findFirst({
        where: { guildId, userId, categoryId, openedAt: { not: null } },
        orderBy: { openedAt: 'desc' }, select: { openedAt: true }
      });
      const latestTicket = await tx.ticket.findFirst({
        where: { guildId, openerId: userId, categoryId }, orderBy: { createdAt: 'desc' },
        select: { createdAt: true }
      });
      const last = Math.max(latest?.openedAt?.getTime() ?? 0, latestTicket?.createdAt.getTime() ?? 0);
      const remaining = last + category.openCooldownSeconds * 1000 - now.getTime();
      if (remaining > 0) return deny('CATEGORY_COOLDOWN', remaining / 1000);
    }
    const active = await tx.ticket.count({ where: { guildId, openerId: userId, categoryId, status: { in: ACTIVE } } });
    if (active >= category.maxOpenPerUser) return deny('MAX_OPEN_TICKETS');
    const token = randomBytes(24).toString('base64url');
    await tx.ticketUserGuard.update({ where: { id: guard.id }, data: {
      reservationToken: token, reservationCategoryId: categoryId,
      reservationSourceKey: sourceKey, reservationFormVersion: version,
      reservationPhase: 'FORM', reservationAnswersEncrypted: null, reservationQuestionIndex: 0,
      pendingUntil: new Date(now.getTime() + FORM_TTL_MS)
    } });
    return { ok: true, token };
  });
}

export async function getTicketOpenReservation(guildId: string, userId: string, token: string) {
  if (!TOKEN.test(token)) return null;
  return prisma.ticketUserGuard.findFirst({ where: {
    guildId, userId, reservationToken: token, reservationPhase: 'FORM', pendingUntil: { gt: new Date() }
  } });
}

export async function consumeTicketOpenReservation(guildId: string, userId: string, token: string) {
  if (!TOKEN.test(token)) return null;
  return transaction(async (tx) => {
    const guard = await lockGuard(tx, guildId, userId);
    const now = new Date();
    if (guard.reservationToken !== token || guard.reservationPhase !== 'FORM' ||
        !guard.pendingUntil || guard.pendingUntil <= now || !guard.reservationCategoryId) return null;
    const category = await tx.ticketCategory.findFirst({ where: {
      id: guard.reservationCategoryId, guildId, enabled: true
    } });
    const blocked = await isBlocked(tx, guildId, userId, now);
    const active = await tx.ticket.count({ where: {
      guildId, openerId: userId, categoryId: guard.reservationCategoryId, status: { in: ACTIVE }
    } });
    if (!category || blocked || active >= category.maxOpenPerUser ||
        formVersion(category.formFields) !== guard.reservationFormVersion) {
      await tx.ticketUserGuard.update({ where: { id: guard.id }, data: cleared });
      return null;
    }
    await tx.ticketUserGuard.update({ where: { id: guard.id }, data: { reservationPhase: 'CREATING' } });
    return guard;
  });
}

export async function releaseTicketOpenReservation(guildId: string, userId: string, token: string) {
  if (!TOKEN.test(token)) return;
  await prisma.ticketUserGuard.updateMany({ where: { guildId, userId, reservationToken: token }, data: cleared });
}

export async function commitTicketOpen<T>(
  guildId: string, userId: string, token: string,
  create: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return transaction(async (tx) => {
    const guard = await lockGuard(tx, guildId, userId);
    if (guard.reservationToken !== token || guard.reservationPhase !== 'CREATING') {
      throw new Error('OPEN_RESERVATION_LOST');
    }
    const result = await create(tx);
    const now = new Date();
    await tx.ticketUserGuard.update({ where: { id: guard.id }, data: { ...cleared, lastOpenedAt: now } });
    if (guard.reservationCategoryId) {
      await tx.ticketOpenAttempt.create({ data: {
        guildId, userId, categoryId: guard.reservationCategoryId, openedAt: now
      } });
    }
    return result;
  });
}

export function ticketOpenReservationMessage(result: Exclude<TicketOpenReservationResult, { ok: true }>) {
  if (result.code === 'BLACKLISTED') return 'Non puoi aprire ticket in questo server.';
  if (result.code === 'MAX_OPEN_TICKETS') return 'Hai raggiunto il limite di ticket aperti per questa richiesta.';
  if (result.code === 'TICKET_OPEN_IN_PROGRESS') return 'Hai gia una richiesta in corso. Completa il modulo aperto.';
  const seconds = result.retryAfterSeconds;
  const wait = seconds >= 60 ? Math.ceil(seconds / 60) + ' minuti' : seconds + ' secondi';
  return 'Apertura temporaneamente limitata. Riprova tra circa ' + wait + '.';
}

// Cheap, bounded ingress protection before any database or Discord REST lookup.
const ingress = new Map<string, { count: number; until: number }>();
export function allowOpeningInteraction(guildId: string, userId: string, now = Date.now()) {
  const key = guildId + ':' + userId;
  let row = ingress.get(key);
  if (!row || row.until <= now) {
    if (ingress.size >= 10000) ingress.delete(ingress.keys().next().value!);
    row = { count: 0, until: now + 5000 };
    ingress.set(key, row);
  }
  row.count++;
  return row.count <= 5;
}
