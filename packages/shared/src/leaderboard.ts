/*
 * Moderator leaderboard: periods in a guild timezone (ISO weeks, calendar
 * months, idempotency keys such as '2026-W41' / '2026-09'), the schedule check
 * and the pure ranking. No I/O and no dependencies: only the Intl APIs of the
 * runtime. Shared by the API preview, the bot scheduler and the tests.
 */

export const LEADERBOARD_PERIOD_KINDS = ['week', 'month'] as const;
export type LeaderboardPeriodKind = (typeof LEADERBOARD_PERIOD_KINDS)[number];

export const LEADERBOARD_LIMITS = {
  sizeMin: 3,
  sizeMax: 25,
  minRatingsMin: 0,
  minRatingsMax: 50,
  /** How many periods back the preview / manual send can look. */
  maxOffset: 52
} as const;

export const LEADERBOARD_DEFAULT_TIME_ZONE = 'Europe/Rome';

const DAY_MS = 86_400_000;
const SNOWFLAKE = /^\d{17,20}$/;
const MONTHS = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
] as const;
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** A calendar day (month 1..12) without timezone. */
export type LocalDate = { year: number; month: number; day: number };

export type ZonedParts = LocalDate & {
  hour: number;
  minute: number;
  second: number;
  /** ISO weekday: 1 = Monday .. 7 = Sunday. */
  weekday: number;
};

export type LeaderboardPeriod = {
  kind: LeaderboardPeriodKind;
  /** '2026-W41' (ISO week-numbering year) or '2026-09'. */
  key: string;
  /** Inclusive start instant (local midnight of the first day). */
  start: Date;
  /** Exclusive end instant (local midnight after the last day). */
  end: Date;
  first: LocalDate;
  /** Last local day, inclusive. */
  last: LocalDate;
  /** Italian label: 'settimana dal 5 all’11 ottobre 2026' / 'settembre 2026'. */
  label: string;
  timeZone: string;
};

const pad2 = (value: number) => String(value).padStart(2, '0');

const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;

/** A valid IANA timezone, otherwise Europe/Rome. */
export function safeTimeZone(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return LEADERBOARD_DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    return LEADERBOARD_DEFAULT_TIME_ZONE;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock parts of an instant in a timezone. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const values: Record<string, string> = {};
  for (const part of partsFormatter(timeZone).formatToParts(date)) values[part.type] = part.value;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    // Some engines report midnight as 24 even with h23.
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAYS[values.weekday ?? ''] ?? 1
  };
}

