import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type GuildMember,
  type Message,
  type TextChannel
} from 'discord.js';
import { prisma, type Prisma } from '@dispatch/db';
import { encryptText } from './security.js';
import { assertTranscriptRetention, lockTicket } from './retention.js';
import { reserveTicketOpen, consumeTicketOpenReservation, commitTicketOpen,
  releaseTicketOpenReservation, formVersion } from './open-guard.js';
import { logTicketEvent, userMention } from './ticket-log.js';

const OPEN_STATUSES = ['OPEN', 'WAITING', 'IN_PROGRESS', 'RESOLVED'];

// Staff actions are only valid on active tickets: REOPENING is owned by the
// reopen flow until it completes, CLOSED by close/feedback/reopen.
function assertTicketActive(status: string) {
  if (status === 'CLOSED') throw new Error('TICKET_CLOSED');
  if (!OPEN_STATUSES.includes(status)) throw new Error('TICKET_REOPENING');
}

// Threads escape the close lock, transcripts and activity tracking.
const THREAD_DENY = {
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
  SendMessagesInThreads: false
} as const;

const PARTICIPANT_PERMISSIONS = {
  ViewChannel: true,
  SendMessages: true,
  ReadMessageHistory: true,
  AttachFiles: true,
  EmbedLinks: true,
  ...THREAD_DENY
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

// Closure message: optional feedback row, then Riapri (staff always, opener
// within the reopen window) and Elimina canale (staff, with confirmation).
function closureComponents(ticketId: string, feedbackEnabled: boolean) {
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

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('dispatch:reopen:' + ticketId)
        .setLabel('Riapri ticket')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('dispatch:delete-channel:' + ticketId)
        .setLabel('Elimina canale')
        .setStyle(ButtonStyle.Danger)
    )
  );

  return rows;
}

const discordErrorCode = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' || typeof code === 'string' ? code : 'UNKNOWN';
};

const unknownChannel = (error: unknown) => (error as { code?: unknown } | null)?.code === 10003;

type TicketWithRelations = Awaited<ReturnType<typeof getTicket>>;

// Closed category: the form override (form-created tickets) wins over the
// ticket category setting. null = closed tickets stay where they are.
async function resolveClosedParent(ticket: {
  guildId: string;
  sourceFormId: string | null;
  category: { closedParentCategoryId: string | null };
}) {
  if (ticket.sourceFormId) {
    const form = await prisma.formDefinition.findFirst({
      where: { id: ticket.sourceFormId, guildId: ticket.guildId },
      select: { ticketClosedParentCategoryId: true }
    }).catch(() => null);
    if (form?.ticketClosedParentCategoryId) return form.ticketClosedParentCategoryId;
  }
  return ticket.category.closedParentCategoryId ?? null;
}

// Best effort: a Discord failure (category full, missing permission, unknown
// category) leaves the channel where it is and never blocks the close.
async function moveToClosedCategory(ticket: TicketWithRelations, channel: TextChannel, actorId: string) {
  const target = await resolveClosedParent(ticket);
  if (!target || channel.parentId === target) return null;
  try {
    const saved = await prisma.ticket.updateMany({
      where: { id: ticket.id, guildId: ticket.guildId, status: 'CLOSED' },
      data: { openParentId: channel.parentId ?? null }
    });
    if (saved.count !== 1) return null;
    // lockPermissions false: the channel keeps its own overwrites (@everyone
    // and thread denies, opener, members, staff) instead of the category's.
    await channel.setParent(target, { lockPermissions: false });
    return target;
  } catch (error) {
    await audit(ticket.id, ticket.guildId, actorId, 'ticket.close.move_failed', {
      targetParentId: target,
      code: discordErrorCode(error)
    }).catch(() => null);
    return null;
  }
}

