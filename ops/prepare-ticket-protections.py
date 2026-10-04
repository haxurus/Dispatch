from pathlib import Path
import hashlib
import re

EXPECTED = {
    'apps/bot/src/tickets.ts': 'f4215e19259a5bebd64d54acd82149497dde878d',
    'apps/bot/src/ticket-operations.ts': 'b5095cb299b50b399821b84ef4c051c61f990f8d',
    'apps/bot/src/index.ts': '429b63e74916cad1cc14f948ebf528154518edff',
    'apps/api/src/index.ts': '2916f9b597b17f564da0128de27ebf908f743a82',
    'packages/db/prisma/schema.prisma': '21a01a3f537fed571c67856d2886730b74737def',
    'deploy/runtime/harden-users.sh': '28dba87d48ea53206ee67bf9744fa3b0b2e0be10',
}
for name, expected in EXPECTED.items():
    raw = Path(name).read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    if actual != expected:
        raise RuntimeError('Source changed; refusing to overwrite: ' + name)

def replace(text, old, new, count=1):
    if text.count(old) != count:
        raise RuntimeError('Unexpected match count for: ' + old[:100])
    return text.replace(old, new)

def region(text, start, end, replacement):
    a = text.index(start)
    b = text.index(end, a)
    return text[:a] + replacement + text[b:]

p = Path('packages/db/prisma/schema.prisma')
s = p.read_text()
s = replace(s, 'model TicketUserGuard {\n', '''model TicketUserGuard {
  reservationToken       String?
  reservationCategoryId  String?
  reservationSourceKey   String?
  reservationFormVersion String?
  reservationPhase       String?
  lastViolationAt        DateTime?
''')
s = replace(s, 'model TicketOpenAttempt {\n', 'model TicketOpenAttempt {\n  openedAt DateTime?\n')
s = replace(s, '  @@index([createdAt])', '  @@index([createdAt])\n  @@index([guildId, userId, categoryId, openedAt(sort: Desc)])')
s = replace(s, 'model Ticket {\n', 'model Ticket {\n  retentionPendingAt DateTime?\n  retentionDeleteChannel Boolean?\n')
s = replace(s, '  @@index([status, id])', '  @@index([status, id])\n  @@index([guildId, status, closedAt])')
s = re.sub(r'(transcriptRetentionDays\s+Int\?)\s+@default\(30\)', r'\1', s)
s = re.sub(r'(closedTicketRetentionDays\s+Int\?)\s+@default\(90\)', r'\1', s)
s = re.sub(r'(retentionDeleteDiscordChannel\s+Boolean)\s+@default\(true\)', r'\1 @default(false)', s)
p.write_text(s)

p = Path('apps/bot/src/open-guard.ts')
s = p.read_text()
s = replace(s, 'where: { guildId, userId,\n          createdAt:', 'where: { guildId, userId, openedAt: null,\n          createdAt:')
s = replace(s, 'where: { guildId, userId, categoryId,\n          createdAt:', 'where: { guildId, userId, categoryId, openedAt: null,\n          createdAt:')
p.write_text(s)

p = Path('apps/bot/src/ticket-operations.ts')
s = p.read_text()
s = s[:s.index('export type TicketOpenReservationResult =')]
s = replace(s, "import { encryptText } from './security.js';", """import { encryptText } from './security.js';
import { assertTranscriptRetention, lockTicket } from './retention.js';
import { reserveTicketOpen, consumeTicketOpenReservation, commitTicketOpen,
  releaseTicketOpenReservation, formVersion } from './open-guard.js';""")
s = replace(s, "  if (!ticket) throw new Error('TICKET_NOT_FOUND');\n  return ticket;", "  if (!ticket) throw new Error('TICKET_NOT_FOUND');\n  if (ticket.retentionPendingAt) throw new Error('TICKET_RETENTION_PENDING');\n  return ticket;")
s = replace(s, '''export async function generateTranscript(client: Client, guildId: string, ticketId: string, actorId?: string) {
  const ticket = await getTicket(guildId, ticketId);''', '''export async function generateTranscript(client: Client, guildId: string, ticketId: string, actorId?: string) {
  const ticket = await getTicket(guildId, ticketId);
  await assertTranscriptRetention(ticket);''')
