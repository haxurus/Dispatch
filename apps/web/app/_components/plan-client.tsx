'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocale } from './locale-context';
import { format, type Locale } from '../i18n';

/*
 * Plan awareness for the dashboard: types of GET /guilds/:guildId/plan
 * (mirroring packages/shared/src/plans.ts, which the web app does not import),
 * a usePlan hook, plan names, the "Plus+" badge and the error text for
 * QUOTA_EXCEEDED / PLAN_REQUIRED answers. Gating in the dashboard only
 * informs: settings are always saved, the bot applies them once the plan
 * includes the feature.
 */

export type PlanTier = 'FREE' | 'TIER1' | 'TIER2' | 'TIER3';
export type PaidTier = Exclude<PlanTier, 'FREE'>;
/** Where the plan in force comes from: a Discord subscription or a gift from the operator. */
export type PlanSource = 'DISCORD' | 'GIFT';

export type PlanLimits = {
  categories: number;
  ticketPanels: number;
  forms: number;
  formPanels: number;
  responseTemplates: number;
  roleBindings: number;
  /** null = no limit. */
  retentionDays: number | null;
};

export type PlanFeatures = {
  automations: boolean;
  staffThreads: boolean;
  leaderboard: boolean;
  closedCategory: boolean;
  customBranding: boolean;
  prioritySupport: boolean;
};

export type PlanFeature = keyof PlanFeatures;
export type PlanQuota = Exclude<keyof PlanLimits, 'retentionDays'>;

export type PlanDefinition = {
  tier: PlanTier;
  name: string;
  level: number;
  monthlyCents: number;
  limits: PlanLimits;
  features: PlanFeatures;
};

export type PlanBranding = { nickname: string | null; bannerSet: boolean };

export type GuildPlan = {
  /** Plan in force: the higher of the Discord subscription and the gift. */
  effectiveTier: PlanTier;
  source: PlanSource | null;
  /** When the plan in force ends: a cancelled subscription or a gift with an expiry (null: renews or no expiry). */
  endsAt: string | null;
  plan: PlanDefinition;
  usage: Record<PlanQuota, number>;
  branding: PlanBranding;
};

export const PLAN_QUOTAS: readonly PlanQuota[] = ['categories', 'ticketPanels', 'forms', 'formPanels', 'responseTemplates', 'roleBindings'];
export const PLAN_FEATURES: readonly PlanFeature[] = ['automations', 'staffThreads', 'leaderboard', 'closedCategory', 'customBranding', 'prioritySupport'];

/** Display names (brand names, identical in both languages). */
export const PLAN_NAMES: Record<PlanTier, string> = { FREE: 'Free', TIER1: 'Plus', TIER2: 'Pro', TIER3: 'Brand' };

/** Lowest plan that includes each feature (see plans.ts). */
export const FEATURE_TIER: Record<PlanFeature, PaidTier> = {
  automations: 'TIER1',
  staffThreads: 'TIER1',
  prioritySupport: 'TIER1',
  leaderboard: 'TIER2',
  closedCategory: 'TIER2',
  customBranding: 'TIER3'
};

/** Retention cap of each plan, in days (null = unlimited). */
export const RETENTION_CAP: Record<PlanTier, number | null> = { FREE: 15, TIER1: 30, TIER2: 60, TIER3: 90 };

const isTier = (value: unknown): value is PlanTier =>
  value === 'FREE' || value === 'TIER1' || value === 'TIER2' || value === 'TIER3';

export const planName = (tier: string | null | undefined) => (isTier(tier) ? PLAN_NAMES[tier] : PLAN_NAMES.FREE);

/** True/false once the plan is known, null while it is loading or unavailable. */
export function planHas(plan: GuildPlan | null, feature: PlanFeature): boolean | null {
  return plan ? Boolean(plan.plan.features[feature]) : null;
}

export const pricingHref = (locale: Locale) => `/${locale}/pricing`;
/** Plans are bought only on Discord: the API redirects to the app's store (the plan's SKU). */
export const storeHref = (tier?: PaidTier | null) => `/backend/bot/store${tier ? `?plan=${tier}` : ''}`;

