import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@dispatch/db';
import { config } from './config.js';
import { getGuildAccessSnapshot } from './discord.js';
import { protectJson, unprotectJson } from './security.js';

export type OAuthGuild = {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
};

export type SessionInfo = {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  guilds: OAuthGuild[];
};

export type AccessLevel = 'VIEWER' | 'MODERATOR' | 'ADMIN' | 'OWNER';

const rank: Record<AccessLevel, number> = {
  VIEWER: 1,
  MODERATOR: 2,
  ADMIN: 3,
  OWNER: 4
};

const cookieName = () => config.production ? '__Host-dispatch_session' : 'dispatch_session';
const hash = (value: string) => crypto.createHmac('sha256', config.sessionSecret).update(value).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');

const accessCache = new Map<string, {
  owner: boolean;
  permissions: bigint;
  roles: string[];
  expires: number;
}>();

export async function createSession(
  reply: FastifyReply,
  user: { id: string; username: string; global_name?: string | null; avatar?: string | null },
  guilds: OAuthGuild[]
) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
    : null;

  await prisma.panelSession.create({
    data: {
      sessionTokenHash: hash(token),
      userId: user.id,
      username: user.global_name || user.username,
      avatarUrl,
      guilds: protectJson(guilds),
      expiresAt
    }
  });

  reply.setCookie(cookieName(), token, {
    path: '/',
    httpOnly: true,
    secure: config.production,
    sameSite: 'lax',
    expires: expiresAt
  });
}

export async function getSession(request: FastifyRequest): Promise<SessionInfo | null> {
  const token = request.cookies[cookieName()];
  if (!token) return null;

  const session = await prisma.panelSession.findUnique({
    where: { sessionTokenHash: hash(token) }
  });

  if (!session || session.expiresAt < new Date()) return null;

  await prisma.panelSession.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() }
  }).catch(() => null);

  return {
    id: session.id,
    userId: session.userId,
    username: session.username,
    avatarUrl: session.avatarUrl,
    guilds: unprotectJson(session.guilds) as OAuthGuild[]
  };
}

export async function requireSession(request: FastifyRequest, reply: FastifyReply) {
  const session = await getSession(request);
  if (!session) {
    reply.code(401).send({ error: 'UNAUTHORIZED' });
    return null;
  }
  return session;
}

async function currentGuildAccess(guildId: string, userId: string) {
  const key = `${guildId}:${userId}`;
  const cached = accessCache.get(key);
  if (cached && cached.expires > Date.now()) return cached;

  try {
    const snapshot = await getGuildAccessSnapshot(guildId, userId);
    const value = { ...snapshot, expires: Date.now() + 60_000 };
    accessCache.set(key, value);
    return value;
  } catch {
    accessCache.delete(key);
    return null;
  }
}

export async function resolveGuildAccess(
  session: SessionInfo,
  guildId: string
): Promise<AccessLevel | null> {
  if (!session.guilds.some((guild) => guild.id === guildId)) return null;

  const current = await currentGuildAccess(guildId, session.userId);
  if (!current) return null;

  if (current.owner) return 'OWNER';

  const administrator = 8n;
  const manageGuild = 32n;
  if (
    (current.permissions & administrator) === administrator ||
    (current.permissions & manageGuild) === manageGuild
  ) {
    return 'ADMIN';
  }

  const bindings = await prisma.panelRoleBinding.findMany({ where: { guildId } });
  if (!bindings.length) return null;

  const matched = bindings.filter((binding) => current.roles.includes(binding.discordRoleId));
  if (!matched.length) return null;

  return matched
    .map((binding) => binding.accessLevel as AccessLevel)
    .filter((level) => level in rank)
    .sort((a, b) => rank[b] - rank[a])[0] ?? null;
}

export async function requireGuild(
  request: FastifyRequest,
  reply: FastifyReply,
  guildId: string,
  minimum: AccessLevel = 'VIEWER'
) {
  const session = await requireSession(request, reply);
  if (!session) return null;

  const installed = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { guildId: true }
  });
  if (!installed) {
    reply.code(404).send({ error: 'BOT_NOT_IN_GUILD' });
    return null;
  }

  const access = await resolveGuildAccess(session, guildId);
  if (!access || rank[access] < rank[minimum]) {
    reply.code(403).send({ error: 'FORBIDDEN', required: minimum, access });
    return null;
  }

  return Object.assign(session, { access });
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[cookieName()];
  if (token) {
    await prisma.panelSession.deleteMany({
      where: { sessionTokenHash: hash(token) }
    });
  }

  reply.clearCookie(cookieName(), {
    path: '/',
    secure: config.production,
    sameSite: 'lax'
  });
}

export function hashIp(ip: string) {
  return hash(ip).slice(0, 24);
}
