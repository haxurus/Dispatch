import {
  ChannelType,
  EmbedBuilder,
  type Client,
  type NewsChannel,
  type TextChannel
} from 'discord.js';
import pino from 'pino';
import { loadLeaderboardActivity, prisma } from '@dispatch/db';
import {
  LEADERBOARD_LIMITS,
  dueLeaderboardPeriods,
  formatLeaderboardMinutes,
  leaderboardPeriod,
  leaderboardTitle,
  rankLeaderboard,
  type LeaderboardEntry,
  type LeaderboardPeriod,
  type LeaderboardPeriodKind
} from '@dispatch/shared';

/*
 * Moderator leaderboard: scheduled weekly/monthly posts and the dashboard
 * "Invia ora". Periods and ranking are pure functions in @dispatch/shared.
 * Users are mentioned without pinging (allowedMentions parse []). The period
 * key is claimed with a conditional update BEFORE posting, so restarts or two
 * bot processes never post the same period twice; a failed post releases it.
 */

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const NO_MENTIONS = { parse: [] as never[] };
const STABLE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const MEDALS = ['🥇', '🥈', '🥉'] as const;

const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max - 1) + '…' : value);

export function leaderboardLine(entry: LeaderboardEntry) {
  const position = entry.rank <= 3 ? MEDALS[entry.rank - 1] : `**${entry.rank}.**`;
  const rating = entry.averageRating === null
    ? `⭐ — (${entry.feedbackCount})`
    : `⭐ ${entry.averageRating.toFixed(2)} (${entry.feedbackCount})`;
  return `${position} <@${entry.userId}> · ${entry.handled} ticket · ${rating} · ` +
    `1ª risposta ${formatLeaderboardMinutes(entry.medianFirstResponseMinutes)}`;
}

/** Empty period: nobody was credited with a closed ticket. */
export function leaderboardIsEmpty(entries: readonly LeaderboardEntry[]) {
  return !entries.some((entry) => entry.handled > 0);
}

export function buildLeaderboardEmbed(period: LeaderboardPeriod, entries: readonly LeaderboardEntry[], minRatings: number) {
  const embed = new EmbedBuilder()
    .setTitle(clip(leaderboardTitle(period), 256))
    .setColor(0xf5a524)
    .setFooter({ text: 'Dispatch · ' + period.key })
    .setTimestamp();
  if (leaderboardIsEmpty(entries)) return embed.setDescription('Nessun ticket gestito in questo periodo.');
  const legend = `Ordine: ticket gestiti, poi valutazione media (conteggiata con almeno ${minRatings} ` +
    `${minRatings === 1 ? 'valutazione' : 'valutazioni'}, altrimenti “—”), poi numero di valutazioni. ` +
    '1ª risposta = mediana dei ticket in cui il moderatore ha risposto per primo.';
  return embed.setDescription(clip(entries.map(leaderboardLine).join('\n') + '\n\n' + legend, 4096));
}

