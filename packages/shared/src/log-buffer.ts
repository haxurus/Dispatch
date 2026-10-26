/**
 * The latest log lines of a process, kept in memory for the super console.
 * It is a pino destination: pass it to pino.multistream next to stdout. Lines
 * are redacted before they are stored and nothing is written to disk.
 */

export type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogEntry = { time: string; level: LogLevelName; msg: string; context: Record<string, unknown> | null };

const LEVELS: Record<number, LogLevelName> = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' };
export const LOG_LEVEL_RANK: Record<LogLevelName, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const DROPPED_KEYS = new Set(['time', 'level', 'msg', 'pid', 'hostname', 'v']);
const MAX_LINE = 4_000;

export function createLogBuffer(capacity = 2_000, redact: (value: string) => string = (value) => value) {
  const entries: LogEntry[] = [];

  const push = (line: string) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      parsed = { level: 30, msg: line };
    }
    const context: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) if (!DROPPED_KEYS.has(key)) context[key] = value;
    const rawContext = Object.keys(context).length ? redact(JSON.stringify(context)).slice(0, MAX_LINE) : null;
    let safeContext: Record<string, unknown> | null = null;
    if (rawContext) {
      try {
        safeContext = JSON.parse(rawContext) as Record<string, unknown>;
      } catch {
        safeContext = { truncated: rawContext };
      }
    }
    entries.push({
      time: new Date(typeof parsed.time === 'number' ? parsed.time : Date.now()).toISOString(),
      level: LEVELS[Number(parsed.level)] ?? 'info',
      msg: redact(String(parsed.msg ?? '')).slice(0, MAX_LINE),
      context: safeContext
    });
    if (entries.length > capacity) entries.splice(0, entries.length - capacity);
  };

  return {
    /** pino destination interface. */
    write(chunk: string) {
      for (const line of String(chunk).split('\n')) if (line.trim()) push(line);
    },
    /** Newest first, at or above `minLevel`. */
    list(minLevel: LogLevelName = 'info', limit = 500) {
      const rank = LOG_LEVEL_RANK[minLevel];
      const out: LogEntry[] = [];
      for (let index = entries.length - 1; index >= 0 && out.length < limit; index -= 1) {
        const entry = entries[index]!;
        if (LOG_LEVEL_RANK[entry.level] >= rank) out.push(entry);
      }
      return out;
    }
  };
}

export type LogBuffer = ReturnType<typeof createLogBuffer>;