// Reopen: back to the parent saved at close, or to the category's Discord
// category when the channel sits in the closed category. Never fatal.
async function restoreOpenCategory(ticket: TicketWithRelations, channel: TextChannel, actorId: string) {
  const closedTarget = await resolveClosedParent(ticket);
  const inClosedCategory = closedTarget !== null && channel.parentId === closedTarget;
  if (!ticket.openParentId && !inClosedCategory) return;
  const restore = ticket.openParentId ?? ticket.category.discordCategoryId ?? null;
  if ((channel.parentId ?? null) === restore) return;
  try {
    await channel.setParent(restore, { lockPermissions: false });
  } catch (error) {
    await audit(ticket.id, ticket.guildId, actorId, 'ticket.reopen.move_failed', {
      targetParentId: restore,
      code: discordErrorCode(error)
    }).catch(() => null);
  }
}

async function audit(ticketId: string, guildId: string, actorId: string, action: string, details: Record<string, unknown> = {}) {
  await prisma.ticketAudit.create({
    data: { ticketId, guildId, actorId, action, details: JSON.parse(JSON.stringify(details)) }
  });
}

export async function unclaimTicket(client: Client, guildId: string, ticketId: string, actorId: string) {
  const ticket = await getTicket(guildId, ticketId);
  assertTicketActive(ticket.status);
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
  await logTicketEvent(client, guildId, 'TICKET_CLAIM', {
    title: 'Ticket rilasciato',
    ticket,
    actorId,
    categoryName: ticket.category.name,
    fields: [{ name: 'Assegnatario precedente', value: userMention(ticket.claimedById), inline: true }]
  });
  return { ok: true, claimedById: null, status: 'OPEN' };
}

export async function assignTicket(client: Client, guildId: string, ticketId: string, actorId: string, assigneeId: string) {
  const ticket = await getTicket(guildId, ticketId);
  assertTicketActive(ticket.status);

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
  await logTicketEvent(client, guildId, 'TICKET_CLAIM', {
    title: 'Ticket assegnato',
    ticket,
    actorId,
    categoryName: ticket.category.name,
    fields: [{ name: 'Assegnatario', value: userMention(assigneeId), inline: true }]
  });

  return { ok: true, claimedById: assigneeId, status: 'IN_PROGRESS' };
}

export async function transferTicketCategory(client: Client, guildId: string, ticketId: string, actorId: string, categoryId: string) {
  const ticket = await getTicket(guildId, ticketId);
  assertTicketActive(ticket.status);

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
  await logTicketEvent(client, guildId, 'TICKET_UPDATE', {
    title: 'Categoria trasferita',
    ticket,
    actorId,
    categoryName: category.name,
    fields: [{ name: 'Categoria precedente', value: ticket.category.name, inline: true }]
  });

  return { ok: true, categoryId: category.id, status: 'OPEN', claimedById: null };
}

export async function addTicketMember(client: Client, guildId: string, ticketId: string, actorId: string, userId: string) {
  const ticket = await getTicket(guildId, ticketId);
  assertTicketActive(ticket.status);

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
  await logTicketEvent(client, guildId, 'TICKET_MEMBERS', {
    title: 'Membro aggiunto',
    ticket,
    actorId,
    categoryName: ticket.category.name,
    fields: [{ name: 'Utente', value: userMention(userId), inline: true }]
  });

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
  await logTicketEvent(client, guildId, 'TICKET_MEMBERS', {
    title: 'Membro rimosso',
    ticket,
    actorId,
    categoryName: ticket.category.name,
    fields: [{ name: 'Utente', value: userMention(userId), inline: true }]
  });

  return { ok: true, userId };
}

type TranscriptBuild = {
  html: string;
  messageCount: number;
  fileName: string;
  ticket: Awaited<ReturnType<typeof getTicket>>;
};

async function buildTranscript(client: Client, guildId: string, ticketId: string): Promise<TranscriptBuild> {
  const ticket = await getTicket(guildId, ticketId);
  if (ticket.channelDeletedAt) throw new Error('TICKET_CHANNEL_DELETED');
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

  return {
    html,
    messageCount: messages.length,
    fileName: `dispatch-ticket-${ticket.ticketNumber}.html`,
    ticket
  };
}

