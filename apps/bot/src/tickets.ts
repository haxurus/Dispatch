import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type GuildMember,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction
} from 'discord.js';
import { prisma } from '@dispatch/db';
import { decryptText, encryptText } from './security.js';
import {
  botCanManageThreads, closeTicket, deleteTicketChannel, openStaffThread, reopenTicket, setTicketStatus,
  ticketChannelOverwrites, unclaimTicket
} from './ticket-operations.js';
import { logTicketEvent } from './ticket-log.js';
import { reserveTicketOpen, getTicketOpenReservation, consumeTicketOpenReservation,
  commitTicketOpen, releaseTicketOpenReservation, ticketOpenReservationMessage,
  formVersion, allowOpeningInteraction } from './open-guard.js';
import { panelComponents, panelEmbed, panelStyle } from './panels.js';

const OPEN_STATUSES = ['OPEN', 'WAITING', 'IN_PROGRESS', 'RESOLVED'];
const PANEL_SELECT_PREFIX = 'dispatch:open:';
// dispatch:panel-btn:<panelId>:<categoryId> (BUTTONS style ticket panels).
const PANEL_BUTTON_PREFIX = 'dispatch:panel-btn:';
const CUID = /^[a-z0-9]{20,32}$/i;
const MAIN_MENU_BUTTON_PREFIX = 'dispatch:main-menu:';
const MAIN_MENU_SELECT_PREFIX = 'dispatch:main-menu-select:';
const OPEN_MODAL_PREFIX = 'dispatch:open-modal:';
const OPEN_SELECT_PREFIX = 'dispatch:open-select:';
const CLAIM_PREFIX = 'dispatch:claim:';
const UNCLAIM_PREFIX = 'dispatch:unclaim:';
const WAITING_PREFIX = 'dispatch:waiting:';
const RESOLVED_PREFIX = 'dispatch:resolved:';
const CLOSE_PREFIX = 'dispatch:close:';
const CLOSE_MODAL_PREFIX = 'dispatch:close-modal:';
const FEEDBACK_PREFIX = 'dispatch:feedback:';
const FEEDBACK_MODAL_PREFIX = 'dispatch:feedback-modal:';
const REOPEN_PREFIX = 'dispatch:reopen:';
// dispatch:delete-channel:<ticketId> (closure message, staff) asks for an
// ephemeral confirmation: dispatch:delete-confirm:<ticketId>:<expiry base36>.
const DELETE_CHANNEL_PREFIX = 'dispatch:delete-channel:';
const DELETE_CONFIRM_PREFIX = 'dispatch:delete-confirm:';
const DELETE_CONFIRM_TTL_MS = 2 * 60_000;
// dispatch:staff-thread:<ticketId> (ticket controls, staff only): creates or
// joins the private staff thread of the ticket.
const STAFF_THREAD_PREFIX = 'dispatch:staff-thread:';
const SNOWFLAKE = /^\d{17,20}$/;

type FormField = {
  id: string;
  label: string;
  style: 'SHORT' | 'PARAGRAPH';
  type: 'SHORT_TEXT' | 'LONG_TEXT' | 'SINGLE_SELECT';
  required: boolean;
  placeholder?: string | null;
  minLength?: number | null;
  maxLength?: number | null;
  options: Array<{ label: string; value: string; description?: string | null }>;
};

function parseFormFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 5).flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const label = typeof row.label === 'string' ? row.label.trim().slice(0, 45) : '';
    if (!label) return [];

    const minLength = typeof row.minLength === 'number' && Number.isInteger(row.minLength)
      ? Math.max(0, Math.min(4000, row.minLength))
      : null;
    const maxLength = typeof row.maxLength === 'number' && Number.isInteger(row.maxLength)
      ? Math.max(1, Math.min(4000, row.maxLength))
      : null;

    return [{
      id: typeof row.id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(row.id)
        ? row.id
        : `field_${index + 1}`,
      label,
      style: row.type === 'LONG_TEXT' || row.style === 'PARAGRAPH' ? 'PARAGRAPH' : 'SHORT',
      type: row.type === 'SINGLE_SELECT' ? 'SINGLE_SELECT'
        : row.type === 'LONG_TEXT' || row.style === 'PARAGRAPH' ? 'LONG_TEXT' : 'SHORT_TEXT',
      required: row.required !== false,
      placeholder: typeof row.placeholder === 'string' ? row.placeholder.slice(0, 100) : null,
      minLength,
      maxLength,
      options: Array.isArray(row.options) ? row.options.slice(0, 25).flatMap((option) => {
        if (!option || typeof option !== 'object' || Array.isArray(option)) return [];
        const entry = option as Record<string, unknown>;
        const optionLabel = typeof entry.label === 'string' ? entry.label.trim().slice(0, 100) : '';
        const optionValue = typeof entry.value === 'string' ? entry.value.trim().slice(0, 100) : '';
        if (!optionLabel || !optionValue) return [];
        return [{ label: optionLabel, value: optionValue,
          description: typeof entry.description === 'string' ? entry.description.trim().slice(0, 100) || null : null }];
      }) : []
    } satisfies FormField];
  });
}

function safeChannelPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'user';
}

export function ticketControls(ticketId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CLAIM_PREFIX}${ticketId}`)
      .setLabel('Claim')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${UNCLAIM_PREFIX}${ticketId}`)
      .setLabel('Unclaim')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${WAITING_PREFIX}${ticketId}`)
      .setLabel('In attesa')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${RESOLVED_PREFIX}${ticketId}`)
      .setLabel('Risolto')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${CLOSE_PREFIX}${ticketId}`)
      .setLabel('Chiudi')
      .setStyle(ButtonStyle.Danger)
  );
}

// Second row of the ticket controls (the first one is full): staff-only tools.
export function ticketStaffControls(ticketId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${STAFF_THREAD_PREFIX}${ticketId}`)
      .setLabel('Thread staff')
      .setStyle(ButtonStyle.Secondary)
  );
}