s = region(s, 'export async function reopenTicket(', 'export function ticketIsOpen', '''export async function reopenTicket(
  client: Client, guildId: string, ticketId: string, actorId: string, enforceUserWindow = false
) {
  const ticket = await getTicket(guildId, ticketId);
  if (enforceUserWindow && actorId !== ticket.openerId) throw new Error('REOPEN_NOT_OPENER');
  if (ticket.status !== 'CLOSED' && ticket.status !== 'REOPENING') throw new Error('TICKET_NOT_CLOSED');
  const { channel } = await getGuildChannel(client, guildId, ticket.channelId);
  if (ticket.status === 'CLOSED') {
    if (enforceUserWindow && (!ticket.category.reopenWindowHours || !ticket.closedAt)) throw new Error('REOPEN_DISABLED');
    if (enforceUserWindow && Date.now() >= ticket.closedAt!.getTime() + ticket.category.reopenWindowHours! * 3600000) {
      throw new Error('REOPEN_WINDOW_EXPIRED');
    }
    const reservation = await reserveTicketOpen(guildId, ticket.openerId, ticket.categoryId,
      'r_' + ticket.id, formVersion(ticket.category.formFields));
    if (!reservation.ok) throw new Error(reservation.code);
    if (!(await consumeTicketOpenReservation(guildId, ticket.openerId, reservation.token))) {
      throw new Error('REOPEN_RESERVATION_EXPIRED');
    }
    try {
      await commitTicketOpen(guildId, ticket.openerId, reservation.token, async (tx) => {
        await lockTicket(tx, ticket.id);
        const current = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
        if (current.retentionPendingAt) throw new Error('TICKET_RETENTION_PENDING');
        if (current.status !== 'CLOSED') throw new Error('TICKET_NOT_CLOSED');
        await tx.ticket.update({ where: { id: ticket.id }, data: { status: 'REOPENING' } });
      });
    } catch (error) {
      await releaseTicketOpenReservation(guildId, ticket.openerId, reservation.token);
      throw error;
    }
  }
  // REOPENING is durable: retention cannot remove the channel while Discord
  // permissions are restored. A failed restoration is safely retryable.
  try {
    for (const member of ticket.members) {
      await channel.permissionOverwrites.edit(member.userId, PARTICIPANT_PERMISSIONS);
    }
  } catch {
    throw new Error('REOPEN_PERMISSION_SYNC_PENDING');
  }
  await prisma.$transaction(async (tx) => {
    await lockTicket(tx, ticket.id);
    const changed = await tx.ticket.updateMany({ where: {
      id: ticket.id, status: 'REOPENING', retentionPendingAt: null
    }, data: {
      status: 'OPEN', closeReason: null, closedAt: null, claimedById: null,
      lastActivityAt: new Date(), escalatedAt: null, feedbackRequestedAt: null, inactivityWarnedAt: null
    } });
    if (changed.count !== 1) throw new Error('REOPEN_STATE_CONFLICT');
    await tx.ticketFeedback.deleteMany({ where: { ticketId: ticket.id } });
    await tx.ticketAudit.create({ data: {
      ticketId: ticket.id, guildId, actorId, action: 'ticket.reopen',
      details: { userWindowEnforced: enforceUserWindow }
    } });
  });
  await channel.setName('ticket-' + String(ticket.ticketNumber).padStart(4, '0')).catch(() => null);
  await channel.send({ content: 'Ticket riaperto.', allowedMentions: { parse: [] } }).catch(() => null);
  return { ok: true, status: 'OPEN', claimedById: null };
}

''')
p.write_text(s)

