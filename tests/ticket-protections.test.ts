import { test, beforeEach, after } from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { prisma, PrismaClient } from '@dispatch/db';
import { ChannelType, PermissionFlagsBits, type Client } from 'discord.js';
import {
  reserveTicketOpen, consumeTicketOpenReservation, releaseTicketOpenReservation,
  getTicketOpenReservation, commitTicketOpen, formVersion, allowOpeningInteraction
} from '../apps/bot/src/open-guard.js';
import { retentionDue, runTicketRetention } from '../apps/bot/src/retention.js';
import {
  closeTicket, deleteTicketChannel, recordTicketMessage, reopenTicket, staffThreadTranscriptDestination, ticketChannelOverwrites
} from '../apps/bot/src/ticket-operations.js';
import { claimLeaderboardPeriod, releaseLeaderboardPeriod, runLeaderboardCycle } from '../apps/bot/src/leaderboard.js';
import { handleTicketInteraction, publishMainMenu } from '../apps/bot/src/tickets.js';
import { panelComponents } from '../apps/bot/src/panels.js';
import { invalidateTicketLogSettings, logTicketEvent } from '../apps/bot/src/ticket-log.js';
import {
  isHttpsUrl, layoutPanelButtons, normalizePanelItems, normalizeTicketLogEvents, parseBlacklistLogPayload, parsePanelEmoji,
  dueLeaderboardPeriods, formatLeaderboardMinutes, isoWeek, leaderboardPeriod, leaderboardTitle, median, rankLeaderboard,
  safeTimeZone, zonedTimeToUtc
} from '@dispatch/shared';

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
    await bot.installBlock.count();
    await assert.rejects(bot.superAdminAudit.count());
    await assert.rejects(bot.installBlock.create({ data: { kind: 'USER', subjectId: '990000000000009001', createdByUserId: '990000000000009002' } }));
    await assert.rejects(bot.panelSession.count());
    await assert.rejects(bot.ticketNote.count());
    await assert.rejects(bot.$queryRaw`SELECT * FROM "_prisma_migrations"`);
  } finally { await bot.$disconnect(); }
});

async function form() {
  return prisma.formDefinition.create({ data: { guildId: G, name: 'Test form', questions: [] } });
}
function formSession(formId: string, extra: Record<string, unknown> = {}) {
  return prisma.formSession.create({ data: {
    guildId: G, formId, userId: U, token: randomBytes(18).toString('base64url'), source: 'test',
    expiresAt: new Date(Date.now() + 60_000), ...extra
  } });
}

test('form submissions open tickets through the same guard: blacklist and open limit apply', async () => {
  const cat = await category({ maxOpenPerUser: 1 });
  const definition = await form();
  const key = 'f_' + definition.id;
  const first = await reserveTicketOpen(G, U, cat.id, key, formVersion(cat.formFields));
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error(first.code);
  assert.equal((await getTicketOpenReservation(G, U, first.token))?.reservationSourceKey, key);
  await releaseTicketOpenReservation(G, U, first.token);
  const invalid = await reserveTicketOpen(G, U, cat.id, 'x_' + definition.id, formVersion(cat.formFields));
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, 'INVALID_OPEN_REQUEST');
  await ticket(cat, { status: 'OPEN', closedAt: null });
  const limited = await reserveTicketOpen(G, U, cat.id, key, formVersion(cat.formFields));
  assert.equal(limited.ok, false);
  if (!limited.ok) assert.equal(limited.code, 'MAX_OPEN_TICKETS');
  await prisma.guildBlacklist.create({ data: { guildId: G, userId: U, createdById: OTHER } });
  const other = await category();
  const blocked = await reserveTicketOpen(G, U, other.id, key, formVersion(other.formFields));
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.code, 'BLACKLISTED');
});

test('PostgreSQL allows only one active form session per user and form', async () => {
  const definition = await form();
  await formSession(definition.id);
  await assert.rejects(formSession(definition.id), { code: 'P2002' });
  await formSession(definition.id, { state: 'CANCELLED' });
  await formSession(definition.id, { state: 'EXPIRED' });
  await formSession(definition.id, { userId: OTHER });
  assert.equal(await prisma.formSession.count({ where: { formId: definition.id, state: 'ACTIVE' } }), 2);
});

test('retention expires abandoned form sessions and purges old finished ones', async () => {
  const definition = await form();
  const stale = await formSession(definition.id, { expiresAt: new Date(Date.now() - 1000) });
  const old = await formSession(definition.id, { state: 'CANCELLED', createdAt: new Date(Date.now() - 8 * DAY) });
  const recent = await formSession(definition.id, { state: 'COMPLETED' });
  await runTicketRetention(client());
  assert.equal((await prisma.formSession.findUniqueOrThrow({ where: { id: stale.id } })).state, 'EXPIRED');
  assert.equal(await prisma.formSession.findUnique({ where: { id: old.id } }), null);
  assert.ok(await prisma.formSession.findUnique({ where: { id: recent.id } }));
});

test('bot database role has only the form privileges the runtime needs', async () => {
  const definition = await form();
  const connection = new URL(db);
  connection.username = 'dispatch_bot'; connection.password = 'dispatch_bot_test';
  const bot = new PrismaClient({ datasources: { db: { url: connection.toString() } } });
  try {
    await bot.formDefinition.count();
    await bot.formPermissionBinding.count();
    await bot.formPanel.count();
    await bot.formSubmission.count();
    await bot.formSession.count();
    await bot.formSession.deleteMany({ where: { formId: definition.id, state: 'EXPIRED' } });
    await assert.rejects(bot.formPermissionBinding.create({ data: {
      guildId: G, formId: definition.id, discordRoleId: OTHER, canSubmit: true
    } }));
    await assert.rejects(bot.formDefinition.updateMany({ where: { id: definition.id }, data: { name: 'Changed' } }));
    await assert.rejects(bot.formDefinition.deleteMany({ where: { id: definition.id } }));
    await assert.rejects(bot.formPanel.deleteMany({ where: { formId: definition.id } }));
    await assert.rejects(bot.formSubmission.deleteMany({ where: { formId: definition.id } }));
    assert.ok(await prisma.formDefinition.findUnique({ where: { id: definition.id } }));
  } finally { await bot.$disconnect(); }
});

// Panel customization (migration 20261010120000_panel_customization).
const PANEL_MIGRATION = resolve('packages/db/prisma/migrations/20261010120000_panel_customization/migration.sql');

test('panel migration backfills FormPanel.formIds from the legacy formId', async () => {
  const definition = await form();
  const id = 'cpanellegacyform00000001';
  // A row as written before the migration: no formIds, style or items.
  await prisma.$executeRaw`INSERT INTO "FormPanel" ("id", "guildId", "formId", "channelId", "title", "updatedAt")
    VALUES (${id}, ${G}, ${definition.id}, '990000000000006001', 'Legacy', NOW())`;
  assert.deepEqual((await prisma.formPanel.findUniqueOrThrow({ where: { id } })).formIds, []);
  const statements = readFileSync(PANEL_MIGRATION, 'utf8').split(';')
    .map((chunk) => chunk.slice(Math.max(0, chunk.indexOf('UPDATE'))).trim())
    .filter((chunk) => chunk.startsWith('UPDATE "FormPanel"'));
  assert.equal(statements.length, 1);
  await prisma.$executeRawUnsafe(statements[0]!);
  const panel = await prisma.formPanel.findUniqueOrThrow({ where: { id } });
  assert.deepEqual(panel.formIds, [definition.id]);
  assert.equal(panel.formId, definition.id);
  assert.equal(panel.style, 'BUTTONS');
  assert.equal(panel.buttonLabel, 'Compila');
  assert.deepEqual(panel.items, []);
  // Idempotent: a second run keeps an already populated list untouched.
  await prisma.$executeRawUnsafe(statements[0]!);
  assert.deepEqual((await prisma.formPanel.findUniqueOrThrow({ where: { id } })).formIds, [definition.id]);
});

