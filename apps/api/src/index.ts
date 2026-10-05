import crypto from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { prisma } from '@dispatch/db';
import { config } from './config.js';
import {
  createSession,
  destroySession,
  randomToken,
  requireGuild,
  requireSession,
  resolveGuildAccess,
  type OAuthGuild
} from './auth.js';
import {
  addTicketMember,
  assignTicket,
  closeTicket,
  generateTranscript,
  getGuildResources,
  publishMainMenu,
  publishPanel,
  removeTicketMember,
  reopenTicket,
  sendTicketReply,
  setTicketPriority,
  setTicketStatus,
  transferTicket,
  unclaimTicket
} from './discord.js';
import { panelAudit } from './audit.js';
import { decryptText, encryptText, unprotectJson } from './security.js';

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';

const app = Fastify({
  // edge -> web -> api are private hops; request.ip is the first public
  // address, i.e. the client set by edge (rate limit and audit ipHash).
  trustProxy: 'loopback, linklocal, uniquelocal',
  bodyLimit: 32 * 1024,
  requestTimeout: 15_000,
  connectionTimeout: 10_000,
  maxParamLength: 256,
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'client_secret',
        '*.client_secret',
        '*.token',
        '*.password',
        '*.secret'
      ],
      censor: '[REDACTED]'
    }
  }
});

await app.register(cookie);
await app.register(helmet);
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

const allowedOrigin = new URL(config.webUrl).origin;
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

app.addHook('onRequest', async (request, reply) => {
  if (safeMethods.has(request.method)) return;
  const origin = request.headers.origin;
  if (!origin || origin !== allowedOrigin) {
    return reply.code(403).send({ error: 'CSRF_ORIGIN_REJECTED' });
  }
});

app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
  return payload;
});

const snowflake = z.string().regex(/^\d{17,20}$/);

app.addHook('preValidation', async (request, reply) => {
  const params = request.params as Record<string, unknown> | undefined;
  if (!params) return;

  for (const key of ['guildId', 'roleId']) {
    if (params[key] !== undefined && !snowflake.safeParse(params[key]).success) {
      return reply.code(400).send({ error: 'INVALID_DISCORD_ID', field: key });
    }
  }
});

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'Request failed');
  if (reply.sent) return;
  const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500
    ? error.statusCode
    : 500;
  return reply.code(status).send({
    error: status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'
  });
});

app.setNotFoundHandler((_request, reply) => {
  return reply.code(404).send({ error: 'NOT_FOUND' });
});

void prisma.panelSession.deleteMany({
  where: { expiresAt: { lt: new Date() } }
}).catch(() => null);

setInterval(() => {
  void prisma.panelSession.deleteMany({
    where: { expiresAt: { lt: new Date() } }
  }).catch(() => null);
}, 60 * 60 * 1000).unref();

app.get('/health/live', async () => ({ ok: true, service: 'dispatch-api' }));

app.get('/health', async (_request, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, service: 'dispatch-api', database: 'ready' };
  } catch {
    return reply.code(503).send({
      ok: false,
      service: 'dispatch-api',
      database: 'unavailable'
    });
  }
});

app.get('/auth/discord', async (_request, reply) => {
  const state = randomToken();
  const stateCookieName = config.production
    ? '__Host-dispatch_oauth_state'
    : 'dispatch_oauth_state';

  reply.setCookie(stateCookieName, state, {
    path: '/',
    httpOnly: true,
    secure: config.production,
    sameSite: 'lax',
    maxAge: 600
  });

  const redirectUri = `${config.publicBaseUrl}/auth/discord/callback`;
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'identify guilds');
  url.searchParams.set('state', state);

  return reply.redirect(url.toString());
});

app.get('/auth/discord/callback', async (request, reply) => {
  const query = z.object({
    code: z.string().min(1).max(2048),
    state: z.string().min(1).max(256)
  }).safeParse(request.query);

  const stateCookieName = config.production
    ? '__Host-dispatch_oauth_state'
    : 'dispatch_oauth_state';
  const stateCookie = request.cookies[stateCookieName];

  const stateMatches = Boolean(
    query.success &&
    stateCookie &&
    Buffer.byteLength(query.data.state) === Buffer.byteLength(stateCookie) &&
    crypto.timingSafeEqual(Buffer.from(query.data.state), Buffer.from(stateCookie))
  );

  if (!query.success || !stateMatches) {
    return reply.code(400).send({ error: 'INVALID_OAUTH_STATE' });
  }

  reply.clearCookie(stateCookieName, {
    path: '/',
    secure: config.production,
    sameSite: 'lax'
  });

  const redirectUri = `${config.publicBaseUrl}/auth/discord/callback`;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code: query.data.code,
    redirect_uri: redirectUri
  });

  const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(8_000)
  });

  if (!tokenResponse.ok) {
    return reply.code(502).send({ error: 'DISCORD_TOKEN_EXCHANGE_FAILED' });
  }

  const token = z.object({
    access_token: z.string().min(16).max(2048)
  }).parse(await tokenResponse.json());

  const headers = { Authorization: `Bearer ${token.access_token}` };

  const [userResponse, guildResponse] = await Promise.all([
    fetch('https://discord.com/api/v10/users/@me', {
      headers,
      signal: AbortSignal.timeout(8_000)
    }),
    fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers,
      signal: AbortSignal.timeout(8_000)
    })
  ]);

  if (!userResponse.ok || !guildResponse.ok) {
    return reply.code(502).send({ error: 'DISCORD_PROFILE_FETCH_FAILED' });
  }

  const user = await userResponse.json() as {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
  };
  const guilds = await guildResponse.json() as OAuthGuild[];

  await createSession(reply, user, guilds);
  return reply.redirect(`${config.webUrl}/dashboard`);
});

app.post('/auth/logout', async (request, reply) => {
  await destroySession(request, reply);
  return { ok: true };
});

app.get('/api/me', async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;

  return {
    userId: session.userId,
    username: session.username,
    avatarUrl: session.avatarUrl
  };
});

app.get('/api/guilds', async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;

  const memberGuildIds = session.guilds.map((guild) => guild.id);
  const installed = await prisma.guildSettings.findMany({
    where: { guildId: { in: memberGuildIds } },
    orderBy: { guildName: 'asc' }
  });

  const guildMeta = new Map(session.guilds.map((guild) => [guild.id, guild]));
  const rows = await Promise.all(installed.map(async (guild) => ({
    ...guild,
    oauth: guildMeta.get(guild.guildId) ?? null,
    access: await resolveGuildAccess(session, guild.guildId)
  })));

  return rows.filter((guild) => guild.access);
});