p = Path('apps/bot/src/tickets.ts')
s = p.read_text()
s = region(s, 'import {\n  closeTicket,', "const OPEN_STATUSES", '''import { closeTicket, reopenTicket, setTicketStatus, unclaimTicket } from './ticket-operations.js';
import { reserveTicketOpen, getTicketOpenReservation, consumeTicketOpenReservation,
  commitTicketOpen, releaseTicketOpenReservation, ticketOpenReservationMessage,
  formVersion, allowOpeningInteraction } from './open-guard.js';

const OPEN_STATUSES''')
# region keeps the end marker, so replace the deliberately repeated marker.
s = replace(s, 'const OPEN_STATUSESconst OPEN_STATUSES', 'const OPEN_STATUSES')
s = replace(s, "    await prisma.guildBlacklist.delete({ where: { id: entry.id } }).catch(() => null);\n", '')
s = region(s, 'async function createTicket(', 'async function beginTicketOpen(', '''async function createTicket(
  interaction: StringSelectMenuInteraction | ModalSubmitInteraction,
  sourceKey: string, categoryId: string,
  formAnswers: Array<{ id: string; label: string; value: string }>, token: string
) {
  if (!interaction.guild || !interaction.guildId) return;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const reservation = await getTicketOpenReservation(guildId, userId, token);
  const source = await resolveOpenSource(guildId, sourceKey, categoryId);
  const category = await prisma.ticketCategory.findFirst({ where: { id: categoryId, guildId, enabled: true } });
  if (!reservation || !source || !category || reservation.reservationCategoryId !== categoryId ||
      reservation.reservationSourceKey !== sourceKey || reservation.reservationFormVersion !== formVersion(category.formFields)) {
    await releaseTicketOpenReservation(guildId, userId, token);
    await interaction.editReply('La richiesta e scaduta o e stata modificata. Apri nuovamente il menu.');
    return;
  }
  const fields = parseFormFields(category.formFields);
  const invalid = fields.length !== formAnswers.length || fields.some((field, index) => {
    const value = formAnswers[index]?.value;
    return typeof value !== 'string' || formAnswers[index]?.id !== field.id ||
      (field.required && !value.trim()) || value.length > (field.maxLength ?? 4000) ||
      (value.length > 0 && value.length < (field.minLength ?? 0));
  });
  if (invalid) {
    await releaseTicketOpenReservation(guildId, userId, token);
    await interaction.editReply('Controlla i campi obbligatori e le lunghezze delle risposte.');
    return;
  }
  if (!(await consumeTicketOpenReservation(guildId, userId, token))) {
    await interaction.editReply('Richiesta gia utilizzata, scaduta o non piu consentita.');
    return;
  }
  let channel: Awaited<ReturnType<typeof interaction.guild.channels.create>> | undefined;
  let persisted = false;
  let discordRequestStarted = false;
  try {
    const counter = await prisma.guildSettings.update({ where: { guildId },
      data: { ticketCounter: { increment: 1 } }, select: { ticketCounter: true } });
    const number = counter.ticketCounter;
    const participant = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
    discordRequestStarted = true;
    channel = await interaction.guild.channels.create({
      name: 'ticket-' + String(number).padStart(4, '0') + '-' + safeChannelPart(interaction.user.username),
      type: ChannelType.GuildText, parent: category.discordCategoryId ?? undefined,
      topic: ('Dispatch ticket #' + number + ' - ' + userId + ' - ' + category.name).slice(0, 1024),
      permissionOverwrites: [
        { id: guildId, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.client.user!.id, type: 1, allow: [...participant, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
        { id: userId, type: 1, allow: participant },
        ...category.staffRoleIds.map((id) => ({ id, type: 0 as const, allow: [...participant, PermissionFlagsBits.ManageMessages] }))
      ]
    });
    const createdChannel = channel;
    const ticket = await commitTicketOpen(guildId, userId, token, (tx) => tx.ticket.create({ data: {
      guildId, categoryId, ticketNumber: number, openerId: userId, channelId: createdChannel.id,
      status: 'OPEN', formDataEncrypted: formAnswers.length ? encryptText(JSON.stringify(formAnswers)) : null,
      lastActivityAt: new Date(), members: { create: { userId, access: 'OPENER' } },
      audit: { create: { guildId, actorId: userId, action: 'ticket.open', details: {
        sourceKind: source.kind, sourceId: source.id, categoryId, formFieldCount: formAnswers.length
      } } }
    } }));
    persisted = true;
    const intro = new EmbedBuilder().setTitle('Ticket #' + number + ' - ' + category.name)
      .setDescription('Descrivi qui la tua richiesta. Lo staff ti rispondera in questo canale.')
      .addFields(...formAnswers.map((answer) => ({
        name: answer.label.slice(0, 45), value: answer.value.trim().slice(0, 1024) || 'Nessuna risposta'
      }))).setFooter({ text: 'Dispatch - ' + ticket.id }).setTimestamp();
    try {
      await createdChannel.send({
        embeds: [intro], components: [ticketControls(ticket.id)],
        content: category.staffRoleIds.map((id) => '<@&' + id + '>').join(' ') || undefined,
        allowedMentions: { parse: [], roles: category.staffRoleIds, users: [] }
      });
    } catch {
      await prisma.ticketAudit.create({ data: {
        ticketId: ticket.id, guildId, actorId: null, action: 'ticket.introduction.failed', details: {}
      } }).catch(() => null);
    }
    // An expired interaction response must never delete a successfully created ticket.
    await interaction.editReply('Ticket creato: <#' + createdChannel.id + '>').catch(() => null);
  } catch (error) {
    if (!persisted) {
      let safeToRelease = !discordRequestStarted;
      if (channel) {
        safeToRelease = await channel.delete('Dispatch: failed ticket persistence').then(() => true)
          .catch((failure: { code?: number }) => failure.code === 10003);
      } else if (discordRequestStarted) {
        const status = (error as { status?: number }).status;
        safeToRelease = status !== undefined && status >= 400 && status < 500 && status !== 429;
      }
      if (safeToRelease) await releaseTicketOpenReservation(guildId, userId, token);
    }
    throw error;
  }
}

''')
s = region(s, 'async function beginTicketOpen(', 'async function openTicket(', '''async function beginTicketOpen(interaction: StringSelectMenuInteraction, sourceKey: string, categoryId: string) {
  if (!interaction.guildId) return;
  const source = await resolveOpenSource(interaction.guildId, sourceKey, categoryId);
  const category = await prisma.ticketCategory.findFirst({
    where: { id: categoryId, guildId: interaction.guildId, enabled: true }
  });
  if (!source || !category) {
    await interaction.reply({ content: 'Questa richiesta non e piu disponibile.', ephemeral: true });
    return;
  }
  const reservation = await reserveTicketOpen(interaction.guildId, interaction.user.id, categoryId,
    sourceKey, formVersion(category.formFields));
  if (!reservation.ok) {
    await interaction.reply({ content: ticketOpenReservationMessage(reservation), ephemeral: true });
    return;
  }
  const fields = parseFormFields(category.formFields);
  if (!fields.length) {
    await interaction.deferReply({ ephemeral: true });
    await createTicket(interaction, sourceKey, categoryId, [], reservation.token);
    return;
  }
  const modal = new ModalBuilder().setCustomId(OPEN_MODAL_PREFIX + reservation.token)
    .setTitle(('Apri ticket - ' + category.name).slice(0, 45));
  for (const [index, field] of fields.entries()) {
    const input = new TextInputBuilder().setCustomId('field_' + (index + 1)).setLabel(field.label)
      .setStyle(field.style === 'PARAGRAPH' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(field.required).setMaxLength(field.maxLength ?? 4000);
    if (field.placeholder) input.setPlaceholder(field.placeholder);
    if (field.minLength != null) input.setMinLength(field.minLength);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }
  try { await interaction.showModal(modal); }
  catch (error) {
    await releaseTicketOpenReservation(interaction.guildId, interaction.user.id, reservation.token);
    throw error;
  }
}

''')
s = region(s, 'async function submitOpenTicket(', 'async function claimTicket(', '''async function submitOpenTicket(interaction: ModalSubmitInteraction) {
  if (!interaction.guildId) return;
  await interaction.deferReply({ ephemeral: true });
  const token = interaction.customId.slice(OPEN_MODAL_PREFIX.length);
  const reservation = await getTicketOpenReservation(interaction.guildId, interaction.user.id, token);
  if (!reservation?.reservationCategoryId || !reservation.reservationSourceKey) {
    await interaction.editReply('Il modulo e scaduto o e gia stato utilizzato. Apri nuovamente il menu.');
    return;
  }
  const category = await prisma.ticketCategory.findFirst({ where: {
    id: reservation.reservationCategoryId, guildId: interaction.guildId, enabled: true
  } });
  if (!category || formVersion(category.formFields) !== reservation.reservationFormVersion) {
    await releaseTicketOpenReservation(interaction.guildId, interaction.user.id, token);
    await interaction.editReply('Il modulo e stato modificato. Apri nuovamente la richiesta.');
    return;
  }
  const fields = parseFormFields(category.formFields);
  let answers: Array<{ id: string; label: string; value: string }>;
  try {
    answers = fields.map((field, index) => ({
      id: field.id, label: field.label, value: interaction.fields.getTextInputValue('field_' + (index + 1))
    }));
  } catch {
    await releaseTicketOpenReservation(interaction.guildId, interaction.user.id, token);
    await interaction.editReply('Modulo non valido. Apri nuovamente la richiesta.');
    return;
  }
  await createTicket(interaction, reservation.reservationSourceKey, category.id, answers, token);
}

''')
# Ignore copied/obsolete panel messages, not only obsolete main menus.
needle = "  await beginTicketOpen(interaction, 'p_' + panelId, categoryId);"
s = replace(s, needle, '''  const panel = await prisma.ticketPanel.findFirst({ where: {
    id: panelId, guildId: interaction.guildId, channelId: interaction.channelId,
    messageId: interaction.message.id, enabled: true
  } });
  if (!panel) {
    await interaction.reply({ content: 'Pannello scaduto o non valido.', ephemeral: true });
    return;
  }
''' + needle)
# Main-menu selections follow configured order and always remain private.
a = s.index('async function openMainMenu(')
b = s.index('async function openMainMenuSelection(', a)
part = s[a:b]
part = replace(part, '.addOptions(categories.slice(0, 25).map', '.addOptions(categories.sort((a, b) => settings.mainMenuCategoryIds.indexOf(a.id) - settings.mainMenuCategoryIds.indexOf(b.id)).slice(0, 25).map')
s = s[:a] + part + s[b:]
# Do not send a new menu for permission, network, or rate-limit failures.
a = s.index('export async function publishMainMenu(')
b = s.index('type OpenSource =', a)
part = s[a:b]
part = replace(part, '    } catch {\n      const sent = await channel.send(payload);', "    } catch (error) {\n      if ((error as { code?: number }).code !== 10008) throw error;\n      const sent = await channel.send(payload);")
part = replace(part, '    embeds: [embed],\n    components:', '    allowedMentions: { parse: [] as never[] },\n    embeds: [embed],\n    components:')
body_start = part.index(' {\n') + 3
body_end = part.rfind('\n}')
body = part[body_start:body_end]
part = part[:body_start] + '''  if (publishingMenus.has(guildId)) throw new Error('MAIN_MENU_PUBLISH_IN_PROGRESS');
  publishingMenus.add(guildId);
  try {
''' + '\n'.join('  ' + line for line in body.splitlines()) + '''
  } finally { publishingMenus.delete(guildId); }
}

'''
s = s[:a] + 'const publishingMenus = new Set<string>();\n' + part + s[b:]
# Throttle opening interactions before database I/O; never throttle staff actions.
a = s.index('export async function handleTicketInteraction(')
b = s.index(') {', a) + 3
s = s[:b] + '''
  const opening = [PANEL_SELECT_PREFIX, MAIN_MENU_BUTTON_PREFIX, MAIN_MENU_SELECT_PREFIX, OPEN_MODAL_PREFIX]
    .some((prefix) => interaction.customId.startsWith(prefix));
  if (opening && interaction.guildId && !allowOpeningInteraction(interaction.guildId, interaction.user.id)) {
    await interaction.reply({ content: 'Stai usando il menu troppo rapidamente. Riprova tra pochi secondi.', ephemeral: true });
    return true;
  }
''' + s[b:]
p.write_text(s)

