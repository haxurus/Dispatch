import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type GuildMember,
  type Message,
  type TextChannel
} from 'discord.js';
import { prisma } from '@dispatch/db';
import { encryptText } from './security.js';

const OPEN_STATUSES = ['OPEN', 'WAITING', 'IN_PROGRESS', 'RESOLVED'];

const PARTICIPANT_PERMISSIONS = {
  ViewChannel: true,
  SendMessages: true,
  ReadMessageHistory: true,
  AttachFiles: true,
  EmbedLinks: true
} as const;

const STAFF_PERMISSIONS = {
  ...PARTICIPANT_PERMISSIONS,
  ManageMessages: true
} as const;

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function hasStaffAccess(member: GuildMember, staffRoleIds: string[]) {
  return member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    staffRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

async function getTicket(guildId: string, ticketId: string) {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId },
    include: {
      category: true,
      members: true
    }
  });
  if (!ticket) throw new Error('TICKET_NOT_FOUND');
  return ticket;
}

async function getGuildChannel(client: Client, guildId: string, channelId: string) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('GUILD_NOT_FOUND');

  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error('TICKET_CHANNEL_NOT_FOUND');
  return { guild, channel: channel as TextChannel };
}

function closureComponents(
  ticketId: string,
  feedbackEnabled: boolean,
  reopenWindowHours: number | null
) {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (feedbackEnabled) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...[1, 2, 3, 4, 5].map((rating) =>
          new ButtonBuilder()
            .setCustomId('dispatch:feedback:' + ticketId + ':' + rating)
            .setLabel('★'.repeat(rating))
            .setStyle(rating >= 4 ? ButtonStyle.Success : rating === 3 ? ButtonStyle.Secondary : ButtonStyle.Danger)
        )
      )
    );
  }

  if (reopenWindowHours) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('dispatch:reopen:' + ticketId)
          .setLabel('Riapri ticket')
          .setStyle(ButtonStyle.Primary)
      )
    );
  }

  return rows;
}

async function audit(ticketId: string, guildId: string, actorId: string, action: string, details: Record<string, unknown> = {}) {
  await prisma.ticketAudit.create({
    data: { ticketId, guildId, actorId, action, details: JSON.parse(JSON.stringify(details)) }
  });
}

export async function unclaimTicket(client: Client, guildId: string, ticketId: string, actorId: string) {
  const ticket = await getTicket(guildId, ticketId);
  if (ticket.status === 'CLOSED') throw new Error('TICKET_CLOSED');
  if (!ticket.claimedById) return { ok: true, claimedById: null, status: ticket.status };

  const { channel } = await getGuildChannel(client, guildId, ticket.channelId);

  await prisma.$transaction([
    prisma.ticket.update({
      where: { id: ticket.id },
      data: { claimedById: null, status: 'OPEN' }
    }),
    prisma.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId,
        actorId,
        action: 'ticket.unclaim',
        details: { previousAssigneeId: ticket.claimedById }
      }
    })
  ]);

  await channel.send({ content: `Ticket rilasciato da <@${actorId}>.`, allowedMentions: { users: [actorId] } }).catch(() => null);
  return { ok: true, claimedById: null, status: 'OPEN' };
}

export async function assignTicket(client: Client, guildId: string, ticketId: string, actorId: string, assigneeId: string) {
  const ticket = await getTicket(guildId, ticketId);
  if (ticket.status === 'CLOSED') throw new Error('TICKET_CLOSED');

  const { guild, channel } = await getGuildChannel(client, guildId, ticket.channelId);
  const assignee = await guild.members.fetch(assigneeId).catch(() => null);
  if (!assignee) throw new Error('ASSIGNEE_NOT_FOUND');
  if (!hasStaffAccess(assignee, ticket.category.staffRoleIds)) throw new Error('ASSIGNEE_NOT_STAFF');

  await prisma.$transaction([
    prisma.ticket.update({
      where: { id: ticket.id },
      data: { claimedById: assigneeId, status: 'IN_PROGRESS' }
    }),
    prisma.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId,
        actorId,
        action: 'ticket.assign',
        details: { assigneeId, previousAssigneeId: ticket.claimedById }
      }
    })
  ]);

  await channel.send({
    content: `Ticket assegnato a <@${assigneeId}> da <@${actorId}>.`,
    allowedMentions: { users: [assigneeId, actorId] }
  }).catch(() => null);

  return { ok: true, claimedById: assigneeId, status: 'IN_PROGRESS' };
}