app.get('/api/guilds/:guildId/access', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId);
  if (!session) return;
  return { access: session.access };
});

app.get('/api/guilds/:guildId/resources', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId);
  if (!session) return;

  try {
    return await getGuildResources(guildId);
  } catch (error) {
    request.log.error({ err: error }, 'Discord resources request failed');
    return reply.code(502).send({ error: 'DISCORD_RESOURCES_FAILED' });
  }
});

app.get('/api/guilds/:guildId/access-bindings', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  return prisma.panelRoleBinding.findMany({
    where: { guildId },
    orderBy: { createdAt: 'asc' }
  });
});

app.put('/api/guilds/:guildId/access-bindings/:roleId', async (request, reply) => {
  const { guildId, roleId } = request.params as { guildId: string; roleId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  const parsed = z.object({
    accessLevel: z.enum(['VIEWER', 'MODERATOR', 'ADMIN'])
  }).safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: 'INVALID_BODY',
      details: parsed.error.flatten()
    });
  }

  // @everyone shares the guild id: binding it would grant the level to every member.
  if (roleId === guildId) {
    return reply.code(400).send({ error: 'EVERYONE_ROLE_NOT_ALLOWED' });
  }

  const resources = await getGuildResources(guildId);
  if (!resources.roles.some((role) => role.id === roleId)) {
    return reply.code(404).send({ error: 'ROLE_NOT_FOUND' });
  }

  const binding = await prisma.panelRoleBinding.upsert({
    where: {
      guildId_discordRoleId: {
        guildId,
        discordRoleId: roleId
      }
    },
    update: { accessLevel: parsed.data.accessLevel },
    create: {
      guildId,
      discordRoleId: roleId,
      accessLevel: parsed.data.accessLevel
    }
  });

  await panelAudit(request, session, guildId, 'access_binding.update', {
    roleId,
    accessLevel: parsed.data.accessLevel
  });

  return binding;
});

app.delete('/api/guilds/:guildId/access-bindings/:roleId', async (request, reply) => {
  const { guildId, roleId } = request.params as { guildId: string; roleId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  await prisma.panelRoleBinding.deleteMany({
    where: { guildId, discordRoleId: roleId }
  });

  await panelAudit(request, session, guildId, 'access_binding.delete', { roleId });
  return { ok: true };
});


const internalId = z.string().regex(/^[a-z0-9]{20,32}$/i);

const formFieldSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/i),
  label: z.string().trim().min(1).max(45),
  style: z.enum(['SHORT', 'PARAGRAPH']).default('SHORT'),
  required: z.boolean().default(true),
  placeholder: z.string().trim().max(100).nullable().default(null),
  minLength: z.number().int().min(0).max(4000).nullable().default(null),
  maxLength: z.number().int().min(1).max(4000).nullable().default(null)
}).superRefine((field, ctx) => {
  if (
    field.minLength !== null &&
    field.maxLength !== null &&
    field.minLength > field.maxLength
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'minLength cannot exceed maxLength',
      path: ['minLength']
    });
  }
});

const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().default(null),
  discordCategoryId: snowflake.nullable().default(null),
  staffRoleIds: z.array(snowflake).max(20).default([]).refine((items) => new Set(items).size === items.length),
  maxOpenPerUser: z.number().int().min(1).max(10).default(1),
  openCooldownSeconds: z.number().int().min(0).max(86400).default(60),
  antiSpamWindowMinutes: z.number().int().min(1).max(1440).default(10),
  antiSpamMaxAttempts: z.number().int().min(1).max(100).default(3),
  formFields: z.array(formFieldSchema).max(5).default([]).refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    { message: 'Form field IDs must be unique' }
  ),
  slaFirstResponseMinutes: z.number().int().min(1).max(10080).nullable().default(null),
  slaResolutionMinutes: z.number().int().min(1).max(43200).nullable().default(null),
  inactivityCloseHours: z.number().int().min(1).max(720).nullable().default(null),
  inactivityWarningMinutes: z.number().int().min(1).max(1440).nullable().default(null),
  escalationMinutes: z.number().int().min(1).max(43200).nullable().default(null),
  escalationRoleIds: z.array(snowflake).max(20).default([]).refine(
    (items) => new Set(items).size === items.length
  ),
  reopenWindowHours: z.number().int().min(1).max(720).nullable().default(null),
  feedbackEnabled: z.boolean().default(true),
  enabled: z.boolean().default(true)
}).superRefine((value, ctx) => {
  if (value.inactivityWarningMinutes !== null && value.inactivityCloseHours === null) {
    ctx.addIssue({
      code: 'custom',
      message: 'Inactivity close must be enabled when a warning is configured',
      path: ['inactivityWarningMinutes']
    });
  }

  if (
    value.inactivityWarningMinutes !== null &&
    value.inactivityCloseHours !== null &&
    value.inactivityWarningMinutes >= value.inactivityCloseHours * 60
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'Warning must occur before automatic close',
      path: ['inactivityWarningMinutes']
    });
  }
});

const ticketSystemSettingsSchema = z.object({
  antiSpamEnabled: z.boolean().default(true),
  antiSpamGlobalCooldownSeconds: z.number().int().min(0).max(86400).default(30),
  antiSpamWindowMinutes: z.number().int().min(1).max(1440).default(10),
  antiSpamMaxAttempts: z.number().int().min(1).max(100).default(5),
  antiSpamBlockMinutes: z.number().int().min(1).max(10080).default(15),
  transcriptRetentionDays: z.number().int().min(1).max(3650).nullable().default(null),
  closedTicketRetentionDays: z.number().int().min(1).max(3650).nullable().default(null),
  retentionDeleteDiscordChannel: z.boolean().default(false),
  mainMenuEnabled: z.boolean().default(false),
  mainMenuChannelId: snowflake.nullable().default(null),
  mainMenuTitle: z.string().trim().min(1).max(256).default('Centro assistenza'),
  mainMenuDescription: z.string().trim().max(2000).default('Premi il pulsante per scegliere il tipo di richiesta.'),
  mainMenuButtonLabel: z.string().trim().min(1).max(80).default('Apri un ticket'),
  mainMenuCategoryIds: z.array(internalId).max(25).default([]).refine(
    (items) => new Set(items).size === items.length
  )
}).superRefine((value, ctx) => {
  if (value.mainMenuEnabled && !value.mainMenuChannelId) {
    ctx.addIssue({
      code: 'custom',
      message: 'Main menu channel is required when enabled',
      path: ['mainMenuChannelId']
    });
  }
  if (value.mainMenuEnabled && value.mainMenuCategoryIds.length < 1) {
    ctx.addIssue({
      code: 'custom',
      message: 'At least one main menu category is required',
      path: ['mainMenuCategoryIds']
    });
  }
  if (
    value.transcriptRetentionDays !== null &&
    value.closedTicketRetentionDays !== null &&
    value.transcriptRetentionDays > value.closedTicketRetentionDays
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'Transcript retention cannot exceed closed ticket retention',
      path: ['transcriptRetentionDays']
    });
  }
});

const panelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  channelId: snowflake,
  title: z.string().trim().min(1).max(256),
  description: z.string().trim().max(2000).nullable().default(null),
  categoryIds: z.array(internalId).min(1).max(25).refine((items) => new Set(items).size === items.length),
  enabled: z.boolean().default(true)
});

async function validateCategoryResources(
  guildId: string,
  data: z.infer<typeof categorySchema>
) {
  const resources = await getGuildResources(guildId);

  if (
    data.discordCategoryId &&
    !resources.channels.some((channel) => channel.id === data.discordCategoryId && channel.type === 4)
  ) {
    return 'CATEGORY_CHANNEL_NOT_FOUND';
  }

  const roleIds = new Set(resources.roles.map((role) => role.id));
  if (data.staffRoleIds.some((roleId) => roleId === guildId || !roleIds.has(roleId))) {
    return 'STAFF_ROLE_NOT_FOUND';
  }
  if (data.escalationRoleIds.some((roleId) => roleId === guildId || !roleIds.has(roleId))) {
    return 'ESCALATION_ROLE_NOT_FOUND';
  }

  return null;
}

async function validateTicketSystemResources(
  guildId: string,
  data: z.infer<typeof ticketSystemSettingsSchema>
) {
  if (data.mainMenuChannelId) {
    const resources = await getGuildResources(guildId);
    if (!resources.channels.some(
      (channel) => channel.id === data.mainMenuChannelId && [0, 5].includes(channel.type)
    )) {
      return 'MAIN_MENU_CHANNEL_NOT_FOUND';
    }
  }

  if (data.mainMenuCategoryIds.length) {
    const count = await prisma.ticketCategory.count({
      where: {
        guildId,
        enabled: true,
        id: { in: data.mainMenuCategoryIds }
      }
    });
    if (count !== data.mainMenuCategoryIds.length) return 'MAIN_MENU_CATEGORY_NOT_FOUND';
  }

  return null;
}

async function validatePanelResources(
  guildId: string,
  data: z.infer<typeof panelSchema>
) {
  const resources = await getGuildResources(guildId);
  if (!resources.channels.some((channel) => channel.id === data.channelId && [0, 5].includes(channel.type))) {
    return 'PANEL_CHANNEL_NOT_FOUND';
  }

  const count = await prisma.ticketCategory.count({
    where: {
      guildId,
      id: { in: data.categoryIds }
    }
  });
  if (count !== data.categoryIds.length) return 'CATEGORY_NOT_FOUND';

  return null;
}

app.get('/api/guilds/:guildId/ticket-system-settings', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: {
      antiSpamEnabled: true,
      antiSpamGlobalCooldownSeconds: true,
      antiSpamWindowMinutes: true,
      antiSpamMaxAttempts: true,
      antiSpamBlockMinutes: true,
      transcriptRetentionDays: true,
      closedTicketRetentionDays: true,
      retentionDeleteDiscordChannel: true,
      mainMenuEnabled: true,
      mainMenuChannelId: true,
      mainMenuMessageId: true,
      mainMenuTitle: true,
      mainMenuDescription: true,
      mainMenuButtonLabel: true,
      mainMenuCategoryIds: true
    }
  });
  if (!settings) return reply.code(404).send({ error: 'GUILD_NOT_FOUND' });

  return settings;
});

app.put('/api/guilds/:guildId/ticket-system-settings', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  const parsed = ticketSystemSettingsSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_BODY', details: parsed.error.flatten() });
  }

  const resourceError = await validateTicketSystemResources(guildId, parsed.data);
  if (resourceError) return reply.code(400).send({ error: resourceError });

  const previous = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { mainMenuChannelId: true }
  });
  if (!previous) return reply.code(404).send({ error: 'GUILD_NOT_FOUND' });

  const settings = await prisma.guildSettings.update({
    where: { guildId },
    data: {
      ...parsed.data,
      ...(previous.mainMenuChannelId !== parsed.data.mainMenuChannelId
        ? { mainMenuMessageId: null }
        : {})
    }
  });

  await panelAudit(request, session, guildId, 'ticket_system_settings.update', {
    antiSpamEnabled: settings.antiSpamEnabled,
    transcriptRetentionDays: settings.transcriptRetentionDays,
    closedTicketRetentionDays: settings.closedTicketRetentionDays,
    mainMenuEnabled: settings.mainMenuEnabled,
    mainMenuChannelId: settings.mainMenuChannelId,
    mainMenuCategoryCount: settings.mainMenuCategoryIds.length
  });

  return settings;
});

app.post('/api/guilds/:guildId/main-menu/publish', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  try {
    const result = await publishMainMenu(guildId);
    await panelAudit(request, session, guildId, 'main_menu.publish', {
      messageId: result.messageId
    });
    return result;
  } catch (error) {
    request.log.error({ err: error, guildId }, 'Main menu publish failed');
    return reply.code(502).send({ error: 'MAIN_MENU_PUBLISH_FAILED' });
  }
});

app.get('/api/guilds/:guildId/categories', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId);
  if (!session) return;

  return prisma.ticketCategory.findMany({
    where: { guildId },
    orderBy: { createdAt: 'asc' }
  });
});

app.post('/api/guilds/:guildId/categories', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  const parsed = categorySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_BODY', details: parsed.error.flatten() });
  }

  const resourceError = await validateCategoryResources(guildId, parsed.data);
  if (resourceError) return reply.code(400).send({ error: resourceError });

  const { formFields, ...categoryData } = parsed.data;
  const category = await prisma.ticketCategory.create({
    data: {
      guildId,
      ...categoryData,
      formFields: JSON.parse(JSON.stringify(formFields))
    }
  });
  await panelAudit(request, session, guildId, 'ticket_category.create', {
    categoryId: category.id,
    name: category.name
  });
  return reply.code(201).send(category);
});

