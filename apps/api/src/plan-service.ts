import { prisma } from '@dispatch/db';
import {
  PLANS,
  effectiveTier,
  isPlanTier,
  planLimits,
  tierLevel,
  type PlanFeature,
  type PlanTier
} from '@dispatch/shared';
import { setBotBranding } from './discord.js';
import { protectJson } from './security.js';

type Logger = { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void; info?: (obj: object, msg: string) => void };

export class PlanError extends Error {
  constructor(readonly code: string, readonly status = 400) {
    super(code);
  }
}

/** Columns effectiveTier() needs. */
export const planStateSelect = {
  planTier: true, planExpiresAt: true, subscriptionTier: true, subscriptionEndsAt: true
} as const;

export async function guildTier(guildId: string) {
  const row = await prisma.guildSettings.findUnique({ where: { guildId }, select: planStateSelect });
  const tier: PlanTier = row ? effectiveTier(row) : 'FREE';
  return { tier, limits: planLimits(tier), plan: PLANS[tier] };
}

export async function guildAllows(guildId: string, feature: PlanFeature) {
  const { plan } = await guildTier(guildId);
  return plan.features[feature];
}

/** Retention values that fit a plan: capped, and transcripts never outlive tickets. */
export function retentionWithinPlan(
  tier: PlanTier,
  values: { transcriptRetentionDays: number | null; closedTicketRetentionDays: number | null }
) {
  const cap = planLimits(tier).retentionDays;
  if (cap === null) return values;
  const closed = Math.min(values.closedTicketRetentionDays ?? cap, cap);
  const transcript = Math.min(values.transcriptRetentionDays ?? cap, cap, closed);
  return { transcriptRetentionDays: transcript, closedTicketRetentionDays: closed };
}

/**
 * Brings a server's configuration within a plan after a downgrade, an expiry
 * or a manual change. Nothing that belongs to the server is deleted except
 * dashboard role bindings above the limit (newest first): retention is
 * capped, the bot branding is reset, and features above the plan simply stop
 * working in the bot (their settings stay, ready for an upgrade).
 */
export async function applyPlanLimits(guildId: string, tier: PlanTier, log: Logger) {
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { transcriptRetentionDays: true, closedTicketRetentionDays: true, brandNickname: true, brandBannerSet: true }
  });
  if (!settings) return { retentionChanged: false, bindingsRemoved: 0, brandingReset: false };

  const limits = planLimits(tier);
  const retention = retentionWithinPlan(tier, settings);
  const retentionChanged = retention.transcriptRetentionDays !== settings.transcriptRetentionDays ||
    retention.closedTicketRetentionDays !== settings.closedTicketRetentionDays;

  const bindings = await prisma.panelRoleBinding.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  const extraBindings = bindings.slice(limits.roleBindings).map((binding) => binding.id);

  await prisma.$transaction([
    ...(retentionChanged ? [prisma.guildSettings.update({ where: { guildId }, data: retention })] : []),
    ...(extraBindings.length ? [prisma.panelRoleBinding.deleteMany({ where: { id: { in: extraBindings } } })] : [])
  ]);

  let brandingReset = false;
  if (!PLANS[tier].features.customBranding && (settings.brandNickname || settings.brandBannerSet)) {
    try {
      await setBotBranding(guildId, { nick: null, banner: null });
    } catch (error) {
      log.warn({ err: error, guildId }, 'Unable to reset bot branding after downgrade');
    }
    await prisma.guildSettings.update({ where: { guildId }, data: { brandNickname: null, brandBannerSet: false } });
    brandingReset = true;
  }

  return { retentionChanged, bindingsRemoved: extraBindings.length, brandingReset };
}

/** A plan given from the super console (the Discord subscription is untouched). */
export type PlanChange = {
  tier: PlanTier;
  expiresAt: Date | null;
  note: string | null;
};

export async function changeGuildPlan(guildId: string, change: PlanChange, log: Logger) {
  const current = await prisma.guildSettings.findUnique({ where: { guildId }, select: planStateSelect });
  if (!current) throw new PlanError('GUILD_NOT_FOUND', 404);

  const free = change.tier === 'FREE';
  const next = { ...current, planTier: change.tier, planExpiresAt: free ? null : change.expiresAt };
  const tier = effectiveTier(next);
  await prisma.guildSettings.update({
    where: { guildId },
    data: {
      planTier: change.tier,
      planExpiresAt: next.planExpiresAt,
      planNote: change.note,
      planUpdatedAt: new Date(),
      planLimitsTier: tier
    }
  });
  const applied = await applyPlanLimits(guildId, tier, log);
  return { previousTier: current.planTier, tier: change.tier, effectiveTier: tier, applied };
}

export async function systemAudit(action: string, subjectType: string | null, subjectId: string | null, details: Record<string, unknown> = {}) {
  await prisma.superAdminAudit.create({
    data: {
      userId: 'system',
      username: 'Dispatch',
      action,
      subjectType,
      subjectId,
      details: protectJson(JSON.parse(JSON.stringify(details)))
    }
  });
}

