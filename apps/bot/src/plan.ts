import { prisma } from '@dispatch/db';
import { PLANS, effectiveTier, type PlanFeature, type PlanTier } from '@dispatch/shared';

/*
 * The plan in force on a server (packages/shared/src/plans.ts), cached
 * briefly: the super console changes it rarely and an expiry is a sweep in
 * the API, so a 30-second delay is harmless. Unknown servers are Free.
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
    select: { planTier: true, planExpiresAt: true }
  }).catch(() => null);
  const tier = row ? effectiveTier(row) : 'FREE';
  if (cache.size > 5000) cache.clear();
  // An expiry inside the cache window is honoured on the next read.
  const expiresAt = Math.min(Date.now() + CACHE_TTL_MS, row?.planExpiresAt?.getTime() ?? Infinity);
  cache.set(guildId, { tier, expiresAt });
  return tier;
}

export async function guildAllows(guildId: string, feature: PlanFeature) {
  return PLANS[await guildPlanTier(guildId)].features[feature];
}