app.put('/api/guilds/:guildId/categories/:categoryId', async (request, reply) => {
  const { guildId, categoryId } = request.params as { guildId: string; categoryId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  if (!internalId.safeParse(categoryId).success) {
    return reply.code(400).send({ error: 'INVALID_CATEGORY_ID' });
  }

  const existing = await prisma.ticketCategory.findFirst({ where: { id: categoryId, guildId } });
  if (!existing) return reply.code(404).send({ error: 'CATEGORY_NOT_FOUND' });

  const parsed = categorySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_BODY', details: parsed.error.flatten() });
  }

  const resourceError = await validateCategoryResources(guildId, parsed.data);
  if (resourceError) return reply.code(400).send({ error: resourceError });

  const { formFields, ...categoryData } = parsed.data;
  const category = await prisma.ticketCategory.update({
    where: { id: categoryId },
    data: {
      ...categoryData,
      formFields: JSON.parse(JSON.stringify(formFields))
    }
  });
  if (!category.enabled) {
    const settings = await prisma.guildSettings.findUnique({
      where: { guildId },
      select: { mainMenuCategoryIds: true }
    });

    if (settings?.mainMenuCategoryIds.includes(category.id)) {
      await prisma.guildSettings.update({
        where: { guildId },
        data: {
          mainMenuCategoryIds: settings.mainMenuCategoryIds.filter((id) => id !== category.id),
          mainMenuMessageId: null
        }
      });
    }
  }

  await panelAudit(request, session, guildId, 'ticket_category.update', {
    categoryId,
    name: category.name
  });
  return category;
});

app.delete('/api/guilds/:guildId/categories/:categoryId', async (request, reply) => {
  const { guildId, categoryId } = request.params as { guildId: string; categoryId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  if (!internalId.safeParse(categoryId).success) {
    return reply.code(400).send({ error: 'INVALID_CATEGORY_ID' });
  }

  const category = await prisma.ticketCategory.findFirst({ where: { id: categoryId, guildId } });
  if (!category) return reply.code(404).send({ error: 'CATEGORY_NOT_FOUND' });

  const ticketCount = await prisma.ticket.count({ where: { categoryId } });
  if (ticketCount > 0) {
    return reply.code(409).send({ error: 'CATEGORY_IN_USE', tickets: ticketCount });
  }

  const [panels, settings] = await Promise.all([
    prisma.ticketPanel.findMany({
      where: { guildId, categoryIds: { has: categoryId } }
    }),
    prisma.guildSettings.findUnique({
      where: { guildId },
      select: { mainMenuCategoryIds: true }
    })
  ]);

  await prisma.$transaction([
    ...panels.map((panel) => prisma.ticketPanel.update({
      where: { id: panel.id },
      data: { categoryIds: panel.categoryIds.filter((id) => id !== categoryId) }
    })),
    ...(settings?.mainMenuCategoryIds.includes(categoryId) ? [
      prisma.guildSettings.update({
        where: { guildId },
        data: {
          mainMenuCategoryIds: settings.mainMenuCategoryIds.filter((id) => id !== categoryId),
          mainMenuMessageId: null
        }
      })
    ] : []),
    prisma.ticketCategory.delete({ where: { id: categoryId } })
  ]);

  await panelAudit(request, session, guildId, 'ticket_category.delete', {
    categoryId,
    name: category.name
  });
  return { ok: true };
});

app.get('/api/guilds/:guildId/panels', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId);
  if (!session) return;

  return prisma.ticketPanel.findMany({
    where: { guildId },
    orderBy: { createdAt: 'asc' }
  });
});

app.post('/api/guilds/:guildId/panels', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  const parsed = panelSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_BODY', details: parsed.error.flatten() });
  }

  const resourceError = await validatePanelResources(guildId, parsed.data);
  if (resourceError) return reply.code(400).send({ error: resourceError });

  const panel = await prisma.ticketPanel.create({
    data: { guildId, ...parsed.data }
  });
  await panelAudit(request, session, guildId, 'ticket_panel.create', {
    panelId: panel.id,
    name: panel.name
  });
  return reply.code(201).send(panel);
});

app.put('/api/guilds/:guildId/panels/:panelId', async (request, reply) => {
  const { guildId, panelId } = request.params as { guildId: string; panelId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  if (!internalId.safeParse(panelId).success) {
    return reply.code(400).send({ error: 'INVALID_PANEL_ID' });
  }

  const existing = await prisma.ticketPanel.findFirst({ where: { id: panelId, guildId } });
  if (!existing) return reply.code(404).send({ error: 'PANEL_NOT_FOUND' });

  const parsed = panelSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'INVALID_BODY', details: parsed.error.flatten() });
  }

  const resourceError = await validatePanelResources(guildId, parsed.data);
  if (resourceError) return reply.code(400).send({ error: resourceError });

  const panel = await prisma.ticketPanel.update({
    where: { id: panelId },
    data: parsed.data
  });
  await panelAudit(request, session, guildId, 'ticket_panel.update', {
    panelId,
    name: panel.name
  });
  return panel;
});

