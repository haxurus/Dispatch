import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, PrismaClient } from '@dispatch/db';
import { ChannelType, type Client } from 'discord.js';
import {
  reserveTicketOpen, consumeTicketOpenReservation, releaseTicketOpenReservation,
  getTicketOpenReservation, commitTicketOpen, formVersion, allowOpeningInteraction
} from '../apps/bot/src/open-guard.js';
import { retentionDue, runTicketRetention } from '../apps/bot/src/retention.js';
import { reopenTicket } from '../apps/bot/src/ticket-operations.js';
import { handleTicketInteraction, publishMainMenu } from '../apps/bot/src/tickets.js';

const db = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid');
assert.equal(process.env.DISPATCH_TEST_DATABASE, '1', 'Explicit test database opt-in required');
assert.equal(db.pathname, '/dispatch_test', 'Tests must never run on a production database');
const G = '990000000000000001';
const U = '990000000000000002';
const OTHER = '990000000000000003';
const DAY = 86400000;
let number = 0;

beforeEach(async () => {
  await prisma.guildSettings.deleteMany({ where: { guildId: G } });
  await prisma.guildSettings.create({ data: {
    guildId: G, guildName: 'Disposable integration test',
    antiSpamGlobalCooldownSeconds: 0, antiSpamMaxAttempts: 100,
    transcriptRetentionDays: null, closedTicketRetentionDays: null,
    retentionDeleteDiscordChannel: false
  } });
});
after(async () => {
  await prisma.guildSettings.deleteMany({ where: { guildId: G } });
  await prisma.$disconnect();
});
async function category(extra: Record<string, unknown> = {}) {
  return prisma.ticketCategory.create({ data: {
    guildId: G, name: 'Support', openCooldownSeconds: 0,
    antiSpamMaxAttempts: 100, maxOpenPerUser: 10, ...extra
  } });
}
async function reservation(cat: Awaited<ReturnType<typeof category>>) {
  const result = await reserveTicketOpen(G, U, cat.id, 'm_' + G, formVersion(cat.formFields));
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.code);
  return result.token;
}
async function ticket(cat: Awaited<ReturnType<typeof category>>, extra: Record<string, unknown> = {}) {
  number++;
  return prisma.ticket.create({ data: {
    guildId: G, categoryId: cat.id, openerId: U, ticketNumber: number,
    channelId: String(990000000000001000n + BigInt(number)),
    status: 'CLOSED', closedAt: new Date(Date.now() - 4 * DAY), ...extra
  } });
}
function client(fetch: (id: string) => Promise<unknown> = async () => null): Client {
  return { isReady: () => true, user: { id: OTHER }, guilds: { cache: new Map([
    [G, { available: true, channels: { fetch } }]
  ]) } } as unknown as Client;
}

for (const enabled of [true, false]) {
  test('only one parallel reservation and one consume, antiSpam=' + enabled, async () => {
    await prisma.guildSettings.update({ where: { guildId: G }, data: { antiSpamEnabled: enabled } });
    const cat = await category();
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      reserveTicketOpen(G, U, cat.id, 'm_' + G, formVersion(cat.formFields))));
    const successes = results.filter((r) => r.ok);
    assert.equal(successes.length, 1);
    const success = successes[0]!;
    if (!success.ok) throw new Error('Missing reservation');
    const consumed = await Promise.all(Array.from({ length: 8 }, () => consumeTicketOpenReservation(G, U, success.token)));
    assert.equal(consumed.filter(Boolean).length, 1);
    assert.equal(await getTicketOpenReservation(G, U, success.token), null);
  });
}

test('nonce is bound to user, guild, category and source; old release cannot clear a newer opening', async () => {
  const cat = await category();
  const first = await reservation(cat);
  assert.equal(await getTicketOpenReservation(G, OTHER, first), null);
  const stored = await getTicketOpenReservation(G, U, first);
  assert.equal(stored?.reservationCategoryId, cat.id);
  assert.equal(stored?.reservationSourceKey, 'm_' + G);
  await releaseTicketOpenReservation(G, U, first);
  const second = await reservation(cat);
  assert.notEqual(second, first);
  await releaseTicketOpenReservation(G, U, first);
  assert.ok(await getTicketOpenReservation(G, U, second));
  assert.equal(await consumeTicketOpenReservation(G, U, first), null);
});

test('expired or changed forms cannot open a ticket', async () => {
  const cat = await category();
  const token = await reservation(cat);
  await prisma.ticketUserGuard.update({ where: { guildId_userId: { guildId: G, userId: U } },
    data: { pendingUntil: new Date(Date.now() - 1000) } });
  assert.equal(await consumeTicketOpenReservation(G, U, token), null);
  const next = await reservation(cat);
  await prisma.ticketCategory.update({ where: { id: cat.id }, data: { formFields: [{ id: 'new', label: 'Changed' }] } });
  assert.equal(await consumeTicketOpenReservation(G, U, next), null);
});

