import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '@dispatch/db';
import {
  BILLING_PERIODS,
  MULTI_SUBSCRIPTION_DISCOUNTS,
  PLANS,
  PLAN_TIERS,
  normalizeCouponCode
} from '@dispatch/shared';
import { requireGuild } from './auth.js';
import { panelAudit } from './audit.js';
import { setBotBranding } from './discord.js';
import { PlanError, changeGuildPlan, guildPlanUsage, guildTier } from './plan-service.js';
import { requireSuperMutation } from './super.js';
import { superAdminAudit } from './super-audit.js';

/*
 * Plans: public catalogue for the pricing page, the super console (contacts,
 * coupons, per-server plans) and the per-server plan and Brand customisation.
 */

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional()
  .transform((value) => (value ? value : null));

export async function instanceConfig() {
  return prisma.instanceConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

const publicPlans = () => PLAN_TIERS.map((tier) => PLANS[tier]);

const couponIsLive = (
  coupon: { active: boolean; validFrom: Date | null; validUntil: Date | null; maxRedemptions: number | null; redemptions: number },
  now = new Date()
) =>
  coupon.active &&
  (!coupon.validFrom || coupon.validFrom <= now) &&
  (!coupon.validUntil || coupon.validUntil >= now) &&
  (coupon.maxRedemptions === null || coupon.redemptions < coupon.maxRedemptions);

const sendPlanError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof PlanError) return reply.code(error.status).send({ error: error.code });
  throw error;
};

