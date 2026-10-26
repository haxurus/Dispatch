import type { FastifyInstance } from 'fastify';
import { prisma } from '@dispatch/db';
import {
  ALERT_CATEGORIES,
  ALERT_UI,
  alertCategoryLabel,
  alertFieldLabel,
  durationText,
  isAlertCategory,
  isAlertMessageKey,
  normalizeAlertLocale,
  renderAlertMessage,
  type AlertCategory,
  type AlertField,
  type AlertLocale,
  type AlertParams
} from '@dispatch/shared';
import { config } from './config.js';
import { deliverAlert } from './discord.js';
import { decryptText, unprotectJson } from './security.js';
import { superAdminAudit } from './super-audit.js';
import { channelAcceptsAlerts, requireSuperAdmin, requireSuperMutation } from './super.js';
import type { AlertLevel } from './alert-store.js';
import {
  SEVERITY_COLOR,
  digestDue,
  groupForDelivery,
  inQuietHours,
  parseAlertSettings,
  reminderDue,
  routeTarget,
  type AlertSettings,
  type AlertTarget
} from './alert-rules.js';

/**
 * Instance alert routing. The bot and the API record alerts as InstanceEvent
 * rows (alert-store.ts and the bot's status.ts); this router sends them where
 * the super console says (status channel, another channel, daily digest, log
 * only), merges repeats, defers non-critical alerts during quiet hours and
 * reminds open incidents. Discord messages are posted by the bot, so an
 * outage of the bot itself is reported by the external monitor (and the
 * optional webhook), not here.
 */

type Logger = { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
type Details = { params?: AlertParams; fields?: Array<AlertField | { name: string; value: string }> };

const ROUTER_INTERVAL_MS = 20_000;
const PENDING_MAX_AGE_MS = 24 * 60 * 60_000;

const LEVEL_COLOR: Record<AlertLevel, number> = { ok: SEVERITY_COLOR.ok, info: SEVERITY_COLOR.info, warn: SEVERITY_COLOR.warning, error: SEVERITY_COLOR.critical };

const readDetails = (value: unknown): Details => {
  try {
    return unprotectJson(value) as Details;
  } catch {
    return {};
  }
};

/** Title, description and fields of an alert in one language. */
export function renderEvent(event: { messageKey: string | null; title: string; details: unknown }, locale: AlertLocale) {
  const details = readDetails(event.details);
  const fields = (details.fields ?? []).map((field) => 'key' in field
    ? { name: alertFieldLabel(field.key, locale), value: field.value }
    : { name: field.name, value: field.value });
  if (isAlertMessageKey(event.messageKey)) {
    const text = renderAlertMessage(event.messageKey, details.params ?? {}, locale);
    return { title: text.title, description: text.description, fields };
  }
  return { title: event.title, description: null, fields };
}

export function renderIncident(incident: { messageKey: string | null; title: string; description: string | null; params: unknown }, locale: AlertLocale) {
  if (isAlertMessageKey(incident.messageKey)) {
    const params = incident.params && typeof incident.params === 'object' ? incident.params as AlertParams : {};
    const text = renderAlertMessage(incident.messageKey, params, locale);
    return { title: text.title, description: text.description };
  }
  return { title: incident.title, description: incident.description };
}

/** Language of each target server (its bot language setting). */
async function localesOf(guildIds: string[]) {
  const unique = [...new Set(guildIds)];
  const rows = unique.length ? await prisma.guildSettings.findMany({ where: { guildId: { in: unique } }, select: { guildId: true, locale: true } }) : [];
  const map = new Map(rows.map((row) => [row.guildId, normalizeAlertLocale(row.locale)]));
  return (guildId: string | null | undefined): AlertLocale => (guildId ? map.get(guildId) ?? 'en' : 'en');
}

export async function statusLocale() {
  const status = await prisma.statusChannel.findUnique({ where: { id: 1 }, select: { guildId: true } });
  return (await localesOf(status ? [status.guildId] : []))(status?.guildId);
}

/* --------------------------------------------------------------- webhook */

export async function alertWebhookUrl() {
  const row = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { alertWebhookUrl: true } });
  return row?.alertWebhookUrl ? decryptText(row.alertWebhookUrl) : null;
}

