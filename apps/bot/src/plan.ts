import { prisma } from '@dispatch/db';
import { PLANS, effectiveTier, type PlanFeature, type PlanTier } from '@dispatch/shared';

/*
 * The plan in force on a server (packages/shared/src/plans.ts): the higher of
 * the gift set from the super console and the Discord subscription mirrored
 * by subscriptions.ts. Cached briefly (the subscription sync invalidates it);
 * unknown servers are Free.
 */

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { tier: PlanTier; expiresAt: number }>();

export function invalidateGuildPlan(guildId?: string) {
  if (guildId) cache.delete(guildId);
  else cache.clear();
}

export async function guildPlanTier(guildId: string): Promise<PlanTier> {
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.tier;
  const row = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { planTier: true, planExpiresAt: true, subscriptionTier: true, subscriptionEndsAt: true }
  }).catch(() => null);
  const tier = row ? effectiveTier(row) : 'FREE';
  if (cache.size > 5000) cache.clear();
  // An end inside the cache window is honoured on the next read.
  const expiresAt = Math.min(
    Date.now() + CACHE_TTL_MS,
    row?.planExpiresAt?.getTime() ?? Infinity,
    row?.subscriptionEndsAt?.getTime() ?? Infinity
  );
  cache.set(guildId, { tier, expiresAt });
  return tier;
}

export async function guildAllows(guildId: string, feature: PlanFeature) {
  return PLANS[await guildPlanTier(guildId)].features[feature];
}