/** Every control row of the ticket introduction message. */
export function ticketControlRows(ticketId: string) {
  return [ticketControls(ticketId), ticketStaffControls(ticketId)];
}

function hasStaffAccess(member: GuildMember, staffRoleIds: string[]) {
  return member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    staffRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

async function userIsBlacklisted(guildId: string, userId: string) {
  const entry = await prisma.guildBlacklist.findUnique({
    where: { guildId_userId: { guildId, userId } }
  });
  if (!entry) return false;

  if (entry.expiresAt && entry.expiresAt.getTime() <= Date.now()) {
    return false;
  }

  return true;
}

export async function publishTicketPanel(client: Client, guildId: string, panelId: string) {
  const panel = await prisma.ticketPanel.findFirst({
    where: { id: panelId, guildId, enabled: true }
  });
  if (!panel) throw new Error('PANEL_NOT_FOUND');

  const rows = await prisma.ticketCategory.findMany({
    where: {
      guildId,
      id: { in: panel.categoryIds },
      enabled: true
    }
  });
  // Panel order; disabled or deleted categories are skipped.
  const categories = panel.categoryIds
    .map((id) => rows.find((category) => category.id === id))
    .filter((category): category is (typeof rows)[number] => Boolean(category));
  if (!categories.length) throw new Error('PANEL_HAS_NO_CATEGORIES');
  if (categories.length > 25) throw new Error('PANEL_TOO_MANY_CATEGORIES');

  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('GUILD_NOT_FOUND');

  const channel = await guild.channels.fetch(panel.channelId);
  if (!channel || !channel.isTextBased() || !('send' in channel)) {
    throw new Error('PANEL_CHANNEL_INVALID');
  }

  const style = panelStyle(panel.style, 'SELECT');
  const payload = {
    allowedMentions: { parse: [] as never[] },
    embeds: [panelEmbed(panel, style === 'BUTTONS'
      ? 'Premi il pulsante del tipo di ticket da aprire.'
      : 'Seleziona il tipo di ticket da aprire.')],
    components: panelComponents({
      style,
      placeholder: panel.placeholder,
      defaultPlaceholder: 'Seleziona una categoria',
      items: panel.items,
      entries: categories.map((category) => ({
        id: category.id,
        label: category.name,
        description: category.description
      })),
      selectCustomId: PANEL_SELECT_PREFIX + panel.id,
      buttonCustomId: (categoryId) => PANEL_BUTTON_PREFIX + panel.id + ':' + categoryId
    })
  };

  // Only a message that no longer exists is replaced: permission or network
  // errors must not publish a duplicate panel.
  let messageId: string;
  if (panel.messageId) {
    try {
      const existing = await channel.messages.fetch(panel.messageId);
      const edited = await existing.edit(payload);
      messageId = edited.id;
    } catch (error) {
      if ((error as { code?: number }).code !== 10008) throw error;
      const sent = await channel.send(payload);
      messageId = sent.id;
    }
  } else {
    const sent = await channel.send(payload);
    messageId = sent.id;
  }

  await prisma.ticketPanel.update({
    where: { id: panel.id },
    data: { messageId }
  });

  return { ok: true, messageId };
}

const publishingMenus = new Set<string>();
export async function publishMainMenu(client: Client, guildId: string) {
  if (publishingMenus.has(guildId)) throw new Error('MAIN_MENU_PUBLISH_IN_PROGRESS');
  publishingMenus.add(guildId);
  try {
    const settings = await prisma.guildSettings.findUnique({ where: { guildId } });
    if (!settings) throw new Error('GUILD_NOT_FOUND');
    if (!settings.mainMenuEnabled) throw new Error('MAIN_MENU_DISABLED');
    if (!settings.mainMenuChannelId) throw new Error('MAIN_MENU_CHANNEL_REQUIRED');
    if (!settings.mainMenuCategoryIds.length) throw new Error('MAIN_MENU_HAS_NO_CATEGORIES');
    if (settings.mainMenuCategoryIds.length > 25) throw new Error('MAIN_MENU_TOO_MANY_CATEGORIES');
  
    const categories = await prisma.ticketCategory.findMany({
      where: {
        guildId,
        id: { in: settings.mainMenuCategoryIds },
        enabled: true
      },
      orderBy: { createdAt: 'asc' }
    });
    if (categories.length !== settings.mainMenuCategoryIds.length) {
      throw new Error('MAIN_MENU_CATEGORY_NOT_FOUND');
    }
  
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error('GUILD_NOT_FOUND');
  
    const channel = await guild.channels.fetch(settings.mainMenuChannelId);
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      throw new Error('MAIN_MENU_CHANNEL_INVALID');
    }
  
    const embed = new EmbedBuilder()
      .setTitle(settings.mainMenuTitle)
      .setDescription(settings.mainMenuDescription || 'Seleziona il tipo di richiesta da aprire.')
      .setFooter({ text: 'Dispatch' });
  
    const button = new ButtonBuilder()
      .setCustomId(MAIN_MENU_BUTTON_PREFIX + guildId)
      .setLabel(settings.mainMenuButtonLabel)
      .setStyle(ButtonStyle.Primary);
  
    const payload = {
      allowedMentions: { parse: [] as never[] },
      embeds: [embed],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)]
    };
  
    let messageId: string;
    if (settings.mainMenuMessageId) {
      try {
        const existing = await channel.messages.fetch(settings.mainMenuMessageId);
        const edited = await existing.edit(payload);
        messageId = edited.id;
      } catch (error) {
        if ((error as { code?: number }).code !== 10008) throw error;
        const sent = await channel.send(payload);
        messageId = sent.id;
      }
    } else {
      const sent = await channel.send(payload);
      messageId = sent.id;
    }
  
    await prisma.guildSettings.update({
      where: { guildId },
      data: { mainMenuMessageId: messageId }
    });
  
    return { ok: true, messageId };
  } finally { publishingMenus.delete(guildId); }
}

