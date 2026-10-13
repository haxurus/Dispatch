'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from './Brand';
import { SiteHeader } from './SiteChrome';
import { SNOWFLAKE, initial, logout } from './session';
import { chromeCopy, format, loginHref, superCopy, type Locale, type SuperCopy } from '../i18n';
import { LocaleToggle } from './locale-context';

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

type StatusChannel = { guildId: string; channelId: string; updatedAt: string } | null;
type ChannelOption = { id: string; name: string; type: number };

/* Plans: local mirror of the @dispatch/shared shapes (the web app does not depend on it). */
type PlanTier = 'FREE' | 'TIER1' | 'TIER2' | 'TIER3';
type PaidTier = Exclude<PlanTier, 'FREE'>;
type Billing = 'MONTHLY' | 'YEARLY' | 'GIFT';
type CouponBilling = 'ANY' | 'MONTHLY' | 'YEARLY';

const PLAN_TIERS: readonly PlanTier[] = ['FREE', 'TIER1', 'TIER2', 'TIER3'];
const PAID_TIERS: readonly PaidTier[] = ['TIER1', 'TIER2', 'TIER3'];
const BILLINGS: readonly Billing[] = ['MONTHLY', 'YEARLY', 'GIFT'];
const FALLBACK_TIER_NAMES: Record<PlanTier, string> = { FREE: 'Free', TIER1: 'Plus', TIER2: 'Pro', TIER3: 'Brand' };
const COUPON_CODE = /^[A-Za-z0-9_-]{3,32}$/;

const isPlanTier = (value: unknown): value is PlanTier =>
  typeof value === 'string' && (PLAN_TIERS as readonly string[]).includes(value);
const isBilling = (value: unknown): value is Billing =>
  typeof value === 'string' && (BILLINGS as readonly string[]).includes(value);
const isCouponBilling = (value: unknown): value is CouponBilling =>
  value === 'ANY' || value === 'MONTHLY' || value === 'YEARLY';

type Coupon = {
  id: string;
  code: string;
  description: string | null;
  percentOff: number | null;
  amountOffCents: number | null;
  tiers: string[];
  billing: string;
  maxRedemptions: number | null;
  redemptions: number;
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
  public: boolean;
};

type GuildPlanRow = {
  guildId: string;
  planTier: string;
  planBilling: string | null;
  planExpiresAt: string | null;
  planCouponCode: string | null;
  planNote: string | null;
  planUpdatedAt: string | null;
};

type PlanCatalogEntry = { tier: PlanTier; name: string; level: number; monthlyCents: number; yearlyCents: number };
type MultiDiscount = { minSubscriptions: number; percentOff: number };
type ContactConfig = { contactEmail: string | null; contactDiscord: string | null; contactUrl: string | null };

type PlansOverview = {
  config: ContactConfig;
  coupons: Coupon[];
  plans: GuildPlanRow[];
  planCatalog: PlanCatalogEntry[];
  multiSubscriptionDiscounts: MultiDiscount[];
};

/** A server's stored plan, normalised; an expired plan behaves as Free. */
type GuildPlan = {
  tier: PlanTier;
  effective: PlanTier;
  billing: Billing | null;
  expiresAt: string | null;
  expired: boolean;
  couponCode: string | null;
  note: string | null;
  updatedAt: string | null;
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
  statusChannel: StatusChannel;
  /** null when the plan tables are missing (installer not re-run on the VPS). */
  plans?: PlansOverview | null;
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

function formatUptime(ms: number | null, locale: Locale) {
  if (ms === null || ms < 0) return '—';
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}${locale === 'it' ? 'g' : 'd'} ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/* ------------------------------------------------------------ plan helpers */

function formatPrice(cents: number, locale: Locale) {
  return new Intl.NumberFormat(locale === 'it' ? 'it-IT' : 'en-IE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2
  }).format(cents / 100);
}

const planName = (plans: PlansOverview, tier: string) =>
  plans.planCatalog.find((entry) => entry.tier === tier)?.name ?? (isPlanTier(tier) ? FALLBACK_TIER_NAMES[tier] : tier);