// Building a transcript is slow (Discord pagination). A reopen that commits in
// the meantime deletes stored transcripts, so the write happens under the same
// ticket lock reopen uses and only if the lifecycle state is still the one the
// transcript was built for. Returns false when the snapshot is stale.
async function persistTranscript(build: TranscriptBuild) {
  const contentEncrypted = encryptText(build.html)!;
  return prisma.$transaction(async (tx) => {
    await lockTicket(tx, build.ticket.id);
    const current = await tx.ticket.findUnique({
      where: { id: build.ticket.id },
      select: { status: true, closedAt: true, retentionPendingAt: true }
    });
    if (!current || current.retentionPendingAt) return false;
    const builtClosed = build.ticket.status === 'CLOSED';
    const unchanged = builtClosed
      ? current.status === 'CLOSED' && current.closedAt?.getTime() === build.ticket.closedAt?.getTime()
      : current.status !== 'CLOSED' && current.status !== 'REOPENING' && current.closedAt === null;
    if (!unchanged) return false;
    await tx.transcript.upsert({
      where: { ticketId: build.ticket.id },
      update: { contentEncrypted, messageCount: build.messageCount, createdAt: new Date() },
      create: { ticketId: build.ticket.id, contentEncrypted, messageCount: build.messageCount }
    });
    return true;
  });
}

function transcriptAttachment(build: TranscriptBuild) {
  return new AttachmentBuilder(Buffer.from(build.html, 'utf8'), { name: build.fileName });
}

export async function generateTranscript(client: Client, guildId: string, ticketId: string, actorId?: string) {
  const build = await buildTranscript(client, guildId, ticketId);
  if (!(await persistTranscript(build))) throw new Error('TRANSCRIPT_STATE_CHANGED');

  if (actorId) {
    await audit(build.ticket.id, guildId, actorId, 'ticket.transcript.generate', {
      messageCount: build.messageCount,
      temporary: !build.ticket.category.transcriptRetain
    });
    await logTicketEvent(client, guildId, 'TICKET_TRANSCRIPT', {
      title: 'Transcript generato',
      ticket: build.ticket,
      actorId,
      categoryName: build.ticket.category.name,
      fields: [{ name: 'Messaggi', value: String(build.messageCount), inline: true }]
    });
  }

  return { ok: true, messageCount: build.messageCount };
}

async function generateAndDeliverAutomaticTranscript(client: Client, guildId: string, ticketId: string) {
  const build = await buildTranscript(client, guildId, ticketId);
  const category = build.ticket.category;

  if (!category.transcriptAutoGenerate) return { ok: true, skipped: true };

  let openerDelivered = false;
  let channelDelivered = false;
  let openerFailed = false;
  let channelFailed = false;

  if (category.transcriptRetain) {
    // Reopened (or retention-claimed) while building: the snapshot no longer
    // describes a closed ticket, so it is neither stored nor delivered.
    if (!(await persistTranscript(build))) return { ok: true, skipped: true };
  } else {
    const current = await prisma.ticket.findUnique({
      where: { id: build.ticket.id }, select: { status: true, closedAt: true }
    });
    if (current?.status !== 'CLOSED' || current.closedAt?.getTime() !== build.ticket.closedAt?.getTime()) {
      return { ok: true, skipped: true };
    }
  }

  if (category.transcriptSendToOpener) {
    try {
      const user = await client.users.fetch(build.ticket.openerId);
      await user.send({
        content: `Transcript del ticket #${build.ticket.ticketNumber}.`,
        files: [transcriptAttachment(build)]
      });
      openerDelivered = true;
    } catch {
      openerFailed = true;
    }
  }

  if (category.transcriptChannelId) {
    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) throw new Error('GUILD_NOT_FOUND');
      const channel = await guild.channels.fetch(category.transcriptChannelId);
      if (!channel?.isTextBased() || !('send' in channel)) throw new Error('TRANSCRIPT_CHANNEL_INVALID');
      await channel.send({
        content: `Transcript ticket #${build.ticket.ticketNumber} · <@${build.ticket.openerId}>`,
        files: [transcriptAttachment(build)],
        allowedMentions: { parse: [], users: [] }
      });
      channelDelivered = true;
    } catch {
      channelFailed = true;
    }
  }

  await prisma.ticketAudit.create({
    data: {
      ticketId: build.ticket.id,
      guildId,
      actorId: null,
      action: 'ticket.transcript.auto',
      details: {
        messageCount: build.messageCount,
        storedTemporary: category.transcriptRetain,
        openerDelivered,
        channelDelivered,
        openerFailed,
        channelFailed
      }
    }
  });

  const yesNo = (value: boolean) => (value ? 'Sì' : 'No');
  await logTicketEvent(client, guildId, 'TICKET_TRANSCRIPT', {
    title: 'Transcript automatico',
    ticket: build.ticket,
    categoryName: category.name,
    fields: [
      { name: 'Messaggi', value: String(build.messageCount), inline: true },
      ...(category.transcriptSendToOpener ? [{ name: 'DM all’utente', value: yesNo(openerDelivered), inline: true }] : []),
      ...(category.transcriptChannelId ? [{ name: 'Canale archivio', value: yesNo(channelDelivered), inline: true }] : []),
      { name: 'Copia conservata', value: yesNo(category.transcriptRetain), inline: true }
    ]
  });

  return {
    ok: true,
    skipped: false,
    messageCount: build.messageCount,
    openerDelivered,
    channelDelivered
  };
}

