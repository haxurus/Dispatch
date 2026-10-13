import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '@dispatch/db';
import {
  PLANS,
  couponProblem,
  effectiveTier,
  normalizeCouponCode,
  planLimits,
  type BillingPeriod,
  type PlanFeature,
  type PlanTier
} from '@dispatch/shared';
import { setBotBranding } from './discord.js';
import { protectJson } from './security.js';

type Logger = Pick<FastifyBaseLogger, 'warn' | 'error' | 'info'>;

export class PlanError extends Error {
  constructor(readonly code: string, readonly status = 400) {
    super(code);
  }
}

export async function guildTier(guildId: string) {
  const row = await prisma.guildSettings.findUnique({ where: { guildId }, select: { planTier: true, planExpiresAt: true } });
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

export type PlanChange = {
  tier: PlanTier;
  billing: BillingPeriod | null;
  expiresAt: Date | null;
  couponCode: string | null;
  note: string | null;
};

export async function changeGuildPlan(guildId: string, change: PlanChange, log: Logger) {
  const current = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { planTier: true, planCouponCode: true }
  });
  if (!current) throw new PlanError('GUILD_NOT_FOUND', 404);

  const free = change.tier === 'FREE';
  const couponCode = free || !change.couponCode ? null : normalizeCouponCode(change.couponCode);
  // A coupon counts as redeemed once per server: re-saving the same plan
  // with the same code does not consume it again.
  const newCoupon = couponCode !== null && couponCode !== current.planCouponCode;
  if (newCoupon) {
    const coupon = await prisma.coupon.findUnique({ where: { code: couponCode! } });
    if (!coupon) throw new PlanError('COUPON_NOT_FOUND', 404);
    const problem = couponProblem(coupon, change.tier, change.billing);
    if (problem) throw new PlanError(problem);
  }

  await prisma.$transaction([
    prisma.guildSettings.update({
      where: { guildId },
      data: {
        planTier: change.tier,
        planBilling: free ? null : change.billing,
        planExpiresAt: free ? null : change.expiresAt,
        planCouponCode: couponCode,
        planNote: change.note,
        planUpdatedAt: new Date()
      }
    }),
    ...(newCoupon ? [prisma.coupon.update({ where: { code: couponCode! }, data: { redemptions: { increment: 1 } } })] : [])
  ]);

  const tier = effectiveTier({ planTier: change.tier, planExpiresAt: free ? null : change.expiresAt });
  const applied = await applyPlanLimits(guildId, tier, log);
  return { previousTier: current.planTier, tier: change.tier, effectiveTier: tier, applied, couponRedeemed: newCoupon };
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

/** Expired plans fall back to Free and their configuration is brought within it. */
export async function sweepExpiredPlans(log: Logger) {
  const expired = await prisma.guildSettings.findMany({
    where: { planTier: { not: 'FREE' }, planExpiresAt: { lte: new Date() } },
    select: { guildId: true, planTier: true, planExpiresAt: true }
  });
  for (const row of expired) {
    try {
      await prisma.guildSettings.update({
        where: { guildId: row.guildId },
        data: { planTier: 'FREE', planBilling: null, planCouponCode: null, planUpdatedAt: new Date() }
      });
      const applied = await applyPlanLimits(row.guildId, 'FREE', log);
      await systemAudit('plan.expired', 'GUILD', row.guildId, { previousTier: row.planTier, expiredAt: row.planExpiresAt, applied });
    } catch (error) {
      log.error({ err: error, guildId: row.guildId }, 'Unable to expire plan');
    }
  }
  return expired.length;
}

export function startPlanSweep(log: Logger) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const expired = await sweepExpiredPlans(log);
      if (expired) log.info({ expired }, 'Expired plans moved to Free');
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
    select: { planTier: true, planExpiresAt: true, planBilling: true, brandNickname: true, brandBannerSet: true }
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
  return {
    tier: settings.planTier,
    effectiveTier: tier,
    expiresAt: settings.planExpiresAt,
    billing: settings.planBilling,
    plan: PLANS[tier],
    usage: { categories, ticketPanels, forms, formPanels, responseTemplates, roleBindings },
    branding: { nickname: settings.brandNickname, bannerSet: settings.brandBannerSet }
  };
}