type OpenSource = {
  kind: 'PANEL' | 'MAIN_MENU';
  id: string;
};

async function resolveOpenSource(
  guildId: string,
  sourceKey: string,
  categoryId: string
): Promise<OpenSource | null> {
  if (sourceKey.startsWith('p_')) {
    const panelId = sourceKey.slice(2);
    const panel = await prisma.ticketPanel.findFirst({
      where: { id: panelId, guildId, enabled: true }
    });
    if (!panel || !panel.categoryIds.includes(categoryId)) return null;
    return { kind: 'PANEL', id: panel.id };
  }

  if (sourceKey.startsWith('m_')) {
    const sourceGuildId = sourceKey.slice(2);
    if (sourceGuildId !== guildId) return null;

    const settings = await prisma.guildSettings.findUnique({
      where: { guildId },
      select: {
        mainMenuEnabled: true,
        mainMenuCategoryIds: true
      }
    });
    if (
      !settings?.mainMenuEnabled ||
      !settings.mainMenuCategoryIds.includes(categoryId)
    ) {
      return null;
    }
    return { kind: 'MAIN_MENU', id: guildId };
  }

  return null;
}

async function createTicket(
  interaction: StringSelectMenuInteraction | ButtonInteraction | ModalSubmitInteraction,
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
  let channel: import("discord.js").TextChannel | undefined;
  let persisted = false;
  let discordRequestStarted = false;
  try {
    const counter = await prisma.guildSettings.update({ where: { guildId },
      data: { ticketCounter: { increment: 1 } }, select: { ticketCounter: true } });
    const number = counter.ticketCounter;
    discordRequestStarted = true;
    channel = await interaction.guild.channels.create({
      name: 'ticket-' + String(number).padStart(4, '0') + '-' + safeChannelPart(interaction.user.username),
      type: ChannelType.GuildText, parent: category.discordCategoryId ?? undefined,
      topic: ('Dispatch ticket #' + number + ' - ' + userId + ' - ' + category.name).slice(0, 1024),
      permissionOverwrites: ticketChannelOverwrites({
        guildId, botId: interaction.client.user!.id, openerId: userId, staffRoleIds: category.staffRoleIds,
        threadsAllowed: botCanManageThreads(interaction.guild)
      })
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
        embeds: [intro], components: ticketControlRows(ticket.id),
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
    await logTicketEvent(interaction.client, guildId, 'TICKET_OPEN', {
      title: 'Ticket aperto',
      ticket,
      actorId: userId,
      categoryName: category.name,
      fields: [{ name: 'Origine', value: source.kind === 'PANEL' ? 'Pannello' : 'Menu principale', inline: true }]
    });
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

function storedTicketAnswers(value: string | null | undefined) {
  if (!value) return [] as Array<{ id: string; label: string; value: string }>;
  try {
    const parsed = JSON.parse(decryptText(value) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ticketSelectRow(token: string, field: FormField) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(OPEN_SELECT_PREFIX + token)
      .setPlaceholder(field.label.slice(0, 100))
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(field.options.map((option) => ({
        label: option.label,
        value: option.value,
        description: option.description || undefined
      })))
  );
}

function ticketTextModal(token: string, categoryName: string, fields: FormField[]) {
  const modal = new ModalBuilder().setCustomId(OPEN_MODAL_PREFIX + token)
    .setTitle(('Apri ticket - ' + categoryName).slice(0, 45));
  for (const [index, field] of fields.entries()) {
    const input = new TextInputBuilder().setCustomId('field_' + (index + 1)).setLabel(field.label)
      .setStyle(field.style === 'PARAGRAPH' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(field.required).setMaxLength(field.maxLength ?? 4000);
    if (field.placeholder) input.setPlaceholder(field.placeholder);
    if (field.minLength != null) input.setMinLength(field.minLength);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }
  return modal;
}

async function beginTicketOpen(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  sourceKey: string,
  categoryId: string
) {
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
  const selects = fields.filter((field) => field.type === 'SINGLE_SELECT');
  if (selects.length) {
    await interaction.reply({
      content: '**1/' + selects.length + ' - ' + selects[0]!.label + '**',
      components: [ticketSelectRow(reservation.token, selects[0]!)],
      allowedMentions: { parse: [] },
      ephemeral: true
    });
    return;
  }
  try { await interaction.showModal(ticketTextModal(reservation.token, category.name, fields)); }
  catch (error) {
    await releaseTicketOpenReservation(interaction.guildId, interaction.user.id, reservation.token);
    throw error;
  }
}

async function submitOpenTicketSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.guildId) return;
  const token = interaction.customId.slice(OPEN_SELECT_PREFIX.length);
  const reservation = await getTicketOpenReservation(interaction.guildId, interaction.user.id, token);
  if (!reservation?.reservationCategoryId || !reservation.reservationSourceKey) {
    await interaction.reply({ content: 'Questa richiesta è scaduta.', ephemeral: true });
    return;
  }
  const category = await prisma.ticketCategory.findFirst({ where: {
    id: reservation.reservationCategoryId, guildId: interaction.guildId, enabled: true
  } });
  if (!category || formVersion(category.formFields) !== reservation.reservationFormVersion) {
    await releaseTicketOpenReservation(interaction.guildId, interaction.user.id, token);
    await interaction.reply({ content: 'Il modulo è stato modificato. Riapri la richiesta.', ephemeral: true });
    return;
  }
  const fields = parseFormFields(category.formFields);
  const selects = fields.filter((field) => field.type === 'SINGLE_SELECT');
  const texts = fields.filter((item) => item.type !== 'SINGLE_SELECT');
  const index = reservation.reservationQuestionIndex ?? 0;
  const guildId = interaction.guildId;
  const categoryName = category.name;
  const showTextModal = async () => {
    try { await interaction.showModal(ticketTextModal(token, categoryName, texts)); }
    catch (error) {
      await releaseTicketOpenReservation(guildId, interaction.user.id, token);
      throw error;
    }
  };
  // Every select is answered but the user dismissed the modal: offer it again
  // instead of trapping the reservation until it expires.
  if (index >= selects.length) {
    if (texts.length) await showTextModal();
    else await interaction.reply({ content: 'Questa richiesta è scaduta.', ephemeral: true });
    return;
  }
  const field = selects[index];
  const value = interaction.values[0];
  if (!field || !value || !field.options.some((option) => option.value === value)) {
    await interaction.reply({ content: 'Selezione non valida.', ephemeral: true });
    return;
  }
  const answers = storedTicketAnswers(reservation.reservationAnswersEncrypted);
  answers.push({ id: field.id, label: field.label, value });
  // Conditional write: a stale or concurrent select for the same step loses
  // instead of appending a duplicate answer and skipping a question.
  const advanced = await prisma.ticketUserGuard.updateMany({
    where: {
      id: reservation.id, reservationToken: token, reservationPhase: 'FORM',
      reservationQuestionIndex: index, pendingUntil: { gt: new Date() }
    },
    data: {
      reservationAnswersEncrypted: encryptText(JSON.stringify(answers)),
      reservationQuestionIndex: index + 1
    }
  });
  if (advanced.count !== 1) {
    await interaction.reply({ content: 'Questa selezione non è più valida.', ephemeral: true });
    return;
  }
  const next = selects[index + 1];
  if (next) {
    await interaction.update({
      content: '**' + (index + 2) + '/' + selects.length + ' - ' + next.label + '**',
      components: [ticketSelectRow(token, next)],
      allowedMentions: { parse: [] }
    });
    return;
  }
  if (texts.length) {
    await showTextModal();
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const ordered = fields.map((item) => answers.find((answer) => answer.id === item.id)!)
    .filter(Boolean);
  await createTicket(interaction, reservation.reservationSourceKey, category.id, ordered, token);
}

async function openTicket(interaction: StringSelectMenuInteraction) {
  if (!interaction.guildId) return;

  const panelId = interaction.customId.slice(PANEL_SELECT_PREFIX.length);
  const categoryId = interaction.values[0];
  if (!categoryId) {
    await interaction.reply({ content: 'Categoria non valida.', ephemeral: true });
    return;
  }

  const panel = await prisma.ticketPanel.findFirst({ where: {
    id: panelId, guildId: interaction.guildId, channelId: interaction.channelId,
    messageId: interaction.message.id, enabled: true
  } });
  if (!panel) {
    await interaction.reply({ content: 'Pannello scaduto o non valido.', ephemeral: true });
    return;
  }
  await beginTicketOpen(interaction, 'p_' + panelId, categoryId);
}

// BUTTONS panels: same open flow, source key and checks as the panel select.
async function openTicketFromButton(interaction: ButtonInteraction) {
  if (!interaction.guildId) return;

  const [panelId, categoryId, extra] = interaction.customId.slice(PANEL_BUTTON_PREFIX.length).split(':');
  if (!panelId || !categoryId || extra !== undefined || !CUID.test(panelId) || !CUID.test(categoryId)) {
    await interaction.reply({ content: 'Pannello non valido.', ephemeral: true });
    return;
  }

  const panel = await prisma.ticketPanel.findFirst({ where: {
    id: panelId, guildId: interaction.guildId, channelId: interaction.channelId,
    messageId: interaction.message.id, enabled: true
  } });
  if (!panel) {
    await interaction.reply({ content: 'Pannello scaduto o non valido.', ephemeral: true });
    return;
  }
  // resolveOpenSource re-checks that the category is still in this panel.
  await beginTicketOpen(interaction, 'p_' + panelId, categoryId);
}

async function openMainMenu(interaction: ButtonInteraction) {
  if (!interaction.guildId) return;

  const guildId = interaction.customId.slice(MAIN_MENU_BUTTON_PREFIX.length);
  if (guildId !== interaction.guildId) {
    await interaction.reply({ content: 'Menu non valido per questo server.', ephemeral: true });
    return;
  }

  if (await userIsBlacklisted(interaction.guildId, interaction.user.id)) {
    await interaction.reply({
      content: 'Non puoi aprire ticket in questo server.',
      ephemeral: true
    });
    return;
  }

  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: {
      mainMenuEnabled: true,
      mainMenuChannelId: true,
      mainMenuMessageId: true,
      mainMenuCategoryIds: true
    }
  });

  if (
    !settings?.mainMenuEnabled ||
    !settings.mainMenuCategoryIds.length ||
    settings.mainMenuChannelId !== interaction.channelId ||
    settings.mainMenuMessageId !== interaction.message.id
  ) {
    await interaction.reply({ content: 'Il menu ticket non è disponibile.', ephemeral: true });
    return;
  }

  const categories = await prisma.ticketCategory.findMany({
    where: {
      guildId,
      id: { in: settings.mainMenuCategoryIds },
      enabled: true
    },
    orderBy: { createdAt: 'asc' }
  });

  if (!categories.length) {
    await interaction.reply({ content: 'Non ci sono richieste disponibili.', ephemeral: true });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(MAIN_MENU_SELECT_PREFIX + guildId)
    .setPlaceholder('Scegli il tipo di richiesta')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(categories.sort((a, b) => settings.mainMenuCategoryIds.indexOf(a.id) - settings.mainMenuCategoryIds.indexOf(b.id)).slice(0, 25).map((category) => ({
      label: category.name.slice(0, 100),
      value: category.id,
      description: category.description?.slice(0, 100) || undefined
    })));

  await interaction.reply({
    content: 'Seleziona la richiesta per cui vuoi aprire un ticket.',
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    ephemeral: true
  });
}

async function openMainMenuSelection(interaction: StringSelectMenuInteraction) {
  if (!interaction.guildId) return;

  const guildId = interaction.customId.slice(MAIN_MENU_SELECT_PREFIX.length);
  const categoryId = interaction.values[0];
  if (guildId !== interaction.guildId || !categoryId) {
    await interaction.reply({ content: 'Selezione non valida.', ephemeral: true });
    return;
  }

  await beginTicketOpen(interaction, 'm_' + guildId, categoryId);
}

async function submitOpenTicket(interaction: ModalSubmitInteraction) {
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
  const textFields = fields.filter((field) => field.type !== 'SINGLE_SELECT');
  const answers = storedTicketAnswers(reservation.reservationAnswersEncrypted);
  try {
    textFields.forEach((field, index) => {
      answers.push({
        id: field.id,
        label: field.label,
        value: interaction.fields.getTextInputValue('field_' + (index + 1))
      });
    });
  } catch {
    await releaseTicketOpenReservation(interaction.guildId, interaction.user.id, token);
    await interaction.editReply('Modulo non valido. Apri nuovamente la richiesta.');
    return;
  }
  const ordered = fields.map((field) => answers.find((answer) => answer.id === field.id)!)
    .filter(Boolean);
  await createTicket(interaction, reservation.reservationSourceKey, category.id, ordered, token);
}

async function claimTicket(interaction: ButtonInteraction) {
  if (!interaction.guild || !interaction.guildId || !interaction.channelId) return;

  const ticketId = interaction.customId.slice(CLAIM_PREFIX.length);
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId: interaction.guildId, channelId: interaction.channelId },
    include: { category: true }
  });

  if (!ticket || !OPEN_STATUSES.includes(ticket.status)) {
    await interaction.reply({ content: 'Ticket non disponibile.', ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!hasStaffAccess(member, ticket.category.staffRoleIds)) {
    await interaction.reply({
      content: 'Non hai i permessi per prendere in carico questo ticket.',
      ephemeral: true
    });
    return;
  }

  if (ticket.claimedById && ticket.claimedById !== interaction.user.id) {
    await interaction.reply({
      content: `Ticket già preso in carico da <@${ticket.claimedById}>.`,
      ephemeral: true
    });
    return;
  }

  // Conditional write: of two concurrent claims only one wins.
  const claimed = await prisma.$transaction(async (tx) => {
    const changed = await tx.ticket.updateMany({
      where: {
        id: ticket.id,
        status: { in: OPEN_STATUSES },
        OR: [{ claimedById: null }, { claimedById: interaction.user.id }]
      },
      data: { claimedById: interaction.user.id, status: 'IN_PROGRESS' }
    });
    if (changed.count !== 1) return false;
    await tx.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId: interaction.guildId!,
        actorId: interaction.user.id,
        action: 'ticket.claim',
        details: {}
      }
    });
    return true;
  });
  if (!claimed) {
    await interaction.reply({ content: 'Ticket non disponibile o già preso in carico.', ephemeral: true });
    return;
  }

  await interaction.reply({
    content: `Ticket preso in carico da <@${interaction.user.id}>.`,
    allowedMentions: { users: [interaction.user.id] }
  });
  await logTicketEvent(interaction.client, interaction.guildId, 'TICKET_CLAIM', {
    title: 'Ticket preso in carico',
    ticket,
    actorId: interaction.user.id,
    categoryName: ticket.category.name
  });
}