export async function closeTicket(
  client: Client,
  guildId: string,
  ticketId: string,
  actorId: string,
  reason: string | null
) {
  const ticket = await getTicket(guildId, ticketId);
  assertTicketActive(ticket.status);

  const { channel } = await getGuildChannel(client, guildId, ticket.channelId);
  const trimmedReason = reason?.trim().slice(0, 1000) || null;

  // Conditional write: a concurrent close (opener, staff, auto-close) loses
  // instead of duplicating audit/messages and moving the retention clock.
  await prisma.$transaction(async (tx) => {
    const changed = await tx.ticket.updateMany({
      where: { id: ticket.id, status: { in: OPEN_STATUSES } },
      data: {
        status: 'CLOSED',
        closeReason: encryptText(trimmedReason),
        closedAt: new Date()
      }
    });
    if (changed.count !== 1) throw new Error('TICKET_CLOSED');
    await tx.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId,
        actorId,
        action: 'ticket.close',
        details: { reasonProvided: Boolean(trimmedReason) }
      }
    });
  });

  for (const member of ticket.members) {
    await channel.permissionOverwrites.edit(member.userId, { SendMessages: false, ...THREAD_DENY }).catch(() => null);
  }

  const movedTo = await moveToClosedCategory(ticket, channel, actorId);

  await channel.setName(`closed-${String(ticket.ticketNumber).padStart(4, '0')}`).catch(() => null);
  await channel.send({
    content: trimmedReason
      ? `Ticket chiuso da <@${actorId}>. Motivo: ${trimmedReason}`
      : `Ticket chiuso da <@${actorId}>.`,
    allowedMentions: { users: [actorId] }
  }).catch(() => null);

  await channel.send({
    content: [
      ticket.category.feedbackEnabled ? 'Puoi valutare l’assistenza ricevuta.' : null,
      ticket.category.reopenWindowHours
        ? `Puoi riaprire il ticket entro ${ticket.category.reopenWindowHours} ore dalla chiusura.`
        : null,
      'Lo staff può riaprire il ticket o eliminare il canale.'
    ].filter(Boolean).join(' '),
    components: closureComponents(ticket.id, ticket.category.feedbackEnabled),
    allowedMentions: { parse: [] }
  }).catch(() => null);

  if (ticket.category.feedbackEnabled) {
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { feedbackRequestedAt: new Date() }
    });
  }

  // Never the close reason: it is encrypted at rest and stays in the ticket.
  await logTicketEvent(client, guildId, 'TICKET_CLOSE', {
    title: 'Ticket chiuso',
    ticket,
    actorId,
    categoryName: ticket.category.name,
    fields: [
      { name: 'Motivo indicato', value: trimmedReason ? 'Sì' : 'No', inline: true },
      ...(movedTo ? [{ name: 'Spostato in', value: `<#${movedTo}>`, inline: true }] : [])
    ]
  });

  if (ticket.category.transcriptAutoGenerate) {
    await generateAndDeliverAutomaticTranscript(client, guildId, ticket.id).catch(async () => {
      await prisma.ticketAudit.create({
        data: {
          ticketId: ticket.id,
          guildId,
          actorId: null,
          action: 'ticket.transcript.auto.failed',
          details: {}
        }
      }).catch(() => null);
    });
  }

  return { ok: true, status: 'CLOSED' };
}