export async function transferTicketCategory(client: Client, guildId: string, ticketId: string, actorId: string, categoryId: string) {
  const ticket = await getTicket(guildId, ticketId);
  if (ticket.status === 'CLOSED') throw new Error('TICKET_CLOSED');

  const category = await prisma.ticketCategory.findFirst({
    where: { id: categoryId, guildId, enabled: true }
  });
  if (!category) throw new Error('CATEGORY_NOT_FOUND');

  const { channel } = await getGuildChannel(client, guildId, ticket.channelId);

  for (const roleId of ticket.category.staffRoleIds) {
    if (!category.staffRoleIds.includes(roleId)) {
      await channel.permissionOverwrites.delete(roleId).catch(() => null);
    }
  }

  for (const roleId of category.staffRoleIds) {
    await channel.permissionOverwrites.edit(roleId, STAFF_PERMISSIONS);
  }

  await channel.setParent(category.discordCategoryId, { lockPermissions: false });

  const previousCategoryId = ticket.categoryId;
  await prisma.$transaction([
    prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        categoryId: category.id,
        claimedById: null,
        status: 'OPEN'
      }
    }),
    prisma.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId,
        actorId,
        action: 'ticket.transfer',
        details: {
          previousCategoryId,
          categoryId: category.id,
          categoryName: category.name
        }
      }
    })
  ]);

  await channel.send({
    content: `Ticket trasferito alla categoria **${category.name}** da <@${actorId}>.`,
    allowedMentions: { users: [actorId] }
  }).catch(() => null);

  return { ok: true, categoryId: category.id, status: 'OPEN', claimedById: null };
}

export async function addTicketMember(client: Client, guildId: string, ticketId: string, actorId: string, userId: string) {
  const ticket = await getTicket(guildId, ticketId);
  if (ticket.status === 'CLOSED') throw new Error('TICKET_CLOSED');

  const { guild, channel } = await getGuildChannel(client, guildId, ticket.channelId);
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new Error('MEMBER_NOT_FOUND');

  await channel.permissionOverwrites.edit(userId, PARTICIPANT_PERMISSIONS);

  await prisma.$transaction([
    prisma.ticketMember.upsert({
      where: { ticketId_userId: { ticketId: ticket.id, userId } },
      update: { access: userId === ticket.openerId ? 'OPENER' : 'PARTICIPANT' },
      create: {
        ticketId: ticket.id,
        userId,
        access: userId === ticket.openerId ? 'OPENER' : 'PARTICIPANT'
      }
    }),
    prisma.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId,
        actorId,
        action: 'ticket.member.add',
        details: { userId }
      }
    })
  ]);

  await channel.send({
    content: `<@${userId}> è stato aggiunto al ticket da <@${actorId}>.`,
    allowedMentions: { users: [userId, actorId] }
  }).catch(() => null);

  return { ok: true, userId };
}

export async function removeTicketMember(client: Client, guildId: string, ticketId: string, actorId: string, userId: string) {
  const ticket = await getTicket(guildId, ticketId);
  if (userId === ticket.openerId) throw new Error('CANNOT_REMOVE_OPENER');

  const existing = ticket.members.find((member) => member.userId === userId);
  if (!existing) throw new Error('MEMBER_NOT_FOUND');

  const { channel } = await getGuildChannel(client, guildId, ticket.channelId);
  await channel.permissionOverwrites.delete(userId).catch(() => null);

  await prisma.$transaction([
    prisma.ticketMember.delete({
      where: { ticketId_userId: { ticketId: ticket.id, userId } }
    }),
    prisma.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId,
        actorId,
        action: 'ticket.member.remove',
        details: { userId }
      }
    })
  ]);

  await channel.send({
    content: `<@${userId}> è stato rimosso dal ticket da <@${actorId}>.`,
    allowedMentions: { users: [userId, actorId] }
  }).catch(() => null);

  return { ok: true, userId };
}

