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
import { assertTranscriptRetention, lockTicket } from './retention.js';
import { reserveTicketOpen, consumeTicketOpenReservation, commitTicketOpen,
  releaseTicketOpenReservation, formVersion } from './open-guard.js';

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
  if (ticket.retentionPendingAt) throw new Error('TICKET_RETENTION_PENDING');
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
  await assertTranscriptRetention(ticket);
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