/** Fallback for "bot down": a webhook works while the bot is stopped. */
export async function postAlertWebhook(url: string, level: AlertLevel, title: string, description: string, locale: AlertLocale = 'en') {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Dispatch monitor',
      allowed_mentions: { parse: [] },
      embeds: [{ title, description, color: LEVEL_COLOR[level], timestamp: new Date().toISOString(), footer: { text: ALERT_UI[locale].monitorFooter } }]
    }),
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`Webhook responded ${response.status}`);
}

/* ---------------------------------------------------------------- router */

async function loadSettings() {
  const row = await prisma.instanceConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 }, select: { alertSettings: true, lastDigestAt: true } });
  return { settings: parseAlertSettings(row.alertSettings), lastDigestAt: row.lastDigestAt };
}

async function statusTarget(): Promise<AlertTarget | null> {
  const row = await prisma.statusChannel.findUnique({ where: { id: 1 }, select: { guildId: true, channelId: true } });
  return row ? { guildId: row.guildId, channelId: row.channelId } : null;
}

const mentionFor = (mention: boolean, severity: string) => (mention && severity === 'critical' && config.superAdminUserId ? config.superAdminUserId : null);

const lastSent = new Map<string, number>();
let routing = false;

export async function runAlertRouter(log: Logger) {
  if (routing) return;
  routing = true;
  try {
    const now = new Date();
    const [{ settings, lastDigestAt }, status] = await Promise.all([loadSettings(), statusTarget()]);
    const quiet = inQuietHours(settings, now);
    const pending = await prisma.instanceEvent.findMany({ where: { deliveryState: 'pending' }, orderBy: { createdAt: 'asc' }, take: 300 });

    const toLog: string[] = [];
    const toDigest: string[] = [];
    const expired: string[] = [];
    const sendable: Array<{ key: string; event: (typeof pending)[number]; target: AlertTarget; mention: string | null; category: AlertCategory }> = [];
    for (const event of pending) {
      if (now.getTime() - event.createdAt.getTime() > PENDING_MAX_AGE_MS) { expired.push(event.id); continue; }
      const category: AlertCategory = isAlertCategory(event.category) ? event.category : 'errors';
      const route = settings.routes[category];
      if (route.mode === 'log') { toLog.push(event.id); continue; }
      if (route.mode === 'digest') { toDigest.push(event.id); continue; }
      const target = routeTarget(route, status);
      if (!target) { toLog.push(event.id); continue; }
      // Quiet hours: non-critical alerts wait and leave together in the morning.
      if (quiet && event.severity !== 'critical') continue;
      sendable.push({ key: `${target.guildId}:${target.channelId}:${event.messageKey ?? event.title}`, event, target, mention: mentionFor(route.mention, event.severity), category });
    }
    await Promise.all([
      toLog.length ? prisma.instanceEvent.updateMany({ where: { id: { in: toLog } }, data: { deliveryState: 'log' } }) : null,
      toDigest.length ? prisma.instanceEvent.updateMany({ where: { id: { in: toDigest } }, data: { deliveryState: 'digest' } }) : null,
      expired.length ? prisma.instanceEvent.updateMany({ where: { id: { in: expired } }, data: { deliveryState: 'failed' } }) : null
    ]);

    const localeOf = await localesOf(sendable.map((item) => item.target.guildId));
    for (const group of groupForDelivery(sendable, lastSent, now.getTime())) {
      const first = group.members[0]!;
      const latest = group.members[group.members.length - 1]!;
      const locale = localeOf(latest.target.guildId);
      const ui = ALERT_UI[locale];
      const text = renderEvent(latest.event, locale);
      const count = group.members.length;
      const since = first.event.createdAt.toLocaleTimeString(locale === 'it' ? 'it-IT' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: settings.timezone });
      try {
        await deliverAlert({
          ...latest.target,
          title: count > 1 ? `${text.title} ×${count}` : text.title,
          description: [text.description, count > 1 ? ui.repeated(count, since) : null].filter(Boolean).join('\n\n') || null,
          fields: text.fields,
          color: LEVEL_COLOR[latest.event.level as AlertLevel] ?? LEVEL_COLOR.info,
          footer: ui.footer(alertCategoryLabel(latest.category, locale)),
          mentionUserId: group.members.some((member) => member.mention) ? latest.mention ?? first.mention : null
        });
        lastSent.set(group.key, now.getTime());
        await prisma.instanceEvent.updateMany({ where: { id: { in: group.members.map((member) => member.event.id) } }, data: { deliveryState: 'sent', deliveredAt: now } });
      } catch (error) {
        // Stays pending: retried at the next run (e.g. while the bot restarts).
        log.warn({ err: error }, 'Alert delivery failed');
      }
    }

    if (digestDue(settings, now, lastDigestAt)) await sendDigest(settings, status, now, log);
    await sendReminders(settings, status, now, quiet, log);
  } finally {
    routing = false;
  }
}

