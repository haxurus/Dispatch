'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { Brand, Icon, type IconName } from './Brand';
import { LocaleToggle, useCopy, useLocale } from './locale-context';
import { format, type Locale } from '../i18n';
import { PLAN_NAMES, usePlan } from './plan-client';
import {
  SNOWFLAKE,
  accessLabel,
  guildIconUrl,
  initial,
  logout,
  type DashboardGuild,
  type Me
} from './session';

type NavKey = 'overview' | 'manage' | 'tickets' | 'system' | 'panels' | 'forms' | 'analytics' | 'security';
type NavItem = { key: NavKey; href: string; icon: IconName };

const TICKET_SUBPAGES = new Set(['manage', 'analytics', 'security', 'system']);

const it = {
  nav: {
    overview: 'Panoramica',
    manage: 'Ticket',
    tickets: 'Configurazione ticket',
    system: 'Sistema e menu',
    panels: 'Pannelli',
    forms: 'Form',
    analytics: 'Analytics',
    security: 'Blacklist'
  } as Record<NavKey, string>,
  allServers: 'Tutti i server',
  sections: 'Sezioni del server',
  yourAccess: 'Il tuo accesso',
  logout: 'Esci',
  plan: 'Piano {plan}'
};

const en: typeof it = {
  nav: {
    overview: 'Overview',
    manage: 'Tickets',
    tickets: 'Ticket setup',
    system: 'System and menu',
    panels: 'Panels',
    forms: 'Forms',
    analytics: 'Analytics',
    security: 'Blacklist'
  },
  allServers: 'All servers',
  sections: 'Server sections',
  yourAccess: 'Your access',
  logout: 'Log out',
  plan: '{plan} plan'
};

const copy: Record<Locale, typeof it> = { it, en };

function navItems(guildId: string): NavItem[] {
  const base = `/dashboard/${guildId}`;
  return [
    { key: 'overview', href: base, icon: 'grid' },
    { key: 'manage', href: `${base}/tickets/manage`, icon: 'inbox' },
    { key: 'tickets', href: `${base}/tickets`, icon: 'ticket' },
    { key: 'system', href: `${base}/tickets/system`, icon: 'sliders' },
    { key: 'panels', href: `${base}/panels`, icon: 'panel' },
    { key: 'forms', href: `${base}/forms`, icon: 'clipboard' },
    { key: 'analytics', href: `${base}/tickets/analytics`, icon: 'chart' },
    { key: 'security', href: `${base}/tickets/security`, icon: 'ban' }
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
  const locale = useLocale();
  const c = useCopy(copy);
  const guildId = typeof params?.guildId === 'string' ? params.guildId : '';
  const validGuild = SNOWFLAKE.test(guildId);

  const [me, setMe] = useState<Me | null>(null);
  const [guild, setGuild] = useState<DashboardGuild | null>(null);
  // Best effort: the sidebar simply omits the plan when it cannot be loaded.
  const { plan } = usePlan(validGuild ? guildId : null);

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
        <Brand href={`/${locale}`} className="sidebar-brand" />
        <a className="sidebar-back" href="/dashboard"><Icon name="arrowLeft" size={14} />{c.allServers}</a>

        <div className="sidebar-guild">
          {icon ? <img src={icon} alt="" /> : <div className="guild-placeholder">{initial(name)}</div>}
          <div>
            <strong title={name}>{name}</strong>
            <span className="mono muted">{validGuild ? guildId : ''}</span>
            {plan && (
              <a className="sidebar-plan" href={`/dashboard/${guildId}`}>
                {format(c.plan, { plan: PLAN_NAMES[plan.effectiveTier] })}
              </a>
            )}
          </div>
        </div>

        <nav className="sidebar-nav" aria-label={c.sections}>
          {items.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className={current === item.key ? 'active' : undefined}
              aria-current={current === item.key ? 'page' : undefined}
            >
              <Icon name={item.icon} size={17} />{c.nav[item.key]}
            </a>
          ))}
        </nav>

        <div className="sidebar-foot">
          {guild?.access && (
            <div className="sidebar-access"><span>{c.yourAccess}</span><strong className="mono">{accessLabel[guild.access]}</strong></div>
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
                <Icon name="logout" size={14} />{c.logout}
              </button>
            )}
            <LocaleToggle />
          </div>
        </div>
      </aside>

      <div className="workspace">{children}</div>
    </div>
  );
}