test('active ticket limit is enforced even when cooldowns are disabled', async () => {
  const cat = await category({ maxOpenPerUser: 1 });
  await ticket(cat, { status: 'OPEN', closedAt: null });
  await prisma.guildSettings.update({ where: { guildId: G }, data: { antiSpamEnabled: false } });
  const result = await reserveTicketOpen(G, U, cat.id, 'm_' + G, formVersion(cat.formFields));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'MAX_OPEN_TICKETS');
});

test('blacklist added while a form is open is checked at consumption', async () => {
  const cat = await category();
  const token = await reservation(cat);
  await prisma.guildBlacklist.create({ data: { guildId: G, userId: U, createdById: OTHER } });
  assert.equal(await consumeTicketOpenReservation(G, U, token), null);
});

test('global cooldown applies across categories and is persisted in PostgreSQL', async () => {
  const cat = await category();
  const token = await reservation(cat);
  assert.ok(await consumeTicketOpenReservation(G, U, token));
  await commitTicketOpen(G, U, token, async () => true);
  await prisma.guildSettings.update({ where: { guildId: G }, data: { antiSpamGlobalCooldownSeconds: 60 } });
  const other = await category();
  const result = await reserveTicketOpen(G, U, other.id, 'm_' + G, formVersion(other.formFields));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'GLOBAL_COOLDOWN');
});

test('category cooldown survives removal of ticket records', async () => {
  const cat = await category({ openCooldownSeconds: 60 });
  const token = await reservation(cat);
  assert.ok(await consumeTicketOpenReservation(G, U, token));
  await commitTicketOpen(G, U, token, async () => true);
  const result = await reserveTicketOpen(G, U, cat.id, 'm_' + G, formVersion(cat.formFields));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'CATEGORY_COOLDOWN');
});

test('attempt limits produce progressive temporary blocks', async () => {
  const cat = await category();
  await prisma.guildSettings.update({ where: { guildId: G }, data: { antiSpamMaxAttempts: 1, antiSpamBlockMinutes: 2 } });
  const token = await reservation(cat);
  await releaseTicketOpenReservation(G, U, token);
  let result = await reserveTicketOpen(G, U, cat.id, 'm_' + G, formVersion(cat.formFields));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.retryAfterSeconds, 120);
  await prisma.ticketUserGuard.update({ where: { guildId_userId: { guildId: G, userId: U } },
    data: { blockedUntil: new Date(Date.now() - 1000) } });
  result = await reserveTicketOpen(G, U, cat.id, 'm_' + G, formVersion(cat.formFields));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.retryAfterSeconds, 240);
});

test('failed creation transaction does not clear the reservation or commit partial data', async () => {
  const cat = await category();
  const token = await reservation(cat);
  assert.ok(await consumeTicketOpenReservation(G, U, token));
  await assert.rejects(commitTicketOpen(G, U, token, async () => { throw new Error('TEST_FAILURE'); }), /TEST_FAILURE/);
  const guard = await prisma.ticketUserGuard.findUniqueOrThrow({ where: { guildId_userId: { guildId: G, userId: U } } });
  assert.equal(guard.reservationPhase, 'CREATING');
  assert.equal(guard.lastOpenedAt, null);
});

test('ingress limiter is bounded and permits normal button/select/modal flow', () => {
  for (let n = 0; n < 5; n++) assert.equal(allowOpeningInteraction(G, 'ingress-test', 10000), true);
  assert.equal(allowOpeningInteraction(G, 'ingress-test', 10000), false);
  assert.equal(allowOpeningInteraction(G, 'ingress-test', 15001), true);
});

test('retention time accounts for the entire user reopening window', () => {
  const now = 10 * DAY;
  assert.equal(retentionDue(new Date(now - 2 * DAY), 1, 72, now), false);
  assert.equal(retentionDue(new Date(now - 4 * DAY), 1, 72, now), true);
  assert.equal(retentionDue(new Date(0), null, 0, now), false);
});

test('unconfigured retention and open tickets are never purged', async () => {
  const cat = await category();
  const closed = await ticket(cat);
  const open = await ticket(cat, { status: 'OPEN', closedAt: null });
  await prisma.transcript.create({ data: { ticketId: open.id, contentEncrypted: 'test fixture' } });
  assert.equal((await runTicketRetention(client())).ticketsDeleted, 0);
  await prisma.guildSettings.update({ where: { guildId: G }, data: { transcriptRetentionDays: 1, closedTicketRetentionDays: 2 } });
  await runTicketRetention(client());
  assert.equal(await prisma.ticket.findUnique({ where: { id: closed.id } }), null);
  assert.ok(await prisma.ticket.findUnique({ where: { id: open.id } }));
  assert.ok(await prisma.transcript.findUnique({ where: { ticketId: open.id } }));
});