test('existing ticket panels keep the select menu look by default', async () => {
  const id = 'cpanellegacyticket000001';
  await prisma.$executeRaw`INSERT INTO "TicketPanel" ("id", "guildId", "name", "channelId", "title", "updatedAt")
    VALUES (${id}, ${G}, 'Legacy', '990000000000006002', 'Legacy', NOW())`;
  const panel = await prisma.ticketPanel.findUniqueOrThrow({ where: { id } });
  assert.equal(panel.style, 'SELECT');
  assert.equal(panel.placeholder, null);
  assert.equal(panel.color, null);
  assert.equal(panel.footerText, null);
  assert.deepEqual(panel.items, []);
  await assert.rejects(prisma.$executeRaw`UPDATE "TicketPanel" SET "style" = 'GRID' WHERE "id" = ${id}`);
});

test('panel emoji parsing accepts unicode and custom emoji only', () => {
  assert.deepEqual(parsePanelEmoji('🎫'), { name: '🎫' });
  assert.deepEqual(parsePanelEmoji(' 👩🏽‍💻 '), { name: '👩🏽‍💻' });
  assert.deepEqual(parsePanelEmoji('🇮🇹'), { name: '🇮🇹' });
  assert.deepEqual(parsePanelEmoji('<:ticket:990000000000007001>'), { name: 'ticket', id: '990000000000007001' });
  assert.deepEqual(parsePanelEmoji('<a:spin:990000000000007002>'), { name: 'spin', id: '990000000000007002', animated: true });
  for (const invalid of ['', 'ticket', ':ticket:', '<:x:1>', '<:ticket:abc>', '🎫🎫', 'a🎫', '<@990000000000007003>', null, 42]) {
    assert.equal(parsePanelEmoji(invalid), null, String(invalid));
  }
});

test('panel helpers sanitise overrides, URLs and button layout', () => {
  const a = 'c'.repeat(24);
  const b = 'd'.repeat(24);
  const items = normalizePanelItems([
    { id: a, label: '  Supporto  ', emoji: 'nope', buttonStyle: 'DANGER', description: 'x'.repeat(150) },
    { id: a, label: 'duplicate' },
    { id: 'e'.repeat(24), label: 'not in panel' },
    'garbage'
  ], [a, b]);
  assert.deepEqual(items, [{ id: a, label: 'Supporto', emoji: null, description: 'x'.repeat(100), buttonStyle: 'DANGER' }]);
  assert.equal(isHttpsUrl('https://cdn.discordapp.com/x.png'), true);
  assert.equal(isHttpsUrl('http://example.com/x.png'), false);
  assert.equal(isHttpsUrl('javascript:alert(1)'), false);
  assert.equal(isHttpsUrl('https://user:pass@example.com/'), false);
  assert.deepEqual(layoutPanelButtons([1, 2, 3, 4, 5, 6, 7]).map((row) => row.length), [5, 2]);
  assert.equal(layoutPanelButtons(Array.from({ length: 30 }, (_, index) => index)).flat().length, 25);
});

test('panel components render select or 5x5 buttons within Discord limits', () => {
  const panelId = 'p'.repeat(32);
  const entries = Array.from({ length: 7 }, (_, index) => ({
    id: String.fromCharCode(97 + index).repeat(32), label: 'Categoria ' + index, description: 'Descrizione ' + index
  }));
  const items = [{ id: entries[0]!.id, label: 'Supporto', emoji: '<:help:990000000000007004>', buttonStyle: 'SUCCESS', description: 'Aiuto' }];
  const base = {
    placeholder: null, defaultPlaceholder: 'Seleziona una categoria', items, entries,
    selectCustomId: 'dispatch:open:' + panelId,
    buttonCustomId: (id: string) => 'dispatch:panel-btn:' + panelId + ':' + id
  };
  const select = panelComponents({ ...base, style: 'SELECT' }).map((row) => row.toJSON() as any);
  assert.equal(select.length, 1);
  const menu = select[0].components[0];
  assert.equal(menu.custom_id, 'dispatch:open:' + panelId);
  assert.equal(menu.placeholder, 'Seleziona una categoria');
  assert.deepEqual(menu.options.map((option: any) => option.value), entries.map((entry) => entry.id));
  assert.equal(menu.options[0].label, 'Supporto');
  assert.equal(menu.options[0].description, 'Aiuto');
  assert.deepEqual(menu.options[0].emoji, { name: 'help', id: '990000000000007004' });
  assert.equal(menu.options[1].description, 'Descrizione 1');

  const buttons = panelComponents({ ...base, style: 'BUTTONS' }).map((row) => row.toJSON() as any);
  assert.deepEqual(buttons.map((row) => row.components.length), [5, 2]);
  const first = buttons[0].components[0];
  assert.equal(first.custom_id, 'dispatch:panel-btn:' + panelId + ':' + entries[0]!.id);
  assert.ok(first.custom_id.length <= 100);
  assert.equal(first.label, 'Supporto');
  assert.equal(first.style, 3);
  assert.equal(buttons[0].components[1].style, 1);
  assert.equal(buttons[0].components[1].emoji, undefined);
});

test('ticket panel buttons re-check panel message and category before opening', async () => {
  const user = '990000000000000004';
  const included = await category({ name: 'Included' });
  const excluded = await category({ name: 'Excluded' });
  const channelId = '990000000000006101';
  const messageId = '990000000000006102';
  const panel = await prisma.ticketPanel.create({ data: {
    guildId: G, name: 'Buttons', channelId, messageId, title: 'Panel', style: 'BUTTONS', categoryIds: [included.id]
  } });
  const replies: any[] = [];
  const interaction = (categoryId: string, message = messageId) => ({
    customId: 'dispatch:panel-btn:' + panel.id + ':' + categoryId, guildId: G, channelId,
    user: { id: user }, message: { id: message },
    isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
    reply: async (payload: unknown) => { replies.push(payload); }
  });
  assert.equal(await handleTicketInteraction(interaction(included.id, '990000000000006103') as any), true);
  assert.match(replies.at(-1).content, /Pannello scaduto/);
  await handleTicketInteraction(interaction(excluded.id) as any);
  assert.match(replies.at(-1).content, /non e piu disponibile/);
  await prisma.ticketCategory.update({ where: { id: included.id }, data: { enabled: false } });
  await handleTicketInteraction(interaction(included.id) as any);
  assert.match(replies.at(-1).content, /non e piu disponibile/);
  assert.equal(await prisma.ticketUserGuard.count({ where: { guildId: G, userId: user } }), 0);
});

// Ticket log channel, closed category and staff channel deletion
// (migration 20261011100000_logs_closed_category).
const OPEN_PARENT = '990000000000007100';
const CLOSED_PARENT = '990000000000007101';
const FORM_PARENT = '990000000000007102';

// Minimal simulated Discord ticket channel: records moves, renames, messages
// and deletion. setParentHook can make the move fail like Discord would.
function fakeTicketChannel(
  row: { channelId: string; ticketNumber: number },
  parentId: string | null,
  setParentHook?: (parent: string | null) => Promise<void>
) {
  const state = {
    parentId,
    name: '',
    deleted: false,
    moves: [] as Array<{ parent: string | null; options: unknown }>,
    sent: [] as any[]
  };
  const channel = {
    id: row.channelId,
    guildId: G,
    type: ChannelType.GuildText,
    topic: 'Dispatch ticket #' + row.ticketNumber + ' - ' + U + ' - Support',
    get parentId() { return state.parentId; },
    permissionOverwrites: { edit: async () => undefined, delete: async () => undefined },
    setName: async (name: string) => { state.name = name; },
    setParent: async (parent: string | null, options: unknown) => {
      if (setParentHook) await setParentHook(parent);
      state.moves.push({ parent, options });
      state.parentId = parent;
    },
    send: async (payload: unknown) => { state.sent.push(payload); return { id: '990000000000008999' }; },
    delete: async () => { state.deleted = true; },
    messages: { fetch: async () => new Map() }
  };
  return { channel, state };
}
const channelClient = (channel: { id: string }) => client(async (id) => (id === channel.id ? channel : null));

