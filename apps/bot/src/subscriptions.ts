import { Routes, type APIEntitlement, type Client } from 'discord.js';
import { prisma } from '@dispatch/db';
import { DISCORD_PLAN_SKUS, bestEntitlement, type EntitlementLike } from '@dispatch/shared';
import { invalidateGuildPlan } from './plan.js';

/*
 * Paid plans are Discord guild subscriptions (Premium Apps). Discord is the
 * source of truth: this module mirrors each server's best running entitlement
 * into GuildSettings.subscription*, on entitlement events and with a full
 * sync at startup and every few minutes (missed events, refunds). A
 * subscription that is no longer running gets subscriptionEndsAt = now; the
 * API sweep then clears it and brings the server within the lower plan.
 */

const SKUS = Object.values(DISCORD_PLAN_SKUS).filter((sku): sku is string => Boolean(sku));

const toEntitlement = (raw: APIEntitlement): EntitlementLike => ({
  id: raw.id,
  skuId: raw.sku_id,
  guildId: raw.guild_id ?? null,
  deleted: raw.deleted,
  startsAt: raw.starts_at ?? null,
  endsAt: raw.ends_at ?? null
});

/** Running entitlements to the plan SKUs, for one server or for all of them. */
async function fetchEntitlements(client: Client<true>, guildId?: string) {
  const entitlements: EntitlementLike[] = [];
  let after: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ sku_ids: SKUS.join(','), exclude_ended: 'true', limit: '100' });
    if (guildId) query.set('guild_id', guildId);
    if (after) query.set('after', after);
    const page = await client.rest.get(Routes.entitlements(client.application.id), { query }) as APIEntitlement[];
    entitlements.push(...page.map(toEntitlement));
    if (page.length < 100) return entitlements;
    after = page.reduce((last, row) => (BigInt(row.id) > BigInt(last) ? row.id : last), page[0]!.id);
  }
}

/** Writes one server's subscription; returns true when something changed. */
async function storeGuildSubscription(guildId: string, entitlements: EntitlementLike[], now: Date) {
  const best = bestEntitlement(entitlements, now);
  const current = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { subscriptionTier: true, subscriptionEndsAt: true, subscriptionEntitlementId: true }
  });
  // Unknown server (the bot is not in it): nothing to mirror.
  if (!current) return false;

  if (best) {
    const endsAt = best.entitlement.endsAt ? new Date(best.entitlement.endsAt) : null;
    const changed = current.subscriptionTier !== best.tier || current.subscriptionEntitlementId !== best.entitlement.id ||
      current.subscriptionEndsAt?.getTime() !== endsAt?.getTime();
    await prisma.guildSettings.update({
      where: { guildId },
      data: {
        subscriptionTier: best.tier,
        subscriptionEndsAt: endsAt,
        subscriptionEntitlementId: best.entitlement.id,
        subscriptionSyncedAt: now
      }
    });
    if (changed) invalidateGuildPlan(guildId);
    return changed;
  }

  // Nothing running any more (refund, removal, end of a cancelled period).
  const stillRunning = current.subscriptionTier !== null &&
    (current.subscriptionEndsAt === null || current.subscriptionEndsAt > now);
  if (!stillRunning) return false;
  await prisma.guildSettings.update({
    where: { guildId },
    data: { subscriptionEndsAt: now, subscriptionSyncedAt: now }
  });
  invalidateGuildPlan(guildId);
  return true;
}

/** Re-reads one server's entitlements (entitlement events). */
export async function syncGuildSubscription(client: Client<true>, guildId: string) {
  if (!SKUS.length) return false;
  return storeGuildSubscription(guildId, await fetchEntitlements(client, guildId), new Date());
}

/** Full sync: every running entitlement, and servers whose subscription is gone. */
export async function syncAllSubscriptions(client: Client<true>) {
  if (!SKUS.length) return { changed: 0 };
  const now = new Date();
  const byGuild = new Map<string, EntitlementLike[]>();
  for (const entitlement of await fetchEntitlements(client)) {
    if (!entitlement.guildId) continue;
    const list = byGuild.get(entitlement.guildId) ?? [];
    list.push(entitlement);
    byGuild.set(entitlement.guildId, list);
  }
  const stored = await prisma.guildSettings.findMany({
    where: { subscriptionTier: { not: null } },
    select: { guildId: true }
  });
  const guildIds = new Set([...byGuild.keys(), ...stored.map((row) => row.guildId)]);
  let changed = 0;
  for (const guildId of guildIds) {
    if (await storeGuildSubscription(guildId, byGuild.get(guildId) ?? [], now)) changed++;
  }
  return { changed };
}
