/*
 * Ticket log channel: event keys, dashboard labels and the validation of the
 * only event the API forwards to the bot (BLACKLIST). Pure helpers, shared by
 * the API, the bot and the tests.
 */

export const TICKET_LOG_EVENTS = [
  'TICKET_OPEN',
  'TICKET_CLAIM',
  'TICKET_UPDATE',
  'TICKET_MEMBERS',
  'TICKET_CLOSE',
  'TICKET_REOPEN',
  'TICKET_DELETE',
  'TICKET_TRANSCRIPT',
  'TICKET_FEEDBACK',
  'TICKET_AUTOMATION',
  'FORM_SUBMISSION',
  'BLACKLIST'
] as const;

export type TicketLogEvent = (typeof TICKET_LOG_EVENTS)[number];

export type TicketLogEventInfo = { key: TicketLogEvent; label: string; description: string };

export const TICKET_LOG_EVENT_INFO: readonly TicketLogEventInfo[] = [
  { key: 'TICKET_OPEN', label: 'Apertura ticket', description: 'Nuovo ticket creato da menu, pannello o form.' },
  { key: 'TICKET_CLAIM', label: 'Presa in carico', description: 'Claim, rilascio e assegnazione a un membro dello staff.' },
  { key: 'TICKET_UPDATE', label: 'Modifiche al ticket', description: 'Cambio di stato, priorità o trasferimento di categoria.' },
  { key: 'TICKET_MEMBERS', label: 'Partecipanti', description: 'Aggiunta o rimozione di un membro dal ticket.' },
  { key: 'TICKET_CLOSE', label: 'Chiusura', description: 'Chiusura manuale, dalla dashboard o automatica (il motivo non viene mai riportato).' },
  { key: 'TICKET_REOPEN', label: 'Riapertura', description: 'Riapertura da parte dello staff o dell’utente.' },
  { key: 'TICKET_DELETE', label: 'Eliminazione canale', description: 'Canale eliminato dallo staff o dalla retention.' },
  { key: 'TICKET_TRANSCRIPT', label: 'Transcript', description: 'Generazione manuale o consegna automatica del transcript.' },
  { key: 'TICKET_FEEDBACK', label: 'Feedback', description: 'Valutazione 1-5 inviata dall’utente (mai il commento).' },
  { key: 'TICKET_AUTOMATION', label: 'Automazioni', description: 'SLA superati, escalation, preavviso e chiusura per inattività.' },
  { key: 'FORM_SUBMISSION', label: 'Invii form', description: 'Nome del form, utente, ID invio ed eventuale ticket (mai le risposte).' },
  { key: 'BLACKLIST', label: 'Blacklist', description: 'Utente aggiunto o rimosso dalla blacklist dalla dashboard.' }
];

export function isTicketLogEvent(value: unknown): value is TicketLogEvent {
  return typeof value === 'string' && (TICKET_LOG_EVENTS as readonly string[]).includes(value);
}

/** Known keys only, deduplicated, in catalogue order. */
export function normalizeTicketLogEvents(value: unknown): TicketLogEvent[] {
  if (!Array.isArray(value)) return [];
  const wanted = new Set(value.filter(isTicketLogEvent));
  return TICKET_LOG_EVENTS.filter((event) => wanted.has(event));
}

export type BlacklistLogPayload = {
  event: 'BLACKLIST';
  action: 'add' | 'remove';
  targetUserId: string;
  actorId: string;
  expiresAt: string | null;
};

const SNOWFLAKE = /^\d{17,20}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const BLACKLIST_KEYS = new Set(['event', 'action', 'targetUserId', 'actorId', 'expiresAt']);

/**
 * Structured BLACKLIST event accepted by the bot RPC. Anything else (unknown
 * keys, free text, other events, malformed ids or dates) is rejected, so the
 * API can never make the bot post arbitrary text in a log channel.
 */
export function parseBlacklistLogPayload(body: unknown): BlacklistLogPayload {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_TICKET_LOG_EVENT');
  const row = body as Record<string, unknown>;
  if (Object.keys(row).some((key) => !BLACKLIST_KEYS.has(key))) throw new Error('INVALID_TICKET_LOG_EVENT');
  const { event, action, targetUserId, actorId, expiresAt: rawExpiresAt } = row;
  if (event !== 'BLACKLIST') throw new Error('INVALID_TICKET_LOG_EVENT');
  if (action !== 'add' && action !== 'remove') throw new Error('INVALID_TICKET_LOG_EVENT');
  if (typeof targetUserId !== 'string' || !SNOWFLAKE.test(targetUserId)) throw new Error('INVALID_TICKET_LOG_EVENT');
  if (typeof actorId !== 'string' || !SNOWFLAKE.test(actorId)) throw new Error('INVALID_TICKET_LOG_EVENT');
  let expiresAt: string | null = null;
  if (rawExpiresAt !== undefined && rawExpiresAt !== null) {
    if (typeof rawExpiresAt !== 'string' || !ISO_DATE.test(rawExpiresAt) || Number.isNaN(Date.parse(rawExpiresAt))) {
      throw new Error('INVALID_TICKET_LOG_EVENT');
    }
    if (action !== 'add') throw new Error('INVALID_TICKET_LOG_EVENT');
    expiresAt = new Date(rawExpiresAt).toISOString();
  }
  return { event: 'BLACKLIST', action, targetUserId, actorId, expiresAt };
}