async function unclaimTicketInteraction(interaction: ButtonInteraction) {
  if (!interaction.guildId) return;

  const ticketId = interaction.customId.slice(UNCLAIM_PREFIX.length);
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId: interaction.guildId, channelId: interaction.channelId },
    include: { category: true }
  });

  if (!ticket) {
    await interaction.reply({ content: 'Ticket non disponibile.', ephemeral: true });
    return;
  }

  const member = await interaction.guild!.members.fetch(interaction.user.id);
  if (!hasStaffAccess(member, ticket.category.staffRoleIds)) {
    await interaction.reply({
      content: 'Non hai i permessi per rilasciare questo ticket.',
      ephemeral: true
    });
    return;
  }

  await unclaimTicket(interaction.client, interaction.guildId, ticketId, interaction.user.id);
  await interaction.reply({ content: 'Ticket rilasciato.', ephemeral: true });
}

async function statusTicketInteraction(
  interaction: ButtonInteraction,
  status: 'WAITING' | 'RESOLVED'
) {
  if (!interaction.guildId) return;

  const prefix = status === 'WAITING' ? WAITING_PREFIX : RESOLVED_PREFIX;
  const ticketId = interaction.customId.slice(prefix.length);
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId: interaction.guildId, channelId: interaction.channelId },
    include: { category: true }
  });
  if (!ticket || !OPEN_STATUSES.includes(ticket.status)) {
    await interaction.reply({ content: 'Ticket non disponibile.', ephemeral: true });
    return;
  }

  const member = await interaction.guild!.members.fetch(interaction.user.id);
  if (!hasStaffAccess(member, ticket.category.staffRoleIds)) {
    await interaction.reply({
      content: 'Non hai i permessi per modificare lo stato.',
      ephemeral: true
    });
    return;
  }

  await setTicketStatus(interaction.client, interaction.guildId, ticket.id, interaction.user.id, status);
  await interaction.reply({
    content: status === 'WAITING' ? 'Ticket impostato in attesa.' : 'Ticket segnato come risolto.',
    ephemeral: true
  });
}


