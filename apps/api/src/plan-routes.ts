import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '@dispatch/db';
import {
  DISCORD_PLAN_SKUS,
  PLANS,
  PLAN_CURRENCY,
  PLAN_TIERS,
  discordStoreUrl,
  isPlanTier
} from '@dispatch/shared';
import { requireGuild } from './auth.js';
import { config } from './config.js';
import { panelAudit } from './audit.js';
import { setBotBranding } from './discord.js';
import { PlanError, changeGuildPlan, guildPlanUsage, guildTier, planStateSelect } from './plan-service.js';
import { requireSuperMutation } from './super.js';
import { superAdminAudit } from './super-audit.js';

/*
 * Plans: public catalogue for the pricing page, the link to the Discord store
 * (the only way to buy a plan), the super console (contacts, gifts) and the
 * per-server plan and Brand customisation.
 */

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional()
  .transform((value) => (value ? value : null));

export async function instanceConfig() {
  return prisma.instanceConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

const publicPlans = () => PLAN_TIERS.map((tier) => PLANS[tier]);

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
    const instance = await instanceConfig();
    return {
      contacts: { email: instance.contactEmail, discord: instance.contactDiscord, url: instance.contactUrl },
      plans: publicPlans(),
      currency: PLAN_CURRENCY
    };
  };
  app.get('/api/public/info', { config: { rateLimit: false } }, async () => {
    if (publicInfoCache && publicInfoCache.expires > Date.now()) return publicInfoCache.value;
    const value = await loadPublicInfo();
    publicInfoCache = { value, expires: Date.now() + 30_000 };
    return value;
  });

  // Plans are bought only on Discord: the website's buttons land here and go
  // to the app's store (the plan's SKU once it exists).
  app.get('/bot/store', async (request, reply) => {
    const plan = (request.query as { plan?: unknown }).plan;
    return reply.redirect(discordStoreUrl(config.clientId, isPlanTier(plan) ? plan : null));
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
    const saved = await prisma.instanceConfig.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
    publicInfoCache = null;
    await superAdminAudit(request, session, 'instance.config', null, null, data);
    return saved;
  });

  // --------------------------------------------------------- super: plans
  app.put('/api/super/guilds/:guildId/plan', async (request, reply) => {
    const session = await requireSuperMutation(request, reply);
    if (!session) return;
    const { guildId } = request.params as { guildId: string };
    // A gift: paid plans come only from Discord subscriptions.
    const parsed = z.object({
      tier: z.enum(PLAN_TIERS),
      expiresAt: z.coerce.date().nullable().optional(),
      note: nullableText(500)
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });
    const change = {
      tier: parsed.data.tier,
      expiresAt: parsed.data.expiresAt ?? null,
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

/** Super console additions: contacts, the gift and subscription of each connected server. */
export async function planOverview(guildIds: string[]) {
  const [instance, plans] = await Promise.all([
    instanceConfig(),
    prisma.guildSettings.findMany({
      where: { guildId: { in: guildIds } },
      select: { guildId: true, ...planStateSelect, planNote: true, planUpdatedAt: true, subscriptionSyncedAt: true }
    })
  ]);
  return {
    config: instance,
    plans,
    planCatalog: publicPlans(),
    currency: PLAN_CURRENCY,
    // SKUs not created yet in the Developer Portal (purchases cannot map to them).
    missingSkus: PLAN_TIERS.filter((tier) => tier !== 'FREE' && !DISCORD_PLAN_SKUS[tier])
  };
}
