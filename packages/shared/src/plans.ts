/**
 * Subscription plans of the hosted instance. Single source of truth for the
 * bot (feature gates, retention), the API (quotas, validation, downgrades)
 * and, through the public API, the pricing page and the dashboard.
 *
 * Plans are activated by the operator from the super console (no online
 * payments). An expired plan behaves as Free; nothing is deleted on a
 * downgrade, features above the plan simply stop working.
 */

export const PLAN_TIERS = ['FREE', 'TIER1', 'TIER2', 'TIER3'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const BILLING_PERIODS = ['MONTHLY', 'YEARLY', 'GIFT'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

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
  monthlyCents: number;
  yearlyCents: number;
  limits: PlanLimits;
  features: PlanFeatures;
};


export const PLANS: Record<PlanTier, PlanDefinition> = {
  FREE: {
    tier: 'FREE', name: 'Free', level: 0, monthlyCents: 0, yearlyCents: 0,
    limits: { categories: 3, ticketPanels: 2, forms: 2, formPanels: 2, responseTemplates: 5, roleBindings: 1, retentionDays: 15 },
    features: { automations: false, staffThreads: false, leaderboard: false, closedCategory: false, customBranding: false, prioritySupport: false }
  },
  TIER1: {
    tier: 'TIER1', name: 'Plus', level: 1, monthlyCents: 199, yearlyCents: 1_999,
    limits: { categories: 10, ticketPanels: 5, forms: 5, formPanels: 5, responseTemplates: 15, roleBindings: 3, retentionDays: 30 },
    features: { automations: true, staffThreads: true, leaderboard: false, closedCategory: false, customBranding: false, prioritySupport: true }
  },
  TIER2: {
    tier: 'TIER2', name: 'Pro', level: 2, monthlyCents: 499, yearlyCents: 4_999,
    limits: { categories: 30, ticketPanels: 15, forms: 15, formPanels: 25, responseTemplates: 25, roleBindings: 10, retentionDays: 60 },
    features: { automations: true, staffThreads: true, leaderboard: true, closedCategory: true, customBranding: false, prioritySupport: true }
  },
  TIER3: {
    tier: 'TIER3', name: 'Brand', level: 3, monthlyCents: 899, yearlyCents: 8_999,
    limits: { categories: 50, ticketPanels: 25, forms: 30, formPanels: 25, responseTemplates: 50, roleBindings: 10, retentionDays: 90 },
    features: { automations: true, staffThreads: true, leaderboard: true, closedCategory: true, customBranding: true, prioritySupport: true }
  }
};

/** Instance-wide caps that do not depend on the plan (abuse protection). */
export const FIXED_LIMITS = {
  blacklistEntries: 2000,
  formRoleBindings: 50
} as const;

/**
 * Discount for a customer who pays for several servers at once, by number of
 * paid subscriptions (highest threshold first).
 */
export const MULTI_SUBSCRIPTION_DISCOUNTS = [
  { minSubscriptions: 5, percentOff: 25 },
  { minSubscriptions: 3, percentOff: 20 },
  { minSubscriptions: 2, percentOff: 15 }
] as const;

export const multiSubscriptionPercent = (subscriptions: number) =>
  MULTI_SUBSCRIPTION_DISCOUNTS.find((discount) => subscriptions >= discount.minSubscriptions)?.percentOff ?? 0;

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

/** The plan in force: an expired plan behaves as Free until it is renewed. */
export function effectiveTier(
  plan: { planTier?: string | null; planExpiresAt?: Date | string | null },
  now: Date = new Date()
): PlanTier {
  const tier = isPlanTier(plan.planTier) ? plan.planTier : 'FREE';
  if (tier === 'FREE' || !plan.planExpiresAt) return tier;
  const expires = new Date(plan.planExpiresAt);
  return Number.isNaN(expires.getTime()) || expires.getTime() > now.getTime() ? tier : 'FREE';
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

export type CouponLike = {
  code: string;
  percentOff: number | null;
  amountOffCents: number | null;
  tiers: string[];
  billing: string;
  maxRedemptions: number | null;
  redemptions: number;
  validFrom: Date | string | null;
  validUntil: Date | string | null;
  active: boolean;
};

export const normalizeCouponCode = (value: string) => value.trim().toUpperCase();

/** Why a coupon cannot be applied to a plan, or null when it can. */
export function couponProblem(coupon: CouponLike, tier: PlanTier, billing: BillingPeriod | null, now: Date = new Date()) {
  if (!coupon.active) return 'COUPON_INACTIVE';
  if (coupon.validFrom && new Date(coupon.validFrom).getTime() > now.getTime()) return 'COUPON_NOT_STARTED';
  if (coupon.validUntil && new Date(coupon.validUntil).getTime() < now.getTime()) return 'COUPON_EXPIRED';
  if (coupon.maxRedemptions !== null && coupon.redemptions >= coupon.maxRedemptions) return 'COUPON_EXHAUSTED';
  if (tier === 'FREE') return 'COUPON_FREE_PLAN';
  if (coupon.tiers.length && !coupon.tiers.includes(tier)) return 'COUPON_WRONG_TIER';
  if (coupon.billing !== 'ANY' && coupon.billing !== billing) return 'COUPON_WRONG_BILLING';
  return null;
}

export function basePriceCents(tier: PlanTier, billing: BillingPeriod | null) {
  if (billing === 'YEARLY') return PLANS[tier].yearlyCents;
  if (billing === 'MONTHLY') return PLANS[tier].monthlyCents;
  return 0;
}

/** Price after a coupon, never below zero. */
export function discountedPriceCents(priceCents: number, coupon: Pick<CouponLike, 'percentOff' | 'amountOffCents'> | null) {
  if (!coupon) return priceCents;
  let price = priceCents;
  if (coupon.percentOff) price = Math.round(price * (100 - coupon.percentOff) / 100);
  if (coupon.amountOffCents) price -= coupon.amountOffCents;
  return Math.max(0, price);
}

/** Days a server's data is kept after the bot is removed from it. */
export const DEFAULT_POST_REMOVAL_RETENTION_DAYS = 30;
