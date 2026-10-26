import { EmbedBuilder, type Client } from 'discord.js';
import { prisma } from '@dispatch/db';
import {
  ALERT_UI,
  alertFieldLabel,
  normalizeAlertLocale,
  renderAlertMessage,
  type AlertCategory,
  type AlertField,
  type AlertMessageKey,
  type AlertParams,
  type AlertSeverity
} from '@dispatch/shared';
import { protectJson, redactText } from './security.js';
import { logger } from './logger.js';

/*
 * Instance notices for the owner: startup, errors, servers added or removed,
 * rejected installations. The bot only records them (InstanceEvent); the API
 * routes them to the status channel, another channel or the daily digest
 * (super console → Monitoring) and posts them through /alerts/deliver, in the
 * language of the destination server. Never carries ticket content.
 */

export { redactText };

export type StatusLevel = 'info' | 'ok' | 'warn' | 'error';

export type StatusNotice = {
  level: StatusLevel;
  /** Decides where the API routes it (super console → Monitoring). */
  category: AlertCategory;
  /** critical: mention and reminders, ignores quiet hours; warning; info. */
  severity: AlertSeverity;
  /** Text key: rendered in the language of the server it is posted to. */
  key: AlertMessageKey;
  params?: AlertParams;
  fields?: AlertField[];
  /** Notices sharing a key are recorded at most once per DEDUPE_MS. */
  dedupeKey?: string;
};

export type StatusResult = { ok: true } | { ok: false; error: string };

export type StatusNotifier = {
  /** Sends straight to the status channel (the super console test button). */
  deliver: (notice: StatusNotice) => Promise<StatusResult>;
  /** Fire-and-forget: records the notice. Must never break the caller. */
  notify: (notice: StatusNotice) => void;
  /** Drops the cached target after the super console changes it. */
  invalidate: () => void;
};

const COLORS: Record<StatusLevel, number> = { info: 0x38bdf8, ok: 0x3ccf8e, warn: 0xf5a524, error: 0xf2555a };
const CONFIG_CACHE_MS = 60_000;
const DEDUPE_MS = 10 * 60_000;
// A crash loop or a join/leave storm must not flood the database; repeats
// that get through are merged by the API before reaching Discord.
const BURST_WINDOW_MS = 10 * 60_000;
const BURST_MAX = 120;

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

type Target = { guildId: string; channelId: string } | null;

/** Posts an embed to a text channel of a server the bot is in. */
export async function sendToChannel(client: Client, guildId: string, channelId: string, embed: EmbedBuilder, mentionUserId: string | null = null) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('STATUS_GUILD_UNAVAILABLE');
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.guildId !== guild.id || !channel.isSendable()) throw new Error('STATUS_CHANNEL_UNAVAILABLE');
  try {
    await channel.send({
      content: mentionUserId ? `<@${mentionUserId}>` : undefined,
      embeds: [embed],
      allowedMentions: mentionUserId ? { users: [mentionUserId] } : { parse: [] }
    });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw new Error(code === 50013 || code === 50001 ? 'STATUS_MISSING_PERMISSIONS' : 'STATUS_SEND_FAILED');
  }
}

export function createStatusNotifier(client: Client): StatusNotifier {
  let cached: { value: Target; expires: number } | null = null;
  const recent = new Map<string, number>();
  let windowStart = 0;
  let windowCount = 0;

  const target = async (): Promise<Target> => {
    if (cached && cached.expires > Date.now()) return cached.value;
    const row = await prisma.statusChannel.findUnique({ where: { id: 1 }, select: { guildId: true, channelId: true } });
    const value = row ? { guildId: row.guildId, channelId: row.channelId } : null;
    cached = { value, expires: Date.now() + CONFIG_CACHE_MS };
    return value;
  };

  const throttled = (notice: StatusNotice) => {
    const now = Date.now();
    if (notice.dedupeKey) {
      const last = recent.get(notice.dedupeKey);
      if (last && now - last < DEDUPE_MS) return true;
      recent.set(notice.dedupeKey, now);
    }
    if (recent.size > 500) {
      for (const [entry, at] of recent) if (now - at >= DEDUPE_MS) recent.delete(entry);
    }
    if (now - windowStart > BURST_WINDOW_MS) {
      windowStart = now;
      windowCount = 0;
    }
    windowCount += 1;
    return windowCount > BURST_MAX;
  };

  /**
   * Every notice goes to the super console's event feed, even when no status
   * channel is set. createMany: the bot may insert but not read back.
   */
  const record = async (notice: StatusNotice) => {
    const params = Object.fromEntries(Object.entries(notice.params ?? {}).map(([key, value]) => [key, typeof value === 'string' ? redactText(value).slice(0, 2000) : value]));
    const fields = (notice.fields ?? []).filter((field) => field.value).slice(0, 20).map((field) => ({ key: field.key, value: redactText(field.value).slice(0, 1024) }));
    await prisma.instanceEvent.createMany({
      data: [{
        source: 'bot',
        level: notice.level,
        category: notice.category,
        severity: notice.severity,
        messageKey: notice.key,
        // Readable in the database; the delivered text is rendered per server.
        title: renderAlertMessage(notice.key, params, 'en').title.slice(0, 256),
        details: protectJson({ params, fields })
      }]
    }).catch((error: unknown) => logger.warn({ error: redactText(String(error)) }, 'Unable to record instance event'));
  };

  const deliver: StatusNotifier['deliver'] = async (notice) => {
    let config: Target;
    try {
      config = await target();
    } catch {
      return { ok: false, error: 'STATUS_CONFIG_UNAVAILABLE' };
    }
    if (!config) return { ok: false, error: 'STATUS_CHANNEL_NOT_SET' };

    const settings = await prisma.guildSettings.findUnique({ where: { guildId: config.guildId }, select: { locale: true } }).catch(() => null);
    const locale = normalizeAlertLocale(settings?.locale);
    const text = renderAlertMessage(notice.key, notice.params ?? {}, locale);
    const embed = new EmbedBuilder()
      .setTitle(clip(text.title, 256))
      .setColor(COLORS[notice.level])
      .setFooter({ text: ALERT_UI[locale].statusFooter })
      .setTimestamp(new Date());
    if (text.description) embed.setDescription(clip(redactText(text.description), 4000));
    const fields = (notice.fields ?? [])
      .filter((field) => field.value)
      .slice(0, 20)
      .map((field) => ({ name: clip(alertFieldLabel(field.key, locale), 256), value: clip(redactText(field.value), 1024), inline: true }));
    if (fields.length) embed.addFields(fields);

    try {
      await sendToChannel(client, config.guildId, config.channelId, embed);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'STATUS_SEND_FAILED' };
    }
  };

  return {
    deliver,
    notify: (notice) => { if (!throttled(notice)) void record(notice).catch(() => null); },
    invalidate: () => { cached = null; }
  };
}

/** Server summary fields shared by the join/leave notices. */
export function guildFields(guild: { id: string; name?: string | null; memberCount?: number | null }, installerId?: string | null): AlertField[] {
  const fields: AlertField[] = [{ key: 'server', value: `${guild.name ?? '—'}\n\`${guild.id}\`` }];
  if (typeof guild.memberCount === 'number') fields.push({ key: 'members', value: String(guild.memberCount) });
  if (installerId) fields.push({ key: 'addedBy', value: `<@${installerId}>\n\`${installerId}\`` });
  return fields;
}