test('log/closed-category migration keeps the previous behaviour by default', async () => {
  const cat = await category();
  const definition = await form();
  const row = await ticket(cat, { status: 'OPEN', closedAt: null });
  const settings = await prisma.guildSettings.findUniqueOrThrow({ where: { guildId: G } });
  assert.equal(settings.ticketLogChannelId, null);
  assert.deepEqual(settings.ticketLogEvents, []);
  assert.equal(cat.closedParentCategoryId, null);
  assert.equal(definition.ticketClosedParentCategoryId, null);
  assert.equal(row.sourceFormId, null);
  assert.equal(row.openParentId, null);
  assert.equal(row.channelDeletedAt, null);
  await assert.rejects(prisma.$executeRaw`UPDATE "GuildSettings" SET "ticketLogChannelId" = 'nope' WHERE "guildId" = ${G}`);
  await assert.rejects(prisma.$executeRaw`UPDATE "TicketCategory" SET "closedParentCategoryId" = 'nope' WHERE "id" = ${cat.id}`);
  // Deleting the source form keeps the ticket and only clears the link.
  const linked = await ticket(cat, { sourceFormId: definition.id });
  await prisma.formDefinition.delete({ where: { id: definition.id } });
  assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: linked.id } })).sourceFormId, null);
});

test('close moves the channel to the closed category keeping its overwrites, reopen moves it back', async () => {
  const cat = await category({ discordCategoryId: OPEN_PARENT, closedParentCategoryId: CLOSED_PARENT });
  const row = await ticket(cat, { status: 'OPEN', closedAt: null });
  const { channel, state } = fakeTicketChannel(row, OPEN_PARENT);
  const mock = channelClient(channel);
  await closeTicket(mock, G, row.id, OTHER, null);
  assert.deepEqual(state.moves, [{ parent: CLOSED_PARENT, options: { lockPermissions: false } }]);
  assert.equal(state.name, 'closed-' + String(row.ticketNumber).padStart(4, '0'));
  const closed = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.openParentId, OPEN_PARENT);
  const customIds = state.sent.flatMap((payload) => (payload.components ?? [])
    .flatMap((component: any) => component.toJSON().components.map((button: any) => button.custom_id)));
  assert.ok(customIds.includes('dispatch:reopen:' + row.id));
  assert.ok(customIds.includes('dispatch:delete-channel:' + row.id));

  await reopenTicket(mock, G, row.id, OTHER);
  assert.deepEqual(state.moves.at(-1), { parent: OPEN_PARENT, options: { lockPermissions: false } });
  const reopened = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(reopened.status, 'OPEN');
  assert.equal(reopened.openParentId, null);
});

test('the form closed-category override wins over the ticket category', async () => {
  const cat = await category({ discordCategoryId: OPEN_PARENT, closedParentCategoryId: CLOSED_PARENT });
  const definition = await prisma.formDefinition.create({ data: {
    guildId: G, name: 'Candidature', questions: [], ticketClosedParentCategoryId: FORM_PARENT
  } });
  const row = await ticket(cat, { status: 'OPEN', closedAt: null, sourceFormId: definition.id });
  const { channel, state } = fakeTicketChannel(row, OPEN_PARENT);
  await closeTicket(channelClient(channel), G, row.id, OTHER, null);
  assert.deepEqual(state.moves, [{ parent: FORM_PARENT, options: { lockPermissions: false } }]);
});

test('a failed move (category full, missing permission) never blocks the close', async () => {
  const cat = await category({ discordCategoryId: OPEN_PARENT, closedParentCategoryId: CLOSED_PARENT });
  const row = await ticket(cat, { status: 'OPEN', closedAt: null });
  const { channel, state } = fakeTicketChannel(row, OPEN_PARENT, async () => {
    throw Object.assign(new Error('Maximum number of channels in category reached'), { code: 50035 });
  });
  const mock = channelClient(channel);
  assert.equal((await closeTicket(mock, G, row.id, OTHER, null)).status, 'CLOSED');
  assert.equal(state.moves.length, 0);
  assert.equal(state.parentId, OPEN_PARENT);
  assert.equal(state.name, 'closed-' + String(row.ticketNumber).padStart(4, '0'));
  assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).status, 'CLOSED');
  const failure = await prisma.ticketAudit.findFirstOrThrow({ where: { ticketId: row.id, action: 'ticket.close.move_failed' } });
  assert.equal((failure.details as { code?: unknown }).code, 50035);
  // The channel never left its parent: reopening does not try to move it.
  await reopenTicket(mock, G, row.id, OTHER);
  assert.equal(state.moves.length, 0);
});

test('staff channel deletion secures the transcript, keeps the row and blocks reopening', async () => {
  const cat = await category({ reopenWindowHours: 24 });
  const row = await ticket(cat, { closedAt: new Date(Date.now() - 60_000) });
  const { channel, state } = fakeTicketChannel(row, null);
  const mock = channelClient(channel);
  await deleteTicketChannel(mock, G, row.id, OTHER);
  assert.equal(state.deleted, true);
  const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
  assert.ok(stored.channelDeletedAt);
  assert.equal(stored.status, 'CLOSED');
  // transcriptRetain (default) keeps a copy: deleting the channel loses nothing.
  assert.ok(await prisma.transcript.findUnique({ where: { ticketId: row.id } }));
  assert.equal(await prisma.ticketAudit.count({ where: { ticketId: row.id, action: 'ticket.channel.delete' } }), 1);
  await assert.rejects(deleteTicketChannel(mock, G, row.id, OTHER), /TICKET_CHANNEL_DELETED/);
  await assert.rejects(reopenTicket(mock, G, row.id, OTHER), /TICKET_CHANNEL_DELETED/);
  await assert.rejects(reopenTicket(mock, G, row.id, U, true), /TICKET_CHANNEL_DELETED/);

  const open = await ticket(cat, { status: 'OPEN', closedAt: null });
  const openChannel = fakeTicketChannel(open, null);
  await assert.rejects(deleteTicketChannel(channelClient(openChannel.channel), G, open.id, OTHER), /TICKET_NOT_CLOSED/);
  assert.equal(openChannel.state.deleted, false);

  // Retention treats a staff-deleted channel as already absent.
  await prisma.ticket.update({ where: { id: row.id }, data: { closedAt: new Date(Date.now() - 4 * DAY) } });
  await prisma.guildSettings.update({ where: { guildId: G }, data: { closedTicketRetentionDays: 1, retentionDeleteDiscordChannel: true } });
  let fetched = false;
  await runTicketRetention(client(async () => { fetched = true; return null; }));
  assert.equal(fetched, false);
  assert.equal(await prisma.ticket.findUnique({ where: { id: row.id } }), null);
});

test('only staff can delete a closed ticket channel from Discord, with an expiring confirmation', async () => {
  const STAFF_ROLE = '990000000000007201';
  const cat = await category({ staffRoleIds: [STAFF_ROLE] });
  const row = await ticket(cat, { closedAt: new Date(Date.now() - 60_000) });
  const { channel, state } = fakeTicketChannel(row, null);
  const replies: any[] = [];
  const member = (staff: boolean) => ({
    permissions: { has: () => false },
    roles: { cache: { has: (roleId: string) => staff && roleId === STAFF_ROLE } }
  });
  const interaction = (customId: string, staff: boolean) => ({
    customId, guildId: G, channelId: row.channelId, user: { id: U }, client: channelClient(channel),
    guild: { members: { fetch: async () => member(staff) } },
    isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
    reply: async (payload: unknown) => { replies.push(payload); },
    update: async (payload: unknown) => { replies.push(payload); },
    editReply: async (payload: unknown) => { replies.push(payload); }
  });
  // The opener without staff roles can neither ask nor confirm.
  await handleTicketInteraction(interaction('dispatch:delete-channel:' + row.id, false) as any);
  assert.match(replies.at(-1).content, /permessi/);
  const expiry = (Date.now() + 60_000).toString(36);
  await handleTicketInteraction(interaction('dispatch:delete-confirm:' + row.id + ':' + expiry, false) as any);
  assert.match(replies.at(-1).content, /permessi/);
  await handleTicketInteraction(interaction('dispatch:delete-confirm:' + row.id + ':' + (Date.now() - 1).toString(36), true) as any);
  assert.match(replies.at(-1).content, /scaduta/);
  assert.equal(state.deleted, false);

  await handleTicketInteraction(interaction('dispatch:delete-channel:' + row.id, true) as any);
  const prompt = replies.at(-1);
  assert.equal(prompt.ephemeral, true);
  const confirmId: string = prompt.components[0].toJSON().components[0].custom_id;
  assert.ok(confirmId.startsWith('dispatch:delete-confirm:' + row.id + ':'));
  assert.ok(confirmId.length <= 100);
  await handleTicketInteraction(interaction(confirmId, true) as any);
  assert.equal(state.deleted, true);
  assert.ok((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).channelDeletedAt);
});