p = Path('apps/bot/src/index.ts')
s = p.read_text()
s = replace(s, '  runTicketAutomations,\n  runTicketRetention\n', '  runTicketAutomations\n')
s = replace(s, "} from './ticket-operations.js';", "} from './ticket-operations.js';\nimport { runTicketRetention } from './retention.js';")
s = replace(s, 'result.transcriptsDeleted || result.ticketsDeleted || result.channelsDeleted', 'result.transcriptsDeleted || result.ticketsDeleted || result.channelsDeleted || result.failed')
s = replace(s, 'log.error({ err: error, customId: interaction.customId },', 'log.error({ errorType: error instanceof Error ? error.name : \'UnknownError\' },')
p.write_text(s)

p = Path('apps/api/src/index.ts')
s = p.read_text()
s = replace(s, 'transcriptRetentionDays: z.number().int().min(1).max(3650).nullable().default(30)', 'transcriptRetentionDays: z.number().int().min(1).max(3650).nullable().default(null)')
s = replace(s, 'closedTicketRetentionDays: z.number().int().min(1).max(3650).nullable().default(90)', 'closedTicketRetentionDays: z.number().int().min(1).max(3650).nullable().default(null)')
s = replace(s, 'retentionDeleteDiscordChannel: z.boolean().default(true)', 'retentionDeleteDiscordChannel: z.boolean().default(false)')
p.write_text(s)