// Same rule as the ticket log: a text or announcement channel of this guild.
async function resolveLeaderboardChannel(client: Client, guildId: string, channelId: string | null) {
  if (!channelId) throw new Error('LEADERBOARD_CHANNEL_REQUIRED');
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('GUILD_NOT_FOUND');
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (
    !channel ||
    channel.id !== channelId ||
    channel.guildId !== guildId ||
    (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
  ) {
    throw new Error('LEADERBOARD_CHANNEL_INVALID');
  }
  return channel as TextChannel | NewsChannel;
}

async function postLeaderboard(
  client: Client,
  guildId: string,
  channelId: string | null,
  period: LeaderboardPeriod,
  entries: readonly LeaderboardEntry[],
  minRatings: number
) {
  const channel = await resolveLeaderboardChannel(client, guildId, channelId);
  try {
    await channel.send({ embeds: [buildLeaderboardEmbed(period, entries, minRatings)], allowedMentions: NO_MENTIONS });
  } catch {
    throw new Error('LEADERBOARD_SEND_FAILED');
  }
  return channel.id;
}

type KeyField = 'leaderboardLastWeekly' | 'leaderboardLastMonthly';
const keyField = (kind: LeaderboardPeriodKind): KeyField => (kind === 'week' ? 'leaderboardLastWeekly' : 'leaderboardLastMonthly');

/**
 * Marks a period as posted only if the stored key is still `previousKey`:
 * of two concurrent workers (or a retry after a restart) only one wins.
 */
export async function claimLeaderboardPeriod(
  guildId: string,
  kind: LeaderboardPeriodKind,
  previousKey: string | null,
  key: string
) {
  const field = keyField(kind);
  const result = await prisma.guildSettings.updateMany({
    where: field === 'leaderboardLastWeekly'
      ? { guildId, leaderboardLastWeekly: previousKey }
      : { guildId, leaderboardLastMonthly: previousKey },
    data: field === 'leaderboardLastWeekly' ? { leaderboardLastWeekly: key } : { leaderboardLastMonthly: key }
  });
  return result.count === 1;
}

/** Undo a claim after a failed post (only if nobody changed it since). */
export async function releaseLeaderboardPeriod(
  guildId: string,
  kind: LeaderboardPeriodKind,
  key: string,
  previousKey: string | null
) {
  const field = keyField(kind);
  await prisma.guildSettings.updateMany({
    where: field === 'leaderboardLastWeekly'
      ? { guildId, leaderboardLastWeekly: key }
      : { guildId, leaderboardLastMonthly: key },
    data: field === 'leaderboardLastWeekly' ? { leaderboardLastWeekly: previousKey } : { leaderboardLastMonthly: previousKey }
  });
}

const settingsSelect = {
  guildId: true,
  timezone: true,
  leaderboardChannelId: true,
  leaderboardWeekly: true,
  leaderboardMonthly: true,
  leaderboardSize: true,
  leaderboardMinRatings: true,
  leaderboardWeekday: true,
  leaderboardHour: true,
  leaderboardLastWeekly: true,
  leaderboardLastMonthly: true
} as const;

type ScheduleRow = {
  guildId: string;
  timezone: string;
  leaderboardChannelId: string | null;
  leaderboardWeekly: boolean;
  leaderboardMonthly: boolean;
  leaderboardSize: number;
  leaderboardMinRatings: number;
  leaderboardWeekday: number;
  leaderboardHour: number;
  leaderboardLastWeekly: string | null;
  leaderboardLastMonthly: string | null;
};

async function rankPeriod(guildId: string, period: LeaderboardPeriod, settings: { leaderboardSize: number; leaderboardMinRatings: number }) {
  const activity = await loadLeaderboardActivity(prisma, guildId, period.start, period.end);
  return rankLeaderboard(activity, { minRatings: settings.leaderboardMinRatings, size: settings.leaderboardSize });
}

async function runGuildLeaderboards(client: Client, settings: ScheduleRow, now: Date) {
  const due = dueLeaderboardPeriods({
    timezone: settings.timezone,
    weekly: settings.leaderboardWeekly,
    monthly: settings.leaderboardMonthly,
    weekday: settings.leaderboardWeekday,
    hour: settings.leaderboardHour,
    lastWeekly: settings.leaderboardLastWeekly,
    lastMonthly: settings.leaderboardLastMonthly
  }, now);

  let posted = 0;
  for (const period of due) {
    const previousKey = period.kind === 'week' ? settings.leaderboardLastWeekly : settings.leaderboardLastMonthly;
    if (!(await claimLeaderboardPeriod(settings.guildId, period.kind, previousKey, period.key))) continue;
    try {
      const entries = await rankPeriod(settings.guildId, period, settings);
      await postLeaderboard(client, settings.guildId, settings.leaderboardChannelId, period, entries, settings.leaderboardMinRatings);
      posted += 1;
    } catch (error) {
      await releaseLeaderboardPeriod(settings.guildId, period.kind, period.key, previousKey).catch(() => null);
      throw error;
    }
  }
  return posted;
}

const errorCode = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'number' || (typeof code === 'string' && STABLE_CODE.test(code))) return code;
  const message = error instanceof Error ? error.message : '';
  return STABLE_CODE.test(message) ? message : 'UNKNOWN';
};

/**
 * Scheduler cycle (bot start + every 15 minutes). Each guild is isolated: an
 * error is logged with its code and never stops the other guilds.
 */
export async function runLeaderboardCycle(client: Client, now = new Date()) {
  const rows = await prisma.guildSettings.findMany({
    where: {
      leaderboardChannelId: { not: null },
      OR: [{ leaderboardWeekly: true }, { leaderboardMonthly: true }]
    },
    select: settingsSelect
  });
  let posted = 0;
  let failed = 0;
  for (const settings of rows) {
    if (!client.guilds.cache.has(settings.guildId)) continue;
    try {
      posted += await runGuildLeaderboards(client, settings, now);
    } catch (error) {
      failed += 1;
      log.warn({ guildId: settings.guildId, code: errorCode(error) }, 'Leaderboard post failed');
    }
  }
  return { posted, failed };
}

/** Dashboard "Invia ora": posts the requested period, never touches the keys. */
export async function sendLeaderboardNow(
  client: Client,
  guildId: string,
  kind: LeaderboardPeriodKind,
  offset: number,
  now = new Date()
) {
  if (!Number.isInteger(offset) || offset < 0 || offset > LEADERBOARD_LIMITS.maxOffset) throw new Error('INVALID_OFFSET');
  const settings = await prisma.guildSettings.findUnique({ where: { guildId }, select: settingsSelect });
  if (!settings) throw new Error('GUILD_NOT_FOUND');
  const period = leaderboardPeriod(kind, now, settings.timezone, offset);
  const entries = await rankPeriod(guildId, period, settings);
  const channelId = await postLeaderboard(client, guildId, settings.leaderboardChannelId, period, entries, settings.leaderboardMinRatings);
  return { ok: true, channelId, period: period.key, entries: entries.length };
}