export async function reopenTicket(
  client: Client, guildId: string, ticketId: string, actorId: string, enforceUserWindow = false
) {
  const ticket = await getTicket(guildId, ticketId);
  if (enforceUserWindow && actorId !== ticket.openerId) throw new Error('REOPEN_NOT_OPENER');
  if (ticket.status !== 'CLOSED' && ticket.status !== 'REOPENING') throw new Error('TICKET_NOT_CLOSED');
  // The staff deleted the channel: there is nothing left to reopen.
  if (ticket.channelDeletedAt) throw new Error('TICKET_CHANNEL_DELETED');
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
        if (current.channelDeletedAt) throw new Error('TICKET_CHANNEL_DELETED');
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
  await restoreOpenCategory(ticket, channel, actorId);
  await prisma.$transaction(async (tx) => {
    await lockTicket(tx, ticket.id);
    const changed = await tx.ticket.updateMany({ where: {
      id: ticket.id, status: 'REOPENING', retentionPendingAt: null, channelDeletedAt: null
    }, data: {
      status: 'OPEN', closeReason: null, closedAt: null, claimedById: null, openParentId: null,
      lastActivityAt: new Date(), escalatedAt: null, feedbackRequestedAt: null, inactivityWarnedAt: null
    } });
    if (changed.count !== 1) throw new Error('REOPEN_STATE_CONFLICT');
    await tx.ticketFeedback.deleteMany({ where: { ticketId: ticket.id } });
    await tx.transcript.deleteMany({ where: { ticketId: ticket.id } });
    await tx.ticketAudit.create({ data: {
      ticketId: ticket.id, guildId, actorId, action: 'ticket.reopen',
      details: { userWindowEnforced: enforceUserWindow }
    } });
  });
  await channel.setName('ticket-' + String(ticket.ticketNumber).padStart(4, '0')).catch(() => null);
  await channel.send({ content: 'Ticket riaperto.', allowedMentions: { parse: [] } }).catch(() => null);
  await logTicketEvent(client, guildId, 'TICKET_REOPEN', {
    title: 'Ticket riaperto',
    ticket,
    actorId,
    categoryName: ticket.category.name,
    fields: [{ name: 'Da parte dell’utente', value: enforceUserWindow ? 'Sì' : 'No', inline: true }]
  });
  return { ok: true, status: 'OPEN', claimedById: null };
}

