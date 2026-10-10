import { test, beforeEach, after } from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { prisma, PrismaClient } from '@dispatch/db';
import { ChannelType, type Client } from 'discord.js';
import {
  reserveTicketOpen, consumeTicketOpenReservation, releaseTicketOpenReservation,
  getTicketOpenReservation, commitTicketOpen, formVersion, allowOpeningInteraction
} from '../apps/bot/src/open-guard.js';
import { retentionDue, runTicketRetention } from '../apps/bot/src/retention.js';
import { closeTicket, deleteTicketChannel, reopenTicket } from '../apps/bot/src/ticket-operations.js';
import { handleTicketInteraction, publishMainMenu } from '../apps/bot/src/tickets.js';
import { panelComponents } from '../apps/bot/src/panels.js';
import { invalidateTicketLogSettings, logTicketEvent } from '../apps/bot/src/ticket-log.js';
import {
  isHttpsUrl, layoutPanelButtons, normalizePanelItems, normalizeTicketLogEvents, parseBlacklistLogPayload, parsePanelEmoji
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
