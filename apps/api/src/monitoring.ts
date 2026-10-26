import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@dispatch/db';
import {
  LOG_LEVEL_RANK,
  normalizeAlertLocale,
  renderAlertMessage,
  type AlertMessageKey,
  type AlertParams,
  type LogBuffer,
  type LogLevelName
} from '@dispatch/shared';
import { botHealth, getBotLogs } from './discord.js';
import { encryptText } from './security.js';
import { superAdminAudit } from './super-audit.js';
import { requireSuperAdmin, requireSuperMutation } from './super.js';
import { openIncident, resolveIncident } from './alert-store.js';
import { alertWebhookUrl, postAlertWebhook, renderEvent, statusLocale } from './alerting.js';

/**
 * Super console monitoring: the bot watchdog, the instance event feed and the
 * latest logs of the API and the bot.
 *
 * "Bot down" cannot be posted by the bot: it is recorded as an incident, sent
 * to the optional webhook and caught by an external monitor on /health/bot.
 * "Bot restored" is routed like any other alert.
 */

type Logger = { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };

const CHECK_INTERVAL_MS = 30_000;
/**
 * Consecutive failed checks before the bot is declared down (about two
 * minutes): a deploy restarts the bot in less, without raising an alarm.
 */
const FAILURES_BEFORE_DOWN = 4;
const EVENT_RETENTION_DAYS = 90;
const WEBHOOK = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[\w-]{20,}$/;

type BotState = { status: 'unknown' | 'up' | 'down'; since: string; lastCheck: string | null; failures: number; guilds: number | null };
const state: BotState = { status: 'unknown', since: new Date().toISOString(), lastCheck: null, failures: 0, guilds: null };
export const botState = () => ({ ...state });

async function webhook(level: 'ok' | 'error', key: AlertMessageKey, params: AlertParams, log: Logger) {
  const url = await alertWebhookUrl().catch(() => null);
  if (!url) return;
  const locale = await statusLocale().catch(() => 'en' as const);
  const text = renderAlertMessage(key, params, locale);
  await postAlertWebhook(url, level, text.title, text.description ?? '', locale).catch((error) => log.warn({ err: error }, 'Alarm webhook failed'));
}

async function checkBot(log: Logger) {
  const now = new Date();
  const health = await botHealth().catch(() => null);
  state.lastCheck = now.toISOString();
  if (health?.ok) {
    state.guilds = health.guilds;
    state.failures = 0;
    if (state.status !== 'up') {
      state.status = 'up';
      state.since = now.toISOString();
    }
    // Also closes an incident left open by a previous API process.
    const durationMs = await resolveIncident('bot.down', 'bot.restored', { guilds: health.guilds }).catch(() => null);
    if (durationMs) await webhook('ok', 'bot.restored', { guilds: health.guilds, durationMs }, log);
    return;
  }
  state.failures += 1;
  if (state.failures >= FAILURES_BEFORE_DOWN && state.status !== 'down') {
    const wasUp = state.status === 'up';
    state.status = 'down';
    state.since = now.toISOString();
    const params = { mode: health ? 'disconnected' : 'silent', minutes: Math.round(FAILURES_BEFORE_DOWN * CHECK_INTERVAL_MS / 60_000), sinceStart: wasUp ? null : 1 };
    // logOnly: the bot cannot post it; the webhook and the external monitor do.
    const opened = await openIncident('bot.down', { category: 'availability', severity: 'critical', message: 'bot.down', params, logOnly: true }).catch(() => false);
    if (opened) await webhook('error', 'bot.down', params, log);
  }
}

export function startMonitoring(log: Logger) {
  setTimeout(() => void checkBot(log), 10_000).unref();
  setInterval(() => void checkBot(log), CHECK_INTERVAL_MS).unref();
  const cleanup = () => prisma.instanceEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - EVENT_RETENTION_DAYS * 86_400_000) } } }).catch(() => null);
  void cleanup();
  setInterval(() => void cleanup(), 12 * 60 * 60 * 1000).unref();
}

export function registerMonitoringRoutes(app: FastifyInstance, apiLogs: LogBuffer) {
  // Public and detail-free, for an external uptime monitor.
  app.get('/health/bot', { logLevel: 'warn', config: { rateLimit: false } }, async (_request, reply) => {
    const ok = state.status === 'up';
    return reply.code(ok ? 200 : 503).send({ ok, service: 'bot' });
  });

  app.get('/api/super/monitor', async (request, reply) => {
    const session = await requireSuperAdmin(request, reply);
    if (!session) return;
    const locale = normalizeAlertLocale((request.query as { locale?: string }).locale);
    const [rows, url] = await Promise.all([
      prisma.instanceEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
      alertWebhookUrl().catch(() => null)
    ]);
    const events = rows.map((row) => {
      const text = renderEvent(row, locale);
      return { id: row.id, source: row.source, level: row.level, category: row.category, severity: row.severity, deliveryState: row.deliveryState, title: text.title, description: text.description, fields: text.fields, createdAt: row.createdAt };
    });
    return { bot: botState(), events, webhook: url ? { configured: true, hint: `…${url.slice(-6)}` } : { configured: false, hint: null } };
  });

  app.get('/api/super/logs', async (request, reply) => {
    const session = await requireSuperAdmin(request, reply);
    if (!session) return;
    const parsed = z.object({
      service: z.enum(['api', 'bot']).default('bot'),
      level: z.enum(Object.keys(LOG_LEVEL_RANK) as [LogLevelName, ...LogLevelName[]]).default('info'),
      limit: z.coerce.number().int().min(1).max(1_000).default(300)
    }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY' });
    const { service, level, limit } = parsed.data;
    if (service === 'api') return { service, entries: apiLogs.list(level, limit) };
    try {
      return { service, entries: await getBotLogs(level, limit) };
    } catch {
      return reply.code(502).send({ error: 'BOT_UNAVAILABLE' });
    }
  });

  app.put('/api/super/alert-webhook', async (request, reply) => {
    const session = await requireSuperMutation(request, reply);
    if (!session) return;
    const parsed = z.object({ url: z.union([z.literal(''), z.string().trim().regex(WEBHOOK)]).nullable() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_WEBHOOK' });
    const url = parsed.data.url || null;
    const stored = url ? encryptText(url) : null;
    await prisma.instanceConfig.upsert({ where: { id: 1 }, update: { alertWebhookUrl: stored }, create: { id: 1, alertWebhookUrl: stored } });
    await superAdminAudit(request, session, url ? 'monitor.webhook_set' : 'monitor.webhook_removed', null, null);
    return { ok: true, configured: Boolean(url) };
  });

  app.post('/api/super/alert-webhook/test', async (request, reply) => {
    const session = await requireSuperMutation(request, reply);
    if (!session) return;
    const url = await alertWebhookUrl().catch(() => null);
    if (!url) return reply.code(400).send({ error: 'WEBHOOK_NOT_SET' });
    try {
      const locale = await statusLocale().catch(() => 'en' as const);
      const text = renderAlertMessage('webhook.test', {}, locale);
      await postAlertWebhook(url, 'info', text.title, text.description ?? '', locale);
    } catch {
      return reply.code(502).send({ error: 'WEBHOOK_FAILED' });
    }
    return { ok: true };
  });
}