export async function generateTranscript(client: Client, guildId: string, ticketId: string, actorId?: string) {
  const ticket = await getTicket(guildId, ticketId);
  const { channel } = await getGuildChannel(client, guildId, ticket.channelId);

  const messages = [];
  let before: string | undefined;

  for (;;) {
    const page = await channel.messages.fetch({ limit: 100, before });
    if (!page.size) break;

    messages.push(...page.values());
    const oldest = page.last();
    if (!oldest || page.size < 100) break;
    before = oldest.id;
  }

  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const rows = messages.map((message) => {
    const content = message.content ? escapeHtml(message.content) : '<em>[nessun contenuto testuale]</em>';
    const attachments = [...message.attachments.values()].map((attachment) =>
      `<li><a href="${escapeHtml(attachment.url)}" rel="noreferrer">${escapeHtml(attachment.name ?? 'allegato')}</a></li>`
    ).join('');
    const attachmentBlock = attachments ? `<ul>${attachments}</ul>` : '';
    const embedBlock = message.embeds.length ? `<div class="meta">Embed: ${message.embeds.length}</div>` : '';

    return `<article class="message">
      <div class="meta">${escapeHtml(message.author.tag)} · ${escapeHtml(message.createdAt.toISOString())} · ${message.id}</div>
      <div class="content">${content.replaceAll('\n', '<br>')}</div>
      ${attachmentBlock}
      ${embedBlock}
    </article>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dispatch Ticket #${ticket.ticketNumber}</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f1115;color:#f5f7fa;max-width:960px;margin:0 auto;padding:32px}
.message{border-bottom:1px solid #303744;padding:16px 0}
.meta{color:#9aa7b8;font-size:12px;margin-bottom:6px}
.content{white-space:normal;overflow-wrap:anywhere}
a{color:#8ab4ff}
</style>
</head>
<body>
<h1>Ticket #${ticket.ticketNumber}</h1>
<p>Categoria: ${escapeHtml(ticket.category.name)} · Stato: ${escapeHtml(ticket.status)}</p>
${rows}
</body>
</html>`;

  await prisma.transcript.upsert({
    where: { ticketId: ticket.id },
    update: {
      contentEncrypted: encryptText(html)!,
      messageCount: messages.length,
      createdAt: new Date()
    },
    create: {
      ticketId: ticket.id,
      contentEncrypted: encryptText(html)!,
      messageCount: messages.length
    }
  });

  if (actorId) {
    await audit(ticket.id, guildId, actorId, 'ticket.transcript.generate', { messageCount: messages.length });
  }

  return { ok: true, messageCount: messages.length };
}

export async function closeTicket(
  client: Client,
  guildId: string,
  ticketId: string,
  actorId: string,
  reason: string | null
) {
  const ticket = await getTicket(guildId, ticketId);
  if (ticket.status === 'CLOSED') throw new Error('TICKET_CLOSED');

  const { channel } = await getGuildChannel(client, guildId, ticket.channelId);
  const trimmedReason = reason?.trim().slice(0, 1000) || null;

  await prisma.$transaction([
    prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: 'CLOSED',
        claimedById: ticket.claimedById,
        closeReason: encryptText(trimmedReason),
        closedAt: new Date()
      }
    }),
    prisma.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId,
        actorId,
        action: 'ticket.close',
        details: { reasonProvided: Boolean(trimmedReason) }
      }
    })
  ]);

  for (const member of ticket.members) {
    await channel.permissionOverwrites.edit(member.userId, { SendMessages: false }).catch(() => null);
  }

  await channel.setName(`closed-${String(ticket.ticketNumber).padStart(4, '0')}`).catch(() => null);
  await channel.send({
    content: trimmedReason
      ? `Ticket chiuso da <@${actorId}>. Motivo: ${trimmedReason}`
      : `Ticket chiuso da <@${actorId}>.`,
    allowedMentions: { users: [actorId] }
  }).catch(() => null);

  const components = closureComponents(
    ticket.id,
    ticket.category.feedbackEnabled,
    ticket.category.reopenWindowHours
  );

  if (components.length) {
    await channel.send({
      content: [
        ticket.category.feedbackEnabled ? 'Puoi valutare l’assistenza ricevuta.' : null,
        ticket.category.reopenWindowHours
          ? `Puoi riaprire il ticket entro ${ticket.category.reopenWindowHours} ore dalla chiusura.`
          : null
      ].filter(Boolean).join(' '),
      components
    }).catch(() => null);

    if (ticket.category.feedbackEnabled) {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { feedbackRequestedAt: new Date() }
      });
    }
  }

  await generateTranscript(client, guildId, ticket.id).catch(() => null);

  return { ok: true, status: 'CLOSED' };
}