async function promptFeedback(interaction: ButtonInteraction) {
  if (!interaction.guildId) return;

  const raw = interaction.customId.slice(FEEDBACK_PREFIX.length);
  const separator = raw.lastIndexOf(':');
  const ticketId = separator > 0 ? raw.slice(0, separator) : '';
  const rating = Number(separator > 0 ? raw.slice(separator + 1) : '');

  if (!ticketId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    await interaction.reply({ content: 'Feedback non valido.', ephemeral: true });
    return;
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId: interaction.guildId },
    include: { category: true }
  });

  if (
    !ticket ||
    ticket.status !== 'CLOSED' ||
    !ticket.category.feedbackEnabled ||
    ticket.openerId !== interaction.user.id
  ) {
    await interaction.reply({ content: 'Non puoi inviare feedback per questo ticket.', ephemeral: true });
    return;
  }

  const comment = new TextInputBuilder()
    .setCustomId('comment')
    .setLabel('Commento opzionale')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1500)
    .setPlaceholder('Cosa è andato bene o cosa possiamo migliorare?');

  const modal = new ModalBuilder()
    .setCustomId(FEEDBACK_MODAL_PREFIX + ticket.id + ':' + rating)
    .setTitle('Feedback ticket - ' + rating + '/5')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(comment));

  await interaction.showModal(modal);
}