test('ticket log posts only enabled events, never throws and never includes encrypted content', async () => {
  const LOG = '990000000000007301';
  const sent: any[] = [];
  const logChannel = { id: LOG, guildId: G, type: ChannelType.GuildText, send: async (payload: unknown) => { sent.push(payload); } };
  const cat = await category({ name: 'Supporto' });
  const row = await ticket(cat, { status: 'OPEN', closedAt: null });
  const { channel } = fakeTicketChannel(row, null);
  const mock = client(async (id) => (id === LOG ? logChannel : id === row.channelId ? channel : null));
  try {
    await prisma.guildSettings.update({ where: { guildId: G }, data: { ticketLogChannelId: LOG, ticketLogEvents: ['TICKET_CLOSE'] } });
    invalidateTicketLogSettings(G);
    assert.equal(await logTicketEvent(mock, G, 'TICKET_OPEN', { ticket: row }), false);
    assert.equal(sent.length, 0);

    await closeTicket(mock, G, row.id, OTHER, 'segreto-di-chiusura');
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].allowedMentions, { parse: [] });
    const embed = sent[0].embeds[0].toJSON();
    assert.equal(embed.title, 'Ticket chiuso');
    assert.ok(!JSON.stringify(embed).includes('segreto-di-chiusura'));

    // Discord failures, foreign or wrong-type channels and a missing guild are swallowed.
    const failing = client(async () => ({ ...logChannel, send: async () => { throw Object.assign(new Error('Missing Access'), { code: 50001 }); } }));
    assert.equal(await logTicketEvent(failing, G, 'TICKET_CLOSE', { ticket: row }), false);
    const foreign = client(async () => ({ ...logChannel, guildId: '990000000000000099' }));
    assert.equal(await logTicketEvent(foreign, G, 'TICKET_CLOSE', { ticket: row }), false);
    const voice = client(async () => ({ ...logChannel, type: ChannelType.GuildVoice }));
    assert.equal(await logTicketEvent(voice, G, 'TICKET_CLOSE'), false);
    assert.equal(await logTicketEvent({ guilds: { cache: new Map() } } as unknown as Client, G, 'TICKET_CLOSE'), false);
    assert.equal(sent.length, 1);

    await prisma.guildSettings.update({ where: { guildId: G }, data: { ticketLogEvents: [] } });
    invalidateTicketLogSettings(G);
    assert.equal(await logTicketEvent(mock, G, 'TICKET_CLOSE', { ticket: row }), false);
    assert.equal(sent.length, 1);
  } finally {
    invalidateTicketLogSettings();
  }
});

test('BLACKLIST log RPC payload accepts only structured fields', () => {
  const base = { event: 'BLACKLIST', action: 'add', targetUserId: U, actorId: OTHER };
  assert.deepEqual(parseBlacklistLogPayload(base), { ...base, expiresAt: null });
  assert.equal(
    parseBlacklistLogPayload({ ...base, expiresAt: '2026-10-12T10:00:00.000Z' }).expiresAt,
    '2026-10-12T10:00:00.000Z'
  );
  assert.equal(parseBlacklistLogPayload({ ...base, action: 'remove' }).action, 'remove');
  for (const invalid of [
    { ...base, reason: 'testo libero' },
    { ...base, content: '@everyone' },
    { ...base, event: 'TICKET_OPEN' },
    { ...base, action: 'ban' },
    { ...base, targetUserId: 'abc' },
    { ...base, actorId: '<@990000000000000002>' },
    { ...base, expiresAt: 'domani' },
    { ...base, action: 'remove', expiresAt: '2026-10-12T10:00:00.000Z' },
    null,
    [],
    'BLACKLIST'
  ]) {
    assert.throws(() => parseBlacklistLogPayload(invalid), /INVALID_TICKET_LOG_EVENT/);
  }
  assert.deepEqual(normalizeTicketLogEvents(['BLACKLIST', 'NOPE', 'TICKET_OPEN', 'BLACKLIST']), ['TICKET_OPEN', 'BLACKLIST']);
});

// Ratings attribution, moderator leaderboard and private staff threads
// (migration 20261012100000_ratings_leaderboard_threads).
const RATINGS_MIGRATION = resolve('packages/db/prisma/migrations/20261012100000_ratings_leaderboard_threads/migration.sql');
const MOD1 = '990000000000000011';
const MOD2 = '990000000000000012';
const NON_STAFF = '990000000000000013';
const STAFF_ROLE_X = '990000000000007401';
const THREAD_ID = '990000000000007402';
const ARCHIVE = '990000000000007403';
const LOG_CHANNEL = '990000000000007404';
const LB_CHANNEL = '990000000000007405';

function memberFor(staff: boolean) {
  return {
    permissions: { has: () => false },
    roles: { cache: { has: (roleId: string) => staff && roleId === STAFF_ROLE_X } }
  };
}

// Simulated guild: channels by id (mutable), staff members and the bot's
// guild-wide thread permissions (members.me).
function guildClient(channels: Record<string, unknown>, staffIds: string[] = [], threadsAllowed = true) {
  const guild = {
    id: G,
    available: true,
    channels: { fetch: async (id: string) => channels[id] ?? null },
    members: {
      me: { permissions: { has: () => threadsAllowed } },
      fetch: async (id: string) => memberFor(staffIds.includes(id))
    }
  };
  const mock = { isReady: () => true, user: { id: OTHER }, guilds: { cache: new Map([[G, guild]]) } } as unknown as Client;
  return { client: mock, guild };
}

function fakeThread(parentId: string, id = THREAD_ID, messages: any[] = []) {
  const state = { added: [] as string[], sent: [] as any[], edits: [] as any[], archived: false, locked: false, deleted: false };
  const page = Object.assign(new Map(messages.map((message) => [message.id, message])), {
    last: () => messages[messages.length - 1]
  });
  const thread = {
    id,
    guildId: G,
    parentId,
    type: ChannelType.PrivateThread,
    isThread: () => true,
    get archived() { return state.archived; },
    get locked() { return state.locked; },
    members: { add: async (userId: string) => { state.added.push(userId); } },
    messages: { fetch: async () => page },
    send: async (payload: unknown) => { state.sent.push(payload); },
    edit: async (options: { archived?: boolean; locked?: boolean }) => {
      state.edits.push(options);
      if (options.archived !== undefined) state.archived = options.archived;
      if (options.locked !== undefined) state.locked = options.locked;
    },
    setArchived: async (value: boolean) => { state.archived = value; },
    delete: async () => { state.deleted = true; }
  };
  return { thread, state };
}

// Ticket channel that records overwrite edits and creates fake threads.
function threadedChannel(row: { channelId: string; ticketNumber: number }) {
  const base = fakeTicketChannel(row, null);
  const edits: Array<{ id: string; options: any }> = [];
  const created: Array<{ options: any; thread: ReturnType<typeof fakeThread> }> = [];
  Object.assign(base.channel, {
    permissionOverwrites: {
      edit: async (id: string, options: unknown) => { edits.push({ id, options }); },
      delete: async () => undefined
    },
    threads: {
      create: async (options: unknown) => {
        const thread = fakeThread(row.channelId);
        created.push({ options, thread });
        return thread.thread;
      }
    }
  });
  return { ...base, edits, created };
}

function textChannel(id: string, sink: any[]) {
  return {
    id,
    guildId: G,
    type: ChannelType.GuildText,
    isTextBased: () => true,
    send: async (payload: unknown) => { sink.push(payload); return { id: '990000000000008998' }; }
  };
}