app.delete('/api/guilds/:guildId/panels/:panelId', async (request, reply) => {
  const { guildId, panelId } = request.params as { guildId: string; panelId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  if (!internalId.safeParse(panelId).success) {
    return reply.code(400).send({ error: 'INVALID_PANEL_ID' });
  }

  const panel = await prisma.ticketPanel.findFirst({ where: { id: panelId, guildId } });
  if (!panel) return reply.code(404).send({ error: 'PANEL_NOT_FOUND' });

  await prisma.ticketPanel.delete({ where: { id: panelId } });
  await panelAudit(request, session, guildId, 'ticket_panel.delete', {
    panelId,
    name: panel.name,
    messageId: panel.messageId
  });
  return { ok: true };
});

app.post('/api/guilds/:guildId/panels/:panelId/publish', async (request, reply) => {
  const { guildId, panelId } = request.params as { guildId: string; panelId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  if (!internalId.safeParse(panelId).success) {
    return reply.code(400).send({ error: 'INVALID_PANEL_ID' });
  }

  const panel = await prisma.ticketPanel.findFirst({ where: { id: panelId, guildId } });
  if (!panel) return reply.code(404).send({ error: 'PANEL_NOT_FOUND' });

  try {
    const result = await publishPanel(guildId, panelId);
    await panelAudit(request, session, guildId, 'ticket_panel.publish', {
      panelId,
      messageId: result.messageId
    });
    return result;
  } catch (error) {
    request.log.error({ err: error, guildId, panelId }, 'Panel publish failed');
    return reply.code(502).send({ error: 'PANEL_PUBLISH_FAILED' });
  }
});


const ticketStatus = z.enum(['OPEN', 'WAITING', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);

function ensureInternalId(value: string, error: string) {
  if (!internalId.safeParse(value).success) throw Object.assign(new Error(error), { statusCode: 400 });
}

async function runTicketBotAction<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  fn: () => Promise<T>
) {
  try {
    return await fn();
  } catch (error) {
    request.log.error({ err: error }, 'Ticket bot action failed');
    const typed = error as Error & { status?: number; code?: string };
    if (typed.status === 404) return reply.code(404).send({ error: typed.code ?? 'DISCORD_RESOURCE_NOT_FOUND' });
    if (typed.status === 409) return reply.code(409).send({ error: typed.code ?? 'TICKET_STATE_CONFLICT' });
    if (typed.status === 400) return reply.code(400).send({ error: typed.code ?? 'TICKET_ACTION_REJECTED' });
    return reply.code(502).send({ error: 'BOT_OPERATION_FAILED' });
  }
}



app.get('/api/guilds/:guildId/blacklist', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  await prisma.guildBlacklist.deleteMany({
    where: {
      guildId,
      expiresAt: { lt: new Date() }
    }
  });

  const entries = await prisma.guildBlacklist.findMany({
    where: { guildId },
    orderBy: { createdAt: 'desc' }
  });

  return entries.map((entry) => ({
    id: entry.id,
    userId: entry.userId,
    reason: decryptText(entry.reasonEncrypted),
    expiresAt: entry.expiresAt,
    createdById: entry.createdById,
    createdAt: entry.createdAt
  }));
});

app.post('/api/guilds/:guildId/blacklist', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  const parsed = z.object({
    userId: snowflake,
    reason: z.string().trim().max(1000).nullable().optional(),
    expiresInHours: z.number().int().min(1).max(8760).nullable().optional()
  }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });

  const expiresAt = parsed.data.expiresInHours
    ? new Date(Date.now() + parsed.data.expiresInHours * 3_600_000)
    : null;

  const entry = await prisma.guildBlacklist.upsert({
    where: {
      guildId_userId: {
        guildId,
        userId: parsed.data.userId
      }
    },
    update: {
      reasonEncrypted: parsed.data.reason ? encryptText(parsed.data.reason) : null,
      expiresAt,
      createdById: session.userId
    },
    create: {
      guildId,
      userId: parsed.data.userId,
      reasonEncrypted: parsed.data.reason ? encryptText(parsed.data.reason) : null,
      expiresAt,
      createdById: session.userId
    }
  });

  await panelAudit(request, session, guildId, 'blacklist.upsert', {
    userId: parsed.data.userId,
    expiresAt: entry.expiresAt?.toISOString() ?? null,
    reasonProvided: Boolean(parsed.data.reason)
  });

  return reply.code(201).send({
    id: entry.id,
    userId: entry.userId,
    reason: parsed.data.reason ?? null,
    expiresAt: entry.expiresAt,
    createdById: entry.createdById,
    createdAt: entry.createdAt
  });
});