async function submitFeedback(interaction: ModalSubmitInteraction) {
  if (!interaction.guildId) return;

  const raw = interaction.customId.slice(FEEDBACK_MODAL_PREFIX.length);
  const separator = raw.lastIndexOf(':');
  const ticketId = separator > 0 ? raw.slice(0, separator) : '';
  const rating = Number(separator > 0 ? raw.slice(separator + 1) : '');

  if (!ticketId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    await interaction.reply({ content: 'Feedback non valido.', ephemeral: true });
    return;
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId: interaction.guildId },
    include: { category: true }
  });

  if (
    !ticket ||
    ticket.status !== 'CLOSED' ||
    !ticket.category.feedbackEnabled ||
    ticket.openerId !== interaction.user.id
  ) {
    await interaction.reply({ content: 'Non puoi inviare feedback per questo ticket.', ephemeral: true });
    return;
  }

  const comment = interaction.fields.getTextInputValue('comment').trim().slice(0, 1500);
  const staffUserId = feedbackStaffUserId(ticket);

  await prisma.$transaction([
    prisma.ticketFeedback.upsert({
      where: { ticketId: ticket.id },
      update: {
        rating,
        commentEncrypted: comment ? encryptText(comment) : null,
        userId: interaction.user.id,
        staffUserId
      },
      create: {
        ticketId: ticket.id,
        guildId: interaction.guildId,
        userId: interaction.user.id,
        rating,
        commentEncrypted: comment ? encryptText(comment) : null,
        staffUserId
      }
    }),
    prisma.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: 'ticket.feedback',
        details: { rating, commentProvided: Boolean(comment), staffUserId }
      }
    })
  ]);

  await interaction.reply({
    content: 'Grazie. Il tuo feedback è stato registrato.',
    ephemeral: true
  });
  // Rating only: the comment is encrypted and never leaves the database.
  await logTicketEvent(interaction.client, interaction.guildId, 'TICKET_FEEDBACK', {
    title: 'Feedback ricevuto',
    ticket,
    actorId: interaction.user.id,
    categoryName: ticket.category.name,
    fields: [
      { name: 'Valutazione', value: '★'.repeat(rating) + '☆'.repeat(5 - rating) + ' (' + rating + '/5)', inline: true },
      { name: 'Moderatore', value: staffUserId ? '<@' + staffUserId + '> (' + staffUserId + ')' : 'Non attribuito', inline: true }
    ]
  });
}

/**
 * Moderator the rating is attributed to, frozen in the feedback row: the
 * claimer of the closed ticket, otherwise the staff member who closed it
 * (Ticket.closedById is never the opener nor the automatic close).
 */
export function feedbackStaffUserId(ticket: { claimedById: string | null; closedById: string | null }) {
  for (const candidate of [ticket.claimedById, ticket.closedById]) {
    if (candidate && SNOWFLAKE.test(candidate)) return candidate;
  }
  return null;
}

