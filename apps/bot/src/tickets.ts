import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type Client,
  type GuildMember,
  type StringSelectMenuInteraction
} from 'discord.js';
import { prisma } from '@dispatch/db';

const OPEN_STATUSES = ['OPEN', 'WAITING', 'IN_PROGRESS'];
const PANEL_SELECT_PREFIX = 'dispatch:open:';
const CLAIM_PREFIX = 'dispatch:claim:';
const CLOSE_PREFIX = 'dispatch:close:';

function safeChannelPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'user';
}

function ticketControls(ticketId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CLAIM_PREFIX}${ticketId}`)
      .setLabel('Claim')
      .setStyle(ButtonStyle.Primary),
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

async function openTicket(interaction: StringSelectMenuInteraction) {
  if (!interaction.guild || !interaction.guildId) {
    await interaction.reply({ content: 'Questa funzione è disponibile solo nei server.', ephemeral: true });
    return;
  }

  const panelId = interaction.customId.slice(PANEL_SELECT_PREFIX.length);
  const categoryId = interaction.values[0];
  if (!categoryId) {
    await interaction.reply({ content: 'Categoria non valida.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const panel = await prisma.ticketPanel.findFirst({
    where: { id: panelId, guildId: interaction.guildId, enabled: true }
  });
  if (!panel || !panel.categoryIds.includes(categoryId)) {
    await interaction.editReply('Questo pannello non è più valido.');
    return;
  }

  const category = await prisma.ticketCategory.findFirst({
    where: { id: categoryId, guildId: interaction.guildId, enabled: true }
  });
  if (!category) {
    await interaction.editReply('Questa categoria non è più disponibile.');
    return;
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
    await interaction.editReply(`Hai già raggiunto il limite di ${category.maxOpenPerUser} ticket aperti per questa categoria.`);
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
    await interaction.editReply('Non riesco a creare il canale ticket. Controlla i permessi del bot e la categoria Discord configurata.');
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
              panelId: panel.id
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
        { name: 'Stato', value: 'Aperto', inline: true }
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
    await interaction.reply({ content: 'Non hai i permessi per prendere in carico questo ticket.', ephemeral: true });
    return;
  }

  if (ticket.claimedById && ticket.claimedById !== interaction.user.id) {
    await interaction.reply({ content: `Ticket già preso in carico da <@${ticket.claimedById}>.`, ephemeral: true });
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

  await interaction.reply({ content: `Ticket preso in carico da <@${interaction.user.id}>.` });
}

async function closeTicket(interaction: ButtonInteraction) {
  if (!interaction.guild || !interaction.guildId || !interaction.channelId) return;

  const ticketId = interaction.customId.slice(CLOSE_PREFIX.length);
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId: interaction.guildId, channelId: interaction.channelId },
    include: { category: true }
  });

  if (!ticket || ticket.status === 'CLOSED') {
    await interaction.reply({ content: 'Il ticket è già chiuso o non esiste.', ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const allowed = interaction.user.id === ticket.openerId ||
    hasStaffAccess(member, ticket.category.staffRoleIds);
  if (!allowed) {
    await interaction.reply({ content: 'Non hai i permessi per chiudere questo ticket.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  await prisma.$transaction([
    prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: 'CLOSED',
        closedAt: new Date()
      }
    }),
    prisma.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: 'ticket.close',
        details: {}
      }
    })
  ]);

  const channel = interaction.channel;
  if (channel && 'permissionOverwrites' in channel) {
    await channel.permissionOverwrites.edit(ticket.openerId, {
      SendMessages: false
    }).catch(() => null);
  }
  if (channel && 'setName' in channel) {
    await channel.setName(`closed-${String(ticket.ticketNumber).padStart(4, '0')}`).catch(() => null);
  }

  await interaction.editReply(`Ticket chiuso da <@${interaction.user.id}>.`);
}

export async function handleTicketInteraction(interaction: StringSelectMenuInteraction | ButtonInteraction) {
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(PANEL_SELECT_PREFIX)) {
    await openTicket(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(CLAIM_PREFIX)) {
    await claimTicket(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(CLOSE_PREFIX)) {
    await closeTicket(interaction);
    return true;
  }

  return false;
}