function toGuildPlan(row: GuildPlanRow | undefined, now: number): GuildPlan {
  const tier: PlanTier = row && isPlanTier(row.planTier) ? row.planTier : 'FREE';
  const expiresAt = row?.planExpiresAt ?? null;
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : NaN;
  const expired = tier !== 'FREE' && !Number.isNaN(expiresMs) && expiresMs <= now;
  return {
    tier,
    effective: expired ? 'FREE' : tier,
    billing: row && isBilling(row.planBilling) ? row.planBilling : null,
    expiresAt,
    expired,
    couponCode: row?.planCouponCode ?? null,
    note: row?.planNote ?? null,
    updatedAt: row?.planUpdatedAt ?? null
  };
}

/** Catalogue price for a tier and billing period (gifts and Free cost nothing). */
function basePriceCents(plans: PlansOverview, tier: PlanTier, billing: Billing | null) {
  const entry = plans.planCatalog.find((item) => item.tier === tier);
  if (!entry || tier === 'FREE') return 0;
  if (billing === 'YEARLY') return entry.yearlyCents;
  if (billing === 'MONTHLY') return entry.monthlyCents;
  return 0;
}

/** Price after a coupon, never below zero. */
function discountedPriceCents(price: number, coupon: Coupon | undefined) {
  if (!coupon) return price;
  let result = price;
  if (coupon.percentOff) result = Math.round(result * (100 - coupon.percentOff) / 100);
  if (coupon.amountOffCents) result -= coupon.amountOffCents;
  return Math.max(0, result);
}

const findCoupon = (plans: PlansOverview, code: string | null) => {
  const normalized = code?.trim().toUpperCase();
  return normalized ? plans.coupons.find((coupon) => coupon.code === normalized) : undefined;
};

function multiPercent(discounts: MultiDiscount[], subscriptions: number) {
  return [...discounts]
    .sort((a, b) => b.minSubscriptions - a.minSubscriptions)
    .find((discount) => subscriptions >= discount.minSubscriptions)?.percentOff ?? 0;
}

/** Mirror of couponProblem in @dispatch/shared: why a coupon cannot apply, or null. */
function couponProblem(coupon: Coupon, tier: PlanTier, billing: Billing | null, now = Date.now()) {
  if (!coupon.active) return 'COUPON_INACTIVE';
  if (coupon.validFrom && new Date(coupon.validFrom).getTime() > now) return 'COUPON_NOT_STARTED';
  if (coupon.validUntil && new Date(coupon.validUntil).getTime() < now) return 'COUPON_EXPIRED';
  if (coupon.maxRedemptions !== null && coupon.redemptions >= coupon.maxRedemptions) return 'COUPON_EXHAUSTED';
  if (tier === 'FREE') return 'COUPON_FREE_PLAN';
  if (coupon.tiers.length && !coupon.tiers.includes(tier)) return 'COUPON_WRONG_TIER';
  if (coupon.billing !== 'ANY' && coupon.billing !== billing) return 'COUPON_WRONG_BILLING';
  return null;
}

/** A billed (not gifted) plan in force: counts for revenue and the multi-server discount. */
const isBilledPlan = (plan: GuildPlan) =>
  plan.effective !== 'FREE' && (plan.billing === 'MONTHLY' || plan.billing === 'YEARLY');

function summarizePlans(guilds: Guild[], plans: PlansOverview) {
  const now = Date.now();
  const rows = new Map(plans.plans.map((row) => [row.guildId, row]));
  const byGuild = new Map<string, GuildPlan>();
  const ownerPaid = new Map<string, number>();
  const counts: Record<PlanTier, number> = { FREE: 0, TIER1: 0, TIER2: 0, TIER3: 0 };
  let expired = 0;
  let revenueCents = 0;

  for (const guild of guilds) {
    const plan = toGuildPlan(rows.get(guild.id), now);
    byGuild.set(guild.id, plan);
    counts[plan.effective] += 1;
    if (plan.expired) expired += 1;
    if (isBilledPlan(plan)) {
      ownerPaid.set(guild.ownerId, (ownerPaid.get(guild.ownerId) ?? 0) + 1);
      const price = discountedPriceCents(basePriceCents(plans, plan.tier, plan.billing), findCoupon(plans, plan.couponCode));
      revenueCents += plan.billing === 'YEARLY' ? price / 12 : price;
    }
  }
  return { byGuild, ownerPaid, counts, expired, revenueCents: Math.round(revenueCents) };
}