// Same reopen path for everyone: the staff (category staff roles or Manage
// Server/Channels) can always reopen, the opener only within the window.
async function reopenTicketInteraction(interaction: ButtonInteraction) {
  if (!interaction.guild || !interaction.guildId) return;

  const ticketId = interaction.customId.slice(REOPEN_PREFIX.length);
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId: interaction.guildId },
    include: { category: true }
  });
  if (!ticket) {
    await interaction.reply({ content: 'Non puoi riaprire questo ticket.', ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const staff = Boolean(member && hasStaffAccess(member, ticket.category.staffRoleIds));
  if (!staff && ticket.openerId !== interaction.user.id) {
    await interaction.reply({ content: 'Non puoi riaprire questo ticket.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    await reopenTicket(
      interaction.client,
      interaction.guildId,
      ticket.id,
      interaction.user.id,
      !staff
    );
    await interaction.editReply('Ticket riaperto.');
  } catch (error) {
    const code = error instanceof Error ? error.message : 'REOPEN_FAILED';
    const message = code === 'REOPEN_WINDOW_EXPIRED'
      ? 'La finestra di riapertura è scaduta.'
      : code === 'REOPEN_DISABLED'
        ? 'La riapertura utente non è abilitata per questa categoria.'
        : code === 'TICKET_CHANNEL_DELETED'
          ? 'Il canale di questo ticket è stato eliminato: non può essere riaperto.'
          : 'Non è possibile riaprire questo ticket.';
    await interaction.editReply(message).catch(() => null);
  }
}

async function closedTicketForStaff(interaction: ButtonInteraction, ticketId: string) {
  if (!interaction.guild || !interaction.guildId) return null;
  if (!CUID.test(ticketId)) {
    await interaction.reply({ content: 'Ticket non valido.', ephemeral: true });
    return null;
  }
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId: interaction.guildId, channelId: interaction.channelId },
    include: { category: true }
  });
  if (!ticket || ticket.status !== 'CLOSED' || ticket.retentionPendingAt || ticket.channelDeletedAt) {
    await interaction.reply({ content: 'Il canale di questo ticket non può essere eliminato.', ephemeral: true });
    return null;
  }
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member || !hasStaffAccess(member, ticket.category.staffRoleIds)) {
    await interaction.reply({ content: 'Non hai i permessi per eliminare questo canale.', ephemeral: true });
    return null;
  }
  return ticket;
}

async function promptDeleteTicketChannel(interaction: ButtonInteraction) {
  const ticketId = interaction.customId.slice(DELETE_CHANNEL_PREFIX.length);
  const ticket = await closedTicketForStaff(interaction, ticketId);
  if (!ticket) return;

  const expiry = (Date.now() + DELETE_CONFIRM_TTL_MS).toString(36);
  await interaction.reply({
    content: `Eliminare definitivamente il canale del ticket #${ticket.ticketNumber}? ` +
      'Il transcript viene prima generato o consegnato secondo le impostazioni della categoria. ' +
      'Il ticket resta nello storico della dashboard ma non potrà più essere riaperto.',
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(DELETE_CONFIRM_PREFIX + ticket.id + ':' + expiry)
          .setLabel('Conferma eliminazione')
          .setStyle(ButtonStyle.Danger)
      )
    ],
    allowedMentions: { parse: [] },
    ephemeral: true
  });
}

async function confirmDeleteTicketChannel(interaction: ButtonInteraction) {
  if (!interaction.guildId) return;
  const [ticketId, expiry, extra] = interaction.customId.slice(DELETE_CONFIRM_PREFIX.length).split(':');
  const expiresAt = expiry ? parseInt(expiry, 36) : NaN;
  if (!ticketId || extra !== undefined || !Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    await interaction.reply({ content: 'Conferma scaduta. Premi di nuovo “Elimina canale”.', ephemeral: true });
    return;
  }
  // Staff and ticket state are checked again: the confirmation is only a click.
  const ticket = await closedTicketForStaff(interaction, ticketId);
  if (!ticket) return;

  await interaction.update({ content: 'Eliminazione del canale in corso…', components: [] });
  try {
    await deleteTicketChannel(interaction.client, interaction.guildId, ticket.id, interaction.user.id);
    // The ephemeral message lived in the deleted channel: a failed edit is fine.
    await interaction.editReply({ content: 'Canale eliminato.', components: [] }).catch(() => null);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'DELETE_FAILED';
    const message = code === 'TICKET_TRANSCRIPT_FAILED'
      ? 'Impossibile generare o consegnare il transcript: il canale non è stato eliminato.'
      : code === 'TICKET_CHANNEL_DELETE_FAILED'
        ? 'Discord ha rifiutato l’eliminazione del canale. Controlla i permessi del bot.'
        : 'Il canale di questo ticket non può essere eliminato.';
    await interaction.editReply({ content: message, components: [] }).catch(() => null);
  }
}

const STAFF_THREAD_ERRORS: Record<string, string> = {
  STAFF_THREAD_MISSING_PERMISSIONS: 'Il bot non ha i permessi per creare thread privati: aggiorna i permessi del suo ruolo ' +
    '(Crea thread privati, Invia messaggi nei thread, Gestisci thread).',
  STAFF_THREAD_BUSY: 'Il thread staff è in fase di creazione: riprova tra qualche secondo.',
  STAFF_THREAD_FORBIDDEN: 'Solo lo staff di questa categoria può usare il thread staff.',
  TICKET_CLOSED: 'Il thread staff è disponibile solo per i ticket attivi.',
  TICKET_REOPENING: 'Il thread staff è disponibile solo per i ticket attivi.',
  TICKET_CHANNEL_DELETED: 'Il thread staff è disponibile solo per i ticket attivi.'
};