// Offset (local - UTC) in ms of the timezone at an instant.
function offsetMs(instant: number, timeZone: string) {
  const parts = zonedParts(new Date(instant), timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Instant of a local wall-clock time. Two passes handle DST changes; a time
 * inside a spring-forward gap resolves to the first valid instant after it.
 */
export function zonedTimeToUtc(date: LocalDate, hour: number, minute: number, timeZone: string): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const first = wall - offsetMs(wall, timeZone);
  return new Date(wall - offsetMs(first, timeZone));
}

function utcDay(date: LocalDate) {
  return Date.UTC(date.year, date.month - 1, date.day);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const moved = new Date(utcDay(date) + days * DAY_MS);
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

function addMonths(date: LocalDate, months: number): LocalDate {
  const index = date.year * 12 + (date.month - 1) + months;
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1, day: 1 };
}

/** ISO weekday of a calendar day: 1 = Monday .. 7 = Sunday. */
export function isoWeekday(date: LocalDate) {
  const day = new Date(utcDay(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** ISO 8601 week: the week belongs to the year of its Thursday. */
export function isoWeek(date: LocalDate): { year: number; week: number } {
  const thursday = addDays(date, 4 - isoWeekday(date));
  const week = 1 + Math.floor((utcDay(thursday) - Date.UTC(thursday.year, 0, 1)) / (7 * DAY_MS));
  return { year: thursday.year, week };
}

export function isoWeekKey(date: LocalDate) {
  const { year, week } = isoWeek(date);
  return `${year}-W${pad2(week)}`;
}

export function monthKey(date: LocalDate) {
  return `${date.year}-${pad2(date.month)}`;
}

// "dal 5" / "dall’8", "al 7" / "all’11" (Italian elision before a vowel sound).
const elided = (day: number) => day === 1 || day === 8 || day === 11;
const from = (day: number) => (elided(day) ? 'dall’' : 'dal ') + day;
const until = (day: number) => (elided(day) ? 'all’' : 'al ') + day;
const monthName = (date: LocalDate) => MONTHS[date.month - 1] ?? '';

function weekLabel(first: LocalDate, last: LocalDate) {
  const start = first.year !== last.year
    ? `${from(first.day)} ${monthName(first)} ${first.year}`
    : first.month !== last.month
      ? `${from(first.day)} ${monthName(first)}`
      : from(first.day);
  return `settimana ${start} ${until(last.day)} ${monthName(last)} ${last.year}`;
}

/**
 * Period containing `reference` (offset 0, possibly still running) or
 * `offset` periods before it, in the given timezone.
 */
export function leaderboardPeriod(
  kind: LeaderboardPeriodKind,
  reference: Date,
  timeZone: string,
  offset = 0
): LeaderboardPeriod {
  const tz = safeTimeZone(timeZone);
  const back = clampInt(offset, 0, 10_000, 0);
  const local = zonedParts(reference, tz);
  const today: LocalDate = { year: local.year, month: local.month, day: local.day };

  if (kind === 'week') {
    const first = addDays(addDays(today, 1 - isoWeekday(today)), -7 * back);
    const next = addDays(first, 7);
    const last = addDays(first, 6);
    return {
      kind,
      key: isoWeekKey(first),
      start: zonedTimeToUtc(first, 0, 0, tz),
      end: zonedTimeToUtc(next, 0, 0, tz),
      first,
      last,
      label: weekLabel(first, last),
      timeZone: tz
    };
  }

  const first = addMonths(today, -back);
  const next = addMonths(first, 1);
  const last = addDays(next, -1);
  return {
    kind,
    key: monthKey(first),
    start: zonedTimeToUtc(first, 0, 0, tz),
    end: zonedTimeToUtc(next, 0, 0, tz),
    first,
    last,
    label: `${monthName(first)} ${first.year}`,
    timeZone: tz
  };
}

export function leaderboardTitle(period: Pick<LeaderboardPeriod, 'label'>) {
  return `Classifica moderatori — ${period.label}`;
}

export type LeaderboardSchedule = {
  timezone: string | null | undefined;
  weekly: boolean;
  monthly: boolean;
  /** 1 = Monday .. 7 = Sunday. */
  weekday: number;
  /** 0..23, local time. */
  hour: number;
  lastWeekly: string | null;
  lastMonthly: string | null;
};

/**
 * Completed periods whose leaderboard is due at `now`: the previous ISO week
 * once the local time is past (weekday, hour) of the current week, the
 * previous month once it is past (day 1, hour) of the current month, and only
 * when the stored key differs (idempotency).
 */
export function dueLeaderboardPeriods(schedule: LeaderboardSchedule, now: Date): LeaderboardPeriod[] {
  const tz = safeTimeZone(schedule.timezone);
  const hour = clampInt(schedule.hour, 0, 23, 9);
  const weekday = clampInt(schedule.weekday, 1, 7, 1);
  const local = zonedParts(now, tz);
  const today: LocalDate = { year: local.year, month: local.month, day: local.day };
  const due: LeaderboardPeriod[] = [];

  if (schedule.weekly) {
    const monday = addDays(today, 1 - isoWeekday(today));
    const slot = zonedTimeToUtc(addDays(monday, weekday - 1), hour, 0, tz);
    const previous = leaderboardPeriod('week', now, tz, 1);
    if (now.getTime() >= slot.getTime() && schedule.lastWeekly !== previous.key) due.push(previous);
  }

  if (schedule.monthly) {
    const slot = zonedTimeToUtc({ year: today.year, month: today.month, day: 1 }, hour, 0, tz);
    const previous = leaderboardPeriod('month', now, tz, 1);
    if (now.getTime() >= slot.getTime() && schedule.lastMonthly !== previous.key) due.push(previous);
  }

  return due;
}

/** Raw activity of a period, one array element per event. */
export type LeaderboardActivity = {
  /** handledById of every ticket closed in the period. */
  handled: readonly string[];
  /** Feedback created in the period, attributed through staffUserId. */
  feedback: ReadonlyArray<{ staffId: string; rating: number }>;
  /** First staff responses in the period, by first responder. */
  firstResponses: ReadonlyArray<{ staffId: string; minutes: number }>;
  /** Claims and assignments in the period (claimer / assignee). */
  claims: readonly string[];
};

export type LeaderboardEntry = {
  /** Competition ranking: full ties share the rank (1, 1, 3). */
  rank: number;
  userId: string;
  handled: number;
  feedbackCount: number;
  /** null when feedbackCount < minRatings (shown as "—"). */
  averageRating: number | null;
  firstResponses: number;
  medianFirstResponseMinutes: number | null;
  claims: number;
};

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Pure ranking. Order: tickets handled, then average rating (only counted
 * with at least `minRatings` ratings, otherwise below every counted one),
 * then number of ratings, then user id (stable output). Ids that are not
 * snowflakes are ignored: every entry is safe to render as a mention.
 */
export function rankLeaderboard(
  activity: LeaderboardActivity,
  options: { minRatings: number; size?: number }
): LeaderboardEntry[] {
  const minRatings = clampInt(options.minRatings, LEADERBOARD_LIMITS.minRatingsMin, LEADERBOARD_LIMITS.minRatingsMax, 3);
  type Row = { userId: string; handled: number; ratings: number[]; responses: number[]; claims: number };
  const rows = new Map<string, Row>();
  const row = (userId: string) => {
    let current = rows.get(userId);
    if (!current) {
      current = { userId, handled: 0, ratings: [], responses: [], claims: 0 };
      rows.set(userId, current);
    }
    return current;
  };
  const valid = (userId: unknown): userId is string => typeof userId === 'string' && SNOWFLAKE.test(userId);

  for (const userId of activity.handled) if (valid(userId)) row(userId).handled += 1;
  for (const entry of activity.feedback) {
    if (valid(entry.staffId) && Number.isInteger(entry.rating) && entry.rating >= 1 && entry.rating <= 5) {
      row(entry.staffId).ratings.push(entry.rating);
    }
  }
  for (const entry of activity.firstResponses) {
    if (valid(entry.staffId) && Number.isFinite(entry.minutes) && entry.minutes >= 0) {
      row(entry.staffId).responses.push(entry.minutes);
    }
  }
  for (const userId of activity.claims) if (valid(userId)) row(userId).claims += 1;

  const entries: LeaderboardEntry[] = [...rows.values()].map((current): LeaderboardEntry => {
    const count = current.ratings.length;
    const qualified = count > 0 && count >= minRatings;
    return {
      rank: 0,
      userId: current.userId,
      handled: current.handled,
      feedbackCount: count,
      averageRating: qualified ? current.ratings.reduce((sum, value) => sum + value, 0) / count : null,
      firstResponses: current.responses.length,
      medianFirstResponseMinutes: median(current.responses),
      claims: current.claims
    };
  });

  const tied = (a: LeaderboardEntry, b: LeaderboardEntry) =>
    a.handled === b.handled && a.averageRating === b.averageRating && a.feedbackCount === b.feedbackCount;

  entries.sort((a, b) =>
    b.handled - a.handled ||
    (b.averageRating ?? -1) - (a.averageRating ?? -1) ||
    b.feedbackCount - a.feedbackCount ||
    (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0)
  );
  entries.forEach((entry, index) => {
    const previous = entries[index - 1];
    entry.rank = previous && tied(previous, entry) ? previous.rank : index + 1;
  });

  const size = typeof options.size === 'number' && Number.isInteger(options.size) && options.size > 0
    ? options.size
    : entries.length;
  return entries.slice(0, size);
}

/** Compact Italian duration: '<1 min', '42 min', '3 h 05 min', '2 g 4 h'. */
export function formatLeaderboardMinutes(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const totalMinutes = Math.round(minutes);
  if (totalMinutes < 24 * 60) return `${Math.floor(totalMinutes / 60)} h ${pad2(totalMinutes % 60)} min`;
  const hours = Math.floor(totalMinutes / 60);
  return `${Math.floor(hours / 24)} g ${hours % 24} h`;
}
