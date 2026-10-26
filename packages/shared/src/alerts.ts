/**
 * Instance alerts: every notice has a category, which decides where it goes,
 * and a severity, which decides how loudly (mention, quiet hours, reminders).
 */

export const ALERT_CATEGORIES = ['availability', 'security', 'errors', 'billing', 'installations'] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

export const ALERT_SEVERITIES = ['critical', 'warning', 'info'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const isAlertCategory = (value: unknown): value is AlertCategory =>
  typeof value === 'string' && (ALERT_CATEGORIES as readonly string[]).includes(value);

export const isAlertSeverity = (value: unknown): value is AlertSeverity =>
  typeof value === 'string' && (ALERT_SEVERITIES as readonly string[]).includes(value);
