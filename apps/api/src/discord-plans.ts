import type { PlanTier } from '@dispatch/shared';

/**
 * Discord SKUs of the paid plans (super console → Discord subscriptions):
 * pure helpers shared by the plan sync, the store links and the tests.
 */

export const PAID_TIERS = ['TIER1', 'TIER2', 'TIER3'] as const;
export type PaidTier = (typeof PAID_TIERS)[number];
export type DiscordSkus = Partial<Record<PaidTier, string>>;

const SNOWFLAKE = /^\d{17,20}$/;

/** Reads the stored JSON defensively: unknown keys and bad IDs are ignored. */
export function parseSkus(value: unknown): DiscordSkus {
  const result: DiscordSkus = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const tier of PAID_TIERS) {
    const id = (value as Record<string, unknown>)[tier];
    if (typeof id === 'string' && SNOWFLAKE.test(id)) result[tier] = id;
  }
  return result;
}

export const skuTier = (skus: DiscordSkus) => (skuId: string): PlanTier | null =>
  PAID_TIERS.find((tier) => skus[tier] === skuId) ?? null;

/** Store pages of the configured SKUs, where people subscribe in Discord. */
export function storeLinks(skus: DiscordSkus, applicationId: string) {
  const store = `https://discord.com/application-directory/${applicationId}/store`;
  const links = Object.fromEntries(PAID_TIERS.map((tier) => [tier, skus[tier] ? `${store}/${skus[tier]}` : null])) as Record<PaidTier, string | null>;
  return { enabled: PAID_TIERS.some((tier) => links[tier]), store, links };
}
