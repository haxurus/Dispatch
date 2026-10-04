import fs from 'node:fs';

const required = (name: string) => {
  const file = process.env[`${name}_FILE`]?.trim();
  const value = file ? fs.readFileSync(file, 'utf8').trim() : process.env[name]?.trim();
  if (!value) throw new Error(`Missing secret/config: ${name} or ${name}_FILE`);
  return value;
};

const internalUrl = required('BOT_INTERNAL_URL').replace(/\/$/, '');
const internalKey = required('BOT_INTERNAL_API_KEY');
const SNOWFLAKE = /^\d{17,20}$/;
const CUID = /^[a-z0-9]{20,32}$/i;

const api = async <T>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>
): Promise<T> => {
  const response = await fetch(`${internalUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${internalKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');
    const error = new Error(
      `Internal bot API failed with status ${response.status}: ${responseBody.slice(0, 300)}`
    ) as Error & { status?: number; code?: string };
    error.status = response.status;
    try {
      const parsed = JSON.parse(responseBody) as { error?: string };
      error.code = parsed.error;
    } catch {
      // Ignore malformed internal error body.
    }
    throw error;
  }

  return response.json() as Promise<T>;
};

function id(value: string) {
  if (!SNOWFLAKE.test(value)) throw new Error('Invalid Discord snowflake');
  return value;
}

function cuid(value: string) {
  if (!CUID.test(value)) throw new Error('Invalid internal ID');
  return value;
}

export async function getGuildResources(guildId: string) {
  return api<{
    channels: Array<{ id: string; name: string; type: number; parentId: string | null; position: number }>;
    roles: Array<{ id: string; name: string; color: number; position: number; permissions: string }>;
  }>(`/guilds/${id(guildId)}/resources`);
}

export async function getGuildAccessSnapshot(guildId: string, userId: string) {
  const result = await api<{ owner: boolean; permissions: string; roles: string[] }>(
    `/guilds/${id(guildId)}/members/${id(userId)}/access`
  );
  return { owner: result.owner, permissions: BigInt(result.permissions), roles: result.roles };
}

export async function publishMainMenu(guildId: string) {
  return api<{ ok: true; messageId: string }>(
    `/guilds/${id(guildId)}/main-menu/publish`,
    'POST'
  );
}

export async function publishPanel(guildId: string, panelId: string) {
  return api<{ ok: true; messageId: string }>(
    `/guilds/${id(guildId)}/panels/${cuid(panelId)}/publish`,
    'POST'
  );
}

function ticketAction<T>(
  guildId: string,
  ticketId: string,
  action: string,
  body: Record<string, unknown>
) {
  return api<T>(
    `/guilds/${id(guildId)}/tickets/${cuid(ticketId)}/${action}`,
    'POST',
    body
  );
}

export const unclaimTicket = (guildId: string, ticketId: string, actorId: string) =>
  ticketAction(guildId, ticketId, 'unclaim', { actorId });

export const assignTicket = (guildId: string, ticketId: string, actorId: string, assigneeId: string) =>
  ticketAction(guildId, ticketId, 'assign', { actorId, assigneeId });

export const transferTicket = (guildId: string, ticketId: string, actorId: string, categoryId: string) =>
  ticketAction(guildId, ticketId, 'transfer', { actorId, categoryId });

export const addTicketMember = (guildId: string, ticketId: string, actorId: string, userId: string) =>
  ticketAction(guildId, ticketId, 'member-add', { actorId, userId });

export const removeTicketMember = (guildId: string, ticketId: string, actorId: string, userId: string) =>
  ticketAction(guildId, ticketId, 'member-remove', { actorId, userId });

export const closeTicket = (guildId: string, ticketId: string, actorId: string, reason: string | null) =>
  ticketAction(guildId, ticketId, 'close', { actorId, reason });

export const reopenTicket = (guildId: string, ticketId: string, actorId: string) =>
  ticketAction(guildId, ticketId, 'reopen', { actorId });

export const generateTranscript = (guildId: string, ticketId: string, actorId: string) =>
  ticketAction<{ ok: true; messageCount: number }>(
    guildId,
    ticketId,
    'transcript',
    { actorId }
  );


export const setTicketStatus = (
  guildId: string,
  ticketId: string,
  actorId: string,
  status: 'OPEN' | 'WAITING' | 'IN_PROGRESS' | 'RESOLVED'
) => ticketAction(guildId, ticketId, 'status', { actorId, status });

export const setTicketPriority = (
  guildId: string,
  ticketId: string,
  actorId: string,
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
) => ticketAction(guildId, ticketId, 'priority', { actorId, priority });

export const sendTicketReply = (
  guildId: string,
  ticketId: string,
  actorId: string,
  content: string,
  templateId?: string | null
) => ticketAction(guildId, ticketId, 'reply', {
  actorId,
  content,
  templateId: templateId ?? null
});