app.delete('/api/guilds/:guildId/blacklist/:userId', async (request, reply) => {
  const { guildId, userId } = request.params as { guildId: string; userId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;
  if (!snowflake.safeParse(userId).success) {
    return reply.code(400).send({ error: 'INVALID_DISCORD_ID', field: 'userId' });
  }

  const deleted = await prisma.guildBlacklist.deleteMany({
    where: { guildId, userId }
  });
  if (!deleted.count) return reply.code(404).send({ error: 'BLACKLIST_ENTRY_NOT_FOUND' });

  await panelAudit(request, session, guildId, 'blacklist.delete', { userId });
  return { ok: true };
});

app.get('/api/guilds/:guildId/analytics', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;

  const parsed = z.object({
    days: z.coerce.number().int().min(1).max(365).default(30)
  }).safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY' });

  const days = parsed.data.days;
  const since = new Date(Date.now() - days * 86_400_000);

  const [tickets, currentOpen, staffEvents, currentAssignments] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        guildId,
        createdAt: { gte: since }
      },
      select: {
        id: true,
        categoryId: true,
        status: true,
        claimedById: true,
        createdAt: true,
        firstStaffResponseAt: true,
        closedAt: true,
        slaFirstBreachedAt: true,
        slaResolutionBreachedAt: true,
        category: { select: { name: true } },
        feedback: { select: { rating: true } }
      }
    }),
    prisma.ticket.count({
      where: {
        guildId,
        status: { not: 'CLOSED' }
      }
    }),
    prisma.ticketAudit.findMany({
      where: {
        guildId,
        createdAt: { gte: since },
        action: {
          in: [
            'ticket.claim',
            'ticket.assign',
            'ticket.first_staff_response',
            'ticket.reply'
          ]
        }
      },
      select: {
        actorId: true,
        action: true,
        details: true
      }
    }),
    prisma.ticket.groupBy({
      by: ['claimedById'],
      where: {
        guildId,
        status: { not: 'CLOSED' },
        claimedById: { not: null }
      },
      _count: { _all: true }
    })
  ]);

  const average = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

  const firstResponseMinutes = tickets.flatMap((ticket) =>
    ticket.firstStaffResponseAt
      ? [(ticket.firstStaffResponseAt.getTime() - ticket.createdAt.getTime()) / 60_000]
      : []
  );
  const resolutionMinutes = tickets.flatMap((ticket) =>
    ticket.closedAt
      ? [(ticket.closedAt.getTime() - ticket.createdAt.getTime()) / 60_000]
      : []
  );
  const ratings = tickets.flatMap((ticket) => ticket.feedback ? [ticket.feedback.rating] : []);

  const categoryMap = new Map<string, {
    id: string;
    name: string;
    created: number;
    closed: number;
    ratings: number[];
  }>();

  for (const ticket of tickets) {
    const current = categoryMap.get(ticket.categoryId) ?? {
      id: ticket.categoryId,
      name: ticket.category.name,
      created: 0,
      closed: 0,
      ratings: []
    };
    current.created += 1;
    if (ticket.closedAt) current.closed += 1;
    if (ticket.feedback) current.ratings.push(ticket.feedback.rating);
    categoryMap.set(ticket.categoryId, current);
  }

  const staffMap = new Map<string, {
    userId: string;
    claims: number;
    closures: number;
    firstResponses: number;
    replies: number;
    currentlyAssigned: number;
    ratings: number[];
  }>();

  for (const event of staffEvents) {
    let staffId = event.actorId;

    if (event.action === 'ticket.assign') {
      const details = event.details && typeof event.details === 'object' && !Array.isArray(event.details)
        ? event.details as Record<string, unknown>
        : null;
      if (details && typeof details.assigneeId === 'string') {
        staffId = details.assigneeId;
      }
    }

    if (!staffId) continue;

    const row = staffMap.get(staffId) ?? {
      userId: staffId,
      claims: 0,
      closures: 0,
      firstResponses: 0,
      replies: 0,
      currentlyAssigned: 0,
      ratings: []
    };

    if (event.action === 'ticket.claim' || event.action === 'ticket.assign') row.claims += 1;
    if (event.action === 'ticket.first_staff_response') row.firstResponses += 1;
    if (event.action === 'ticket.reply') row.replies += 1;
    staffMap.set(staffId, row);
  }

  for (const assignment of currentAssignments) {
    if (!assignment.claimedById) continue;
    const row = staffMap.get(assignment.claimedById) ?? {
      userId: assignment.claimedById,
      claims: 0,
      closures: 0,
      firstResponses: 0,
      replies: 0,
      currentlyAssigned: 0,
      ratings: []
    };
    row.currentlyAssigned = assignment._count._all;
    staffMap.set(assignment.claimedById, row);
  }

  for (const ticket of tickets) {
    if (!ticket.claimedById) continue;
    const row = staffMap.get(ticket.claimedById) ?? {
      userId: ticket.claimedById,
      claims: 0,
      closures: 0,
      firstResponses: 0,
      replies: 0,
      currentlyAssigned: 0,
      ratings: []
    };
    if (ticket.closedAt) row.closures += 1;
    if (ticket.feedback) row.ratings.push(ticket.feedback.rating);
    staffMap.set(ticket.claimedById, row);
  }

  const dayMap = new Map<string, { date: string; created: number; closed: number }>();
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(Date.now() - index * 86_400_000).toISOString().slice(0, 10);
    dayMap.set(date, { date, created: 0, closed: 0 });
  }
  for (const ticket of tickets) {
    const createdKey = ticket.createdAt.toISOString().slice(0, 10);
    const createdRow = dayMap.get(createdKey);
    if (createdRow) createdRow.created += 1;
    if (ticket.closedAt) {
      const closedKey = ticket.closedAt.toISOString().slice(0, 10);
      const closedRow = dayMap.get(closedKey);
      if (closedRow) closedRow.closed += 1;
    }
  }

  const closedCount = tickets.filter((ticket) => ticket.closedAt).length;
  const firstBreachCount = tickets.filter((ticket) => ticket.slaFirstBreachedAt).length;
  const resolutionBreachCount = tickets.filter((ticket) => ticket.slaResolutionBreachedAt).length;

  return {
    period: { days, since },
    summary: {
      created: tickets.length,
      closed: closedCount,
      currentOpen,
      averageFirstResponseMinutes: average(firstResponseMinutes),
      averageResolutionMinutes: average(resolutionMinutes),
      firstResponseSlaBreaches: firstBreachCount,
      resolutionSlaBreaches: resolutionBreachCount,
      feedbackCount: ratings.length,
      averageRating: average(ratings)
    },
    categories: [...categoryMap.values()].map((row) => ({
      id: row.id,
      name: row.name,
      created: row.created,
      closed: row.closed,
      averageRating: average(row.ratings)
    })).sort((a, b) => b.created - a.created),
    staff: [...staffMap.values()].map((row) => ({
      userId: row.userId,
      claims: row.claims,
      closures: row.closures,
      firstResponses: row.firstResponses,
      replies: row.replies,
      currentlyAssigned: row.currentlyAssigned,
      averageRating: average(row.ratings)
    })).sort((a, b) => b.closures - a.closures || b.replies - a.replies),
    daily: [...dayMap.values()]
  };
});

app.get('/api/guilds/:guildId/response-templates', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;

  const templates = await prisma.responseTemplate.findMany({
    where: { guildId },
    orderBy: { name: 'asc' }
  });

  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    content: decryptText(template.contentEncrypted),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt
  }));
});

app.post('/api/guilds/:guildId/response-templates', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  const parsed = z.object({
    name: z.string().trim().min(1).max(80),
    content: z.string().trim().min(1).max(2000)
  }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });

  try {
    const template = await prisma.responseTemplate.create({
      data: {
        guildId,
        name: parsed.data.name,
        contentEncrypted: encryptText(parsed.data.content)!
      }
    });

    await panelAudit(request, session, guildId, 'response_template.create', {
      templateId: template.id,
      name: template.name
    });

    return reply.code(201).send({
      id: template.id,
      name: template.name,
      content: parsed.data.content
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    request.log.warn({ err: error }, 'Response template creation failed');
    return reply.code(409).send({ error: 'TEMPLATE_NAME_CONFLICT' });
  }
});

app.put('/api/guilds/:guildId/response-templates/:templateId', async (request, reply) => {
  const { guildId, templateId } = request.params as { guildId: string; templateId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;
  if (!internalId.safeParse(templateId).success) return reply.code(400).send({ error: 'INVALID_TEMPLATE_ID' });

  const parsed = z.object({
    name: z.string().trim().min(1).max(80),
    content: z.string().trim().min(1).max(2000)
  }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });

  const existing = await prisma.responseTemplate.findFirst({ where: { id: templateId, guildId } });
  if (!existing) return reply.code(404).send({ error: 'TEMPLATE_NOT_FOUND' });

  try {
    const template = await prisma.responseTemplate.update({
      where: { id: templateId },
      data: {
        name: parsed.data.name,
        contentEncrypted: encryptText(parsed.data.content)!
      }
    });

    await panelAudit(request, session, guildId, 'response_template.update', {
      templateId,
      name: template.name
    });

    return { id: template.id, name: template.name, content: parsed.data.content };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return reply.code(409).send({ error: 'TEMPLATE_NAME_CONFLICT' });
  }
});