/*
 * One request per page load: the sidebar and the page share the in-flight
 * request; reload() (after a branding change, for example) fetches again.
 */
const planRequests = new Map<string, Promise<GuildPlan | null>>();

function requestPlan(guildId: string, fresh = false) {
  const cached = planRequests.get(guildId);
  if (cached && !fresh) return cached;
  const request: Promise<GuildPlan | null> = fetch(`/backend/api/guilds/${guildId}/plan`, { credentials: 'same-origin' })
    .then(async (response) => (response.ok ? (await response.json()) as GuildPlan : null))
    .catch(() => null)
    .then((plan) => {
      // Do not keep failures: a later page may try again.
      if (!plan && planRequests.get(guildId) === request) planRequests.delete(guildId);
      return plan;
    });
  planRequests.set(guildId, request);
  return request;
}

export function usePlan(guildId: string | null | undefined) {
  const [plan, setPlan] = useState<GuildPlan | null>(null);
  const [loading, setLoading] = useState(Boolean(guildId));

  useEffect(() => {
    if (!guildId || !/^\d{17,20}$/.test(guildId)) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void requestPlan(guildId).then((value) => {
      if (cancelled) return;
      setPlan(value);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [guildId]);

  const reload = useCallback(async () => {
    if (!guildId) return;
    const value = await requestPlan(guildId, true);
    setPlan(value);
  }, [guildId]);

  return { plan, loading, reload, setPlan };
}

const badgeCopy = {
  it: { title: 'Richiede il piano {plan} o superiore. Vedi i piani' },
  en: { title: 'Requires the {plan} plan or higher. See plans' }
} satisfies Record<Locale, { title: string }>;

/** "Plus+" chip linking to the pricing page. */
export function PlanBadge({ required, className = '' }: { required: PaidTier; className?: string }) {
  const locale = useLocale();
  const name = PLAN_NAMES[required];
  return (
    <a
      className={`plan-badge ${className}`.trim()}
      href={pricingHref(locale)}
      title={format(badgeCopy[locale].title, { plan: name })}
    >
      {name}+
    </a>
  );
}

/**
 * One-line note shown next to a setting whose feature the current plan lacks.
 * Renders nothing while the plan is loading or when the feature is included.
 */
export function PlanHint({ plan, feature, children }: { plan: GuildPlan | null; feature: PlanFeature; children: ReactNode }) {
  if (planHas(plan, feature) !== false) return null;
  return (
    <p className="plan-hint">
      <PlanBadge required={FEATURE_TIER[feature]} />
      <span>{children}</span>
    </p>
  );
}

export type ApiErrorBody = {
  error?: string;
  quota?: string;
  limit?: number | null;
  tier?: string;
  required?: string;
};

const FIXED_QUOTAS = new Set(['blacklistEntries', 'formRoleBindings']);

/**
 * Text for an API error from a page's error map. QUOTA_EXCEEDED templates get
 * {limit}; instance-wide caps (blacklist, form role bindings) use
 * QUOTA_EXCEEDED_FIXED when the map has it, since upgrading does not raise
 * them. PLAN_REQUIRED templates get {plan}.
 */
export function apiErrorText(errors: Record<string, string>, body: ApiErrorBody | null | undefined, fallback: string): string {
  if (!body || !body.error) return fallback;
  const code = body.error;
  if (code === 'QUOTA_EXCEEDED') {
    const fixed = FIXED_QUOTAS.has(String(body.quota ?? ''));
    const template = (fixed ? errors.QUOTA_EXCEEDED_FIXED : undefined) ?? errors.QUOTA_EXCEEDED;
    const limit = body.limit;
    if (template) return format(template, { limit: typeof limit === 'number' ? limit : '—' });
  }
  const required = body.required;
  if (code === 'PLAN_REQUIRED' && errors.PLAN_REQUIRED) {
    return format(errors.PLAN_REQUIRED, { plan: isTier(required) && required !== 'FREE' ? PLAN_NAMES[required] : PLAN_NAMES.TIER1 });
  }
  return errors[code] ?? fallback;
}
