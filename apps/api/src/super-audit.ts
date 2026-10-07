import { prisma } from '@dispatch/db';
import type { FastifyRequest } from 'fastify';
import type { SessionInfo } from './auth.js';
import { hashIp } from './auth.js';
import { protectJson } from './security.js';

export type SuperAuditSubject = 'USER' | 'GUILD';

/**
 * Durable record of a super-console mutation. Details are encrypted at rest
 * (protectJson) and the client IP is stored only as a keyed hash.
 */
export async function superAdminAudit(
  request: FastifyRequest,
  session: SessionInfo,
  action: string,
  subjectType: SuperAuditSubject | null,
  subjectId: string | null,
  details: Record<string, unknown> = {}
) {
  await prisma.superAdminAudit.create({
    data: {
      userId: session.userId,
      username: session.username,
      action,
      subjectType,
      subjectId,
      details: protectJson(JSON.parse(JSON.stringify(details))),
      ipHash: hashIp(request.ip)
    }
  });
}