app.delete('/api/guilds/:guildId/response-templates/:templateId', async (request, reply) => {
  const { guildId, templateId } = request.params as { guildId: string; templateId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;
  if (!internalId.safeParse(templateId).success) return reply.code(400).send({ error: 'INVALID_TEMPLATE_ID' });

  const template = await prisma.responseTemplate.findFirst({ where: { id: templateId, guildId } });
  if (!template) return reply.code(404).send({ error: 'TEMPLATE_NOT_FOUND' });

  await prisma.responseTemplate.delete({ where: { id: templateId } });
  await panelAudit(request, session, guildId, 'response_template.delete', {
    templateId,
    name: template.name
  });
  return { ok: true };
});

app.get('/api/guilds/:guildId/tickets', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;

  const parsed = z.object({
    status: ticketStatus.optional(),
    page: z.coerce.number().int().min(1).default(1),
    take: z.coerce.number().int().min(1).max(100).default(50)
  }).safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY' });

  const { status, page, take } = parsed.data;
  const where = {
    guildId,
    ...(status ? { status } : {})
  };

  const [items, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        _count: { select: { members: true } },
        transcript: { select: { messageCount: true, createdAt: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * take,
      take
    }),
    prisma.ticket.count({ where })
  ]);

  return {
    items: items.map((ticket) => ({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      openerId: ticket.openerId,
      channelId: ticket.channelId,
      status: ticket.status,
      priority: ticket.priority,
      claimedById: ticket.claimedById,
      category: ticket.category,
      memberCount: ticket._count.members,
      transcript: ticket.transcript,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      closedAt: ticket.closedAt
    })),
    total,
    page,
    take,
    pages: Math.max(1, Math.ceil(total / take))
  };
});

app.get('/api/guilds/:guildId/tickets/:ticketId', async (request, reply) => {
  const { guildId, ticketId } = request.params as { guildId: string; ticketId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;
  if (!internalId.safeParse(ticketId).success) return reply.code(400).send({ error: 'INVALID_TICKET_ID' });

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId },
    include: {
      category: true,
      members: { orderBy: { createdAt: 'asc' } },
      audit: { orderBy: { createdAt: 'desc' }, take: 200 },
      notes: { orderBy: { createdAt: 'desc' }, take: 200 },
      feedback: true,
      transcript: { select: { messageCount: true, createdAt: true } }
    }
  });
  if (!ticket) return reply.code(404).send({ error: 'TICKET_NOT_FOUND' });

  let formData: unknown = [];
  const decryptedForm = decryptText(ticket.formDataEncrypted);
  if (decryptedForm) {
    try {
      formData = JSON.parse(decryptedForm);
    } catch {
      formData = [];
    }
  }

  return {
    ...ticket,
    closeReason: decryptText(ticket.closeReason),
    formData,
    formDataEncrypted: undefined,
    notes: ticket.notes.map((note) => ({
      id: note.id,
      authorId: note.authorId,
      content: decryptText(note.contentEncrypted),
      createdAt: note.createdAt
    })),
    feedback: ticket.feedback ? {
      id: ticket.feedback.id,
      rating: ticket.feedback.rating,
      comment: decryptText(ticket.feedback.commentEncrypted),
      createdAt: ticket.feedback.createdAt,
      updatedAt: ticket.feedback.updatedAt
    } : null
  };
});


app.post('/api/guilds/:guildId/tickets/:ticketId/status', async (request, reply) => {
  const { guildId, ticketId } = request.params as { guildId: string; ticketId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;
  if (!internalId.safeParse(ticketId).success) return reply.code(400).send({ error: 'INVALID_TICKET_ID' });

  const parsed = z.object({
    status: z.enum(['OPEN', 'WAITING', 'IN_PROGRESS', 'RESOLVED'])
  }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });

  return runTicketBotAction(request, reply, () =>
    setTicketStatus(guildId, ticketId, session.userId, parsed.data.status)
  );
});

app.post('/api/guilds/:guildId/tickets/:ticketId/priority', async (request, reply) => {
  const { guildId, ticketId } = request.params as { guildId: string; ticketId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;
  if (!internalId.safeParse(ticketId).success) return reply.code(400).send({ error: 'INVALID_TICKET_ID' });

  const parsed = z.object({
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });

  return runTicketBotAction(request, reply, () =>
    setTicketPriority(guildId, ticketId, session.userId, parsed.data.priority)
  );
});

app.post('/api/guilds/:guildId/tickets/:ticketId/notes', async (request, reply) => {
  const { guildId, ticketId } = request.params as { guildId: string; ticketId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;
  if (!internalId.safeParse(ticketId).success) return reply.code(400).send({ error: 'INVALID_TICKET_ID' });

  const parsed = z.object({
    content: z.string().trim().min(1).max(4000)
  }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId },
    select: { id: true }
  });
  if (!ticket) return reply.code(404).send({ error: 'TICKET_NOT_FOUND' });

  const note = await prisma.ticketNote.create({
    data: {
      ticketId,
      guildId,
      authorId: session.userId,
      contentEncrypted: encryptText(parsed.data.content)!
    }
  });

  await prisma.ticketAudit.create({
    data: {
      ticketId,
      guildId,
      actorId: session.userId,
      action: 'ticket.note.add',
      details: { noteId: note.id, contentLength: parsed.data.content.length }
    }
  });

  return reply.code(201).send({
    id: note.id,
    authorId: note.authorId,
    content: parsed.data.content,
    createdAt: note.createdAt
  });
});

app.delete('/api/guilds/:guildId/tickets/:ticketId/notes/:noteId', async (request, reply) => {
  const { guildId, ticketId, noteId } = request.params as {
    guildId: string;
    ticketId: string;
    noteId: string;
  };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;
  if (!internalId.safeParse(ticketId).success || !internalId.safeParse(noteId).success) {
    return reply.code(400).send({ error: 'INVALID_INTERNAL_ID' });
  }

  const note = await prisma.ticketNote.findFirst({
    where: { id: noteId, ticketId, guildId }
  });
  if (!note) return reply.code(404).send({ error: 'NOTE_NOT_FOUND' });

  const canDelete = session.access === 'ADMIN' ||
    session.access === 'OWNER' ||
    note.authorId === session.userId;
  if (!canDelete) return reply.code(403).send({ error: 'FORBIDDEN' });

  await prisma.ticketNote.delete({ where: { id: note.id } });
  await prisma.ticketAudit.create({
    data: {
      ticketId,
      guildId,
      actorId: session.userId,
      action: 'ticket.note.delete',
      details: { noteId }
    }
  });

  return { ok: true };
});