// Banner data URIs are resized in the browser; the route allows them above the global body limit.
const BANNER_URI = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export function registerPlanRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- public
  // Served to the pricing page (also server-side, from a single address), so
  // it is cached briefly instead of being rate limited per client.
  let publicInfoCache: { value: unknown; expires: number } | null = null;
  const loadPublicInfo = async () => {
    const [config, coupons] = await Promise.all([
      instanceConfig(),
      prisma.coupon.findMany({ where: { public: true, active: true }, orderBy: { createdAt: 'desc' }, take: 10 })
    ]);
    return {
      contacts: { email: config.contactEmail, discord: config.contactDiscord, url: config.contactUrl },
      plans: publicPlans(),
      multiSubscriptionDiscounts: MULTI_SUBSCRIPTION_DISCOUNTS,
      promotions: coupons.filter((coupon) => couponIsLive(coupon)).map((coupon) => ({
        code: coupon.code,
        description: coupon.description,
        percentOff: coupon.percentOff,
        amountOffCents: coupon.amountOffCents,
        tiers: coupon.tiers,
        billing: coupon.billing,
        validUntil: coupon.validUntil
      }))
    };
  };
  app.get('/api/public/info', { config: { rateLimit: false } }, async () => {
    if (publicInfoCache && publicInfoCache.expires > Date.now()) return publicInfoCache.value;
    const value = await loadPublicInfo();
    publicInfoCache = { value, expires: Date.now() + 30_000 };
    return value;
  });

  // ------------------------------------------------------ super: contacts
  app.put('/api/super/config', async (request, reply) => {
    const session = await requireSuperMutation(request, reply);
    if (!session) return;
    const parsed = z.object({
      contactEmail: z.union([z.literal(''), z.string().trim().email().max(200)]).nullable().optional(),
      contactDiscord: z.string().trim().max(200).nullable().optional(),
      contactUrl: z.union([z.literal(''), z.string().trim().url().max(500).refine((value) => value.startsWith('https://'))]).nullable().optional()
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });
    const text = (value: string | null | undefined) => (value === undefined ? undefined : value || null);
    const data = {
      contactEmail: text(parsed.data.contactEmail),
      contactDiscord: text(parsed.data.contactDiscord),
      contactUrl: text(parsed.data.contactUrl)
    };
    const config = await prisma.instanceConfig.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
    publicInfoCache = null;
    await superAdminAudit(request, session, 'instance.config', null, null, data);
    return config;
  });

  // ------------------------------------------------------- super: coupons
  const couponBody = z.object({
    description: nullableText(200),
    percentOff: z.number().int().min(1).max(100).nullable().optional(),
    amountOffCents: z.number().int().min(1).max(100_000).nullable().optional(),
    tiers: z.array(z.enum(['TIER1', 'TIER2', 'TIER3'])).max(3).optional(),
    billing: z.enum(['ANY', 'MONTHLY', 'YEARLY']).optional(),
    maxRedemptions: z.number().int().min(1).max(100_000).nullable().optional(),
    validFrom: z.coerce.date().nullable().optional(),
    validUntil: z.coerce.date().nullable().optional(),
    active: z.boolean().optional(),
    public: z.boolean().optional()
  });
  const discountValid = (value: { percentOff?: number | null; amountOffCents?: number | null }) =>
    Boolean(value.percentOff) !== Boolean(value.amountOffCents);

  app.post('/api/super/coupons', async (request, reply) => {
    const session = await requireSuperMutation(request, reply);
    if (!session) return;
    const parsed = couponBody.extend({ code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,32}$/) }).safeParse(request.body);
    if (!parsed.success || !discountValid(parsed.data)) return reply.code(400).send({ error: 'INVALID_COUPON' });
    const code = normalizeCouponCode(parsed.data.code);
    if (await prisma.coupon.findUnique({ where: { code }, select: { id: true } })) return reply.code(409).send({ error: 'COUPON_EXISTS' });
    const coupon = await prisma.coupon.create({ data: { ...parsed.data, code, createdByUserId: session.userId } });
    publicInfoCache = null;
    await superAdminAudit(request, session, 'coupon.create', null, null, { code, percentOff: coupon.percentOff, amountOffCents: coupon.amountOffCents });
    return coupon;
  });

  app.put('/api/super/coupons/:id', async (request, reply) => {
    const session = await requireSuperMutation(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const parsed = couponBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_COUPON' });
    const current = await prisma.coupon.findUnique({ where: { id } });
    if (!current) return reply.code(404).send({ error: 'NOT_FOUND' });
    const next = { percentOff: current.percentOff, amountOffCents: current.amountOffCents, ...parsed.data };
    if (!discountValid(next)) return reply.code(400).send({ error: 'INVALID_COUPON' });
    const coupon = await prisma.coupon.update({ where: { id }, data: parsed.data });
    publicInfoCache = null;
    await superAdminAudit(request, session, 'coupon.update', null, null, { code: coupon.code, ...parsed.data });
    return coupon;
  });

  app.delete('/api/super/coupons/:id', async (request, reply) => {
    const session = await requireSuperMutation(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const coupon = await prisma.coupon.findUnique({ where: { id } });
    if (!coupon) return reply.code(404).send({ error: 'NOT_FOUND' });
    await prisma.coupon.delete({ where: { id } });
    publicInfoCache = null;
    await superAdminAudit(request, session, 'coupon.delete', null, null, { code: coupon.code });
    return { ok: true };
  });

  // --------------------------------------------------------- super: plans
  app.put('/api/super/guilds/:guildId/plan', async (request, reply) => {
    const session = await requireSuperMutation(request, reply);
    if (!session) return;
    const { guildId } = request.params as { guildId: string };
    const parsed = z.object({
      tier: z.enum(PLAN_TIERS),
      billing: z.enum(BILLING_PERIODS).nullable().optional(),
      expiresAt: z.coerce.date().nullable().optional(),
      couponCode: z.string().trim().max(32).nullable().optional(),
      note: nullableText(500)
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });
    const change = {
      tier: parsed.data.tier,
      billing: parsed.data.billing ?? null,
      expiresAt: parsed.data.expiresAt ?? null,
      couponCode: parsed.data.couponCode || null,
      note: parsed.data.note
    };
    if (change.tier !== 'FREE' && change.expiresAt && change.expiresAt.getTime() <= Date.now()) {
      return reply.code(400).send({ error: 'EXPIRY_IN_PAST' });
    }
    try {
      const result = await changeGuildPlan(guildId, change, request.log);
      await superAdminAudit(request, session, 'plan.update', 'GUILD', guildId, { ...change, ...result });
      return { ok: true, ...result };
    } catch (error) {
      return sendPlanError(reply, error);
    }
  });

  // ---------------------------------------------------------- guild: plan
  app.get('/api/guilds/:guildId/plan', async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const session = await requireGuild(request, reply, guildId);
    if (!session) return;
    const usage = await guildPlanUsage(guildId);
    if (!usage) return reply.code(404).send({ error: 'GUILD_NOT_FOUND' });
    return usage;
  });

  app.put('/api/guilds/:guildId/branding', { bodyLimit: 96 * 1024 }, async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const session = await requireGuild(request, reply, guildId, 'ADMIN');
    if (!session) return;
    const { plan } = await guildTier(guildId);
    if (!plan.features.customBranding) return reply.code(403).send({ error: 'PLAN_REQUIRED', required: 'TIER3' });

    const parsed = z.object({
      nickname: z.string().trim().min(1).max(32).nullable().optional(),
      banner: z.string().max(90_000).regex(BANNER_URI).nullable().optional()
    }).refine((value) => value.nickname !== undefined || value.banner !== undefined).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });

    const profile: { nick?: string | null; banner?: string | null } = {};
    if (parsed.data.nickname !== undefined) profile.nick = parsed.data.nickname;
    if (parsed.data.banner !== undefined) profile.banner = parsed.data.banner;
    try {
      await setBotBranding(guildId, profile);
    } catch (error) {
      request.log.warn({ err: error, guildId }, 'Bot branding update failed');
      const code = (error as { code?: string }).code;
      return reply.code(502).send({ error: code === 'BRANDING_MISSING_PERMISSION' ? code : 'BRANDING_FAILED' });
    }

    const data = {
      ...(parsed.data.nickname !== undefined ? { brandNickname: parsed.data.nickname } : {}),
      ...(parsed.data.banner !== undefined ? { brandBannerSet: parsed.data.banner !== null } : {})
    };
    const updated = await prisma.guildSettings.update({ where: { guildId }, data, select: { brandNickname: true, brandBannerSet: true } });
    await panelAudit(request, session, guildId, 'branding.update', {
      nickname: parsed.data.nickname,
      banner: parsed.data.banner === undefined ? undefined : parsed.data.banner === null ? 'removed' : 'updated'
    });
    return { ok: true, nickname: updated.brandNickname, bannerSet: updated.brandBannerSet };
  });
}

/** Super console additions: contacts, coupons, plan of each connected server. */
export async function planOverview(guildIds: string[]) {
  const [config, coupons, plans] = await Promise.all([
    instanceConfig(),
    prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.guildSettings.findMany({
      where: { guildId: { in: guildIds } },
      select: { guildId: true, planTier: true, planBilling: true, planExpiresAt: true, planCouponCode: true, planNote: true, planUpdatedAt: true }
    })
  ]);
  return { config, coupons, plans, planCatalog: publicPlans(), multiSubscriptionDiscounts: MULTI_SUBSCRIPTION_DISCOUNTS };
}
