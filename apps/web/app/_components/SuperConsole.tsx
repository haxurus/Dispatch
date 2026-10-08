'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from './Brand';
import { SiteHeader } from './SiteChrome';
import { SNOWFLAKE, initial, logout } from './session';
import { format, loginHref, superCopy, type Locale } from '../i18n';

type BlockKind = 'USER' | 'GUILD';

type Guild = {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number;
  ownerId: string;
  joinedAt: string | null;
  installedAt: string | null;
  openTickets: number;
  totalTickets: number;
  blocked: boolean;
};

type Block = {
  id: string;
  kind: BlockKind;
  subjectId: string;
  reason: string | null;
  createdByUserId: string;
  createdAt: string;
};

type Audit = {
  id: string;
  username: string;
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: string;
};

type BotStatus = {
  ready: boolean;
  uptimeMs: number | null;
  readyAt: string | null;
  guildCount: number;
  pingMs: number | null;
  user: { id: string; username: string; avatarUrl: string | null } | null;
};

type Overview = {
  bot: { reachable: boolean; status: BotStatus | null };
  metrics: {
    connectedGuilds: number;
    openTickets: number;
    ticketsLast7Days: number;
    forms: number;
    guildBlacklistEntries: number;
    installBlocks: number;
  };
  guilds: Guild[];
  blocks: Block[];
  audit: Audit[];
};

class ApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    throw new ApiError(typeof body.error === 'string' ? body.error : `HTTP_${response.status}`, response.status);
  }
  return response.json() as Promise<T>;
}