test('retention respects reopen window and cascades expired private data', async () => {
  const cat = await category({ reopenWindowHours: 72 });
  const keep = await ticket(cat, { closedAt: new Date(Date.now() - 2 * DAY) });
  const purge = await ticket(cat);
  await prisma.ticketNote.create({ data: { ticketId: purge.id, guildId: G, authorId: OTHER, contentEncrypted: 'test fixture' } });
  await prisma.ticketFeedback.create({ data: { ticketId: purge.id, guildId: G, userId: U, rating: 5 } });
  await prisma.transcript.create({ data: { ticketId: purge.id, contentEncrypted: 'test fixture' } });
  await prisma.guildSettings.update({ where: { guildId: G }, data: { transcriptRetentionDays: 1, closedTicketRetentionDays: 1 } });
  await runTicketRetention(client());
  assert.ok(await prisma.ticket.findUnique({ where: { id: keep.id } }));
  assert.equal(await prisma.ticket.findUnique({ where: { id: purge.id } }), null);
  assert.equal(await prisma.ticketNote.count({ where: { ticketId: purge.id } }), 0);
  assert.equal(await prisma.ticketFeedback.count({ where: { ticketId: purge.id } }), 0);
  assert.equal(await prisma.transcript.count({ where: { ticketId: purge.id } }), 0);
});

test('Discord failures preserve the deletion marker and block reopening, retry can finish', async () => {
  const cat = await category({ reopenWindowHours: 1 });
  const row = await ticket(cat);
  await prisma.guildSettings.update({ where: { guildId: G }, data: { closedTicketRetentionDays: 1, retentionDeleteDiscordChannel: true } });
  const forbidden = client(async () => { throw Object.assign(new Error('Forbidden'), { code: 50013 }); });
  assert.equal((await runTicketRetention(forbidden)).failed, 1);
  const retained = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
  assert.ok(retained.retentionPendingAt);
  await assert.rejects(reopenTicket(forbidden, G, row.id, U, true), /RETENTION/);
  const missing = client(async () => { throw Object.assign(new Error('Unknown Channel'), { code: 10003 }); });
  assert.equal((await runTicketRetention(missing)).ticketsDeleted, 1);
});

test('retention never deletes a repurposed channel', async () => {
  const cat = await category();
  const row = await ticket(cat);
  await prisma.guildSettings.update({ where: { guildId: G }, data: { closedTicketRetentionDays: 1, retentionDeleteDiscordChannel: true } });
  let deleted = false;
  const mock = client(async () => ({ id: row.channelId, guildId: G, type: ChannelType.GuildText,
    topic: 'Unrelated channel', delete: async () => { deleted = true; } }));
  await runTicketRetention(mock);
  assert.equal(deleted, false);
  assert.ok(await prisma.ticket.findUnique({ where: { id: row.id } }));
});

test('main menu opens a private request selector in configured order', async () => {
  const first = await category({ name: 'First' });
  const second = await category({ name: 'Second' });
  const channelId = '990000000000005001';
  const messageId = '990000000000005002';
  await prisma.guildSettings.update({ where: { guildId: G }, data: {
    mainMenuEnabled: true, mainMenuChannelId: channelId, mainMenuMessageId: messageId,
    mainMenuCategoryIds: [second.id, first.id]
  } });
  let response: any;
  const interaction = {
    customId: 'dispatch:main-menu:' + G, guildId: G, channelId, user: { id: U }, message: { id: messageId },
    isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
    reply: async (payload: unknown) => { response = payload; }
  };
  await handleTicketInteraction(interaction as any);
  assert.equal(response.ephemeral, true);
  const options = response.components[0].toJSON().components[0].options;
  assert.deepEqual(options.map((option: any) => option.value), [second.id, first.id]);
  response = undefined;
  interaction.message.id = '990000000000005003';
  await handleTicketInteraction(interaction as any);
  assert.equal(response.components, undefined);
});

test('a forbidden main menu edit must not silently publish duplicates', async () => {
  const cat = await category();
  await prisma.guildSettings.update({ where: { guildId: G }, data: {
    mainMenuEnabled: true, mainMenuChannelId: '990000000000005001', mainMenuMessageId: '990000000000005002',
    mainMenuCategoryIds: [cat.id]
  } });
  let sends = 0;
  const mock = client(async () => ({ isTextBased: () => true, send: async () => { sends++; },
    messages: { fetch: async () => { throw Object.assign(new Error('Forbidden'), { code: 50013 }); } }
  }));
  await assert.rejects(publishMainMenu(mock, G), /Forbidden/);
  assert.equal(sends, 0);
});

test('bot database role can use guards but cannot read dashboard sessions or staff notes', async () => {
  const connection = new URL(db);
  connection.username = 'dispatch_bot'; connection.password = 'dispatch_bot_test';
  const bot = new PrismaClient({ datasources: { db: { url: connection.toString() } } });
  try {
    await bot.ticketUserGuard.count();
    await bot.ticketOpenAttempt.count();
    await bot.guildBlacklist.count();
    await assert.rejects(bot.panelSession.count());
    await assert.rejects(bot.ticketNote.count());
    await assert.rejects(bot.$queryRaw`SELECT * FROM "_prisma_migrations"`);
  } finally { await bot.$disconnect(); }
});
