import { prisma } from '@dispatch/db';
import {
  isAlertCategory,
  renderAlertMessage,
  type AlertCategory,
  type AlertField,
  type AlertMessageKey,
  type AlertParams,
  type AlertSeverity
} from '@dispatch/shared';
import { protectJson } from './security.js';

/*
 * Recording side of the instance alerts (InstanceEvent, Incident): used by
 * the plan sync, the watchdog and the server purge. Routing and delivery are
 * in alerting.ts.
 */

export type AlertLevel = 'info' | 'ok' | 'warn' | 'error';

export const levelFor = (severity: AlertSeverity): AlertLevel => severity === 'critical' ? 'error' : severity === 'warning' ? 'warn' : 'info';

export async function recordAlert(input: {
  category: AlertCategory; severity: AlertSeverity; key: AlertMessageKey; params?: AlertParams;
  fields?: AlertField[]; level?: AlertLevel; logOnly?: boolean;
}) {
  const params = input.params ?? {};
  await prisma.instanceEvent.create({
    data: {
      source: 'api',
      level: input.level ?? levelFor(input.severity),
      category: input.category,
      severity: input.severity,
      messageKey: input.key,
      // Readable in the database; the delivered text is rendered per server.
      title: renderAlertMessage(input.key, params, 'en').title.slice(0, 256),
      details: protectJson({ params, fields: input.fields ?? [] }),
      deliveryState: input.logOnly ? 'log' : 'pending'
    }
  });
}

/** Opens an incident once per key; repeated calls while it is open do nothing. */
export async function openIncident(key: string, input: {
  category: AlertCategory; severity: AlertSeverity; message: AlertMessageKey; params?: AlertParams; logOnly?: boolean;
}) {
  const open = await prisma.incident.findFirst({ where: { key, resolvedAt: null } });
  if (open) return false;
  const params = input.params ?? {};
  const text = renderAlertMessage(input.message, params, 'en');
  await prisma.incident.create({
    data: {
      key,
      category: input.category,
      severity: input.severity,
      title: text.title,
      description: text.description,
      messageKey: input.message,
      params: params as Record<string, string | number | null>
    }
  });
  await recordAlert({ category: input.category, severity: input.severity, key: input.message, params, logOnly: input.logOnly });
  return true;
}

/** Resolves the open incident of a key and announces it with its duration. */
export async function resolveIncident(key: string, message: AlertMessageKey, params: AlertParams = {}) {
  const open = await prisma.incident.findFirst({ where: { key, resolvedAt: null } });
  if (!open) return null;
  const now = new Date();
  await prisma.incident.update({ where: { id: open.id }, data: { resolvedAt: now } });
  const durationMs = now.getTime() - open.openedAt.getTime();
  await recordAlert({
    category: isAlertCategory(open.category) ? open.category : 'errors',
    severity: 'info',
    level: 'ok',
    key: message,
    params: { ...params, durationMs }
  });
  return durationMs;
}