export async function reopenTicket(
  client: Client,
  guildId: string,
  ticketId: string,
  actorId: string,
  enforceUserWindow = false
) {
  const ticket = await getTicket(guildId, ticketId);
  if (ticket.status !== 'CLOSED') throw new Error('TICKET_NOT_CLOSED');

  if (enforceUserWindow) {
    if (actorId !== ticket.openerId) throw new Error('REOPEN_NOT_OPENER');
    if (!ticket.category.reopenWindowHours || !ticket.closedAt) throw new Error('REOPEN_DISABLED');

    const deadline = ticket.closedAt.getTime() + ticket.category.reopenWindowHours * 3_600_000;
    if (Date.now() > deadline) throw new Error('REOPEN_WINDOW_EXPIRED');
  }

  const { channel } = await getGuildChannel(client, guildId, ticket.channelId);

  for (const member of ticket.members) {
    await channel.permissionOverwrites.edit(member.userId, PARTICIPANT_PERMISSIONS);
  }

  await channel.setName(`ticket-${String(ticket.ticketNumber).padStart(4, '0')}`).catch(() => null);

  await prisma.$transaction([
    prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: 'OPEN',
        closeReason: null,
        closedAt: null,
        claimedById: null,
        escalatedAt: null,
        feedbackRequestedAt: null,
        inactivityWarnedAt: null
      }
    }),
    prisma.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId,
        actorId,
        action: 'ticket.reopen',
        details: { userWindowEnforced: enforceUserWindow }
      }
    }),
    prisma.ticketFeedback.deleteMany({
      where: { ticketId: ticket.id }
    })
  ]);

  await channel.send({
    content: `Ticket riaperto da <@${actorId}>.`,
    allowedMentions: { users: [actorId] }
  }).catch(() => null);

  return { ok: true, status: 'OPEN', claimedById: null };
}

export function ticketIsOpen(status: string) {
  return OPEN_STATUSES.includes(status);
}


export async function setTicketStatus(
  client: Client,
  guildId: string,
  ticketId: string,
  actorId: string,
  status: 'OPEN' | 'WAITING' | 'IN_PROGRESS' | 'RESOLVED'
) {
  const ticket = await getTicket(guildId, ticketId);
  if (ticket.status === 'CLOSED') throw new Error('TICKET_CLOSED');

  const { channel } = await getGuildChannel(client, guildId, ticket.channelId);
  const previousStatus = ticket.status;

  await prisma.$transaction([
    prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status,
        lastActivityAt: new Date(),
        inactivityWarnedAt: null
      }
    }),
    prisma.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId,
        actorId,
        action: 'ticket.status',
        details: { previousStatus, status }
      }
    })
  ]);

  const labels: Record<string, string> = {
    OPEN: 'aperto',
    WAITING: 'in attesa',
    IN_PROGRESS: 'in lavorazione',
    RESOLVED: 'risolto'
  };

  await channel.send({
    content: 'Stato ticket impostato su **' + labels[status] + '** da <@' + actorId + '>.',
    allowedMentions: { users: [actorId] }
  }).catch(() => null);

  return { ok: true, status };
}

export async function setTicketPriority(
  client: Client,
  guildId: string,
  ticketId: string,
  actorId: string,
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
) {
  const ticket = await getTicket(guildId, ticketId);
  if (ticket.status === 'CLOSED') throw new Error('TICKET_CLOSED');

  const { channel } = await getGuildChannel(client, guildId, ticket.channelId);
  const previousPriority = ticket.priority;

  await prisma.$transaction([
    prisma.ticket.update({
      where: { id: ticket.id },
      data: { priority }
    }),
    prisma.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId,
        actorId,
        action: 'ticket.priority',
        details: { previousPriority, priority }
      }
    })
  ]);

  await channel.send({
    content: 'Priorita impostata su **' + priority + '** da <@' + actorId + '>.',
    allowedMentions: { users: [actorId] }
  }).catch(() => null);

  return { ok: true, priority };
}

