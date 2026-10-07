/* Client helpers shared by the dashboard chrome and the super console. */

export type AccessLevel = 'VIEWER' | 'MODERATOR' | 'ADMIN' | 'OWNER';

export type Me = {
  userId: string;
  username: string;
  avatarUrl: string | null;
  superAdmin?: boolean;
};

export type DashboardGuild = {
  guildId: string;
  guildName: string;
  access: AccessLevel | null;
  oauth: { id: string; name: string; icon: string | null } | null;
};

export const SNOWFLAKE = /^\d{17,20}$/;

export const accessLabel: Record<AccessLevel, string> = {
  VIEWER: 'Viewer',
  MODERATOR: 'Moderator',
  ADMIN: 'Admin',
  OWNER: 'Owner'
};

export function guildIconUrl(guildId: string, icon: string | null | undefined) {
  if (!icon || !SNOWFLAKE.test(guildId) || !/^(a_)?[a-f0-9]{32}$/i.test(icon)) return null;
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=128`;
}

export function initial(name: string) {
  return name.trim().slice(0, 1) || '?';
}

export async function logout() {
  await fetch('/backend/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  }).catch(() => null);
  window.location.href = '/';
}
