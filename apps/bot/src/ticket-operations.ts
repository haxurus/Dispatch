import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type GuildMember,
  type TextChannel
} from 'discord.js';
import { prisma } from '@dispatch/db';
import { encryptText } from './security.js';

const OPEN_STATUSES = ['OPEN', 'WAITING', 'IN_PROGRESS'];

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

async function audit(ticketId: string, guildId: string, actorId: string, action: string, details: Record<string, unknown> = {}) {
  await prisma.ticketAudit.create({
    data: { ticketId, guildId, actorId, action, details }
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

  await generateTranscript(client, guildId, ticket.id).catch(() => null);

  return { ok: true, status: 'CLOSED' };
}

export async function reopenTicket(client: Client, guildId: string, ticketId: string, actorId: string) {
  const ticket = await getTicket(guildId, ticketId);
  if (ticket.status !== 'CLOSED') throw new Error('TICKET_NOT_CLOSED');

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
        claimedById: null
      }
    }),
    prisma.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId,
        actorId,
        action: 'ticket.reopen',
        details: {}
      }
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