test('ratings/leaderboard/threads migration: defaults, backfill and constraints', async () => {
  const settings = await prisma.guildSettings.findUniqueOrThrow({ where: { guildId: G } });
  assert.equal(settings.leaderboardChannelId, null);
  assert.equal(settings.leaderboardWeekly, false);
  assert.equal(settings.leaderboardMonthly, false);
  assert.equal(settings.leaderboardSize, 10);
  assert.equal(settings.leaderboardMinRatings, 3);
  assert.equal(settings.leaderboardWeekday, 1);
  assert.equal(settings.leaderboardHour, 9);
  assert.equal(settings.leaderboardLastWeekly, null);
  assert.equal(settings.leaderboardLastMonthly, null);

  const cat = await category();
  const closed = await ticket(cat, { claimedById: MOD1 });
  const open = await ticket(cat, { status: 'OPEN', closedAt: null, claimedById: MOD2 });
  const unclaimed = await ticket(cat);
  for (const row of [closed, open, unclaimed]) {
    assert.equal(row.closedById, null);
    assert.equal(row.handledById, null);
    assert.equal(row.staffThreadId, null);
  }
  await prisma.ticketFeedback.create({ data: { ticketId: closed.id, guildId: G, userId: U, rating: 5 } });
  await prisma.ticketFeedback.create({ data: { ticketId: unclaimed.id, guildId: G, userId: U, rating: 2 } });

  // Rows as they were before the migration: run its backfill statements.
  const statements = readFileSync(RATINGS_MIGRATION, 'utf8').split(';')
    .map((chunk) => chunk.slice(Math.max(0, chunk.indexOf('UPDATE'))).trim())
    .filter((chunk) => chunk.startsWith('UPDATE '));
  assert.equal(statements.length, 2);
  for (let run = 0; run < 2; run++) {
    for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  }
  assert.equal((await prisma.ticketFeedback.findUniqueOrThrow({ where: { ticketId: closed.id } })).staffUserId, MOD1);
  assert.equal((await prisma.ticketFeedback.findUniqueOrThrow({ where: { ticketId: unclaimed.id } })).staffUserId, null);
  assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: closed.id } })).handledById, MOD1);
  assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: open.id } })).handledById, null);
  assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: unclaimed.id } })).handledById, null);

  await assert.rejects(prisma.$executeRaw`UPDATE "GuildSettings" SET "leaderboardSize" = 2 WHERE "guildId" = ${G}`);
  await assert.rejects(prisma.$executeRaw`UPDATE "GuildSettings" SET "leaderboardMinRatings" = 51 WHERE "guildId" = ${G}`);
  await assert.rejects(prisma.$executeRaw`UPDATE "GuildSettings" SET "leaderboardWeekday" = 0 WHERE "guildId" = ${G}`);
  await assert.rejects(prisma.$executeRaw`UPDATE "GuildSettings" SET "leaderboardHour" = 24 WHERE "guildId" = ${G}`);
  await assert.rejects(prisma.$executeRaw`UPDATE "GuildSettings" SET "leaderboardLastWeekly" = '2026-41' WHERE "guildId" = ${G}`);
  await assert.rejects(prisma.$executeRaw`UPDATE "GuildSettings" SET "leaderboardChannelId" = 'nope' WHERE "guildId" = ${G}`);
  await assert.rejects(prisma.$executeRaw`UPDATE "Ticket" SET "staffThreadId" = 'nope' WHERE "id" = ${open.id}`);
  await assert.rejects(prisma.$executeRaw`UPDATE "TicketFeedback" SET "staffUserId" = '<@1>' WHERE "ticketId" = ${closed.id}`);
});

test('feedback is attributed to the claimer, otherwise to the staff closer, never to the opener or the auto-close', async () => {
  const cat = await category({ staffRoleIds: [STAFF_ROLE_X] });
  const submitFeedback = async (mock: Client, ticketId: string) => {
    await handleTicketInteraction({
      customId: 'dispatch:feedback-modal:' + ticketId + ':4', guildId: G, channelId: '990000000000000998',
      user: { id: U }, client: mock, fields: { getTextInputValue: () => '' },
      isButton: () => false, isStringSelectMenu: () => false, isModalSubmit: () => true,
      reply: async () => undefined
    } as any);
    return (await prisma.ticketFeedback.findUniqueOrThrow({ where: { ticketId } })).staffUserId;
  };
  const closeWith = async (extra: Record<string, unknown>, actorId: string, staffIds = [MOD1, MOD2]) => {
    const row = await ticket(cat, { status: 'OPEN', closedAt: null, ...extra });
    const { channel, state } = fakeTicketChannel(row, null);
    const { client: mock } = guildClient({ [row.channelId]: channel }, staffIds);
    await closeTicket(mock, G, row.id, actorId, null);
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
    const prompt = state.sent.find((payload) => payload.components);
    return { row, stored, prompt, mock };
  };

  // Claimed by MOD1, closed by the staff member MOD2: MOD1 handled it.
  const claimed = await closeWith({ status: 'IN_PROGRESS', claimedById: MOD1 }, MOD2);
  assert.equal(claimed.stored.closedById, MOD2);
  assert.equal(claimed.stored.handledById, MOD1);
  assert.ok(claimed.prompt.content.includes('Valuta l’assistenza ricevuta da <@' + MOD1 + '>'));
  assert.deepEqual(claimed.prompt.allowedMentions, { parse: [] });
  assert.equal(await submitFeedback(claimed.mock, claimed.row.id), MOD1);
  // The snapshot survives a later change of the claimer.
  await prisma.ticket.update({ where: { id: claimed.row.id }, data: { claimedById: null } });
  assert.equal((await prisma.ticketFeedback.findUniqueOrThrow({ where: { ticketId: claimed.row.id } })).staffUserId, MOD1);

  // Unclaimed, closed by staff: the closer.
  const staffClosed = await closeWith({}, MOD2);
  assert.equal(staffClosed.stored.handledById, MOD2);
  assert.equal(await submitFeedback(staffClosed.mock, staffClosed.row.id), MOD2);

  // Unclaimed, closed by the opener (even one with a staff role) or by the
  // automatic close (the bot): unattributed, generic prompt.
  for (const [actorId, staffIds] of [[U, [MOD1]], [U, [U]], [OTHER, [OTHER]]] as Array<[string, string[]]>) {
    const result = await closeWith({}, actorId, staffIds);
    assert.equal(result.stored.closedById, null);
    assert.equal(result.stored.handledById, null);
    assert.ok(result.prompt.content.includes('Puoi valutare l’assistenza ricevuta.'));
    assert.equal(await submitFeedback(result.mock, result.row.id), null);
  }

  // A non-staff closer is never credited either.
  const outsider = await closeWith({}, NON_STAFF);
  assert.equal(outsider.stored.closedById, null);

  // Reopen clears the attribution of the previous close.
  await reopenTicket(staffClosed.mock, G, staffClosed.row.id, MOD2);
  const reopened = await prisma.ticket.findUniqueOrThrow({ where: { id: staffClosed.row.id } });
  assert.equal(reopened.closedById, null);
  assert.equal(reopened.handledById, null);
  assert.equal(await prisma.ticketFeedback.count({ where: { ticketId: staffClosed.row.id } }), 0);
});

