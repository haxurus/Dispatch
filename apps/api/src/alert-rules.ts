import { ALERT_CATEGORIES, type AlertCategory, type AlertSeverity } from '@dispatch/shared';

/**
 * Pure alert routing rules: where each category goes, quiet hours, the daily
 * digest, grouping of repeated alerts and incident reminders.
 */

export type RouteMode = 'status' | 'channel' | 'digest' | 'log';
export type AlertRoute = { mode: RouteMode; guildId: string | null; channelId: string | null; mention: boolean };
export type AlertTarget = { guildId: string; channelId: string };
export type AlertSettings = {
  routes: Record<AlertCategory, AlertRoute>;
  quietHours: { enabled: boolean; start: string; end: string };
  digest: { time: string; mode: 'status' | 'channel'; guildId: string | null; channelId: string | null };
  timezone: string;
};

const route = (mode: RouteMode, mention = false): AlertRoute => ({ mode, guildId: null, channelId: null, mention });

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  routes: {
    availability: route('status', true),
    security: route('status', true),
    errors: route('status'),
    billing: route('status'),
    installations: route('digest')
  },
  quietHours: { enabled: false, start: '23:00', end: '08:00' },
  digest: { time: '09:00', mode: 'status', guildId: null, channelId: null },
  timezone: 'Europe/Rome'
};

const SNOWFLAKE = /^\d{17,20}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MODES = new Set<RouteMode>(['status', 'channel', 'digest', 'log']);

export const isTimeZone = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const obj = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const id = (value: unknown) => (typeof value === 'string' && SNOWFLAKE.test(value) ? value : null);
const time = (value: unknown, fallback: string) => (typeof value === 'string' && TIME.test(value) ? value : fallback);

/** Stored settings merged over the defaults; invalid values fall back. */
export function parseAlertSettings(value: unknown): AlertSettings {
  const input = obj(value);
  const routesIn = obj(input.routes);
  const routes = {} as Record<AlertCategory, AlertRoute>;
  for (const category of ALERT_CATEGORIES) {
    const base = DEFAULT_ALERT_SETTINGS.routes[category];
    const raw = obj(routesIn[category]);
    const mode = MODES.has(raw.mode as RouteMode) ? raw.mode as RouteMode : base.mode;
    routes[category] = {
      mode,
      guildId: mode === 'channel' ? id(raw.guildId) : null,
      channelId: mode === 'channel' ? id(raw.channelId) : null,
      mention: typeof raw.mention === 'boolean' ? raw.mention : base.mention
    };
  }
  const quiet = obj(input.quietHours);
  const digest = obj(input.digest);
  const digestMode = digest.mode === 'channel' ? 'channel' : 'status';
  return {
    routes,
    quietHours: {
      enabled: quiet.enabled === true,
      start: time(quiet.start, DEFAULT_ALERT_SETTINGS.quietHours.start),
      end: time(quiet.end, DEFAULT_ALERT_SETTINGS.quietHours.end)
    },
    digest: {
      time: time(digest.time, DEFAULT_ALERT_SETTINGS.digest.time),
      mode: digestMode,
      guildId: digestMode === 'channel' ? id(digest.guildId) : null,
      channelId: digestMode === 'channel' ? id(digest.channelId) : null
    },
    timezone: isTimeZone(input.timezone) ? input.timezone : DEFAULT_ALERT_SETTINGS.timezone
  };
}

function localParts(now: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const minutesOf = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

/** Quiet hours may cross midnight (e.g. 23:00–08:00). */
export function inQuietHours(settings: AlertSettings, now: Date) {
  if (!settings.quietHours.enabled) return false;
  const start = minutesOf(settings.quietHours.start);
  const end = minutesOf(settings.quietHours.end);
  if (start === end) return false;
  const { minutes } = localParts(now, settings.timezone);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** Once per local day, at or after the digest time. */
export function digestDue(settings: AlertSettings, now: Date, lastDigestAt: Date | null) {
  const today = localParts(now, settings.timezone);
  if (today.minutes < minutesOf(settings.digest.time)) return false;
  return !lastDigestAt || localParts(lastDigestAt, settings.timezone).date !== today.date;
}

/** Where a route delivers; null means it cannot be delivered right now. */
export function routeTarget(target: Pick<AlertRoute, 'mode' | 'guildId' | 'channelId'>, statusChannel: AlertTarget | null): AlertTarget | null {
  if (target.mode === 'status') return statusChannel;
  if (target.mode === 'channel' && target.guildId && target.channelId) return { guildId: target.guildId, channelId: target.channelId };
  return null;
}

/** Repeated alerts with the same key are merged and held back for a window. */
export const GROUP_WINDOW_MS = 10 * 60_000;

export function groupForDelivery<T extends { key: string }>(items: T[], lastSent: Map<string, number>, now: number, windowMs = GROUP_WINDOW_MS) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const last = lastSent.get(item.key);
    if (last !== undefined && now - last < windowMs) continue;
    groups.set(item.key, [...(groups.get(item.key) ?? []), item]);
  }
  return [...groups.entries()].map(([key, members]) => ({ key, members }));
}

/** Reminders for an open, unacknowledged incident: after 15 min, 1 h, then every 6 h. */
export function reminderDue(incident: {
  severity: string; openedAt: Date; resolvedAt: Date | null; acknowledgedAt: Date | null; lastRemindedAt: Date | null; reminders: number;
}, now: Date) {
  if (incident.resolvedAt || incident.acknowledgedAt || incident.severity === 'info') return false;
  const sinceOpen = now.getTime() - incident.openedAt.getTime();
  if (incident.reminders === 0) return sinceOpen >= 15 * 60_000;
  if (incident.reminders === 1) return sinceOpen >= 60 * 60_000;
  return !incident.lastRemindedAt || now.getTime() - incident.lastRemindedAt.getTime() >= 6 * 60 * 60_000;
}

export const SEVERITY_COLOR: Record<AlertSeverity | 'ok', number> = { critical: 0xf2555a, warning: 0xf5a524, info: 0x38bdf8, ok: 0x3ccf8e };