export async function sendTicketReply(
  client: Client,
  guildId: string,
  ticketId: string,
  actorId: string,
  content: string,
  templateId?: string | null
) {
  const ticket = await getTicket(guildId, ticketId);
  if (ticket.status === 'CLOSED') throw new Error('TICKET_CLOSED');

  const trimmed = content.trim().slice(0, 2000);
  if (!trimmed) throw new Error('EMPTY_REPLY');

  const { channel } = await getGuildChannel(client, guildId, ticket.channelId);

  await channel.send({
    content: trimmed,
    allowedMentions: { parse: [], repliedUser: false }
  });

  await prisma.$transaction([
    prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        lastActivityAt: new Date(),
        inactivityWarnedAt: null,
        ...(ticket.firstStaffResponseAt ? {} : { firstStaffResponseAt: new Date() })
      }
    }),
    prisma.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId,
        actorId,
        action: 'ticket.reply',
        details: {
          templateId: templateId ?? null,
          contentLength: trimmed.length
        }
      }
    }),
    ...(!ticket.firstStaffResponseAt ? [
      prisma.ticketAudit.create({
        data: {
          ticketId: ticket.id,
          guildId,
          actorId,
          action: 'ticket.first_staff_response',
          details: { source: 'dashboard' }
        }
      })
    ] : [])
  ]);

  return { ok: true };
}

export async function recordTicketMessage(message: Message) {
  if (!message.guildId || message.author.bot) return;
  if (
    message.channel.type !== ChannelType.GuildText ||
    !message.channel.topic?.startsWith('Dispatch ticket #')
  ) {
    return;
  }

  const ticket = await prisma.ticket.findUnique({
    where: { channelId: message.channelId },
    include: { category: true }
  });
  if (!ticket || ticket.status === 'CLOSED') return;

  let firstStaffResponseAt = ticket.firstStaffResponseAt;
  if (!firstStaffResponseAt) {
    const member = message.member ?? await message.guild?.members.fetch(message.author.id).catch(() => null);
    if (member && hasStaffAccess(member, ticket.category.staffRoleIds)) {
      firstStaffResponseAt = new Date();
    }
  }

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      lastActivityAt: new Date(),
      inactivityWarnedAt: null,
      ...(firstStaffResponseAt && !ticket.firstStaffResponseAt ? { firstStaffResponseAt } : {})
    }
  });

  if (firstStaffResponseAt && !ticket.firstStaffResponseAt) {
    await audit(ticket.id, ticket.guildId, message.author.id, 'ticket.first_staff_response', {
      messageId: message.id
    });
  }
}

async function sendAutomationNotice(
  client: Client,
  guildId: string,
  channelId: string,
  content: string,
  roleIds: string[] = [],
  userIds: string[] = []
) {
  try {
    const { channel } = await getGuildChannel(client, guildId, channelId);
    await channel.send({
      content,
      allowedMentions: { roles: roleIds, users: userIds, parse: [] }
    }).catch(() => null);
  } catch {
    return;
  }
}