test('leaderboard ranking: handled tickets, rating only above the minimum, rating count, shared ranks', () => {
  const [A, B, C, D, E] = ['990000000000000021', '990000000000000022', '990000000000000023', '990000000000000024', '990000000000000025'];
  const activity = {
    handled: [A, A, A, B, B, B, C, C, D, 'not-a-snowflake'],
    feedback: [
      { staffId: A, rating: 3 }, { staffId: A, rating: 3 }, { staffId: A, rating: 3 },
      { staffId: B, rating: 5 }, { staffId: B, rating: 5 },
      { staffId: C, rating: 4 }, { staffId: C, rating: 4 }, { staffId: C, rating: 4 },
      { staffId: D, rating: 5 }, { staffId: E, rating: 7 }
    ],
    firstResponses: [{ staffId: A, minutes: 10 }, { staffId: A, minutes: 30 }, { staffId: A, minutes: 20 }, { staffId: B, minutes: 5 }],
    claims: [A, E, '<@1>']
  };
  const ranked = rankLeaderboard(activity, { minRatings: 3 });
  assert.deepEqual(ranked.map((entry) => entry.userId), [A, B, C, D, E]);
  assert.deepEqual(ranked.map((entry) => entry.rank), [1, 2, 3, 4, 5]);
  assert.equal(ranked[0]!.averageRating, 3);
  assert.equal(ranked[0]!.medianFirstResponseMinutes, 20);
  assert.equal(ranked[0]!.claims, 1);
  // B has two 5-star ratings: below the minimum, shown as "—" and ranked below A.
  assert.equal(ranked[1]!.averageRating, null);
  assert.equal(ranked[1]!.feedbackCount, 2);
  assert.equal(ranked[2]!.averageRating, 4);
  assert.equal(ranked[4]!.handled, 0);
  assert.equal(ranked[4]!.feedbackCount, 0);
  // Without a minimum B's average counts and wins the tie on handled tickets.
  assert.deepEqual(rankLeaderboard(activity, { minRatings: 0 }).slice(0, 2).map((entry) => entry.userId), [B, A]);
  assert.equal(rankLeaderboard(activity, { minRatings: 3, size: 2 }).length, 2);

  // Full ties share the rank (ordered by id for a stable output).
  const [X, Y, Z] = ['990000000000000031', '990000000000000032', '990000000000000033'];
  const tied = rankLeaderboard({ handled: [Y, X], feedback: [], firstResponses: [], claims: [Z] }, { minRatings: 3 });
  assert.deepEqual(tied.map((entry) => [entry.userId, entry.rank]), [[X, 1], [Y, 1], [Z, 3]]);

  assert.equal(median([40, 10, 30, 20]), 25);
  assert.equal(median([]), null);
  assert.equal(formatLeaderboardMinutes(null), '—');
  assert.equal(formatLeaderboardMinutes(0.4), '<1 min');
  assert.equal(formatLeaderboardMinutes(42), '42 min');
  assert.equal(formatLeaderboardMinutes(185), '3 h 05 min');
  assert.equal(formatLeaderboardMinutes(3000), '2 g 2 h');
});

test('leaderboard periods: ISO weeks and months in the guild timezone, DST and year boundaries', () => {
  const rome = 'Europe/Rome';
  const iso = (value: Date) => value.toISOString();

  const week = leaderboardPeriod('week', new Date('2026-10-10T10:00:00Z'), rome);
  assert.equal(week.key, '2026-W41');
  assert.equal(iso(week.start), '2026-10-04T22:00:00.000Z');
  assert.equal(iso(week.end), '2026-10-11T22:00:00.000Z');
  assert.equal(week.label, 'settimana dal 5 all’11 ottobre 2026');
  assert.equal(leaderboardTitle(week), 'Classifica moderatori — settimana dal 5 all’11 ottobre 2026');

  // Autumn DST change (25 Oct 2026): the week lasts 7 days + 1 hour.
  const autumn = leaderboardPeriod('week', new Date('2026-10-25T12:00:00Z'), rome);
  assert.equal(autumn.key, '2026-W43');
  assert.equal(iso(autumn.start), '2026-10-18T22:00:00.000Z');
  assert.equal(iso(autumn.end), '2026-10-25T23:00:00.000Z');
  // Spring DST change (29 Mar 2026): 7 days - 1 hour.
  const spring = leaderboardPeriod('week', new Date('2026-03-29T12:00:00Z'), rome);
  assert.equal(spring.key, '2026-W13');
  assert.equal(iso(spring.start), '2026-03-22T23:00:00.000Z');
  assert.equal(iso(spring.end), '2026-03-29T22:00:00.000Z');
  // A wall time inside the spring-forward gap resolves after it.
  assert.equal(iso(zonedTimeToUtc({ year: 2026, month: 3, day: 29 }, 2, 30, rome)), '2026-03-29T01:30:00.000Z');

  // 2026 has 53 ISO weeks: 28 Dec 2026 - 3 Jan 2027 is 2026-W53, then 2027-W01.
  const w53 = leaderboardPeriod('week', new Date('2027-01-02T12:00:00Z'), rome);
  assert.equal(w53.key, '2026-W53');
  assert.equal(iso(w53.start), '2026-12-27T23:00:00.000Z');
  assert.equal(iso(w53.end), '2027-01-03T23:00:00.000Z');
  assert.equal(w53.label, 'settimana dal 28 dicembre 2026 al 3 gennaio 2027');
  assert.equal(leaderboardPeriod('week', new Date('2027-01-04T12:00:00Z'), rome).key, '2027-W01');
  assert.equal(leaderboardPeriod('week', new Date('2027-01-04T12:00:00Z'), rome, 1).key, '2026-W53');
  assert.deepEqual(isoWeek({ year: 2021, month: 1, day: 3 }), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek({ year: 2024, month: 12, day: 30 }), { year: 2025, week: 1 });

  // The local date decides the period: Monday 01:30 in Rome is Sunday in UTC.
  const instant = new Date('2026-10-11T23:30:00Z');
  assert.equal(leaderboardPeriod('week', instant, rome).key, '2026-W42');
  assert.equal(leaderboardPeriod('week', instant, 'UTC').key, '2026-W41');
  assert.equal(leaderboardPeriod('week', instant, 'Not/AZone').key, '2026-W42');
  assert.equal(safeTimeZone('Not/AZone'), rome);

  const month = leaderboardPeriod('month', new Date('2026-10-10T10:00:00Z'), rome, 1);
  assert.equal(month.key, '2026-09');
  assert.equal(month.label, 'settembre 2026');
  assert.equal(iso(month.start), '2026-08-31T22:00:00.000Z');
  assert.equal(iso(month.end), '2026-09-30T22:00:00.000Z');
  assert.equal(leaderboardPeriod('month', new Date('2027-01-15T10:00:00Z'), rome, 1).key, '2026-12');
  // October contains the DST change: it ends at local midnight in CET.
  const october = leaderboardPeriod('month', new Date('2026-10-10T10:00:00Z'), rome);
  assert.equal(iso(october.end), '2026-10-31T23:00:00.000Z');
});

test('leaderboard schedule: due after the local weekday/hour slot and only for a new period key', () => {
  const base = { timezone: 'Europe/Rome', weekly: true, monthly: false, weekday: 1, hour: 9, lastWeekly: null, lastMonthly: null };
  const keys = (schedule: typeof base | Record<string, unknown>, now: string) =>
    dueLeaderboardPeriods(schedule as typeof base, new Date(now)).map((period) => period.key);
  assert.deepEqual(keys(base, '2026-10-12T06:59:00Z'), []); // Monday 08:59 in Rome
  assert.deepEqual(keys(base, '2026-10-12T07:00:00Z'), ['2026-W41']);
  assert.deepEqual(keys(base, '2026-10-15T20:00:00Z'), ['2026-W41']); // late (bot offline): still the previous week
  assert.deepEqual(keys({ ...base, lastWeekly: '2026-W41' }, '2026-10-12T07:00:00Z'), []);
  assert.deepEqual(keys({ ...base, weekday: 7, hour: 23 }, '2026-10-18T20:59:00Z'), []);
  assert.deepEqual(keys({ ...base, weekday: 7, hour: 23 }, '2026-10-18T21:00:00Z'), ['2026-W41']);
  // After the autumn DST change 09:00 in Rome is 08:00 UTC.
  assert.deepEqual(keys({ ...base, lastWeekly: '2026-W42' }, '2026-10-26T07:59:00Z'), []);
  assert.deepEqual(keys({ ...base, lastWeekly: '2026-W42' }, '2026-10-26T08:00:00Z'), ['2026-W43']);

  const monthly = { ...base, weekly: false, monthly: true };
  assert.deepEqual(keys(monthly, '2026-10-01T06:59:00Z'), []);
  assert.deepEqual(keys(monthly, '2026-10-01T07:00:00Z'), ['2026-09']);
  assert.deepEqual(keys({ ...monthly, lastMonthly: '2026-09' }, '2026-10-20T07:00:00Z'), []);
  assert.deepEqual(keys({ ...monthly, weekly: true }, '2027-01-04T08:00:00Z'), ['2026-W53', '2026-12']);
});

