import PricingView from './PricingView';
import type { Locale } from '../i18n';
import { SITE_URL } from '../site';
import { FALLBACK_DISCOUNTS, FALLBACK_PLANS, TIER_ORDER, type Plan, type PublicInfo } from './plans';

const apiOrigin = process.env.INTERNAL_API_URL || 'http://api:3001';

const isPlan = (value: unknown): value is Plan => {
  const plan = value as Partial<Plan> | null;
  return Boolean(plan && typeof plan === 'object' &&
    typeof plan.tier === 'string' && (TIER_ORDER as string[]).includes(plan.tier) &&
    typeof plan.name === 'string' && typeof plan.monthlyCents === 'number' && typeof plan.yearlyCents === 'number' &&
    plan.limits && typeof plan.limits === 'object' && plan.features && typeof plan.features === 'object');
};

/** Live catalogue, contacts and promotions; null when the API cannot be reached. */
async function loadInfo(): Promise<PublicInfo | null> {
  try {
    const response = await fetch(`${apiOrigin}/api/public/info`, { cache: 'no-store', signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return null;
    const body = await response.json() as Partial<PublicInfo> | null;
    if (!body || typeof body !== 'object') return null;
    const rawPlans: unknown = body.plans;
    const plans = Array.isArray(rawPlans) ? rawPlans.filter(isPlan) : [];
    if (!plans.length) return null;
    return {
      contacts: {
        email: body.contacts?.email ?? null,
        discord: body.contacts?.discord ?? null,
        url: body.contacts?.url ?? null
      },
      plans,
      multiSubscriptionDiscounts: Array.isArray(body.multiSubscriptionDiscounts) ? body.multiSubscriptionDiscounts : FALLBACK_DISCOUNTS,
      promotions: Array.isArray(body.promotions) ? body.promotions : []
    };
  } catch {
    return null;
  }
}

/** Server component: plans and promotions come from the API at request time. */
export default async function PricingPage({ locale }: { locale: Locale }) {
  const info = await loadInfo();
  const fallback: PublicInfo = {
    contacts: { email: null, discord: null, url: null },
    plans: FALLBACK_PLANS,
    multiSubscriptionDiscounts: FALLBACK_DISCOUNTS,
    promotions: []
  };
  return <PricingView locale={locale} info={info ?? fallback} live={info !== null} siteUrl={SITE_URL} />;
}
