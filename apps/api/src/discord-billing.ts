import { prisma } from '@dispatch/db';
import { PLANS, bestEntitlement } from '@dispatch/shared';
import { PAID_TIERS, parseSkus, skuTier } from './discord-plans.js';
import { getEntitlements, type Entitlement } from './discord.js';
import { openIncident, recordAlert, resolveIncident } from './alert-store.js';
import { settleGuildPlan } from './plan-service.js';

/**
 * Paid plans are sold only as Discord Premium Apps guild subscriptions
 * (monthly). Each paid plan maps to a SKU set in the super console; the API
 * reads the application's entitlements through the bot every two minutes and
 * mirrors each server's best one into GuildSettings.subscription*. If the
 * entitlements cannot be read nothing changes: an outage never downgrades.
 */

export { PAID_TIERS, parseSkus, skuTier, storeLinks, type DiscordSkus, type PaidTier } from './discord-plans.js';

export async function configuredSkus() {
  const config = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { discordSkus: true } });
  return parseSkus(config?.discordSkus);
}

type Logger = { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };

export type SyncResult = { at: string; ok: boolean; entitlements: number; changed: number; error?: string };
let lastSync: SyncResult | null = null;
let consecutiveFailures = 0;
/** Failed syncs in a row (2 min apart) before an incident: about 6 minutes. */
const FAILURES_BEFORE_INCIDENT = 3;
export const lastDiscordSync = () => lastSync;

const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Brings every server's subscription in line with Discord. */
export async function syncDiscordPlans(log: Logger): Promise<SyncResult> {
  const skus = await configuredSkus();
  if (!PAID_TIERS.some((tier) => skus[tier])) {
    lastSync = { at: new Date().toISOString(), ok: true, entitlements: 0, changed: 0 };
    return lastSync;
  }

  let entitlements: Entitlement[];
  try {
    entitlements = await getEntitlements();
  } catch (error) {
    log.warn({ err: error }, 'Unable to read Discord entitlements');
    lastSync = { at: new Date().toISOString(), ok: false, entitlements: 0, changed: 0, error: 'ENTITLEMENTS_UNAVAILABLE' };
    consecutiveFailures += 1;
    if (consecutiveFailures >= FAILURES_BEFORE_INCIDENT) {
      await openIncident('discord.sync', { category: 'billing', severity: 'warning', message: 'sync.stopped' }).catch(() => null);
    }
    return lastSync;
  }

  consecutiveFailures = 0;
  await resolveIncident('discord.sync', 'sync.restored').catch(() => null);
  const now = new Date();
  const tierOf = skuTier(skus);
  const byGuild = new Map<string, Entitlement[]>();
  for (const entitlement of entitlements) {
    if (!entitlement.guildId) continue;
    byGuild.set(entitlement.guildId, [...(byGuild.get(entitlement.guildId) ?? []), entitlement]);
  }
  const rows = await prisma.guildSettings.findMany({
    where: { OR: [{ subscriptionTier: { not: null } }, { guildId: { in: [...byGuild.keys()] } }] },
    select: { guildId: true, subscriptionTier: true, subscriptionEndsAt: true, subscriptionEntitlementId: true }
  });

  let changed = 0;
  for (const row of rows) {
    const best = bestEntitlement(byGuild.get(row.guildId) ?? [], tierOf, now);
    const fields = [{ key: 'server' as const, value: `\`${row.guildId}\`` }];
    try {
      if (best) {
        const endsAt = best.entitlement.endsAt ? new Date(best.entitlement.endsAt) : null;
        if (row.subscriptionTier === best.tier && row.subscriptionEntitlementId === best.entitlement.id && sameTime(row.subscriptionEndsAt, endsAt)) continue;
        await prisma.guildSettings.update({
          where: { guildId: row.guildId },
          data: { subscriptionTier: best.tier, subscriptionEndsAt: endsAt, subscriptionEntitlementId: best.entitlement.id, subscriptionSyncedAt: now }
        });
        const plan = PLANS[best.tier].name;
        if (!row.subscriptionTier) {
          await recordAlert({ category: 'billing', severity: 'info', level: 'ok', key: 'subscription.new', params: { plan }, fields });
        } else if (row.subscriptionTier !== best.tier) {
          await recordAlert({ category: 'billing', severity: 'info', key: 'subscription.changed', params: { plan }, fields });
        } else if (endsAt && !row.subscriptionEndsAt) {
          await recordAlert({ category: 'billing', severity: 'info', level: 'warn', key: 'subscription.cancelled', params: { plan, until: endsAt.toISOString().slice(0, 10) }, fields });
        }
      } else {
        await prisma.guildSettings.update({
          where: { guildId: row.guildId },
          data: { subscriptionTier: null, subscriptionEndsAt: null, subscriptionEntitlementId: null, subscriptionSyncedAt: now }
        });
        await recordAlert({ category: 'billing', severity: 'info', level: 'warn', key: 'subscription.ended', fields });
      }
      // A lower plan in force: retention capped, extra roles removed, branding reset.
      await settleGuildPlan(row.guildId, log);
      changed += 1;
    } catch (error) {
      log.error({ err: error, guildId: row.guildId }, 'Unable to sync Discord plan');
    }
  }

  lastSync = { at: now.toISOString(), ok: true, entitlements: entitlements.length, changed };
  return lastSync;
}

export function startDiscordSync(log: Logger) {
  const run = () => syncDiscordPlans(log).catch((error) => log.error({ err: error }, 'Discord plan sync failed'));
  setTimeout(() => void run(), 20_000).unref();
  setInterval(() => void run(), 2 * 60 * 1000).unref();
}