app.post('/api/guilds/:guildId/tickets/:ticketId/reply', async (request, reply) => {
  const { guildId, ticketId } = request.params as { guildId: string; ticketId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;
  if (!internalId.safeParse(ticketId).success) return reply.code(400).send({ error: 'INVALID_TICKET_ID' });

  const parsed = z.object({
    templateId: internalId.nullable().optional(),
    content: z.string().trim().min(1).max(2000).optional()
  }).refine((value) => Boolean(value.templateId) !== Boolean(value.content), {
    message: 'Provide either templateId or content'
  }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });

  let content = parsed.data.content ?? '';
  let templateId: string | null = null;

  if (parsed.data.templateId) {
    const template = await prisma.responseTemplate.findFirst({
      where: { id: parsed.data.templateId, guildId }
    });
    if (!template) return reply.code(404).send({ error: 'TEMPLATE_NOT_FOUND' });
    content = decryptText(template.contentEncrypted) ?? '';
    templateId = template.id;
  }

  if (!content.trim()) return reply.code(400).send({ error: 'EMPTY_REPLY' });

  return runTicketBotAction(request, reply, () =>
    sendTicketReply(guildId, ticketId, session.userId, content, templateId)
  );
});

app.post('/api/guilds/:guildId/tickets/:ticketId/unclaim', async (request, reply) => {
  const { guildId, ticketId } = request.params as { guildId: string; ticketId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;
  if (!internalId.safeParse(ticketId).success) return reply.code(400).send({ error: 'INVALID_TICKET_ID' });

  return runTicketBotAction(request, reply, () => unclaimTicket(guildId, ticketId, session.userId));
});

app.post('/api/guilds/:guildId/tickets/:ticketId/assign', async (request, reply) => {
  const { guildId, ticketId } = request.params as { guildId: string; ticketId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;
  if (!internalId.safeParse(ticketId).success) return reply.code(400).send({ error: 'INVALID_TICKET_ID' });

  const parsed = z.object({ assigneeId: snowflake }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });

  return runTicketBotAction(request, reply, () =>
    assignTicket(guildId, ticketId, session.userId, parsed.data.assigneeId)
  );
});

app.post('/api/guilds/:guildId/tickets/:ticketId/transfer', async (request, reply) => {
  const { guildId, ticketId } = request.params as { guildId: string; ticketId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;
  if (!internalId.safeParse(ticketId).success) return reply.code(400).send({ error: 'INVALID_TICKET_ID' });

  const parsed = z.object({ categoryId: internalId }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });

  return runTicketBotAction(request, reply, () =>
    transferTicket(guildId, ticketId, session.userId, parsed.data.categoryId)
  );
});

app.post('/api/guilds/:guildId/tickets/:ticketId/members', async (request, reply) => {
  const { guildId, ticketId } = request.params as { guildId: string; ticketId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;
  if (!internalId.safeParse(ticketId).success) return reply.code(400).send({ error: 'INVALID_TICKET_ID' });

  const parsed = z.object({ userId: snowflake }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });

  return runTicketBotAction(request, reply, () =>
    addTicketMember(guildId, ticketId, session.userId, parsed.data.userId)
  );
});

app.delete('/api/guilds/:guildId/tickets/:ticketId/members/:userId', async (request, reply) => {
  const { guildId, ticketId, userId } = request.params as { guildId: string; ticketId: string; userId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;
  if (!internalId.safeParse(ticketId).success) return reply.code(400).send({ error: 'INVALID_TICKET_ID' });
  if (!snowflake.safeParse(userId).success) return reply.code(400).send({ error: 'INVALID_DISCORD_ID', field: 'userId' });

  return runTicketBotAction(request, reply, () =>
    removeTicketMember(guildId, ticketId, session.userId, userId)
  );
});

app.post('/api/guilds/:guildId/tickets/:ticketId/close', async (request, reply) => {
  const { guildId, ticketId } = request.params as { guildId: string; ticketId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;
  if (!internalId.safeParse(ticketId).success) return reply.code(400).send({ error: 'INVALID_TICKET_ID' });

  const parsed = z.object({
    reason: z.string().trim().max(1000).nullable().optional()
  }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });

  return runTicketBotAction(request, reply, () =>
    closeTicket(guildId, ticketId, session.userId, parsed.data.reason || null)
  );
});

app.post('/api/guilds/:guildId/tickets/:ticketId/reopen', async (request, reply) => {
  const { guildId, ticketId } = request.params as { guildId: string; ticketId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;
  if (!internalId.safeParse(ticketId).success) return reply.code(400).send({ error: 'INVALID_TICKET_ID' });

  return runTicketBotAction(request, reply, () =>
    reopenTicket(guildId, ticketId, session.userId)
  );
});

app.post('/api/guilds/:guildId/tickets/:ticketId/transcript', async (request, reply) => {
  const { guildId, ticketId } = request.params as { guildId: string; ticketId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;
  if (!internalId.safeParse(ticketId).success) return reply.code(400).send({ error: 'INVALID_TICKET_ID' });

  return runTicketBotAction(request, reply, () =>
    generateTranscript(guildId, ticketId, session.userId)
  );
});

app.get('/api/guilds/:guildId/tickets/:ticketId/transcript', async (request, reply) => {
  const { guildId, ticketId } = request.params as { guildId: string; ticketId: string };
  const session = await requireGuild(request, reply, guildId, 'MODERATOR');
  if (!session) return;
  if (!internalId.safeParse(ticketId).success) return reply.code(400).send({ error: 'INVALID_TICKET_ID' });

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, guildId },
    select: {
      ticketNumber: true,
      transcript: { select: { contentEncrypted: true } }
    }
  });
  if (!ticket) return reply.code(404).send({ error: 'TICKET_NOT_FOUND' });
  if (!ticket.transcript) return reply.code(404).send({ error: 'TRANSCRIPT_NOT_FOUND' });

  const html = decryptText(ticket.transcript.contentEncrypted);
  if (!html) return reply.code(500).send({ error: 'TRANSCRIPT_DECRYPT_FAILED' });

  reply.header('Content-Disposition', `attachment; filename="dispatch-ticket-${ticket.ticketNumber}.html"`);
  return reply.type('text/html; charset=utf-8').send(html);
});

app.get('/api/guilds/:guildId/panel-audit', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  const entries = await prisma.panelAudit.findMany({
    where: { guildId },
    orderBy: { createdAt: 'desc' },
    take: 200
  });
  return entries.map((entry) => ({ ...entry, details: unprotectJson(entry.details) }));
});

await app.listen({
  host: '0.0.0.0',
  port: config.port
});