async function sendDigest(settings: AlertSettings, status: AlertTarget | null, now: Date, log: Logger) {
  const target = settings.digest.mode === 'channel' ? routeTarget({ mode: 'channel', guildId: settings.digest.guildId, channelId: settings.digest.channelId }, status) : status;
  const events = await prisma.instanceEvent.findMany({ where: { deliveryState: 'digest' }, orderBy: { createdAt: 'asc' }, take: 2_000 });
  const done = () => prisma.instanceConfig.update({ where: { id: 1 }, data: { lastDigestAt: now } });
  if (!events.length) { await done(); return; }
  if (!target) {
    await prisma.instanceEvent.updateMany({ where: { id: { in: events.map((event) => event.id) } }, data: { deliveryState: 'log' } });
    await done();
    return;
  }

  const locale = (await localesOf([target.guildId]))(target.guildId);
  const ui = ALERT_UI[locale];
  const byCategory = new Map<AlertCategory, Map<string, number>>();
  for (const event of events) {
    const category: AlertCategory = isAlertCategory(event.category) ? event.category : 'errors';
    const titles = byCategory.get(category) ?? new Map<string, number>();
    const title = renderEvent(event, locale).title;
    titles.set(title, (titles.get(title) ?? 0) + 1);
    byCategory.set(category, titles);
  }
  const fields = ALERT_CATEGORIES.filter((category) => byCategory.has(category)).map((category) => ({
    name: alertCategoryLabel(category, locale),
    value: [...byCategory.get(category)!.entries()].sort((a, b) => b[1] - a[1]).map(([title, count]) => `• ${title}: **${count}**`).join('\n').slice(0, 1024)
  }));
  try {
    await deliverAlert({
      ...target,
      title: ui.digestTitle,
      description: ui.digestText(events.length),
      fields,
      color: SEVERITY_COLOR.info,
      footer: ui.digestFooter,
      mentionUserId: null
    });
    await prisma.instanceEvent.updateMany({ where: { id: { in: events.map((event) => event.id) } }, data: { deliveryState: 'digested', deliveredAt: now } });
    await done();
  } catch (error) {
    log.warn({ err: error }, 'Daily digest delivery failed');
  }
}

