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
import { encryptText } from './security.js';
import { closeTicket, reopenTicket, setTicketStatus, unclaimTicket } from './ticket-operations.js';

const OPEN_STATUSES = ['OPEN', 'WAITING', 'IN_PROGRESS', 'RESOLVED'];
const PANEL_SELECT_PREFIX = 'dispatch:open:';
const OPEN_MODAL_PREFIX = 'dispatch:open-modal:';
const CLAIM_PREFIX = 'dispatch:claim:';
const UNCLAIM_PREFIX = 'dispatch:unclaim:';
const WAITING_PREFIX = 'dispatch:waiting:';
const RESOLVED_PREFIX = 'dispatch:resolved:';
const CLOSE_PREFIX = 'dispatch:close:';
const CLOSE_MODAL_PREFIX = 'dispatch:close-modal:';
const FEEDBACK_PREFIX = 'dispatch:feedback:';
const FEEDBACK_MODAL_PREFIX = 'dispatch:feedback-modal:';
const REOPEN_PREFIX = 'dispatch:reopen:';

type FormField = {
  id: string;
  label: string;
  style: 'SHORT' | 'PARAGRAPH';
  required: boolean;
  placeholder?: string | null;
  minLength?: number | null;
  maxLength?: number | null;
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
      style: row.style === 'PARAGRAPH' ? 'PARAGRAPH' : 'SHORT',
      required: row.required !== false,
      placeholder: typeof row.placeholder === 'string' ? row.placeholder.slice(0, 100) : null,
      minLength,
      maxLength
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

function ticketControls(ticketId: string) {
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
    await prisma.guildBlacklist.delete({ where: { id: entry.id } }).catch(() => null);
    return false;
  }

  return true;
}

export async function publishTicketPanel(client: Client, guildId: string, panelId: string) {
  const panel = await prisma.ticketPanel.findFirst({
    where: { id: panelId, guildId, enabled: true }
  });
  if (!panel) throw new Error('PANEL_NOT_FOUND');

  const categories = await prisma.ticketCategory.findMany({
    where: {
      guildId,
      id: { in: panel.categoryIds },
      enabled: true
    },
    orderBy: { createdAt: 'asc' }
  });
  if (!categories.length) throw new Error('PANEL_HAS_NO_CATEGORIES');
  if (categories.length > 25) throw new Error('PANEL_TOO_MANY_CATEGORIES');

  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('GUILD_NOT_FOUND');

  const channel = await guild.channels.fetch(panel.channelId);
  if (!channel || !channel.isTextBased() || !('send' in channel)) {
    throw new Error('PANEL_CHANNEL_INVALID');
  }

  const embed = new EmbedBuilder()
    .setTitle(panel.title)
    .setDescription(panel.description || 'Seleziona il tipo di ticket da aprire.')
    .setFooter({ text: 'Dispatch' });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PANEL_SELECT_PREFIX}${panel.id}`)
    .setPlaceholder('Seleziona una categoria')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(categories.map((category) => ({
      label: category.name.slice(0, 100),
      value: category.id,
      description: category.description?.slice(0, 100) || undefined
    })));

  const payload = {
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)]
  };

  let messageId: string;
  if (panel.messageId) {
    try {
      const existing = await channel.messages.fetch(panel.messageId);
      const edited = await existing.edit(payload);
      messageId = edited.id;
    } catch {
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

async function createTicket(
  interaction: StringSelectMenuInteraction | ModalSubmitInteraction,
  panelId: string,
  categoryId: string,
  formAnswers: Array<{ id: string; label: string; value: string }>
) {
  if (!interaction.guild || !interaction.guildId) {
    await interaction.editReply('Questa funzione è disponibile solo nei server.');
    return;
  }

  const [panel, category] = await Promise.all([
    prisma.ticketPanel.findFirst({
      where: { id: panelId, guildId: interaction.guildId, enabled: true }
    }),
    prisma.ticketCategory.findFirst({
      where: { id: categoryId, guildId: interaction.guildId, enabled: true }
    })
  ]);

  if (!panel || !panel.categoryIds.includes(categoryId)) {
    await interaction.editReply('Questo pannello non è più valido.');
    return;
  }
  if (!category) {
    await interaction.editReply('Questa categoria non è più disponibile.');
    return;
  }

  const blacklist = await prisma.guildBlacklist.findUnique({
    where: {
      guildId_userId: {
        guildId: interaction.guildId,
        userId: interaction.user.id
      }
    }
  });

  if (blacklist) {
    if (!blacklist.expiresAt || blacklist.expiresAt.getTime() > Date.now()) {
      await interaction.editReply('Non puoi aprire ticket in questo server.');
      return;
    }

    await prisma.guildBlacklist.delete({ where: { id: blacklist.id } }).catch(() => null);
  }

  const openCount = await prisma.ticket.count({
    where: {
      guildId: interaction.guildId,
      categoryId,
      openerId: interaction.user.id,
      status: { in: OPEN_STATUSES }
    }
  });
  if (openCount >= category.maxOpenPerUser) {
    await interaction.editReply(
      `Hai già raggiunto il limite di ${category.maxOpenPerUser} ticket aperti per questa categoria.`
    );
    return;
  }

  const counter = await prisma.guildSettings.update({
    where: { guildId: interaction.guildId },
    data: { ticketCounter: { increment: 1 } },
    select: { ticketCounter: true }
  });

  const number = counter.ticketCounter;
  const channelName = `ticket-${String(number).padStart(4, '0')}-${safeChannelPart(interaction.user.username)}`;

  const permissionOverwrites = [
    {
      id: interaction.guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    },
    ...category.staffRoleIds.map((roleId) => ({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages
      ]
    }))
  ];

  let channel;
  try {
    channel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category.discordCategoryId ?? undefined,
      topic: `Dispatch ticket #${number} - ${interaction.user.id} - ${category.name}`.slice(0, 1024),
      permissionOverwrites
    });
  } catch {
    await interaction.editReply(
      'Non riesco a creare il canale ticket. Controlla i permessi del bot e la categoria Discord configurata.'
    );
    return;
  }

  try {
    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber: number,
        guildId: interaction.guildId,
        categoryId: category.id,
        openerId: interaction.user.id,
        channelId: channel.id,
        status: 'OPEN',
        subject: null,
        formDataEncrypted: formAnswers.length
          ? encryptText(JSON.stringify(formAnswers))
          : null,
        lastActivityAt: new Date(),
        members: {
          create: { userId: interaction.user.id, access: 'OPENER' }
        },
        audit: {
          create: {
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            action: 'ticket.open',
            details: {
              categoryId: category.id,
              categoryName: category.name,
              panelId: panel.id,
              formFieldCount: formAnswers.length
            }
          }
        }
      }
    });

    const intro = new EmbedBuilder()
      .setTitle(`Ticket #${number} - ${category.name}`)
      .setDescription(`Ciao <@${interaction.user.id}>. Lo staff ti risponderà qui.`)
      .addFields(
        { name: 'Categoria', value: category.name, inline: true },
        { name: 'Stato', value: 'Aperto', inline: true },
        { name: 'Priorità', value: 'Normal', inline: true },
        ...formAnswers.map((answer) => ({
          name: answer.label.slice(0, 256),
          value: answer.value.trim().slice(0, 1024) || '_Nessuna risposta_',
          inline: false
        }))
      )
      .setFooter({ text: `Dispatch • ${ticket.id}` })
      .setTimestamp();

    await channel.send({
      content: category.staffRoleIds.map((roleId) => `<@&${roleId}>`).join(' ') || undefined,
      embeds: [intro],
      components: [ticketControls(ticket.id)],
      allowedMentions: { roles: category.staffRoleIds }
    });

    await interaction.editReply(`Ticket creato: <#${channel.id}>`);
  } catch (error) {
    await channel.delete('Rollback Dispatch: database ticket creation failed').catch(() => null);
    throw error;
  }
}