export async function runTicketAutomations(client: Client) {
  let cursor: string | undefined;
  const now = Date.now();

  for (;;) {
    const tickets = await prisma.ticket.findMany({
      where: { status: { in: OPEN_STATUSES } },
      include: { category: true },
      orderBy: { id: 'asc' },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });

    if (!tickets.length) break;

    for (const ticket of tickets) {
      const category = ticket.category;

      if (
        category.slaFirstResponseMinutes &&
        !ticket.firstStaffResponseAt &&
        !ticket.slaFirstBreachedAt &&
        ticket.createdAt.getTime() + category.slaFirstResponseMinutes * 60_000 <= now
      ) {
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { slaFirstBreachedAt: new Date() }
        });

        const mentions = category.staffRoleIds.map((roleId) => '<@&' + roleId + '>').join(' ');
        await sendAutomationNotice(
          client,
          ticket.guildId,
          ticket.channelId,
          (mentions ? mentions + ' ' : '') + 'SLA prima risposta superato per il ticket #' + ticket.ticketNumber + '.',
          category.staffRoleIds
        );
        await audit(
          ticket.id,
          ticket.guildId,
          client.user?.id ?? ticket.openerId,
          'ticket.sla.first_response_breached',
          { minutes: category.slaFirstResponseMinutes }
        );
      }

      if (
        category.slaResolutionMinutes &&
        ticket.status !== 'RESOLVED' &&
        !ticket.slaResolutionBreachedAt &&
        ticket.createdAt.getTime() + category.slaResolutionMinutes * 60_000 <= now
      ) {
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { slaResolutionBreachedAt: new Date() }
        });

        const mentions = category.staffRoleIds.map((roleId) => '<@&' + roleId + '>').join(' ');
        await sendAutomationNotice(
          client,
          ticket.guildId,
          ticket.channelId,
          (mentions ? mentions + ' ' : '') + 'SLA risoluzione superato per il ticket #' + ticket.ticketNumber + '.',
          category.staffRoleIds
        );
        await audit(
          ticket.id,
          ticket.guildId,
          client.user?.id ?? ticket.openerId,
          'ticket.sla.resolution_breached',
          { minutes: category.slaResolutionMinutes }
        );
      }

      if (
        category.escalationMinutes &&
        !ticket.escalatedAt &&
        ticket.status !== 'RESOLVED' &&
        ticket.createdAt.getTime() + category.escalationMinutes * 60_000 <= now
      ) {
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { escalatedAt: new Date() }
        });

        const escalationRoles = category.escalationRoleIds.length
          ? category.escalationRoleIds
          : category.staffRoleIds;
        const mentions = escalationRoles.map((roleId) => '<@&' + roleId + '>').join(' ');

        await sendAutomationNotice(
          client,
          ticket.guildId,
          ticket.channelId,
          (mentions ? mentions + ' ' : '') +
            'Escalation automatica per il ticket #' + ticket.ticketNumber + '.',
          escalationRoles
        );
        await audit(
          ticket.id,
          ticket.guildId,
          client.user?.id ?? ticket.openerId,
          'ticket.escalation',
          { minutes: category.escalationMinutes, roleIds: escalationRoles }
        );
      }

      if (category.inactivityCloseHours) {
        const closeAt = ticket.lastActivityAt.getTime() + category.inactivityCloseHours * 3_600_000;
        const warningMinutes = category.inactivityWarningMinutes ?? 0;
        const warnAt = closeAt - warningMinutes * 60_000;

        if (
          warningMinutes > 0 &&
          !ticket.inactivityWarnedAt &&
          now >= warnAt &&
          now < closeAt
        ) {
          await prisma.ticket.update({
            where: { id: ticket.id },
            data: { inactivityWarnedAt: new Date() }
          });

          await sendAutomationNotice(
            client,
            ticket.guildId,
            ticket.channelId,
            '<@' + ticket.openerId + '> questo ticket verra chiuso automaticamente tra circa ' +
              warningMinutes + ' minuti se non ci saranno nuove attivita.',
          [],
          [ticket.openerId]
          );
          await audit(
            ticket.id,
            ticket.guildId,
            client.user?.id ?? ticket.openerId,
            'ticket.inactivity.warning',
            { warningMinutes }
          );
        }

        if (now >= closeAt) {
          await closeTicket(
            client,
            ticket.guildId,
            ticket.id,
            client.user?.id ?? ticket.openerId,
            'Chiuso automaticamente per inattivita.'
          ).catch(() => null);
        }
      }
    }

    cursor = tickets[tickets.length - 1]!.id;
    if (tickets.length < 200) break;
  }
}


export type TicketOpenReservationResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'TICKET_OPEN_BLOCKED'
        | 'TICKET_OPEN_IN_PROGRESS'
        | 'GLOBAL_COOLDOWN'
        | 'CATEGORY_COOLDOWN'
        | 'GLOBAL_ATTEMPT_LIMIT'
        | 'CATEGORY_ATTEMPT_LIMIT';
      retryAfterSeconds: number;
    };

function secondsUntil(date: Date, now: Date) {
  return Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 1000));
}

