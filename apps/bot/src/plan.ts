import { prisma } from '@dispatch/db';
import { PLANS, effectiveTier, type PlanFeature, type PlanTier } from '@dispatch/shared';

/*
 * The plan in force on a server (packages/shared/src/plans.ts): the higher of
 * the gift set from the super console and the Discord subscription mirrored
 * by the API from Discord. Cached briefly (30 seconds);
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

/*
 * Discord SKU of each paid plan (super console → Discord subscriptions), for
 * the premium "subscribe" buttons. The bot may read only this column; until
 * the grant exists (or no SKU is set) there is simply no button.
 */
const SKU_CACHE_MS = 60_000;
let skuCache: { value: Record<string, string>; expires: number } | null = null;

export async function planSku(tier: PlanTier): Promise<string | null> {
  if (tier === 'FREE') return null;
  if (!skuCache || skuCache.expires <= Date.now()) {
    const row = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { discordSkus: true } }).catch(() => null);
    const raw = row?.discordSkus;
    const value: Record<string, string> = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [key, id] of Object.entries(raw)) if (typeof id === 'string' && /^\d{17,20}$/.test(id)) value[key] = id;
    }
    skuCache = { value, expires: Date.now() + SKU_CACHE_MS };
  }
  return skuCache.value[tier] ?? null;
}