// Before the staff deletes the channel of a closed ticket, the transcript is
// secured according to the category settings: the automatic delivery is
// completed (and must reach the archive channel when one is configured) and a
// retained copy is stored when the category keeps one. Retention-expired
// transcripts are intentionally gone and do not block the deletion.
async function secureTranscriptBeforeDeletion(client: Client, guildId: string, ticket: TicketWithRelations) {
  const category = ticket.category;
  try {
    if (category.transcriptAutoGenerate) {
      const needsArchive = Boolean(category.transcriptChannelId);
      const last = await prisma.ticketAudit.findFirst({
        where: {
          ticketId: ticket.id,
          action: 'ticket.transcript.auto',
          ...(ticket.closedAt ? { createdAt: { gte: ticket.closedAt } } : {})
        },
        orderBy: { createdAt: 'desc' },
        select: { details: true }
      });
      const details = last?.details as { channelDelivered?: unknown } | null | undefined;
      if (!last || (needsArchive && details?.channelDelivered !== true)) {
        const result = await generateAndDeliverAutomaticTranscript(client, guildId, ticket.id);
        if (result.skipped) throw new Error('TRANSCRIPT_STATE_CHANGED');
        const archived = 'channelDelivered' in result ? result.channelDelivered : false;
        if (needsArchive && !archived) throw new Error('TRANSCRIPT_ARCHIVE_FAILED');
      }
    }
    if (category.transcriptRetain) {
      const stored = await prisma.transcript.findUnique({ where: { ticketId: ticket.id }, select: { id: true } });
      if (!stored) {
        const build = await buildTranscript(client, guildId, ticket.id);
        if (!(await persistTranscript(build))) throw new Error('TRANSCRIPT_STATE_CHANGED');
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'TRANSCRIPT_RETENTION_EXPIRED') return;
    throw new Error('TICKET_TRANSCRIPT_FAILED');
  }
}

/**
 * Deletes the Discord channel of a CLOSED ticket (staff button or dashboard).
 * The ticket row stays for history and analytics until retention; reopening
 * is refused afterwards (TICKET_CHANNEL_DELETED).
 */
export async function deleteTicketChannel(client: Client, guildId: string, ticketId: string, actorId: string) {
  const ticket = await getTicket(guildId, ticketId);
  if (ticket.channelDeletedAt) throw new Error('TICKET_CHANNEL_DELETED');
  if (ticket.status !== 'CLOSED') throw new Error('TICKET_NOT_CLOSED');

  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('GUILD_NOT_FOUND');
  let channel: TextChannel | null = null;
  try {
    const fetched = await guild.channels.fetch(ticket.channelId);
    if (fetched) {
      // Same identity check as retention: never delete a repurposed channel.
      if (
        fetched.id !== ticket.channelId ||
        fetched.guildId !== guildId ||
        fetched.type !== ChannelType.GuildText ||
        !(fetched as TextChannel).topic?.startsWith('Dispatch ticket #' + ticket.ticketNumber + ' - ')
      ) {
        throw new Error('TICKET_CHANNEL_MISMATCH');
      }
      channel = fetched as TextChannel;
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'TICKET_CHANNEL_MISMATCH') throw error;
    // Unknown Channel: already gone, only the database state is updated.
    if (!unknownChannel(error)) throw new Error('TICKET_CHANNEL_UNAVAILABLE');
  }

  if (channel) await secureTranscriptBeforeDeletion(client, guildId, ticket);

  const deletedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await lockTicket(tx, ticket.id);
    const changed = await tx.ticket.updateMany({
      where: { id: ticket.id, guildId, status: 'CLOSED', retentionPendingAt: null, channelDeletedAt: null },
      data: { channelDeletedAt: deletedAt }
    });
    if (changed.count !== 1) throw new Error('TICKET_STATE_CONFLICT');
    await tx.ticketAudit.create({
      data: {
        ticketId: ticket.id,
        guildId,
        actorId,
        action: 'ticket.channel.delete',
        details: { channelId: ticket.channelId, alreadyMissing: !channel }
      }
    });
  });

  if (channel) {
    try {
      await channel.delete('Dispatch: canale del ticket #' + ticket.ticketNumber + ' eliminato dallo staff');
    } catch (error) {
      if (!unknownChannel(error)) {
        // The channel still exists: undo the marker so the ticket stays usable.
        await prisma.$transaction(async (tx) => {
          await lockTicket(tx, ticket.id);
          await tx.ticket.updateMany({
            where: { id: ticket.id, guildId, channelDeletedAt: deletedAt },
            data: { channelDeletedAt: null }
          });
          await tx.ticketAudit.create({
            data: {
              ticketId: ticket.id,
              guildId,
              actorId,
              action: 'ticket.channel.delete_failed',
              details: { code: discordErrorCode(error) }
            }
          });
        }).catch(() => null);
        throw new Error('TICKET_CHANNEL_DELETE_FAILED');
      }
    }
  }

  await logTicketEvent(client, guildId, 'TICKET_DELETE', {
    title: 'Canale eliminato dallo staff',
    ticket,
    actorId,
    categoryName: ticket.category.name,
    fields: [{ name: 'Canale', value: ticket.channelId, inline: true }]
  });

  return { ok: true, channelDeletedAt: deletedAt.toISOString() };
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
  assertTicketActive(ticket.status);

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
  await logTicketEvent(client, guildId, 'TICKET_UPDATE', {
    title: 'Stato modificato',
    ticket,
    actorId,
    categoryName: ticket.category.name,
    fields: [
      { name: 'Prima', value: previousStatus, inline: true },
      { name: 'Dopo', value: status, inline: true }
    ]
  });

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
  assertTicketActive(ticket.status);

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
  await logTicketEvent(client, guildId, 'TICKET_UPDATE', {
    title: 'Priorità modificata',
    ticket,
    actorId,
    categoryName: ticket.category.name,
    fields: [
      { name: 'Prima', value: previousPriority, inline: true },
      { name: 'Dopo', value: priority, inline: true }
    ]
  });

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
  assertTicketActive(ticket.status);

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
      where: { status: { in: OPEN_STATUSES }, ...(cursor ? { id: { gt: cursor } } : {}) },
      include: { category: true },
      orderBy: { id: 'asc' },
      take: 200
    });

    if (!tickets.length) break;

    for (const ticket of tickets) {
      // One failing ticket must not abort the cycle for the remaining ones.
      await automateTicket(client, ticket, now).catch(() => null);
    }

    cursor = tickets[tickets.length - 1]!.id;
    if (tickets.length < 200) break;
  }
}