export async function reserveTicketOpen(
  guildId: string,
  userId: string,
  categoryId: string
): Promise<TicketOpenReservationResult> {
  const [settings, category] = await Promise.all([
    prisma.guildSettings.findUnique({ where: { guildId } }),
    prisma.ticketCategory.findFirst({
      where: { id: categoryId, guildId, enabled: true }
    })
  ]);

  if (!settings) throw new Error('GUILD_NOT_FOUND');
  if (!category) throw new Error('CATEGORY_NOT_FOUND');
  if (!settings.antiSpamEnabled) return { ok: true };

  try {
    return await prisma.$transaction(async (tx) => {
      const now = new Date();

      const guard = await tx.ticketUserGuard.upsert({
        where: { guildId_userId: { guildId, userId } },
        update: {},
        create: { guildId, userId }
      });

      if (guard.blockedUntil && guard.blockedUntil > now) {
        return {
          ok: false,
          code: 'TICKET_OPEN_BLOCKED',
          retryAfterSeconds: secondsUntil(guard.blockedUntil, now)
        };
      }

      if (guard.pendingUntil && guard.pendingUntil > now) {
        return {
          ok: false,
          code: 'TICKET_OPEN_IN_PROGRESS',
          retryAfterSeconds: secondsUntil(guard.pendingUntil, now)
        };
      }

      await tx.ticketOpenAttempt.create({
        data: { guildId, userId, categoryId }
      });

      const globalSince = new Date(
        now.getTime() - settings.antiSpamWindowMinutes * 60_000
      );
      const categorySince = new Date(
        now.getTime() - category.antiSpamWindowMinutes * 60_000
      );

      const [globalAttempts, categoryAttempts, latestCategoryTicket] = await Promise.all([
        tx.ticketOpenAttempt.count({
          where: {
            guildId,
            userId,
            createdAt: { gte: globalSince }
          }
        }),
        tx.ticketOpenAttempt.count({
          where: {
            guildId,
            userId,
            categoryId,
            createdAt: { gte: categorySince }
          }
        }),
        tx.ticket.findFirst({
          where: {
            guildId,
            categoryId,
            openerId: userId
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true }
        })
      ]);

      const limitViolation =
        globalAttempts > settings.antiSpamMaxAttempts
          ? 'GLOBAL_ATTEMPT_LIMIT'
          : categoryAttempts > category.antiSpamMaxAttempts
            ? 'CATEGORY_ATTEMPT_LIMIT'
            : null;

      if (limitViolation) {
        const nextStrikes = Math.min(8, guard.strikes + 1);
        const multiplier = Math.min(8, 2 ** Math.max(0, nextStrikes - 1));
        const blockMinutes = Math.min(
          10_080,
          settings.antiSpamBlockMinutes * multiplier
        );
        const blockedUntil = new Date(now.getTime() + blockMinutes * 60_000);

        await tx.ticketUserGuard.update({
          where: { id: guard.id },
          data: {
            blockedUntil,
            pendingUntil: null,
            strikes: nextStrikes
          }
        });

        return {
          ok: false,
          code: limitViolation,
          retryAfterSeconds: blockMinutes * 60
        };
      }

      if (
        guard.lastOpenedAt &&
        settings.antiSpamGlobalCooldownSeconds > 0
      ) {
        const globalCooldownUntil = new Date(
          guard.lastOpenedAt.getTime() +
            settings.antiSpamGlobalCooldownSeconds * 1000
        );
        if (globalCooldownUntil > now) {
          return {
            ok: false,
            code: 'GLOBAL_COOLDOWN',
            retryAfterSeconds: secondsUntil(globalCooldownUntil, now)
          };
        }
      }

      if (latestCategoryTicket && category.openCooldownSeconds > 0) {
        const categoryCooldownUntil = new Date(
          latestCategoryTicket.createdAt.getTime() +
            category.openCooldownSeconds * 1000
        );
        if (categoryCooldownUntil > now) {
          return {
            ok: false,
            code: 'CATEGORY_COOLDOWN',
            retryAfterSeconds: secondsUntil(categoryCooldownUntil, now)
          };
        }
      }

      await tx.ticketUserGuard.update({
        where: { id: guard.id },
        data: {
          pendingUntil: new Date(now.getTime() + 120_000),
          blockedUntil: null
        }
      });

      return { ok: true };
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error instanceof Error && /transaction|serializ|deadlock|P2034/i.test(error.message)) {
      return {
        ok: false,
        code: 'TICKET_OPEN_IN_PROGRESS',
        retryAfterSeconds: 5
      };
    }
    throw error;
  }
}

export async function hasTicketOpenReservation(guildId: string, userId: string) {
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { antiSpamEnabled: true }
  });
  if (!settings) throw new Error('GUILD_NOT_FOUND');
  if (!settings.antiSpamEnabled) return true;

  const guard = await prisma.ticketUserGuard.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { pendingUntil: true }
  });

  return Boolean(guard?.pendingUntil && guard.pendingUntil.getTime() > Date.now());
}

export async function releaseTicketOpenReservation(guildId: string, userId: string) {
  await prisma.ticketUserGuard.updateMany({
    where: { guildId, userId },
    data: { pendingUntil: null }
  });
}

export async function markTicketOpened(guildId: string, userId: string) {
  await prisma.ticketUserGuard.upsert({
    where: { guildId_userId: { guildId, userId } },
    update: {
      lastOpenedAt: new Date(),
      pendingUntil: null,
      blockedUntil: null,
      strikes: 0
    },
    create: {
      guildId,
      userId,
      lastOpenedAt: new Date()
    }
  });
}