test('leaderboard posting is claimed once per period, even with concurrent workers, and released on failure', async () => {
  const claims = await Promise.all(Array.from({ length: 6 }, () => claimLeaderboardPeriod(G, 'week', null, '2026-W41')));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(await claimLeaderboardPeriod(G, 'week', null, '2026-W41'), false);
  await releaseLeaderboardPeriod(G, 'week', '2026-W41', null);
  assert.equal((await prisma.guildSettings.findUniqueOrThrow({ where: { guildId: G } })).leaderboardLastWeekly, null);
  assert.equal(await claimLeaderboardPeriod(G, 'month', null, '2026-09'), true);

  await prisma.guildSettings.update({ where: { guildId: G }, data: {
    leaderboardLastMonthly: null, leaderboardChannelId: LB_CHANNEL, leaderboardWeekly: true, leaderboardMinRatings: 1
  } });
  const cat = await category();
  const handled = await ticket(cat, { closedAt: new Date('2026-10-08T10:00:00Z'), claimedById: MOD1, handledById: MOD1 });
  await prisma.ticketFeedback.create({ data: {
    ticketId: handled.id, guildId: G, userId: U, rating: 5, staffUserId: MOD1, createdAt: new Date('2026-10-08T11:00:00Z')
  } });
  const sent: any[] = [];
  const { client: mock } = guildClient({ [LB_CHANNEL]: textChannel(LB_CHANNEL, sent) });

  // Monday 10:00 in Rome: two workers race, one post.
  const now = new Date('2026-10-12T08:00:00Z');
  const results = await Promise.all([runLeaderboardCycle(mock, now), runLeaderboardCycle(mock, now)]);
  assert.equal(results.reduce((sum, result) => sum + result.posted, 0), 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  const embed = sent[0].embeds[0].toJSON();
  assert.equal(embed.title, 'Classifica moderatori — settimana dal 5 all’11 ottobre 2026');
  assert.ok(embed.description.includes('🥇 <@' + MOD1 + '> · 1 ticket · ⭐ 5.00 (1)'));
  assert.equal((await prisma.guildSettings.findUniqueOrThrow({ where: { guildId: G } })).leaderboardLastWeekly, '2026-W41');

  // Restart later in the same week: nothing new.
  await runLeaderboardCycle(mock, new Date('2026-10-14T08:00:00Z'));
  assert.equal(sent.length, 1);

  // Empty period: short message, still marked as done.
  await runLeaderboardCycle(mock, new Date('2026-10-19T08:00:00Z'));
  assert.equal(sent.length, 2);
  assert.equal(sent[1].embeds[0].toJSON().description, 'Nessun ticket gestito in questo periodo.');
  assert.equal((await prisma.guildSettings.findUniqueOrThrow({ where: { guildId: G } })).leaderboardLastWeekly, '2026-W42');

  // Discord refuses the post: the key is released for the next cycle.
  const failing = guildClient({ [LB_CHANNEL]: { ...textChannel(LB_CHANNEL, sent), send: async () => {
    throw Object.assign(new Error('Missing Access'), { code: 50001 });
  } } }).client;
  const failed = await runLeaderboardCycle(failing, new Date('2026-10-26T08:00:00Z'));
  assert.equal(failed.failed, 1);
  assert.equal((await prisma.guildSettings.findUniqueOrThrow({ where: { guildId: G } })).leaderboardLastWeekly, '2026-W42');
  await runLeaderboardCycle(mock, new Date('2026-10-26T08:00:00Z'));
  assert.equal((await prisma.guildSettings.findUniqueOrThrow({ where: { guildId: G } })).leaderboardLastWeekly, '2026-W43');
});

test('new ticket channels deny threads to opener and participants; staff may only write in them', () => {
  const base = { guildId: G, botId: OTHER, openerId: U, staffRoleIds: [STAFF_ROLE_X] };
  const has = (bits: bigint[] | undefined, flag: bigint) => Boolean(bits?.includes(flag));
  for (const threadsAllowed of [true, false]) {
    const [everyone, bot, opener, staff] = ticketChannelOverwrites({ ...base, threadsAllowed }) as Array<{ id: string; allow?: bigint[]; deny?: bigint[] }>;
    assert.equal(everyone!.id, G);
    assert.ok(has(everyone!.deny, PermissionFlagsBits.CreatePrivateThreads));
    assert.ok(has(everyone!.deny, PermissionFlagsBits.SendMessagesInThreads));
    assert.equal(opener!.id, U);
    assert.ok(!has(opener!.allow, PermissionFlagsBits.SendMessagesInThreads));
    assert.ok(!has(opener!.allow, PermissionFlagsBits.CreatePrivateThreads));
    assert.ok(has(staff!.deny, PermissionFlagsBits.CreatePrivateThreads));
    assert.ok(has(staff!.deny, PermissionFlagsBits.CreatePublicThreads));
    assert.equal(has(staff!.allow, PermissionFlagsBits.SendMessagesInThreads), threadsAllowed);
    assert.equal(has(bot!.allow, PermissionFlagsBits.ManageThreads), threadsAllowed);
    assert.equal(has(bot!.allow, PermissionFlagsBits.CreatePrivateThreads), threadsAllowed);
  }
});

test('staff thread button: staff only (never the opener), active tickets only, one thread per ticket', async () => {
  const cat = await category({ staffRoleIds: [STAFF_ROLE_X] });
  const row = await ticket(cat, { status: 'OPEN', closedAt: null });
  const { channel, edits, created } = threadedChannel(row);
  const channels: Record<string, unknown> = { [row.channelId]: channel };
  // U opened the ticket and also holds the staff role: still refused.
  const { client: mock, guild } = guildClient(channels, [MOD1, MOD2, U]);
  const replies: any[] = [];
  const press = (userId: string, target: Client = mock, targetGuild: unknown = guild, ticketId = row.id, channelId = row.channelId) =>
    handleTicketInteraction({
      customId: 'dispatch:staff-thread:' + ticketId, guildId: G, channelId, user: { id: userId },
      client: target, guild: targetGuild,
      isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
      reply: async (payload: unknown) => { replies.push(payload); },
      deferReply: async () => undefined,
      editReply: async (payload: unknown) => { replies.push(payload); }
    } as any);

  await press(U);
  assert.match(replies.at(-1).content, /Solo lo staff/);
  await press(NON_STAFF);
  assert.match(replies.at(-1).content, /Solo lo staff/);
  assert.equal(created.length, 0);
  assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).staffThreadId, null);

  await press(MOD1);
  assert.equal(created.length, 1);
  const options = created[0]!.options;
  assert.equal(options.name, 'staff-' + String(row.ticketNumber).padStart(4, '0'));
  assert.equal(options.type, ChannelType.PrivateThread);
  assert.equal(options.invitable, false);
  assert.equal(options.autoArchiveDuration, 10080);
  const thread = created[0]!.thread;
  assert.deepEqual(thread.state.added, [MOD1]);
  // The intro mentions (pings) the moderators added to the thread, nobody else.
  assert.deepEqual(thread.state.sent[0].allowedMentions, { parse: [], users: [MOD1] });
  assert.deepEqual(edits.find((edit) => edit.id === OTHER)?.options, {
    CreatePrivateThreads: true, SendMessagesInThreads: true, ManageThreads: true
  });
  assert.deepEqual(edits.find((edit) => edit.id === STAFF_ROLE_X)?.options, {
    SendMessagesInThreads: true, CreatePublicThreads: false, CreatePrivateThreads: false
  });
  assert.ok(!edits.some((edit) => edit.id === U));
  assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).staffThreadId, THREAD_ID);
  assert.ok(replies.at(-1).content.includes('<#' + THREAD_ID + '>'));
  assert.equal(await prisma.ticketAudit.count({ where: { ticketId: row.id, action: 'ticket.staff_thread.create' } }), 1);

  // Another staff member joins the same thread; the opener is never added.
  channels[THREAD_ID] = thread.thread;
  await press(MOD2);
  assert.equal(created.length, 1);
  assert.deepEqual(thread.state.added, [MOD1, MOD2]);
  await press(U);
  assert.deepEqual(thread.state.added, [MOD1, MOD2]);

  // Closed: the thread is locked/archived and the button is refused.
  await closeTicket(mock, G, row.id, MOD1, null);
  assert.equal(thread.state.locked, true);
  assert.equal(thread.state.archived, true);
  await press(MOD1);
  assert.match(replies.at(-1).content, /ticket attivi/);
  assert.deepEqual(thread.state.added, [MOD1, MOD2]);

  // Reopen unlocks it.
  await reopenTicket(mock, G, row.id, MOD1);
  assert.equal(thread.state.locked, false);
  assert.equal(thread.state.archived, false);

  // Bot role without thread permissions: clear message and audit, no thread.
  const other = await ticket(cat, { status: 'OPEN', closedAt: null });
  const otherChannel = threadedChannel(other);
  const limited = guildClient({ [other.channelId]: otherChannel.channel }, [MOD1], false);
  await press(MOD1, limited.client, limited.guild, other.id, other.channelId);
  assert.match(replies.at(-1).content, /Il bot non ha i permessi per creare thread privati: aggiorna i permessi del suo ruolo/);
  assert.equal(otherChannel.created.length, 0);
  assert.equal(await prisma.ticketAudit.count({ where: { ticketId: other.id, action: 'ticket.staff_thread.missing_permissions' } }), 1);
});