p = Path('apps/web/app/dashboard/[guildId]/tickets/[ticketId]/page.tsx')
s = p.read_text()
s = replace(s, "const closed = ticket.status === 'CLOSED';", "const closed = ticket.status === 'CLOSED' || ticket.status === 'REOPENING';")
s = replace(s, "{closed && <option value=\"CLOSED\">Chiuso</option>}", "{closed && <option value={ticket.status}>{ticket.status === 'REOPENING' ? 'Ripristino permessi da completare' : 'Chiuso'}</option>}")
p.write_text(s)

p = Path('deploy/runtime/harden-users.sh')
s = p.read_text()
s = replace(s, 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dispatch_api;', '''REVOKE ALL ON ALL TABLES IN SCHEMA public FROM dispatch_api, dispatch_bot;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "GuildSettings", "TicketCategory", "TicketPanel", "Ticket", "TicketMember", "TicketAudit", "Transcript",
  "PanelSession", "PanelRoleBinding", "PanelAudit", "TicketNote", "ResponseTemplate", "TicketFeedback", "GuildBlacklist"
TO dispatch_api;''')
s = replace(s, '"TicketMember", "TicketAudit", "Transcript"\nTO dispatch_bot;', '''"TicketMember", "TicketAudit", "Transcript", "TicketFeedback", "TicketOpenAttempt", "TicketUserGuard"
TO dispatch_bot;
GRANT SELECT ON TABLE "GuildBlacklist" TO dispatch_bot;''')
p.write_text(s)

p = Path('deploy/docker-compose.prod.yml')
s = p.read_text()
s = replace(s, "fetch('http://127.0.0.1:3002/')", "fetch('http://127.0.0.1:3002/healthz')")
p.write_text(s)

p = Path('.github/workflows/deploy.yml')
s = p.read_text()
s = replace(s, 'jobs:\n  build:', 'jobs:\n  ticket-checks:\n    uses: ./.github/workflows/ticket-tests.yml\n    permissions:\n      contents: read\n\n  build:\n    needs: ticket-checks')
p.write_text(s)
print('Applied ticket protections without rewriting unrelated application code.')