async function openTicket(interaction: StringSelectMenuInteraction) {
  if (!interaction.guild || !interaction.guildId) {
    await interaction.reply({
      content: 'Questa funzione è disponibile solo nei server.',
      ephemeral: true
    });
    return;
  }

  const panelId = interaction.customId.slice(PANEL_SELECT_PREFIX.length);
  const categoryId = interaction.values[0];
  if (!categoryId) {
    await interaction.reply({ content: 'Categoria non valida.', ephemeral: true });
    return;
  }

  const [panel, category] = await Promise.all([
    prisma.ticketPanel.findFirst({
      where: { id: panelId, guildId: interaction.guildId, enabled: true }
    }),
    prisma.ticketCategory.findFirst({
      where: { id: categoryId, guildId: interaction.guildId, enabled: true }
    })
  ]);

  if (!panel || !panel.categoryIds.includes(categoryId) || !category) {
    await interaction.reply({ content: 'Questo pannello non è più valido.', ephemeral: true });
    return;
  }

  if (await userIsBlacklisted(interaction.guildId, interaction.user.id)) {
    await interaction.reply({
      content: 'Non puoi aprire ticket in questo server.',
      ephemeral: true
    });
    return;
  }

  const fields = parseFormFields(category.formFields);
  if (!fields.length) {
    await interaction.deferReply({ ephemeral: true });
    await createTicket(interaction, panelId, categoryId, []);
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${OPEN_MODAL_PREFIX}${panelId}:${categoryId}`)
    .setTitle(`Apri ticket - ${category.name}`.slice(0, 45));

  for (const [index, field] of fields.entries()) {
    const input = new TextInputBuilder()
      .setCustomId(`field_${index + 1}`)
      .setLabel(field.label)
      .setStyle(field.style === 'PARAGRAPH' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(field.required);

    if (field.placeholder) input.setPlaceholder(field.placeholder);
    if (field.minLength !== null && field.minLength !== undefined) input.setMinLength(field.minLength);
    if (field.maxLength !== null && field.maxLength !== undefined) input.setMaxLength(field.maxLength);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }

  await interaction.showModal(modal);
}

async function submitOpenTicket(interaction: ModalSubmitInteraction) {
  const raw = interaction.customId.slice(OPEN_MODAL_PREFIX.length);
  const separator = raw.indexOf(':');
  if (separator < 1) {
    await interaction.reply({ content: 'Form ticket non valido.', ephemeral: true });
    return;
  }

  const panelId = raw.slice(0, separator);
  const categoryId = raw.slice(separator + 1);

  if (!interaction.guildId) return;

  const category = await prisma.ticketCategory.findFirst({
    where: { id: categoryId, guildId: interaction.guildId, enabled: true }
  });
  if (!category) {
    await interaction.reply({ content: 'Categoria non più disponibile.', ephemeral: true });
    return;
  }

  const fields = parseFormFields(category.formFields);
  const answers = fields.map((field, index) => ({
    id: field.id,
    label: field.label,
    value: interaction.fields.getTextInputValue(`field_${index + 1}`)
  }));

  await interaction.deferReply({ ephemeral: true });
  await createTicket(interaction, panelId, categoryId, answers);
}

async function claimTicket(interaction: ButtonInteraction) {
  if (!interaction.guild || !interaction.guildId || !interaction.channelId) return;

  const ticketId = interaction.customId.slice(CLAIM_PREFIX.length);
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId: interaction.guildId, channelId: interaction.channelId },
    include: { category: true }
  });

  if (!ticket || ticket.status === 'CLOSED') {
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

  await prisma.$transaction([
    prisma.ticket.update({
      where: { id: ticket.id },
      data: { claimedById: interaction.user.id, status: 'IN_PROGRESS' }
    }),
    prisma.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: 'ticket.claim',
        details: {}
      }
    })
  ]);

  await interaction.reply({
    content: `Ticket preso in carico da <@${interaction.user.id}>.`
  });
}

async function unclaimTicketInteraction(interaction: ButtonInteraction) {
  if (!interaction.guildId) return;

  const ticketId = interaction.customId.slice(UNCLAIM_PREFIX.length);
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId: interaction.guildId },
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
    where: { id: ticketId, guildId: interaction.guildId },
    include: { category: true }
  });
  if (!ticket || ticket.status === 'CLOSED') {
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

  await prisma.$transaction([
    prisma.ticketFeedback.upsert({
      where: { ticketId: ticket.id },
      update: {
        rating,
        commentEncrypted: comment ? encryptText(comment) : null,
        userId: interaction.user.id
      },
      create: {
        ticketId: ticket.id,
        guildId: interaction.guildId,
        userId: interaction.user.id,
        rating,
        commentEncrypted: comment ? encryptText(comment) : null
      }
    }),
    prisma.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: 'ticket.feedback',
        details: { rating, commentProvided: Boolean(comment) }
      }
    })
  ]);

  await interaction.reply({
    content: 'Grazie. Il tuo feedback è stato registrato.',
    ephemeral: true
  });
}

async function reopenTicketInteraction(interaction: ButtonInteraction) {
  if (!interaction.guildId) return;

  const ticketId = interaction.customId.slice(REOPEN_PREFIX.length);
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId: interaction.guildId }
  });

  if (!ticket || ticket.openerId !== interaction.user.id) {
    await interaction.reply({ content: 'Non puoi riaprire questo ticket.', ephemeral: true });
    return;
  }

  try {
    await reopenTicket(
      interaction.client,
      interaction.guildId,
      ticket.id,
      interaction.user.id,
      true
    );
    await interaction.reply({ content: 'Ticket riaperto.', ephemeral: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'REOPEN_FAILED';
    const message = code === 'REOPEN_WINDOW_EXPIRED'
      ? 'La finestra di riapertura è scaduta.'
      : code === 'REOPEN_DISABLED'
        ? 'La riapertura utente non è abilitata per questa categoria.'
        : 'Non è possibile riaprire questo ticket.';
    await interaction.reply({ content: message, ephemeral: true }).catch(() => null);
  }
}

async function promptCloseTicket(interaction: ButtonInteraction) {
  if (!interaction.guild || !interaction.guildId || !interaction.channelId) return;

  const ticketId = interaction.customId.slice(CLOSE_PREFIX.length);
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId: interaction.guildId, channelId: interaction.channelId },
    include: { category: true }
  });

  if (!ticket || ticket.status === 'CLOSED') {
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

  if (!ticket || ticket.status === 'CLOSED') {
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
  await closeTicket(
    interaction.client,
    interaction.guildId,
    ticket.id,
    interaction.user.id,
    reason
  );
  await interaction.editReply('Ticket chiuso e transcript aggiornato.');
}

export async function handleTicketInteraction(
  interaction: StringSelectMenuInteraction | ButtonInteraction | ModalSubmitInteraction
) {
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith(PANEL_SELECT_PREFIX)
  ) {
    await openTicket(interaction);
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

  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith(FEEDBACK_MODAL_PREFIX)
  ) {
    await submitFeedback(interaction);
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