export function ticketOpenReservationMessage(
  result: Exclude<TicketOpenReservationResult, { ok: true }>
) {
  const seconds = result.retryAfterSeconds;
  const human = seconds >= 3600
    ? Math.ceil(seconds / 3600) + ' ore'
    : seconds >= 60
      ? Math.ceil(seconds / 60) + ' minuti'
      : seconds + ' secondi';

  switch (result.code) {
    case 'TICKET_OPEN_BLOCKED':
    case 'GLOBAL_ATTEMPT_LIMIT':
    case 'CATEGORY_ATTEMPT_LIMIT':
      return 'Hai effettuato troppi tentativi di apertura. Riprova tra circa ' + human + '.';
    case 'TICKET_OPEN_IN_PROGRESS':
      return 'Hai già un’apertura ticket in corso. Completa quella richiesta oppure riprova tra circa ' + human + '.';
    case 'GLOBAL_COOLDOWN':
      return 'Devi attendere circa ' + human + ' prima di aprire un altro ticket.';
    case 'CATEGORY_COOLDOWN':
      return 'Devi attendere circa ' + human + ' prima di aprire un altro ticket di questa categoria.';
  }
}

export async function runTicketRetention(client: Client) {
  const settingsRows = await prisma.guildSettings.findMany({
    where: {
      OR: [
        { transcriptRetentionDays: { not: null } },
        { closedTicketRetentionDays: { not: null } }
      ]
    },
    select: {
      guildId: true,
      transcriptRetentionDays: true,
      closedTicketRetentionDays: true,
      retentionDeleteDiscordChannel: true
    }
  });

  let transcriptsDeleted = 0;
  let ticketsDeleted = 0;
  let channelsDeleted = 0;

  for (const settings of settingsRows) {
    if (settings.transcriptRetentionDays !== null) {
      const cutoff = new Date(
        Date.now() - settings.transcriptRetentionDays * 86_400_000
      );

      const transcriptRows = await prisma.transcript.findMany({
        where: {
          ticket: {
            guildId: settings.guildId,
            status: 'CLOSED',
            closedAt: { lt: cutoff }
          }
        },
        select: { id: true },
        take: 500
      });

      if (transcriptRows.length) {
        const deleted = await prisma.transcript.deleteMany({
          where: { id: { in: transcriptRows.map((row) => row.id) } }
        });
        transcriptsDeleted += deleted.count;
      }
    }

    if (settings.closedTicketRetentionDays !== null) {
      const cutoff = new Date(
        Date.now() - settings.closedTicketRetentionDays * 86_400_000
      );

      for (;;) {
        const expired = await prisma.ticket.findMany({
          where: {
            guildId: settings.guildId,
            status: 'CLOSED',
            closedAt: { lt: cutoff }
          },
          orderBy: { id: 'asc' },
          select: { id: true, channelId: true, ticketNumber: true },
          take: 100
        });

        if (!expired.length) break;

        for (const ticket of expired) {
          if (settings.retentionDeleteDiscordChannel) {
            const guild = client.guilds.cache.get(settings.guildId);
            if (guild) {
              const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
              if (channel) {
                const deleted = await channel.delete(
                  'Dispatch retention ticket #' + ticket.ticketNumber
                ).then(() => true).catch(() => false);
                if (deleted) channelsDeleted += 1;
              }
            }
          }

          await prisma.ticket.delete({ where: { id: ticket.id } });
          ticketsDeleted += 1;
        }

        if (expired.length < 100) break;
      }
    }
  }

  const attemptCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.ticketOpenAttempt.deleteMany({
    where: { createdAt: { lt: attemptCutoff } }
  });

  const now = new Date();
  const expiredGuards = await prisma.ticketUserGuard.findMany({
    where: {
      OR: [
        { pendingUntil: { lt: now } },
        { blockedUntil: { lt: now } }
      ]
    },
    select: {
      id: true,
      pendingUntil: true,
      blockedUntil: true
    },
    take: 1000
  });

  for (const guard of expiredGuards) {
    await prisma.ticketUserGuard.update({
      where: { id: guard.id },
      data: {
        ...(guard.pendingUntil && guard.pendingUntil < now ? { pendingUntil: null } : {}),
        ...(guard.blockedUntil && guard.blockedUntil < now ? { blockedUntil: null } : {})
      }
    });
  }

  return { transcriptsDeleted, ticketsDeleted, channelsDeleted };
}