test('staff thread messages are neither ticket activity nor a first staff response', async () => {
  const cat = await category({ staffRoleIds: [STAFF_ROLE_X] });
  const lastActivityAt = new Date(Date.now() - DAY);
  const row = await ticket(cat, { status: 'OPEN', closedAt: null, lastActivityAt, staffThreadId: THREAD_ID });
  await recordTicketMessage({
    guildId: G, channelId: THREAD_ID, id: '990000000000009601', author: { id: MOD1, bot: false },
    channel: { type: ChannelType.PrivateThread, topic: null }, member: memberFor(true)
  } as any);
  const after = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(after.firstStaffResponseAt, null);
  assert.equal(after.lastActivityAt.getTime(), lastActivityAt.getTime());
});

test('staff thread transcript goes to the archive channel, else the log channel, else nowhere; never to the opener', async () => {
  assert.deepEqual(staffThreadTranscriptDestination(ARCHIVE, LOG_CHANNEL), { channelId: ARCHIVE, source: 'archive' });
  assert.deepEqual(staffThreadTranscriptDestination(null, LOG_CHANNEL), { channelId: LOG_CHANNEL, source: 'log' });
  assert.deepEqual(staffThreadTranscriptDestination('nope', LOG_CHANNEL), { channelId: LOG_CHANNEL, source: 'log' });
  assert.equal(staffThreadTranscriptDestination(null, null), null);

  const message = {
    id: '990000000000009500', content: 'nota interna <b>', createdTimestamp: 1, createdAt: new Date('2026-10-10T10:00:00Z'),
    author: { tag: 'moderatore' }, attachments: new Map(), embeds: []
  };
  const closeWithThread = async (categoryExtra: Record<string, unknown>, logChannelId: string | null) => {
    await prisma.guildSettings.update({ where: { guildId: G }, data: { ticketLogChannelId: logChannelId, ticketLogEvents: [] } });
    invalidateTicketLogSettings(G);
    const cat = await category({ staffRoleIds: [STAFF_ROLE_X], ...categoryExtra });
    const row = await ticket(cat, { status: 'OPEN', closedAt: null, staffThreadId: THREAD_ID });
    const { channel } = fakeTicketChannel(row, null);
    const { thread, state } = fakeThread(row.channelId, THREAD_ID, [message]);
    const sent: Record<string, any[]> = { [ARCHIVE]: [], [LOG_CHANNEL]: [] };
    const { client: mock } = guildClient({
      [row.channelId]: channel,
      [THREAD_ID]: thread,
      [ARCHIVE]: textChannel(ARCHIVE, sent[ARCHIVE]!),
      [LOG_CHANNEL]: textChannel(LOG_CHANNEL, sent[LOG_CHANNEL]!)
    }, [MOD1]);
    await closeTicket(mock, G, row.id, MOD1, null);
    // The staff copy never names or pings the opener (the user transcript of
    // the archive channel keeps its existing opener reference).
    for (const payload of [...sent[ARCHIVE]!, ...sent[LOG_CHANNEL]!]) {
      if ((payload.files ?? []).some((file: any) => String(file.name).endsWith('-staff.html'))) {
        assert.ok(!String(payload.content ?? '').includes(U));
        assert.deepEqual(payload.allowedMentions, { parse: [] });
      }
    }
    return { row, sent, state };
  };
  const staffFile = (payloads: any[], row: { ticketNumber: number }) =>
    payloads.flatMap((payload) => payload.files ?? []).find((file: any) => file.name === `dispatch-ticket-${row.ticketNumber}-staff.html`);

  try {
    // Archive channel configured: the staff copy goes there, next to the user
    // transcript, which never contains the thread.
    const archived = await closeWithThread({ transcriptChannelId: ARCHIVE, transcriptAutoGenerate: true, transcriptRetain: false }, LOG_CHANNEL);
    assert.equal(archived.sent[LOG_CHANNEL]!.length, 0);
    assert.equal(archived.sent[ARCHIVE]!.length, 2);
    const staffCopy = staffFile(archived.sent[ARCHIVE]!, archived.row);
    assert.ok(staffCopy);
    assert.ok(staffCopy.attachment.toString('utf8').includes('nota interna &lt;b&gt;'));
    const userCopy = archived.sent[ARCHIVE]!.flatMap((payload) => payload.files ?? [])
      .find((file: any) => file.name === `dispatch-ticket-${archived.row.ticketNumber}.html`);
    assert.ok(userCopy);
    assert.ok(!userCopy.attachment.toString('utf8').includes('nota interna'));
    assert.ok(archived.sent[ARCHIVE]!.every((payload) => Array.isArray(payload.allowedMentions?.parse) && payload.allowedMentions.parse.length === 0));
    assert.equal(archived.state.locked, true);
    assert.equal(archived.state.archived, true);
    const delivered = await prisma.ticketAudit.findFirstOrThrow({ where: { ticketId: archived.row.id, action: 'ticket.staff_thread.transcript' } });
    assert.equal((delivered.details as { destination?: unknown }).destination, 'archive');
    assert.equal((delivered.details as { delivered?: unknown }).delivered, true);

    // No archive channel: the server ticket log channel.
    const logged = await closeWithThread({}, LOG_CHANNEL);
    assert.equal(logged.sent[ARCHIVE]!.length, 0);
    assert.equal(logged.sent[LOG_CHANNEL]!.length, 1);
    assert.ok(staffFile(logged.sent[LOG_CHANNEL]!, logged.row));

    // Nothing configured: skipped and audited, the thread is still locked.
    const skipped = await closeWithThread({}, null);
    assert.equal(skipped.sent[ARCHIVE]!.length + skipped.sent[LOG_CHANNEL]!.length, 0);
    assert.equal(await prisma.ticketAudit.count({ where: { ticketId: skipped.row.id, action: 'ticket.staff_thread.transcript_skipped' } }), 1);
    assert.equal(skipped.state.locked, true);

    // Channel deletion after a delivered close does not send it twice.
    const { channel: logChannelTicket } = fakeTicketChannel(logged.row, null);
    const { thread } = fakeThread(logged.row.channelId, THREAD_ID, [message]);
    const resent: any[] = [];
    const { client: deleter } = guildClient({
      [logged.row.channelId]: logChannelTicket, [THREAD_ID]: thread, [LOG_CHANNEL]: textChannel(LOG_CHANNEL, resent)
    }, [MOD1]);
    await deleteTicketChannel(deleter, G, logged.row.id, MOD1);
    assert.equal(resent.length, 0);
  } finally {
    invalidateTicketLogSettings();
  }
});
