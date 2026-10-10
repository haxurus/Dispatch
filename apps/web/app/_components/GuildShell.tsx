'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { Brand, Icon, type IconName } from './Brand';
import {
  SNOWFLAKE,
  accessLabel,
  guildIconUrl,
  initial,
  logout,
  type DashboardGuild,
  type Me
} from './session';

type NavItem = { key: string; href: string; label: string; icon: IconName };

const TICKET_SUBPAGES = new Set(['manage', 'analytics', 'security', 'system']);

function navItems(guildId: string): NavItem[] {
  const base = `/dashboard/${guildId}`;
  return [
    { key: 'overview', href: base, label: 'Panoramica', icon: 'grid' },
    { key: 'manage', href: `${base}/tickets/manage`, label: 'Ticket', icon: 'inbox' },
    { key: 'tickets', href: `${base}/tickets`, label: 'Configurazione ticket', icon: 'ticket' },
    { key: 'system', href: `${base}/tickets/system`, label: 'Sistema e menu', icon: 'sliders' },
    { key: 'panels', href: `${base}/panels`, label: 'Pannelli', icon: 'panel' },
    { key: 'forms', href: `${base}/forms`, label: 'Form', icon: 'clipboard' },
    { key: 'analytics', href: `${base}/tickets/analytics`, label: 'Analytics', icon: 'chart' },
    { key: 'security', href: `${base}/tickets/security`, label: 'Blacklist', icon: 'ban' }
  ];
}

/** Maps the current path to the sidebar entry it belongs to. */
function activeKey(pathname: string, guildId: string) {
  const rest = pathname.replace(`/dashboard/${guildId}`, '').split('/').filter(Boolean);
  if (rest.length === 0) return 'overview';
  if (rest[0] === 'forms') return 'forms';
  if (rest[0] === 'panels') return 'panels';
  if (rest[0] === 'tickets') {
    if (rest.length === 1) return 'tickets';
    const sub = rest[1]!;
    // /tickets/<ticketId> is a ticket detail: it lives under "Ticket".
    return TICKET_SUBPAGES.has(sub) ? sub : 'manage';
  }
  return '';
}

/**
 * App shell for every /dashboard/[guildId]/** page: sidebar with brand, guild,
 * section navigation, user, super-console link and logout. Pages render their
 * own content (and their own auth handling) inside `.workspace`.
 */
export default function GuildShell({ children }: { children: ReactNode }) {
  const params = useParams<{ guildId: string }>();
  const pathname = usePathname() ?? '';
  const guildId = typeof params?.guildId === 'string' ? params.guildId : '';
  const validGuild = SNOWFLAKE.test(guildId);

  const [me, setMe] = useState<Me | null>(null);
  const [guild, setGuild] = useState<DashboardGuild | null>(null);

  useEffect(() => {
    if (!validGuild) return;
    let cancelled = false;
    const run = async () => {
      try {
        const [meResponse, guildsResponse] = await Promise.all([
          fetch('/backend/api/me', { credentials: 'same-origin' }),
          fetch('/backend/api/guilds', { credentials: 'same-origin' })
        ]);
        if (cancelled) return;
        if (meResponse.ok) setMe(await meResponse.json() as Me);
        if (guildsResponse.ok) {
          const rows = await guildsResponse.json() as DashboardGuild[];
          if (!cancelled) setGuild(rows.find((row) => row.guildId === guildId) ?? null);
        }
      } catch {
        // Chrome is best effort; the page itself reports load errors.
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [guildId, validGuild]);

  const items = validGuild ? navItems(guildId) : [];
  const current = activeKey(pathname, guildId);
  const name = guild?.guildName ?? 'Server';
  const icon = guild ? guildIconUrl(guild.guildId, guild.oauth?.icon) : null;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand href="/it" className="sidebar-brand" />
        <a className="sidebar-back" href="/dashboard"><Icon name="arrowLeft" size={14} />Tutti i server</a>

        <div className="sidebar-guild">
          {icon ? <img src={icon} alt="" /> : <div className="guild-placeholder">{initial(name)}</div>}
          <div>
            <strong title={name}>{name}</strong>
            <span className="mono muted">{validGuild ? guildId : ''}</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Sezioni del server">
          {items.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className={current === item.key ? 'active' : undefined}
              aria-current={current === item.key ? 'page' : undefined}
            >
              <Icon name={item.icon} size={17} />{item.label}
            </a>
          ))}
        </nav>

        <div className="sidebar-foot">
          {guild?.access && (
            <div className="sidebar-access"><span>Il tuo accesso</span><strong className="mono">{accessLabel[guild.access]}</strong></div>
          )}
          {me && (
            <div className="sidebar-user">
              {me.avatarUrl ? <img src={me.avatarUrl} alt="" /> : <div className="avatar-fallback">{initial(me.username)}</div>}
              <strong title={me.username}>{me.username}</strong>
            </div>
          )}
          <div className="sidebar-links">
            {me?.superAdmin && (
              <a className="button button-sm button-secondary" href="/super"><Icon name="terminal" size={14} />Super console</a>
            )}
            {me && (
              <button type="button" className="button button-sm button-ghost" onClick={() => void logout()}>
                <Icon name="logout" size={14} />Esci
              </button>
            )}
          </div>
        </div>
      </aside>

      <div className="workspace">{children}</div>
    </div>
  );
}