/**
 * Brings a server within the plan in force when it dropped below the one
 * whose limits were last applied (an expired gift, a Discord subscription
 * that ended or moved to a lower SKU), and records the plan now applied.
 * Returns what applyPlanLimits changed, or null when nothing was lowered.
 */
export async function settleGuildPlan(guildId: string, log: Logger, now = new Date()) {
  const row = await prisma.guildSettings.findUnique({ where: { guildId }, select: { ...planStateSelect, planLimitsTier: true } });
  if (!row) return null;
  const tier = effectiveTier(row, now);
  const limitsTier: PlanTier = isPlanTier(row.planLimitsTier) ? row.planLimitsTier : 'FREE';
  if (tier === limitsTier) return null;
  await prisma.guildSettings.update({ where: { guildId }, data: { planLimitsTier: tier } });
  if (tierLevel(tier) >= tierLevel(limitsTier)) return null;
  const applied = await applyPlanLimits(guildId, tier, log);
  await systemAudit('plan.downgraded', 'GUILD', guildId, { from: limitsTier, to: tier, applied });
  return applied;
}

/**
 * Ended gifts and subscriptions are cleared, and servers whose plan in force
 * dropped are brought within the lower plan (settleGuildPlan).
 */
export async function sweepPlans(log: Logger) {
  const now = new Date();
  const rows = await prisma.guildSettings.findMany({
    where: {
      OR: [
        { planTier: { not: 'FREE' }, planExpiresAt: { lte: now } },
        // Every subscription, so that planLimitsTier follows upgrades too.
        { subscriptionTier: { not: null } },
        { planLimitsTier: { not: 'FREE' } }
      ]
    },
    select: { guildId: true, planTier: true, planExpiresAt: true, subscriptionTier: true, subscriptionEndsAt: true }
  });
  let downgraded = 0;
  for (const row of rows) {
    try {
      const giftEnded = row.planTier !== 'FREE' && row.planExpiresAt !== null && row.planExpiresAt <= now;
      const subscriptionEnded = row.subscriptionTier !== null && row.subscriptionEndsAt !== null && row.subscriptionEndsAt <= now;
      if (giftEnded || subscriptionEnded) {
        await prisma.guildSettings.update({
          where: { guildId: row.guildId },
          data: {
            ...(giftEnded ? { planTier: 'FREE', planExpiresAt: null, planUpdatedAt: now } : {}),
            ...(subscriptionEnded ? { subscriptionTier: null, subscriptionEndsAt: null, subscriptionEntitlementId: null } : {})
          }
        });
      }
      if (await settleGuildPlan(row.guildId, log, now)) downgraded++;
    } catch (error) {
      log.error({ err: error, guildId: row.guildId }, 'Unable to sweep plan');
    }
  }
  return downgraded;
}

export function startPlanSweep(log: Logger) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const downgraded = await sweepPlans(log);
      if (downgraded) log.info?.({ downgraded }, 'Servers brought within a lower plan');
    } catch (error) {
      log.error({ err: error }, 'Plan expiry sweep failed');
    } finally {
      running = false;
    }
  };
  setTimeout(run, 30_000).unref();
  setInterval(run, 15 * 60_000).unref();
}

/** Plan, limits and current usage of a server, for the dashboard. */
export async function guildPlanUsage(guildId: string) {
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { ...planStateSelect, brandNickname: true, brandBannerSet: true }
  });
  if (!settings) return null;
  const tier = effectiveTier(settings);
  const [categories, ticketPanels, forms, formPanels, responseTemplates, roleBindings] = await Promise.all([
    prisma.ticketCategory.count({ where: { guildId } }),
    prisma.ticketPanel.count({ where: { guildId } }),
    prisma.formDefinition.count({ where: { guildId } }),
    prisma.formPanel.count({ where: { guildId } }),
    prisma.responseTemplate.count({ where: { guildId } }),
    prisma.panelRoleBinding.count({ where: { guildId } })
  ]);
  const subscriptionRunning = effectiveTier({ subscriptionTier: settings.subscriptionTier, subscriptionEndsAt: settings.subscriptionEndsAt }) === tier && tier !== 'FREE';
  return {
    effectiveTier: tier,
    /** Where the plan in force comes from: a Discord subscription or a gift. */
    source: tier === 'FREE' ? null : subscriptionRunning ? 'DISCORD' : 'GIFT',
    /** When the plan in force ends (null: renews or no expiry). */
    endsAt: tier === 'FREE' ? null : subscriptionRunning ? settings.subscriptionEndsAt : settings.planExpiresAt,
    plan: PLANS[tier],
    usage: { categories, ticketPanels, forms, formPanels, responseTemplates, roleBindings },
    branding: { nickname: settings.brandNickname, bannerSet: settings.brandBannerSet }
  };
}
