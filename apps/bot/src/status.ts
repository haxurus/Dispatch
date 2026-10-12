import { EmbedBuilder, type Client } from 'discord.js';
import { prisma } from '@dispatch/db';

/*
 * Instance status notices for the owner (super console → status channel):
 * startup, servers added or removed, rejected installations. Owner-facing,
 * so Italian like the super console. Never carries ticket content.
 */

export type StatusLevel = 'info' | 'ok' | 'warn' | 'error';

export type StatusNotice = {
  level: StatusLevel;
  title: string;
  description?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  /** Notices sharing a key are sent at most once per DEDUPE_MS. */
  dedupeKey?: string;
};

export type StatusResult = { ok: true } | { ok: false; error: string };

export type StatusNotifier = {
  /** Sends and reports the outcome (used by the super console test button). */
  deliver: (notice: StatusNotice, options?: { force?: boolean }) => Promise<StatusResult>;
  /** Fire-and-forget: status notices must never break the code path that raises them. */
  notify: (notice: StatusNotice) => void;
  /** Drops the cached target after the super console changes it. */
  invalidate: () => void;
};

const COLORS: Record<StatusLevel, number> = { info: 0x38bdf8, ok: 0x3ccf8e, warn: 0xf5a524, error: 0xf2555a };
const CONFIG_CACHE_MS = 60_000;
const DEDUPE_MS = 10 * 60_000;
// A join/leave storm (raid, mass removal) must not turn into a flood of
// messages and a rate limit that also delays ticket traffic.
const BURST_WINDOW_MS = 10 * 60_000;
const BURST_MAX = 30;

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

// Error texts may quote connection strings or tokens: never post them.
const REDACTIONS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,40}/g, '[token]'],
  [/\b(postgres(?:ql)?|redis|https?):\/\/[^\s'"]+/gi, '$1://[redacted]'],
  [/(Bearer|Bot)\s+[A-Za-z0-9._-]{16,}/g, '$1 [redacted]']
];
export const redactText = (value: string) => REDACTIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);

type Target = { guildId: string; channelId: string } | null;

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
    const key = notice.dedupeKey ?? `${notice.level}:${notice.title}:${notice.description ?? ''}`;
    const last = recent.get(key);
    if (last && now - last < DEDUPE_MS) return true;
    recent.set(key, now);
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

  const deliver: StatusNotifier['deliver'] = async (notice, options = {}) => {
    let config: Target;
    try {
      config = await target();
    } catch {
      return { ok: false, error: 'STATUS_CONFIG_UNAVAILABLE' };
    }
    if (!config) return { ok: false, error: 'STATUS_CHANNEL_NOT_SET' };
    if (!options.force && throttled(notice)) return { ok: false, error: 'THROTTLED' };

    const embed = new EmbedBuilder()
      .setTitle(clip(notice.title, 256))
      .setColor(COLORS[notice.level])
      .setFooter({ text: 'Dispatch · stato del bot' })
      .setTimestamp(new Date());
    if (notice.description) embed.setDescription(clip(redactText(notice.description), 4000));
    const fields = (notice.fields ?? [])
      .filter((field) => field.value)
      .slice(0, 20)
      .map((field) => ({ name: clip(field.name, 256), value: clip(redactText(field.value), 1024), inline: field.inline ?? true }));
    if (fields.length) embed.addFields(fields);

    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return { ok: false, error: 'STATUS_GUILD_UNAVAILABLE' };
    const channel = await guild.channels.fetch(config.channelId).catch(() => null);
    if (!channel || channel.guildId !== guild.id || !channel.isSendable()) return { ok: false, error: 'STATUS_CHANNEL_UNAVAILABLE' };
    try {
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      return { ok: true };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      return { ok: false, error: code === 50013 || code === 50001 ? 'STATUS_MISSING_PERMISSIONS' : 'STATUS_SEND_FAILED' };
    }
  };

  return {
    deliver,
    notify: (notice) => { void deliver(notice).catch(() => null); },
    invalidate: () => { cached = null; }
  };
}

/** Server summary fields shared by the join/leave notices. */
export function guildFields(guild: { id: string; name?: string | null; memberCount?: number | null }, installerId?: string | null) {
  const fields = [{ name: 'Server', value: `${guild.name ?? 'sconosciuto'}\n\`${guild.id}\`` }];
  if (typeof guild.memberCount === 'number') fields.push({ name: 'Membri', value: String(guild.memberCount) });
  if (installerId !== undefined) {
    fields.push({ name: 'Aggiunto da', value: installerId ? `<@${installerId}>\n\`${installerId}\`` : 'sconosciuto' });
  }
  return fields;
}
