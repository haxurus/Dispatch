import crypto from 'node:crypto';
import Fastify from 'fastify';
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
import { getGuildResources } from './discord.js';
import { panelAudit } from './audit.js';

const app = Fastify({
  trustProxy: 1,
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
    query.data.state.length === stateCookie.length &&
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

app.get('/api/guilds/:guildId/panel-audit', async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const session = await requireGuild(request, reply, guildId, 'ADMIN');
  if (!session) return;

  return prisma.panelAudit.findMany({
    where: { guildId },
    orderBy: { createdAt: 'desc' },
    take: 200
  });
});

await app.listen({
  host: '0.0.0.0',
  port: config.port
});