const jsonInit = (method: 'PUT' | 'POST', body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

function formatUptime(ms: number | null) {
  if (ms === null || ms < 0) return '—';
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}g ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function SuperConsole({ locale }: { locale: Locale }) {
  const c = superCopy[locale];
  const intl = locale === 'it' ? 'it-IT' : 'en-US';

  const [data, setData] = useState<Overview | null>(null);
  const [denied, setDenied] = useState<'' | 'signed-out' | 'forbidden'>('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState('');
  const [userReason, setUserReason] = useState('');
  const [guildId, setGuildId] = useState('');
  const [guildReason, setGuildReason] = useState('');

  const load = useCallback(async () => {
    try {
      const overview = await api<Overview>('/backend/api/super/overview');
      setData(overview);
      setDenied('');
      setError('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setDenied('signed-out');
      else if (err instanceof ApiError && err.status === 403) setDenied('forbidden');
      else setError(c.failed);
    }
  }, [c.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  const messageFor = (err: unknown) => {
    const code = err instanceof ApiError ? err.code : '';
    switch (code) {
      case 'RATE_LIMITED': return c.rateLimited;
      case 'BOT_UNAVAILABLE': return c.botUnavailable;
      case 'CANNOT_BLOCK_SUPER_ADMIN': return c.cannotBlockSelf;
      case 'GUILD_NOT_CONNECTED': return c.notConnected;
      case 'INVALID_BLOCK_REQUEST':
      case 'INVALID_DISCORD_ID': return c.invalidId;
      default: return c.failed;
    }
  };

  /** Runs a mutation, then reloads. Returns false when it failed. */
  const mutate = async (run: () => Promise<string | null>) => {
    setBusy(true);
    setStatus('');
    setError('');
    try {
      const message = await run();
      await load();
      setStatus(message ?? c.refreshed);
      return true;
    } catch (err) {
      setError(messageFor(err));
      if (err instanceof ApiError && err.code === 'GUILD_NOT_CONNECTED') await load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const putBlock = (kind: BlockKind, id: string, reason: string) =>
    api<{ ok: true; left: boolean; leaveError: string | null }>(
      `/backend/api/super/blocks/${kind}/${id}`,
      jsonInit('PUT', { reason: reason.trim() || null })
    ).then((result) => (kind === 'GUILD' && result.leaveError ? c.blockedNotLeft : null));

  const submitBlock = async (event: FormEvent<HTMLFormElement>, kind: BlockKind) => {
    event.preventDefault();
    const id = (kind === 'USER' ? userId : guildId).trim();
    const reason = kind === 'USER' ? userReason : guildReason;
    if (!SNOWFLAKE.test(id)) {
      setStatus('');
      setError(c.invalidId);
      return;
    }
    if (reason.length > 500) return;
    const ok = await mutate(() => putBlock(kind, id, reason));
    if (!ok) return;
    if (kind === 'USER') { setUserId(''); setUserReason(''); }
    else { setGuildId(''); setGuildReason(''); }
  };

  const leave = (guild: Guild) => {
    if (!window.confirm(format(c.guilds.confirmLeave, { name: guild.name }))) return;
    void mutate(async () => {
      await api(`/backend/api/super/guilds/${guild.id}/leave`, jsonInit('POST', {}));
      return null;
    });
  };

  const blockGuild = (guild: Guild) => {
    if (!window.confirm(format(c.guilds.confirmBlock, { name: guild.name }))) return;
    void mutate(() => putBlock('GUILD', guild.id, c.guilds.blockReason));
  };

  const unblock = (block: Block) => {
    const kind = block.kind === 'USER' ? c.blacklist.user : c.blacklist.guild;
    if (!window.confirm(format(c.blacklist.confirmUnblock, { kind: kind.toLowerCase(), id: block.subjectId }))) return;
    void mutate(async () => {
      await api(`/backend/api/super/blocks/${block.kind}/${block.subjectId}`, { method: 'DELETE' });
      return null;
    });
  };

  const fmtDate = (value: string | null, withTime = true) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(intl, withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
  };
  const num = (value: number) => value.toLocaleString(intl);

  const bot = data?.bot.status ?? null;
  const botState = !data ? null : !data.bot.reachable || !bot ? 'offline' : bot.ready ? 'ready' : 'notReady';

  return (
    <main className="public-site super-console" lang={locale}>
      <SiteHeader
        locale={locale}
        homeHref={`/${locale}`}
        links={[
          { href: '/dashboard', label: 'Dashboard' },
          { href: '/super', label: 'Super console', current: true }
        ]}
        actions={<button type="button" className="button button-ghost" onClick={() => void logout()}><Icon name="logout" size={15} />Esci</button>}
      />

      <section className="page">
        <div className="site-container">
          <div className="page-head">
            <div>
              <span className="kicker kicker-danger">{c.kicker}</span>
              <h1>{c.title}</h1>
              <p>{c.intro}</p>
            </div>
            {data && (
              <div className="page-head-actions">
                <button type="button" className="button button-secondary" onClick={() => void mutate(async () => null)} disabled={busy}>
                  <Icon name="refresh" size={15} />{c.refresh}
                </button>
              </div>
            )}
          </div>

          {status && <div className="notice notice-ok" role="status">{status}</div>}
          {error && <div className="notice notice-error" role="alert">{error}</div>}
          {denied === 'forbidden' && <div className="notice notice-error">{c.denied}</div>}
          {denied === 'signed-out' && (
            <div className="card card-feature">
              <span className="kicker">{c.kicker}</span>
              <h2>{c.signedOut}</h2>
              <a className="button button-primary button-lg" href={loginHref}>Accedi con Discord<Icon name="arrowRight" size={16} /></a>
            </div>
          )}
          {!data && !denied && !error && <div className="card skeleton-card"><h2>{c.loading}</h2></div>}

          {data && <>
            <div className="metric-row">
              <div className="metric"><span>{c.metrics.servers}</span><strong>{num(data.metrics.connectedGuilds)}</strong></div>
              <div className="metric"><span>{c.metrics.openTickets}</span><strong>{num(data.metrics.openTickets)}</strong></div>
              <div className="metric"><span>{c.metrics.lastWeek}</span><strong>{num(data.metrics.ticketsLast7Days)}</strong></div>
              <div className="metric"><span>{c.metrics.forms}</span><strong>{num(data.metrics.forms)}</strong></div>
              <div className={`metric ${data.metrics.installBlocks ? 'metric-danger' : ''}`}>
                <span>{c.metrics.blocks}</span>
                <strong>{num(data.metrics.installBlocks)}<small>· {num(data.metrics.guildBlacklistEntries)} {c.metrics.guildBlacklist}</small></strong>
              </div>
              <div className={`metric ${botState === 'ready' ? 'metric-ok' : botState === 'notReady' ? 'metric-warn' : 'metric-danger'}`}>
                <span>{c.metrics.bot}</span>
                <strong>{botState === 'ready' ? c.metrics.ready : botState === 'notReady' ? c.metrics.notReady : c.metrics.offline}</strong>
              </div>
            </div>

            <div className="bot-status">
              {bot?.user?.avatarUrl ? <img src={bot.user.avatarUrl} alt="" /> : <div className="avatar-fallback">{initial(bot?.user?.username ?? 'D')}</div>}
              <strong>{bot?.user?.username ?? 'Dispatch'}</strong>
              <span className={`state ${botState === 'ready' ? 'state-ok' : botState === 'notReady' ? 'state-warn' : 'state-danger'}`}>
                {botState === 'ready' ? c.metrics.ready : botState === 'notReady' ? c.metrics.notReady : c.metrics.offline}
              </span>
              {bot && <>
                <span>{c.bot.uptime}: <span className="mono">{formatUptime(bot.uptimeMs)}</span></span>
                <span>{c.bot.ping}: <span className="mono">{bot.pingMs ?? '—'}{bot.pingMs !== null ? ' ms' : ''}</span></span>
                <span className="mono">{num(bot.guildCount)} {c.bot.servers}</span>
              </>}
              {!data.bot.reachable && <span>{c.bot.unreachable}</span>}
            </div>

            <section className="card">
              <div className="card-head">
                <div><span className="kicker">{c.guilds.kicker}</span><h2>{c.guilds.title}</h2><p>{c.guilds.text}</p></div>
              </div>
              {!data.guilds.length && <div className="empty">{c.guilds.empty}</div>}
              <div className="table-list">
                {data.guilds.map((guild) => (
                  <article className="super-guild" key={guild.id}>
                    <div className="super-guild-identity">
                      {guild.iconUrl ? <img src={guild.iconUrl} alt="" /> : <div className="guild-placeholder">{initial(guild.name)}</div>}
                      <div><strong title={guild.name}>{guild.name}</strong><span className="mono">{guild.id}</span></div>
                    </div>
                    <div className="super-guild-meta">
                      <span>{c.guilds.owner}: <span className="mono">{guild.ownerId}</span></span>
                      <span>{num(guild.memberCount)} {c.guilds.members} · {c.guilds.installed} {fmtDate(guild.installedAt, false)}</span>
                    </div>
                    <div className="super-guild-stats">
                      <span className={guild.openTickets ? 'tag tag-accent' : 'tag'}>{num(guild.openTickets)} {c.guilds.open}</span>
                      <span className="tag">{num(guild.totalTickets)} {c.guilds.total}</span>
                      {guild.blocked && <span className="tag tag-danger">{c.guilds.blocked}</span>}
                    </div>
                    <div className="super-guild-actions">
                      <button type="button" className="button button-sm button-secondary" disabled={busy} onClick={() => leave(guild)}>{c.guilds.leave}</button>
                      <button type="button" className="button button-sm button-danger" disabled={busy} onClick={() => blockGuild(guild)}>{c.guilds.blockLeave}</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <div><span className="kicker">{c.blacklist.kicker}</span><h2>{c.blacklist.title}</h2><p>{c.blacklist.text}</p></div>
              </div>

              <div className="block-forms">
                <form onSubmit={(event) => void submitBlock(event, 'USER')}>
                  <label>{c.blacklist.userId}
                    <input value={userId} onChange={(event) => setUserId(event.target.value.trim())} inputMode="numeric" pattern="\d{17,20}" placeholder="123456789012345678" autoComplete="off" required />
                  </label>
                  <label>{c.blacklist.reason}
                    <input value={userReason} onChange={(event) => setUserReason(event.target.value)} maxLength={500} autoComplete="off" />
                  </label>
                  <button type="submit" className="button button-secondary" disabled={busy}>{c.blacklist.blockUser}</button>
                </form>
                <form onSubmit={(event) => void submitBlock(event, 'GUILD')}>
                  <label>{c.blacklist.guildId}
                    <input value={guildId} onChange={(event) => setGuildId(event.target.value.trim())} inputMode="numeric" pattern="\d{17,20}" placeholder="123456789012345678" autoComplete="off" required />
                  </label>
                  <label>{c.blacklist.reason}
                    <input value={guildReason} onChange={(event) => setGuildReason(event.target.value)} maxLength={500} autoComplete="off" />
                  </label>
                  <button type="submit" className="button button-danger" disabled={busy}>{c.blacklist.blockGuild}</button>
                </form>
              </div>

              {!data.blocks.length && <div className="empty">{c.blacklist.empty}</div>}
              <div className="table-list">
                {data.blocks.map((block) => (
                  <div className="block-row" key={block.id}>
                    <div>
                      <strong>{block.kind === 'USER' ? c.blacklist.user : c.blacklist.guild} · <span className="mono">{block.subjectId}</span></strong>
                      <span>{block.reason || '—'} · {fmtDate(block.createdAt)}</span>
                    </div>
                    <span className="tag tag-danger">{c.blacklist.blocked}</span>
                    <button type="button" className="button button-sm button-secondary" disabled={busy} onClick={() => unblock(block)}>{c.blacklist.unblock}</button>
                  </div>
                ))}
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <div><span className="kicker">{c.audit.kicker}</span><h2>{c.audit.title}</h2><p>{c.audit.text}</p></div>
              </div>
              {!data.audit.length && <div className="empty">{c.audit.empty}</div>}
              <div className="log-table">
                {data.audit.map((item) => (
                  <div className="log-row" key={item.id}>
                    <strong className="mono">{item.action}</strong>
                    <span>{item.subjectType ? <>{item.subjectType} · <span className="mono">{item.subjectId}</span></> : '—'}</span>
                    <span>{item.username}</span>
                    <time className="mono" dateTime={item.createdAt}>{fmtDate(item.createdAt)}</time>
                  </div>
                ))}
              </div>
            </section>
          </>}
        </div>
      </section>
    </main>
  );
}
