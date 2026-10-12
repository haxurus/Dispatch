/*
 * Per-server limits of the hosted instance. They keep one server from filling
 * the shared database or the VPS disk, and stay well above what a real support
 * desk needs. The API enforces them on create; existing rows are never removed.
 */
export const GUILD_QUOTAS = {
  categories: 50,
  ticketPanels: 25,
  forms: 50,
  formPanels: 25,
  responseTemplates: 100,
  blacklistEntries: 2000,
  roleBindings: 50
} as const;

export type GuildQuota = keyof typeof GUILD_QUOTAS;

/** Days a server's data is kept after the bot is removed from it. */
export const DEFAULT_POST_REMOVAL_RETENTION_DAYS = 30;
