/**
 * Subscription plans of the hosted instance. Single source of truth for the
 * bot (feature gates, retention), the API (quotas, validation, downgrades)
 * and, through the public API, the pricing page and the dashboard.
 *
 * Paid plans are sold only through Discord (Premium Apps guild subscriptions,
 * monthly, SKUs set in the super console): the API mirrors each server's
 * active entitlement into GuildSettings.subscription* (apps/api/src/discord-billing.ts). The operator can also give a plan from the
 * super console (a gift, optionally with an expiry). The higher of the two is
 * in force; an ended plan behaves as Free and nothing is deleted on a
 * downgrade except what applyPlanLimits() resets.
 */

export const PLAN_TIERS = ['FREE', 'TIER1', 'TIER2', 'TIER3'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export type PlanLimits = {
  /** Ticket categories. */
  categories: number;
  /** Ticket panels. */
  ticketPanels: number;
  /** Form definitions. */
  forms: number;
  /** Form panels. */
  formPanels: number;
  /** Canned replies (response templates). */
  responseTemplates: number;
  /** Discord roles mapped to dashboard access levels. */
  roleBindings: number;
  /**
   * Longest transcript and closed-ticket retention, in days. null = no limit
   * (the server may also keep tickets forever).
   */
  retentionDays: number | null;
};

export type PlanFeatures = {
  /** SLAs, escalation, inactivity warning and automatic close. */
  automations: boolean;
  /** Private staff threads. */
  staffThreads: boolean;
  /** Weekly/monthly moderator leaderboard. */
  leaderboard: boolean;
  /** Move closed tickets to a dedicated Discord category. */
  closedCategory: boolean;
  /** Bot nickname and banner per server, custom panel footer. */
  customBranding: boolean;
  prioritySupport: boolean;
};

export type PlanFeature = keyof PlanFeatures;

export type PlanDefinition = {
  tier: PlanTier;
  name: string;
  level: number;
  /** Monthly price in US cents, as set on the Discord SKU (Discord localises it). */
  monthlyCents: number;
  limits: PlanLimits;
  features: PlanFeatures;
};


export const PLANS: Record<PlanTier, PlanDefinition> = {
  FREE: {
    tier: 'FREE', name: 'Free', level: 0, monthlyCents: 0,
    limits: { categories: 3, ticketPanels: 2, forms: 2, formPanels: 2, responseTemplates: 5, roleBindings: 1, retentionDays: 15 },
    features: { automations: false, staffThreads: false, leaderboard: false, closedCategory: false, customBranding: false, prioritySupport: false }
  },
  TIER1: {
    tier: 'TIER1', name: 'Plus', level: 1, monthlyCents: 199,
    limits: { categories: 10, ticketPanels: 5, forms: 5, formPanels: 5, responseTemplates: 15, roleBindings: 3, retentionDays: 30 },
    features: { automations: true, staffThreads: true, leaderboard: false, closedCategory: false, customBranding: false, prioritySupport: true }
  },
  TIER2: {
    tier: 'TIER2', name: 'Pro', level: 2, monthlyCents: 499,
    limits: { categories: 30, ticketPanels: 15, forms: 15, formPanels: 25, responseTemplates: 25, roleBindings: 10, retentionDays: 60 },
    features: { automations: true, staffThreads: true, leaderboard: true, closedCategory: true, customBranding: false, prioritySupport: true }
  },
  TIER3: {
    tier: 'TIER3', name: 'Brand', level: 3, monthlyCents: 899,
    limits: { categories: 50, ticketPanels: 25, forms: 30, formPanels: 25, responseTemplates: 50, roleBindings: 10, retentionDays: 90 },
    features: { automations: true, staffThreads: true, leaderboard: true, closedCategory: true, customBranding: true, prioritySupport: true }
  }
};

/** Instance-wide caps that do not depend on the plan (abuse protection). */
export const FIXED_LIMITS = {
  blacklistEntries: 2000,
  formRoleBindings: 50
} as const;

/** Currency of monthlyCents: Discord SKU prices are set in US dollars. */
export const PLAN_CURRENCY = 'USD';

export const isPlanTier = (value: unknown): value is PlanTier =>
  typeof value === 'string' && (PLAN_TIERS as readonly string[]).includes(value);

export const tierLevel = (tier: PlanTier) => PLANS[tier].level;

export const tierAllows = (tier: PlanTier, required: PlanTier) => tierLevel(tier) >= tierLevel(required);

/** Lowest plan that includes a feature. */
export function requiredTierFor(feature: PlanFeature): PlanTier {
  return PLAN_TIERS.find((tier) => PLANS[tier].features[feature]) ?? 'TIER3';
}

export const planAllows = (tier: PlanTier, feature: PlanFeature) => PLANS[tier].features[feature];

export const planLimits = (tier: PlanTier) => PLANS[tier].limits;

const activeTier = (tier: string | null | undefined, endsAt: Date | string | null | undefined, now: Date): PlanTier => {
  if (!isPlanTier(tier) || tier === 'FREE') return 'FREE';
  if (!endsAt) return tier;
  const end = new Date(endsAt);
  return Number.isNaN(end.getTime()) || end.getTime() > now.getTime() ? tier : 'FREE';
};

export type PlanState = {
  /** Plan given from the super console and its optional expiry. */
  planTier?: string | null;
  planExpiresAt?: Date | string | null;
  /** Discord subscription mirrored by the bot; endsAt is set once it is cancelled. */
  subscriptionTier?: string | null;
  subscriptionEndsAt?: Date | string | null;
};

/** The plan in force: the higher of the gift and the Discord subscription still running. */
export function effectiveTier(plan: PlanState, now: Date = new Date()): PlanTier {
  const gift = activeTier(plan.planTier, plan.planExpiresAt, now);
  const subscription = activeTier(plan.subscriptionTier, plan.subscriptionEndsAt, now);
  return tierLevel(subscription) > tierLevel(gift) ? subscription : gift;
}

/** Fields of a Discord entitlement used to find a server's subscription. */
export type EntitlementLike = {
  id: string;
  skuId: string;
  guildId: string | null;
  deleted?: boolean;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
};

/**
 * The best running subscription among a server's entitlements: the highest
 * plan, then the one that does not end (or ends last). Test entitlements have
 * no dates and count as running.
 */
export function bestEntitlement<T extends EntitlementLike>(
  entitlements: T[],
  tierOf: (skuId: string) => PlanTier | null,
  now: Date = new Date()
) {
  let best: { entitlement: T; tier: PlanTier } | null = null;
  const endOf = (value: EntitlementLike) => (value.endsAt ? new Date(value.endsAt).getTime() : Infinity);
  for (const entitlement of entitlements) {
    if (entitlement.deleted) continue;
    const tier = tierOf(entitlement.skuId);
    if (!tier) continue;
    if (entitlement.startsAt && new Date(entitlement.startsAt).getTime() > now.getTime()) continue;
    if (endOf(entitlement) <= now.getTime()) continue;
    if (!best || tierLevel(tier) > tierLevel(best.tier) ||
      (tier === best.tier && endOf(entitlement) > endOf(best.entitlement))) {
      best = { entitlement, tier };
    }
  }
  return best;
}

/**
 * Retention actually applied: the server's setting, capped by the plan. A
 * missing setting means "as long as the plan allows" (forever only without a cap).
 */
export function effectiveRetentionDays(setting: number | null | undefined, tier: PlanTier): number | null {
  const cap = PLANS[tier].limits.retentionDays;
  if (cap === null) return setting ?? null;
  return setting == null ? cap : Math.min(setting, cap);
}

/** Days a server's data is kept after the bot is removed from it. */
export const DEFAULT_POST_REMOVAL_RETENTION_DAYS = 30;