// Staff only (category staff roles, Manage Server/Channels), never the opener,
// active tickets only. Joins the live staff thread or creates it.
async function staffThreadInteraction(interaction: ButtonInteraction) {
  if (!interaction.guild || !interaction.guildId) return;

  const ticketId = interaction.customId.slice(STAFF_THREAD_PREFIX.length);
  if (!CUID.test(ticketId)) {
    await interaction.reply({ content: 'Ticket non valido.', ephemeral: true });
    return;
  }
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId: interaction.guildId, channelId: interaction.channelId },
    include: { category: true }
  });
  if (!ticket || !OPEN_STATUSES.includes(ticket.status) || ticket.retentionPendingAt || ticket.channelDeletedAt) {
    await interaction.reply({ content: STAFF_THREAD_ERRORS.TICKET_CLOSED!, ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member || interaction.user.id === ticket.openerId || !hasStaffAccess(member, ticket.category.staffRoleIds)) {
    await interaction.reply({ content: STAFF_THREAD_ERRORS.STAFF_THREAD_FORBIDDEN!, ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await openStaffThread(interaction.client, interaction.guildId, ticket.id, interaction.user.id);
    await interaction.editReply({
      content: (result.created ? 'Thread staff creato: ' : 'Sei stato aggiunto al thread staff: ') + '<#' + result.threadId + '>',
      allowedMentions: { parse: [] }
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    await interaction.editReply({
      content: STAFF_THREAD_ERRORS[code] ?? 'Impossibile aprire il thread staff.',
      allowedMentions: { parse: [] }
    }).catch(() => null);
  }
}

async function promptCloseTicket(interaction: ButtonInteraction) {
  if (!interaction.guild || !interaction.guildId || !interaction.channelId) return;

  const ticketId = interaction.customId.slice(CLOSE_PREFIX.length);
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId: interaction.guildId, channelId: interaction.channelId },
    include: { category: true }
  });

  if (!ticket || !OPEN_STATUSES.includes(ticket.status)) {
    await interaction.reply({
      content: 'Il ticket è già chiuso o non esiste.',
      ephemeral: true
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const allowed = interaction.user.id === ticket.openerId ||
    hasStaffAccess(member, ticket.category.staffRoleIds);
  if (!allowed) {
    await interaction.reply({
      content: 'Non hai i permessi per chiudere questo ticket.',
      ephemeral: true
    });
    return;
  }

  const reason = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Motivo della chiusura')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)
    .setPlaceholder('Opzionale');

  const modal = new ModalBuilder()
    .setCustomId(`${CLOSE_MODAL_PREFIX}${ticket.id}`)
    .setTitle(`Chiudi ticket #${ticket.ticketNumber}`)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reason));

  await interaction.showModal(modal);
}

async function submitCloseTicket(interaction: ModalSubmitInteraction) {
  if (!interaction.guildId) return;

  const ticketId = interaction.customId.slice(CLOSE_MODAL_PREFIX.length);
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId: interaction.guildId },
    include: { category: true }
  });

  if (!ticket || !OPEN_STATUSES.includes(ticket.status)) {
    await interaction.reply({
      content: 'Il ticket è già chiuso o non esiste.',
      ephemeral: true
    });
    return;
  }

  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const allowed = interaction.user.id === ticket.openerId ||
    hasStaffAccess(member, ticket.category.staffRoleIds);
  if (!allowed) {
    await interaction.reply({
      content: 'Non hai i permessi per chiudere questo ticket.',
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const reason = interaction.fields.getTextInputValue('reason').trim() || null;
  const closed = await closeTicket(
    interaction.client,
    interaction.guildId,
    ticket.id,
    interaction.user.id,
    reason
  ).then(() => true, () => false);
  await interaction.editReply(closed ? 'Ticket chiuso.' : 'Il ticket è già chiuso o non è più disponibile.');
}

export async function handleTicketInteraction(
  interaction: StringSelectMenuInteraction | ButtonInteraction | ModalSubmitInteraction
) {
  const opening = [PANEL_SELECT_PREFIX, PANEL_BUTTON_PREFIX, MAIN_MENU_BUTTON_PREFIX, MAIN_MENU_SELECT_PREFIX, OPEN_MODAL_PREFIX, OPEN_SELECT_PREFIX]
    .some((prefix) => interaction.customId.startsWith(prefix));
  if (opening && interaction.guildId && !allowOpeningInteraction(interaction.guildId, interaction.user.id)) {
    await interaction.reply({ content: 'Stai usando il menu troppo rapidamente. Riprova tra pochi secondi.', ephemeral: true });
    return true;
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith(PANEL_SELECT_PREFIX)
  ) {
    await openTicket(interaction);
    return true;
  }

  if (
    interaction.isButton() &&
    interaction.customId.startsWith(PANEL_BUTTON_PREFIX)
  ) {
    await openTicketFromButton(interaction);
    return true;
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith(MAIN_MENU_SELECT_PREFIX)
  ) {
    await openMainMenuSelection(interaction);
    return true;
  }

  if (
    interaction.isButton() &&
    interaction.customId.startsWith(MAIN_MENU_BUTTON_PREFIX)
  ) {
    await openMainMenu(interaction);
    return true;
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith(OPEN_SELECT_PREFIX)
  ) {
    await submitOpenTicketSelect(interaction);
    return true;
  }

  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith(OPEN_MODAL_PREFIX)
  ) {
    await submitOpenTicket(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(CLAIM_PREFIX)) {
    await claimTicket(interaction);
    return true;
  }

  if (
    interaction.isButton() &&
    interaction.customId.startsWith(UNCLAIM_PREFIX)
  ) {
    await unclaimTicketInteraction(interaction);
    return true;
  }

  if (
    interaction.isButton() &&
    interaction.customId.startsWith(WAITING_PREFIX)
  ) {
    await statusTicketInteraction(interaction, 'WAITING');
    return true;
  }

  if (
    interaction.isButton() &&
    interaction.customId.startsWith(RESOLVED_PREFIX)
  ) {
    await statusTicketInteraction(interaction, 'RESOLVED');
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(FEEDBACK_PREFIX)) {
    await promptFeedback(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(REOPEN_PREFIX)) {
    await reopenTicketInteraction(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(DELETE_CHANNEL_PREFIX)) {
    await promptDeleteTicketChannel(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(DELETE_CONFIRM_PREFIX)) {
    await confirmDeleteTicketChannel(interaction);
    return true;
  }

  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith(FEEDBACK_MODAL_PREFIX)
  ) {
    await submitFeedback(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(STAFF_THREAD_PREFIX)) {
    await staffThreadInteraction(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(CLOSE_PREFIX)) {
    await promptCloseTicket(interaction);
    return true;
  }

  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith(CLOSE_MODAL_PREFIX)
  ) {
    await submitCloseTicket(interaction);
    return true;
  }

  return false;
}
