import {
  ChannelType,
  EmbedBuilder,
  type Client,
  type NewsChannel,
  type TextChannel
} from 'discord.js';
import pino from 'pino';
import { prisma } from '@dispatch/db';
import {
  TICKET_LOG_EVENT_INFO,
  type BlacklistLogPayload,
  type TicketLogEvent
} from '@dispatch/shared';

/*
 * Per-server ticket log channel. Every caller is a ticket action that must
 * never fail because of the log: logTicketEvent never throws, sends compact
 * embeds only with system data (ids, numbers, names configured by admins) and
 * never any encrypted content (close reason, form answers, notes, feedback
 * comment). Settings are cached briefly; the dashboard test RPC refreshes them.
 */

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const CACHE_TTL_MS = 30_000;
const NO_MENTIONS = { parse: [] as never[] };
const STABLE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

const COLORS: Record<TicketLogEvent, number> = {
  TICKET_OPEN: 0x4ade80,
  TICKET_REOPEN: 0x4ade80,
  TICKET_CLAIM: 0x38bdf8,
  TICKET_UPDATE: 0x38bdf8,
  TICKET_MEMBERS: 0x38bdf8,
  TICKET_CLOSE: 0xf2555a,
  TICKET_DELETE: 0xf2555a,
  TICKET_TRANSCRIPT: 0x818cf8,
  TICKET_FEEDBACK: 0x818cf8,
  TICKET_AUTOMATION: 0xf5a524,
  FORM_SUBMISSION: 0x5eead4,
  BLACKLIST: 0x9f1239
};

type LogSettings = { channelId: string | null; events: ReadonlySet<string> };
const cache = new Map<string, { settings: LogSettings; expiresAt: number }>();

export function invalidateTicketLogSettings(guildId?: string) {
  if (guildId) cache.delete(guildId);
  else cache.clear();
}

async function loadSettings(guildId: string): Promise<LogSettings> {
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.settings;
  const row = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { ticketLogChannelId: true, ticketLogEvents: true }
  });
  const settings: LogSettings = {
    channelId: row?.ticketLogChannelId ?? null,
    events: new Set(row?.ticketLogEvents ?? [])
  };
  cache.set(guildId, { settings, expiresAt: Date.now() + CACHE_TTL_MS });
  return settings;
}

function errorCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'number' || (typeof code === 'string' && STABLE_CODE.test(code))) return code;
  const message = error instanceof Error ? error.message : '';
  return STABLE_CODE.test(message) ? message : 'UNKNOWN';
}

// Only a text or announcement channel of this very guild is a valid target.
async function resolveLogChannel(client: Client, guildId: string, channelId: string) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('GUILD_NOT_FOUND');
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (
    !channel ||
    channel.id !== channelId ||
    channel.guildId !== guildId ||
    (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
  ) {
    throw new Error('TICKET_LOG_CHANNEL_INVALID');
  }
  return channel as TextChannel | NewsChannel;
}

export type TicketLogField = { name: string; value: string; inline?: boolean };

export type TicketLogData = {
  /** Specific action, e.g. "Ticket preso in carico". Defaults to the event label. */
  title?: string;
  ticket?: { id: string; ticketNumber: number; channelId?: string | null } | null;
  /** Discord user that performed the action; null/undefined = system. */
  actorId?: string | null;
  categoryName?: string | null;
  fields?: TicketLogField[];
};

const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max - 1) + '…' : value);
export const userMention = (userId: string) => `<@${userId}> (${userId})`;

export function buildTicketLogEmbed(event: TicketLogEvent, data: TicketLogData = {}) {
  const info = TICKET_LOG_EVENT_INFO.find((entry) => entry.key === event);
  const fields: TicketLogField[] = [];
  if (data.ticket) {
    const number = '#' + String(data.ticket.ticketNumber).padStart(4, '0');
    fields.push({
      name: 'Ticket',
      value: data.ticket.channelId ? `${number} · <#${data.ticket.channelId}>` : number,
      inline: true
    });
  }
  fields.push({ name: 'Autore', value: data.actorId ? userMention(data.actorId) : 'Sistema', inline: true });
  if (data.categoryName) fields.push({ name: 'Categoria', value: data.categoryName, inline: true });
  fields.push(...(data.fields ?? []));

  const embed = new EmbedBuilder()
    .setTitle(clip(data.title ?? info?.label ?? event, 256))
    .setColor(COLORS[event])
    .addFields(fields.slice(0, 25).map((field) => ({
      name: clip(field.name || '-', 256),
      value: clip(field.value || '-', 1024),
      inline: field.inline ?? false
    })))
    .setTimestamp();
  if (data.ticket) embed.setFooter({ text: 'Dispatch · ' + data.ticket.id });
  else embed.setFooter({ text: 'Dispatch' });
  return embed;
}

/**
 * Posts one event in the guild log channel when the channel is configured and
 * the event enabled. Never throws: failures are logged with an error code only.
 * Resolves true when the embed was sent.
 */
export async function logTicketEvent(
  client: Client,
  guildId: string,
  event: TicketLogEvent,
  data: TicketLogData = {}
): Promise<boolean> {
  try {
    const settings = await loadSettings(guildId);
    if (!settings.channelId || !settings.events.has(event)) return false;
    const channel = await resolveLogChannel(client, guildId, settings.channelId);
    await channel.send({ embeds: [buildTicketLogEmbed(event, data)], allowedMentions: NO_MENTIONS });
    return true;
  } catch (error) {
    try {
      log.warn({ guildId, event, code: errorCode(error) }, 'Ticket log delivery failed');
    } catch {
      // Logging must not break the ticket action either.
    }
    return false;
  }
}

/** Dashboard "Invia messaggio di prova": stable error codes, fresh settings. */
export async function sendTicketLogTest(client: Client, guildId: string, actorId: string) {
  invalidateTicketLogSettings(guildId);
  const settings = await loadSettings(guildId);
  if (!settings.channelId) throw new Error('TICKET_LOG_CHANNEL_REQUIRED');
  const channel = await resolveLogChannel(client, guildId, settings.channelId);
  const enabled = TICKET_LOG_EVENT_INFO.filter((entry) => settings.events.has(entry.key)).map((entry) => entry.label);
  const embed = buildTicketLogEmbed('TICKET_UPDATE', {
    title: 'Messaggio di prova',
    actorId,
    fields: [{ name: 'Eventi attivi', value: enabled.length ? enabled.join(', ') : 'Nessun evento selezionato' }]
  }).setColor(0x38bdf8);
  try {
    await channel.send({ embeds: [embed], allowedMentions: NO_MENTIONS });
  } catch {
    throw new Error('TICKET_LOG_SEND_FAILED');
  }
  return { ok: true, channelId: channel.id };
}

/** BLACKLIST happens in the API: it forwards only a validated, structured payload. */
export function logBlacklistEvent(client: Client, guildId: string, payload: BlacklistLogPayload) {
  const fields: TicketLogField[] = [{ name: 'Utente', value: userMention(payload.targetUserId), inline: true }];
  if (payload.action === 'add') {
    const expires = payload.expiresAt ? Math.floor(new Date(payload.expiresAt).getTime() / 1000) : null;
    fields.push({ name: 'Scadenza', value: expires ? `<t:${expires}:f>` : 'Permanente', inline: true });
  }
  return logTicketEvent(client, guildId, 'BLACKLIST', {
    title: payload.action === 'add' ? 'Utente aggiunto alla blacklist' : 'Utente rimosso dalla blacklist',
    actorId: payload.actorId,
    fields
  });
}