/** yyyy-mm-dd in the browser's time zone, for date inputs. */
function toDateInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Start or end of a chosen day in the browser's time zone, as ISO; null when empty or invalid. */
function fromDateInput(value: string, end: boolean) {
  if (!value) return null;
  const date = new Date(`${value}T${end ? '23:59:59' : '00:00:00'}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
  const [editingPlan, setEditingPlan] = useState<string | null>(null);

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
      case 'CHANNEL_NOT_FOUND': return c.status.channelMissing;
      default: return c.plans.errors[code] ?? c.failed;
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
  const plans = data?.plans ?? null;
  const planSummary = data && plans ? summarizePlans(data.guilds, plans) : null;
  const multiTiers = plans
    ? [...plans.multiSubscriptionDiscounts]
      .sort((a, b) => a.minSubscriptions - b.minSubscriptions)
      .map((discount) => format(c.plans.multiTier, { count: discount.minSubscriptions, percent: discount.percentOff }))
      .join(' · ')
    : '';

  return (
    <main className="public-site super-console" lang={locale}>
      <SiteHeader
        locale={locale}
        homeHref={`/${locale}`}
        links={[
          { href: '/dashboard', label: chromeCopy[locale].dashboard },
          { href: '/super', label: chromeCopy[locale].superConsole, current: true }
        ]}
        actions={<>
          <LocaleToggle />
          <button type="button" className="button button-ghost" onClick={() => void logout()}><Icon name="logout" size={15} />{chromeCopy[locale].logout}</button>
        </>}
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
              <a className="button button-primary button-lg" href={loginHref}>{chromeCopy[locale].signInDiscord}<Icon name="arrowRight" size={16} /></a>
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

            {plans && planSummary && (
              <div className="metric-row plan-metrics">
                {PLAN_TIERS.map((tier) => (
                  <div className={`metric ${tier !== 'FREE' && planSummary.counts[tier] ? 'metric-ok' : ''}`} key={tier}>
                    <span>{planName(plans, tier)} · {c.plans.metrics.servers}</span>
                    <strong>
                      {num(planSummary.counts[tier])}
                      {tier === 'FREE' && planSummary.expired > 0 && <small>· {num(planSummary.expired)} {c.plans.metrics.expired}</small>}
                    </strong>
                  </div>
                ))}
                <div className="metric">
                  <span>{c.plans.metrics.revenue}</span>
                  <strong>{formatPrice(planSummary.revenueCents, locale)}<small>{c.plans.metrics.revenueHint}</small></strong>
                </div>
              </div>
            )}

            <div className="bot-status">
              {bot?.user?.avatarUrl ? <img src={bot.user.avatarUrl} alt="" /> : <div className="avatar-fallback">{initial(bot?.user?.username ?? 'D')}</div>}
              <strong>{bot?.user?.username ?? 'Dispatch'}</strong>
              <span className={`state ${botState === 'ready' ? 'state-ok' : botState === 'notReady' ? 'state-warn' : 'state-danger'}`}>
                {botState === 'ready' ? c.metrics.ready : botState === 'notReady' ? c.metrics.notReady : c.metrics.offline}
              </span>
              {bot && <>
                <span>{c.bot.uptime}: <span className="mono">{formatUptime(bot.uptimeMs, locale)}</span></span>
                <span>{c.bot.ping}: <span className="mono">{bot.pingMs ?? '—'}{bot.pingMs !== null ? ' ms' : ''}</span></span>
                <span className="mono">{num(bot.guildCount)} {c.bot.servers}</span>
              </>}
              {!data.bot.reachable && <span>{c.bot.unreachable}</span>}
            </div>

            <section className="card">
              <div className="card-head">
                <div>
                  <span className="kicker">{c.guilds.kicker}</span><h2>{c.guilds.title}</h2><p>{c.guilds.text}</p>
                  {multiTiers && <p className="plan-hint">{format(c.plans.multiTiers, { tiers: multiTiers })}</p>}
                </div>
              </div>
              {!data.guilds.length && <div className="empty">{c.guilds.empty}</div>}
              <div className="table-list">
                {data.guilds.map((guild) => {
                  const plan = planSummary?.byGuild.get(guild.id) ?? null;
                  return (
                    <article className="super-guild-block" key={guild.id}>
                      <div className="super-guild">
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
                      </div>
                      {plans && plan && (
                        <GuildPlanStrip
                          c={c}
                          locale={locale}
                          plans={plans}
                          plan={plan}
                          ownerPaid={planSummary?.ownerPaid.get(guild.ownerId) ?? 0}
                          editing={editingPlan === guild.id}
                          fmtDate={fmtDate}
                          onToggle={() => setEditingPlan(editingPlan === guild.id ? null : guild.id)}
                        />
                      )}
                      {plans && plan && editingPlan === guild.id && (
                        <PlanEditor
                          key={`${guild.id}-${plan.updatedAt ?? ''}`}
                          c={c}
                          locale={locale}
                          guild={guild}
                          plans={plans}
                          plan={plan}
                          ownerPaid={planSummary?.ownerPaid.get(guild.ownerId) ?? 0}
                          busy={busy}
                          mutate={mutate}
                          onDone={() => setEditingPlan(null)}
                        />
                      )}
                    </article>
                  );
                })}
              </div>
            </section>

            {plans ? <>
              <CouponsCard c={c} locale={locale} plans={plans} busy={busy} mutate={mutate} fmtDate={fmtDate} />
              <ContactsCard c={c} config={plans.config} busy={busy} mutate={mutate} />
            </> : <div className="notice notice-warn" role="status">{c.plans.unavailable}</div>}

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

            <StatusChannelCard
              c={c}
              guilds={data.guilds}
              current={data.statusChannel}
              busy={busy}
              mutate={mutate}
              onTestResult={(ok, text) => { setError(ok ? '' : text); setStatus(ok ? text : ''); }}
            />

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

/* --------------------------------------------------------- status channel */

function StatusChannelCard({ c, guilds, current, busy, mutate, onTestResult }: {
  c: SuperCopy;
  guilds: Guild[];
  current: StatusChannel;
  busy: boolean;
  mutate: (run: () => Promise<string | null>) => Promise<boolean>;
  onTestResult: (ok: boolean, text: string) => void;
}) {
  const [guildId, setGuildId] = useState(current?.guildId ?? '');
  const [channelId, setChannelId] = useState(current?.channelId ?? '');
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setChannels([]);
    if (!SNOWFLAKE.test(guildId)) return;
    let cancelled = false;
    setLoading(true);
    api<ChannelOption[]>(`/backend/api/super/status-channel/channels?guildId=${guildId}`)
      .then((list) => { if (!cancelled) setChannels(list); })
      .catch(() => { if (!cancelled) setChannels([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [guildId]);

  const currentGuild = guilds.find((guild) => guild.id === current?.guildId);
  const save = () => void mutate(async () => {
    await api('/backend/api/super/status-channel', jsonInit('PUT', { guildId, channelId }));
    return c.status.saved;
  });
  const remove = () => void mutate(async () => {
    await api('/backend/api/super/status-channel', { method: 'DELETE' });
    return c.status.removed;
  });
  const test = async () => {
    try {
      const result = await api<{ ok: boolean; error?: string }>('/backend/api/super/status-channel/test', jsonInit('POST', {}));
      onTestResult(result.ok, result.ok ? c.status.testOk : `${c.status.testFailed}: ${c.status.errors[result.error ?? ''] ?? result.error ?? ''}`);
    } catch (err) {
      onTestResult(false, `${c.status.testFailed}: ${err instanceof ApiError ? err.code : ''}`);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <div><span className="kicker">{c.status.kicker}</span><h2>{c.status.title}</h2><p>{c.status.text}</p></div>
      </div>
      <p className="muted">
        {current
          ? <>{c.status.current}: <strong>{currentGuild?.name ?? current.guildId}</strong> · <span className="mono">#{current.channelId}</span></>
          : c.status.notSet}
      </p>
      <div className="block-forms status-forms">
        <form onSubmit={(event) => { event.preventDefault(); save(); }}>
          <label>{c.status.guild}
            <select value={guildId} onChange={(event) => { setGuildId(event.target.value); setChannelId(''); }} required>
              <option value="">{c.status.chooseGuild}</option>
              {guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
            </select>
          </label>
          <label>{c.status.channel}
            <select value={channelId} onChange={(event) => setChannelId(event.target.value)} required disabled={!channels.length}>
              <option value="">{loading ? c.loading : c.status.chooseChannel}</option>
              {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
            </select>
          </label>
          <div className="button-row">
            <button type="submit" className="button button-primary" disabled={busy || !guildId || !channelId}>{c.status.save}</button>
            <button type="button" className="button button-secondary" disabled={busy || !current} onClick={() => void test()}>{c.status.test}</button>
            <button type="button" className="button button-ghost" disabled={busy || !current} onClick={remove}>{c.status.remove}</button>
          </div>
        </form>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- plans */

type Mutate = (run: () => Promise<string | null>) => Promise<boolean>;
type FmtDate = (value: string | null, withTime?: boolean) => string;

function PriceText({ c, locale, base, final, billing }: {
  c: SuperCopy;
  locale: Locale;
  base: number;
  final: number;
  billing: Billing | null;
}) {
  if (billing === 'GIFT') return <span className="plan-price">{c.plans.price}: {c.plans.gift}</span>;
  if (billing === null) return null;
  return (
    <span className="plan-price">
      {c.plans.price}:{' '}
      {final !== base && <><s>{formatPrice(base, locale)}</s>{' '}</>}
      <strong>{formatPrice(final, locale)}</strong>{billing === 'YEARLY' ? c.plans.perYear : c.plans.perMonth}
    </span>
  );
}

function GuildPlanStrip({ c, locale, plans, plan, ownerPaid, editing, fmtDate, onToggle }: {
  c: SuperCopy;
  locale: Locale;
  plans: PlansOverview;
  plan: GuildPlan;
  ownerPaid: number;
  editing: boolean;
  fmtDate: FmtDate;
  onToggle: () => void;
}) {
  const paid = plan.tier !== 'FREE';
  const coupon = findCoupon(plans, plan.couponCode);
  const base = basePriceCents(plans, plan.tier, plan.billing);
  const percent = isBilledPlan(plan) ? multiPercent(plans.multiSubscriptionDiscounts, ownerPaid) : 0;

  return (
    <div className="super-guild-plan">
      <span className={`tag ${plan.effective !== 'FREE' ? 'tag-accent' : ''}`}>{planName(plans, plan.tier)}</span>
      {paid && plan.billing && <span className={`tag ${plan.billing === 'GIFT' ? 'tag-info' : ''}`}>{c.plans.billingNames[plan.billing]}</span>}
      {plan.expired && <span className="tag tag-danger">{c.plans.expired}</span>}
      {paid && (
        <span>
          {plan.expiresAt
            ? format(plan.expired ? c.plans.expiredOn : c.plans.expiresOn, { date: fmtDate(plan.expiresAt, false) })
            : c.plans.noExpiry}
        </span>
      )}
      {paid && !plan.expired && <PriceText c={c} locale={locale} base={base} final={discountedPriceCents(base, coupon)} billing={plan.billing} />}
      {plan.couponCode && <span className={`tag ${coupon ? '' : 'tag-warn'}`} title={coupon ? undefined : c.plans.couponUnknown}>{plan.couponCode}</span>}
      {percent > 0 && <span className="plan-hint">{format(c.plans.multi, { percent, count: ownerPaid })}</span>}
      {plan.note && <span className="super-guild-plan-note" title={plan.note}>{plan.note}</span>}
      {plan.updatedAt && <span className="plan-hint">{format(c.plans.updated, { date: fmtDate(plan.updatedAt) })}</span>}
      <button type="button" className="button button-sm button-secondary" aria-expanded={editing} onClick={onToggle}>
        {editing ? c.plans.close : c.plans.edit}
      </button>
    </div>
  );
}

function PlanEditor({ c, locale, guild, plans, plan, ownerPaid, busy, mutate, onDone }: {
  c: SuperCopy;
  locale: Locale;
  guild: Guild;
  plans: PlansOverview;
  plan: GuildPlan;
  ownerPaid: number;
  busy: boolean;
  mutate: Mutate;
  onDone: () => void;
}) {
  const [tier, setTier] = useState<PlanTier>(plan.tier);
  const [billing, setBilling] = useState<Billing>(plan.billing ?? 'MONTHLY');
  const [expires, setExpires] = useState(toDateInput(plan.expiresAt));
  const [coupon, setCoupon] = useState(plan.couponCode ?? '');
  const [note, setNote] = useState(plan.note ?? '');

  const free = tier === 'FREE';
  const couponCode = coupon.trim().toUpperCase();
  const matched = free ? undefined : findCoupon(plans, couponCode);
  const base = free ? 0 : basePriceCents(plans, tier, billing);
  const final = discountedPriceCents(base, matched);
  // The server only re-checks a coupon that differs from the one already applied.
  const problem = matched && couponCode !== plan.couponCode ? couponProblem(matched, tier, billing) : null;
  const couponHint = free || !couponCode ? null : !matched ? c.plans.couponUnknown : problem ? c.plans.errors[problem] ?? null : null;

  // Paid subscriptions of the same owner once this change is saved.
  const billed = !free && billing !== 'GIFT';
  const subscriptions = ownerPaid - (isBilledPlan(plan) ? 1 : 0) + (billed ? 1 : 0);
  const percent = billed ? multiPercent(plans.multiSubscriptionDiscounts, subscriptions) : 0;

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (PLAN_TIERS.indexOf(tier) < PLAN_TIERS.indexOf(plan.effective) &&
      !window.confirm(format(c.plans.confirmDowngrade, { name: guild.name }))) return;
    void mutate(async () => {
      const expiresAt = free ? null : fromDateInput(expires, true);
      if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) throw new ApiError('EXPIRY_IN_PAST', 400);
      await api(`/backend/api/super/guilds/${guild.id}/plan`, jsonInit('PUT', {
        tier,
        billing: free ? null : billing,
        expiresAt,
        couponCode: free ? null : couponCode || null,
        note: note.trim() || null
      }));
      return format(c.plans.saved, { name: guild.name });
    }).then((ok) => { if (ok) onDone(); });
  };

  const datalistId = `plan-coupons-${guild.id}`;

  return (
    <form className="plan-editor" onSubmit={save}>
      <div className="plan-editor-fields">
        <label>{c.plans.tier}
          <select value={tier} onChange={(event) => { const value = event.target.value; if (isPlanTier(value)) setTier(value); }}>
            {PLAN_TIERS.map((item) => <option key={item} value={item}>{planName(plans, item)}</option>)}
          </select>
        </label>
        {!free && (
          <label>{c.plans.billing}
            <select value={billing} onChange={(event) => { const value = event.target.value; if (isBilling(value)) setBilling(value); }}>
              {BILLINGS.map((item) => <option key={item} value={item}>{c.plans.billingNames[item]}</option>)}
            </select>
          </label>
        )}
        {!free && (
          <label>{c.plans.expires}
            <input type="date" value={expires} onChange={(event) => setExpires(event.target.value)} />
            <small className="plan-hint">{c.plans.expiresHint}</small>
          </label>
        )}
        {!free && (
          <label>{c.plans.coupon}
            <input
              value={coupon}
              onChange={(event) => setCoupon(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
              maxLength={32}
              list={datalistId}
              placeholder="BETA50"
              autoComplete="off"
            />
            <datalist id={datalistId}>
              {plans.coupons.filter((item) => item.active).map((item) => <option key={item.id} value={item.code} />)}
            </datalist>
            {couponHint && <small className="plan-hint plan-hint-warn">{couponHint}</small>}
          </label>
        )}
        <label className="plan-editor-wide">{c.plans.note}
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder={c.plans.notePlaceholder} autoComplete="off" />
        </label>
      </div>
      <div className="plan-editor-foot">
        <div className="plan-editor-info">
          {free
            ? <span className="plan-price">{c.plans.price}: {c.plans.free}</span>
            : <PriceText c={c} locale={locale} base={base} final={final} billing={billing} />}
          {percent > 0 && <span className="plan-hint">{format(c.plans.multi, { percent, count: subscriptions })}</span>}
        </div>
        <div className="button-row">
          <button type="button" className="button button-ghost" onClick={onDone}>{c.plans.close}</button>
          <button type="submit" className="button button-primary" disabled={busy}>{c.plans.save}</button>
        </div>
      </div>
    </form>
  );
}

/* ----------------------------------------------------------------- coupons */

type CouponForm = {
  code: string;
  type: 'percent' | 'amount';
  value: string;
  tiers: PaidTier[];
  billing: CouponBilling;
  max: string;
  from: string;
  until: string;
  description: string;
  active: boolean;
  public: boolean;
};

const emptyCouponForm: CouponForm = {
  code: '', type: 'percent', value: '', tiers: [], billing: 'ANY', max: '', from: '', until: '', description: '', active: true, public: false
};

function CouponsCard({ c, locale, plans, busy, mutate, fmtDate }: {
  c: SuperCopy;
  locale: Locale;
  plans: PlansOverview;
  busy: boolean;
  mutate: Mutate;
  fmtDate: FmtDate;
}) {
  const [form, setForm] = useState<CouponForm>(emptyCouponForm);
  const set = (patch: Partial<CouponForm>) => setForm((current) => ({ ...current, ...patch }));
  const cc = c.plans.coupons;

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ok = await mutate(async () => {
      const code = form.code.trim().toUpperCase();
      const value = Number(form.value.replace(',', '.'));
      const percentOff = form.type === 'percent' ? value : null;
      const amountOffCents = form.type === 'amount' ? Math.round(value * 100) : null;
      const maxRedemptions = form.max ? Number(form.max) : null;
      const valid = COUPON_CODE.test(code) && Number.isFinite(value) && value > 0 &&
        (percentOff === null || (Number.isInteger(percentOff) && percentOff <= 100)) &&
        (amountOffCents === null || (amountOffCents >= 1 && amountOffCents <= 100_000)) &&
        (maxRedemptions === null || (Number.isInteger(maxRedemptions) && maxRedemptions >= 1 && maxRedemptions <= 100_000));
      if (!valid) throw new ApiError('INVALID_COUPON', 400);
      await api('/backend/api/super/coupons', jsonInit('POST', {
        code,
        description: form.description.trim() || null,
        percentOff,
        amountOffCents,
        tiers: form.tiers,
        billing: form.billing,
        maxRedemptions,
        validFrom: fromDateInput(form.from, false),
        validUntil: fromDateInput(form.until, true),
        active: form.active,
        public: form.public
      }));
      return format(cc.created, { code });
    });
    if (ok) setForm(emptyCouponForm);
  };

  const update = (coupon: Coupon, patch: { active?: boolean; public?: boolean }) => void mutate(async () => {
    await api(`/backend/api/super/coupons/${coupon.id}`, jsonInit('PUT', patch));
    return format(cc.updated, { code: coupon.code });
  });

  const remove = (coupon: Coupon) => {
    if (!window.confirm(format(cc.confirmRemove, { code: coupon.code }))) return;
    void mutate(async () => {
      await api(`/backend/api/super/coupons/${coupon.id}`, { method: 'DELETE' });
      return format(cc.removed, { code: coupon.code });
    });
  };

  const billingLabel = (value: string) => (value === 'ANY' ? cc.any : isBilling(value) ? c.plans.billingNames[value] : value);
  const validity = (coupon: Coupon) =>
    !coupon.validFrom && !coupon.validUntil
      ? cc.always
      : `${coupon.validFrom ? fmtDate(coupon.validFrom, false) : '…'} → ${coupon.validUntil ? fmtDate(coupon.validUntil, false) : '…'}`;

  return (
    <section className="card">
      <div className="card-head">
        <div><span className="kicker">{cc.kicker}</span><h2>{cc.title}</h2><p>{cc.text}</p></div>
      </div>

      <form className="coupon-form" onSubmit={(event) => void create(event)}>
        <label>{cc.code}
          <input
            value={form.code}
            onChange={(event) => set({ code: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })}
            minLength={3}
            maxLength={32}
            placeholder="BETA50"
            title={cc.codeHint}
            autoComplete="off"
            required
          />
        </label>
        <label>{cc.type}
          <select value={form.type} onChange={(event) => set({ type: event.target.value === 'amount' ? 'amount' : 'percent', value: '' })}>
            <option value="percent">{cc.percent}</option>
            <option value="amount">{cc.amount}</option>
          </select>
        </label>
        <label>{cc.value}
          <input
            value={form.value}
            onChange={(event) => set({ value: event.target.value.replace(/[^\d.,]/g, '') })}
            inputMode="decimal"
            placeholder={form.type === 'percent' ? '50' : '5'}
            autoComplete="off"
            required
          />
        </label>
        <label>{cc.billing}
          <select value={form.billing} onChange={(event) => { const value = event.target.value; if (isCouponBilling(value)) set({ billing: value }); }}>
            <option value="ANY">{cc.any}</option>
            <option value="MONTHLY">{c.plans.billingNames.MONTHLY}</option>
            <option value="YEARLY">{c.plans.billingNames.YEARLY}</option>
          </select>
        </label>
        <label>{cc.max}
          <input value={form.max} onChange={(event) => set({ max: event.target.value.replace(/\D/g, '') })} inputMode="numeric" placeholder="∞" autoComplete="off" />
        </label>
        <label>{cc.from}
          <input type="date" value={form.from} onChange={(event) => set({ from: event.target.value })} />
        </label>
        <label>{cc.until}
          <input type="date" value={form.until} onChange={(event) => set({ until: event.target.value })} />
        </label>
        <label className="coupon-form-wide">{cc.description}
          <input value={form.description} onChange={(event) => set({ description: event.target.value })} maxLength={200} autoComplete="off" />
        </label>
        <fieldset className="coupon-form-wide coupon-tiers">
          <legend>{cc.tiers}</legend>
          {PAID_TIERS.map((tier) => (
            <label key={tier} className="checkbox-row">
              <input
                type="checkbox"
                checked={form.tiers.includes(tier)}
                onChange={(event) => set({ tiers: event.target.checked ? [...form.tiers, tier] : form.tiers.filter((item) => item !== tier) })}
              />
              {planName(plans, tier)}
            </label>
          ))}
          {!form.tiers.length && <small className="plan-hint">{cc.allTiers}</small>}
        </fieldset>
        <div className="coupon-form-wide coupon-form-foot">
          <label className="checkbox-row"><input type="checkbox" checked={form.active} onChange={(event) => set({ active: event.target.checked })} />{cc.active}</label>
          <label className="checkbox-row"><input type="checkbox" checked={form.public} onChange={(event) => set({ public: event.target.checked })} />{cc.public}</label>
          <button type="submit" className="button button-primary" disabled={busy}>{cc.create}</button>
        </div>
      </form>

      {!plans.coupons.length && <div className="empty">{cc.empty}</div>}
      <div className="table-list">
        {plans.coupons.map((coupon) => (
          <div className="coupon-row" key={coupon.id}>
            <div>
              <strong>
                <span className="mono">{coupon.code}</span>
                {!coupon.active && <span className="tag">{cc.inactive}</span>}
              </strong>
              <span>
                {coupon.percentOff ? `−${coupon.percentOff}%` : `−${formatPrice(coupon.amountOffCents ?? 0, locale)}`}
                {' · '}{coupon.tiers.length ? coupon.tiers.map((tier) => planName(plans, tier)).join(', ') : cc.allTiers}
                {' · '}{billingLabel(coupon.billing)}
              </span>
              <span>
                {coupon.redemptions} / {coupon.maxRedemptions ?? cc.unlimited} {cc.redemptions}
                {' · '}{validity(coupon)}
              </span>
              {coupon.description && <span>{coupon.description}</span>}
            </div>
            <label className="checkbox-row">
              <input type="checkbox" checked={coupon.active} disabled={busy} onChange={(event) => update(coupon, { active: event.target.checked })} />
              {cc.active}
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={coupon.public} disabled={busy} onChange={(event) => update(coupon, { public: event.target.checked })} />
              {cc.public}
            </label>
            <button type="button" className="button button-sm button-danger" disabled={busy} onClick={() => remove(coupon)}>{cc.remove}</button>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- contacts */

function ContactsCard({ c, config, busy, mutate }: {
  c: SuperCopy;
  config: ContactConfig;
  busy: boolean;
  mutate: Mutate;
}) {
  const [email, setEmail] = useState(config.contactEmail ?? '');
  const [discord, setDiscord] = useState(config.contactDiscord ?? '');
  const [url, setUrl] = useState(config.contactUrl ?? '');
  const cc = c.plans.contacts;

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // An empty string clears the contact.
    void mutate(async () => {
      await api('/backend/api/super/config', jsonInit('PUT', {
        contactEmail: email.trim(),
        contactDiscord: discord.trim(),
        contactUrl: url.trim()
      }));
      return cc.saved;
    });
  };

  return (
    <section className="card">
      <div className="card-head">
        <div><span className="kicker">{cc.kicker}</span><h2>{cc.title}</h2><p>{cc.text}</p></div>
      </div>
      <form className="contact-form" onSubmit={save}>
        <div className="inline-fields">
          <label>{cc.email}
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={200} autoComplete="off" />
          </label>
          <label>{cc.discord}
            <input value={discord} onChange={(event) => setDiscord(event.target.value)} maxLength={200} autoComplete="off" />
          </label>
          <label>{cc.url}
            <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} maxLength={500} pattern="https://.*" placeholder="https://" autoComplete="off" />
          </label>
        </div>
        <div className="button-row">
          <button type="submit" className="button button-primary" disabled={busy}>{cc.save}</button>
        </div>
      </form>
    </section>
  );
}