type AutomationTicket = Prisma.TicketGetPayload<{ include: { category: true } }>;

async function automateTicket(client: Client, ticket: AutomationTicket, now: number) {
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
    await logTicketEvent(client, ticket.guildId, 'TICKET_AUTOMATION', {
      title: 'SLA prima risposta superato',
      ticket,
      categoryName: category.name,
      fields: [{ name: 'Soglia', value: category.slaFirstResponseMinutes + ' min', inline: true }]
    });
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
    await logTicketEvent(client, ticket.guildId, 'TICKET_AUTOMATION', {
      title: 'SLA risoluzione superato',
      ticket,
      categoryName: category.name,
      fields: [{ name: 'Soglia', value: category.slaResolutionMinutes + ' min', inline: true }]
    });
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
    await logTicketEvent(client, ticket.guildId, 'TICKET_AUTOMATION', {
      title: 'Escalation automatica',
      ticket,
      categoryName: category.name,
      fields: [
        { name: 'Dopo', value: category.escalationMinutes + ' min', inline: true },
        { name: 'Ruoli', value: escalationRoles.map((roleId) => '<@&' + roleId + '>').join(' ') || 'Nessuno', inline: true }
      ]
    });
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
      await logTicketEvent(client, ticket.guildId, 'TICKET_AUTOMATION', {
        title: 'Preavviso chiusura per inattività',
        ticket,
        categoryName: category.name,
        fields: [{ name: 'Chiusura tra', value: warningMinutes + ' min', inline: true }]
      });
    }

    if (now >= closeAt) {
      // Re-read: a message may have arrived since this page was loaded.
      const fresh = await prisma.ticket.findUnique({ where: { id: ticket.id }, select: { lastActivityAt: true } });
      if (!fresh || now < fresh.lastActivityAt.getTime() + category.inactivityCloseHours * 3_600_000) return;
      const closed = await closeTicket(
        client,
        ticket.guildId,
        ticket.id,
        client.user?.id ?? ticket.openerId,
        'Chiuso automaticamente per inattivita.'
      ).catch(() => null);
      if (closed) {
        await logTicketEvent(client, ticket.guildId, 'TICKET_AUTOMATION', {
          title: 'Chiusura automatica per inattività',
          ticket,
          categoryName: category.name,
          fields: [{ name: 'Inattività', value: category.inactivityCloseHours + ' ore', inline: true }]
        });
      }
    }
  }
}