async function sendReminders(settings: AlertSettings, status: AlertTarget | null, now: Date, quiet: boolean, log: Logger) {
  const open = await prisma.incident.findMany({ where: { resolvedAt: null, acknowledgedAt: null } });
  for (const incident of open) {
    if (!reminderDue(incident, now)) continue;
    if (quiet && incident.severity !== 'critical') continue;
    try {
      if (incident.key === 'bot.down') {
        // The bot cannot post while it is down: only the webhook can remind.
        const url = await alertWebhookUrl().catch(() => null);
        if (url) {
          const locale = await statusLocale();
          const text = renderIncident(incident, locale);
          await postAlertWebhook(url, 'error', ALERT_UI[locale].reminder(text.title), ALERT_UI[locale].reminderText(durationText(now.getTime() - incident.openedAt.getTime(), locale)), locale);
        }
      } else {
        const category: AlertCategory = isAlertCategory(incident.category) ? incident.category : 'errors';
        const route = settings.routes[category];
        const target = route.mode === 'status' || route.mode === 'channel' ? routeTarget(route, status) : status;
        if (target) {
          const locale = (await localesOf([target.guildId]))(target.guildId);
          const ui = ALERT_UI[locale];
          const text = renderIncident(incident, locale);
          await deliverAlert({
            ...target,
            title: ui.reminder(text.title),
            description: [text.description, ui.reminderText(durationText(now.getTime() - incident.openedAt.getTime(), locale))].filter(Boolean).join('\n\n'),
            fields: [],
            color: incident.severity === 'critical' ? SEVERITY_COLOR.critical : SEVERITY_COLOR.warning,
            footer: ui.footer(alertCategoryLabel(category, locale)),
            mentionUserId: mentionFor(route.mention, incident.severity)
          });
        }
      }
      await prisma.incident.update({ where: { id: incident.id }, data: { reminders: { increment: 1 }, lastRemindedAt: now } });
    } catch (error) {
      log.warn({ err: error, incident: incident.key }, 'Incident reminder failed');
    }
  }
}

export function startAlerting(log: Logger) {
  setInterval(() => void runAlertRouter(log).catch((error) => log.warn({ err: error }, 'Alert router failed')), ROUTER_INTERVAL_MS).unref();
}

/* ---------------------------------------------------------------- routes */

export function registerAlertRoutes(app: FastifyInstance) {
  app.get('/api/super/alerts', async (request, reply) => {
    const session = await requireSuperAdmin(request, reply);
    if (!session) return;
    const locale = normalizeAlertLocale((request.query as { locale?: string }).locale);
    const [{ settings }, open, recent] = await Promise.all([
      loadSettings(),
      prisma.incident.findMany({ where: { resolvedAt: null }, orderBy: { openedAt: 'desc' } }),
      prisma.incident.findMany({ where: { resolvedAt: { not: null } }, orderBy: { openedAt: 'desc' }, take: 30 })
    ]);
    const view = (incident: (typeof open)[number]) => ({ ...incident, ...renderIncident(incident, locale) });
    return { settings, incidents: { open: open.map(view), recent: recent.map(view) }, mentionAvailable: Boolean(config.superAdminUserId) };
  });

  app.put('/api/super/alerts/settings', async (request, reply) => {
    const session = await requireSuperMutation(request, reply);
    if (!session) return;
    const settings = parseAlertSettings(request.body);
    // Every chosen channel must belong to its server and accept messages.
    const targets = [
      ...Object.values(settings.routes).filter((route) => route.mode === 'channel'),
      ...(settings.digest.mode === 'channel' ? [settings.digest] : [])
    ];
    if (targets.some((target) => !target.guildId || !target.channelId)) return reply.code(400).send({ error: 'CHANNEL_REQUIRED' });
    try {
      for (const target of targets) {
        if (!(await channelAcceptsAlerts(target.guildId!, target.channelId!))) return reply.code(400).send({ error: 'CHANNEL_NOT_FOUND' });
      }
    } catch {
      return reply.code(502).send({ error: 'BOT_UNAVAILABLE' });
    }
    await prisma.instanceConfig.upsert({ where: { id: 1 }, update: { alertSettings: settings }, create: { id: 1, alertSettings: settings } });
    await superAdminAudit(request, session, 'alerts.settings', null, null, settings);
    return { settings };
  });

  app.post('/api/super/incidents/:id/ack', async (request, reply) => {
    const session = await requireSuperMutation(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const incident = await prisma.incident.findUnique({ where: { id } });
    if (!incident || incident.resolvedAt) return reply.code(404).send({ error: 'NOT_FOUND' });
    await prisma.incident.update({ where: { id }, data: { acknowledgedAt: new Date(), acknowledgedBy: session.username } });
    await superAdminAudit(request, session, 'incident.ack', 'INCIDENT', incident.key);
    return { ok: true };
  });
}
