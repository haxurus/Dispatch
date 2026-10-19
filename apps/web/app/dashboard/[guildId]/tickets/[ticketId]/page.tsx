'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useCopy, useLocale } from '../../../../_components/locale-context';
import { format, type Locale } from '../../../../i18n';

type Category = {
  id: string;
  name: string;
  enabled: boolean;
  slaFirstResponseMinutes: number | null;
  slaResolutionMinutes: number | null;
  inactivityCloseHours: number | null;
  inactivityWarningMinutes: number | null;
  escalationMinutes: number | null;
  escalationRoleIds: string[];
  reopenWindowHours: number | null;
  feedbackEnabled: boolean;
  transcriptAutoGenerate: boolean;
  transcriptSendToOpener: boolean;
  transcriptChannelId: string | null;
  transcriptRetain: boolean;
  formFields?: Array<{ id: string; type?: string; options?: Array<{ label: string; value: string }> }>;
};

type TicketMember = {
  id: string;
  userId: string;
  access: string;
  createdAt: string;
};

type TicketAudit = {
  id: string;
  actorId: string | null;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
};

type TicketNote = {
  id: string;
  authorId: string;
  content: string;
  createdAt: string;
};

type FormAnswer = {
  id: string;
  label: string;
  type?: string;
  value: string | string[] | boolean | null;
};

const it = {
  noAnswer: 'Nessuna risposta',
  yes: 'Sì',
  no: 'No',
  loadError: 'Impossibile caricare il ticket.',
  actionFailed: 'Operazione fallita: {code}',
  actionDone: 'Operazione completata.',
  downloadFailed: 'Download fallito: {code}',
  transcriptConsumed: 'Transcript scaricato e rimosso dal database (copia monouso).',
  transcriptDownloaded: 'Transcript scaricato.',
  loading: 'Caricamento ticket...',
  deleteChannelConfirm: 'Eliminare definitivamente il canale Discord del ticket #{number}? Il transcript viene prima generato o consegnato secondo le impostazioni della categoria. Il ticket resta nello storico ma non potrà più essere riaperto.',
  eyebrow: 'Dispatch Ticket',
  summary: 'Stato: {status} · Priorità: {priority} · Utente: {user}',
  channelDeletedSuffix: ' · Canale eliminato',
  allTickets: 'Tutti i ticket',
  openDiscord: 'Apri Discord',
  statusPriorityTitle: 'Stato e priorità',
  statusLabel: 'Stato',
  statusOpen: 'Aperto',
  statusWaiting: 'In attesa',
  statusInProgress: 'In lavorazione',
  statusResolved: 'Risolto',
  statusReopening: 'Ripristino permessi da completare',
  statusClosed: 'Chiuso',
  priorityLabel: 'Priorità',
  priorityLow: 'Bassa',
  priorityNormal: 'Normale',
  priorityHigh: 'Alta',
  priorityUrgent: 'Urgente',
  assignmentTitle: 'Assegnazione',
  assigned: 'Assegnato:',
  nobody: 'Nessuno',
  handledBy: 'Gestito da:',
  notCredited: 'Non attribuito',
  staffThread: 'Thread staff:',
  openStaffThread: 'Apri il thread privato',
  threadDeleted: 'Eliminato con il canale',
  claim: 'Prendi in carico',
  unclaim: 'Unclaim',
  assignTo: 'Assegna a staff ID',
  userIdPlaceholder: 'Discord User ID',
  assign: 'Assegna',
  categoryTitle: 'Categoria',
  transfer: 'Trasferisci',
  slaTitle: 'SLA',
  created: 'Creato',
  lastActivity: 'Ultima attività',
  firstStaffResponse: 'Prima risposta staff',
  notYet: 'Non ancora',
  slaFirstResponse: 'SLA prima risposta',
  slaResolution: 'SLA risoluzione',
  breached: 'Superato',
  minutes: '{count} min',
  hours: '{count} ore',
  disabledMasc: 'Disattivato',
  disabledFem: 'Disattivata',
  autoClose: 'Auto-chiusura',
  escalation: 'Escalation',
  userReopen: 'Riapertura utente',
  initialAnswersTitle: 'Risposte iniziali',
  noForm: 'Nessun form configurato per questo ticket.',
  transcriptTitle: 'Transcript',
  transcriptInfo: '{count} messaggi · {date}',
  autoDeliveryRetained: 'La consegna automatica avviene alla chiusura; una copia cifrata viene conservata.',
  autoDeliveryNotRetained: 'La consegna automatica avviene alla chiusura. Nessuna copia viene conservata.',
  notGenerated: 'Non ancora generato',
  generate: 'Genera/Aggiorna',
  downloadHtml: 'Scarica HTML',
  singleUseCopy: 'Questa copia è monouso: al primo download viene rimossa dal database. In ogni caso viene eliminata insieme al ticket.',
  staffReplyTitle: 'Risposta staff',
  templateLabel: 'Risposta rapida',
  customMessage: 'Messaggio personalizzato',
  manageReplies: 'Gestisci le risposte rapide',
  messageLabel: 'Messaggio',
  sendToTicket: 'Invia nel ticket',
  internalNoteTitle: 'Nota interna',
  notePlaceholder: 'Visibile solo nel pannello staff.',
  addNote: 'Aggiungi nota',
  delete: 'Elimina',
  noNotes: 'Nessuna nota interna.',
  membersTitle: 'Membri',
  add: 'Aggiungi',
  remove: 'Rimuovi',
  reopenTitle: 'Riapertura',
  closeTitle: 'Chiusura',
  reason: 'Motivo:',
  noReason: 'Nessun motivo indicato.',
  channelDeletedNotice: 'Canale eliminato il {date}: il ticket resta nello storico fino alla retention ma non può più essere riaperto.',
  reopen: 'Riapri ticket',
  deleting: 'Eliminazione...',
  deleteChannel: 'Elimina canale',
  closeReasonLabel: 'Motivo chiusura',
  optional: 'Opzionale',
  closeTicket: 'Chiudi ticket',
  feedbackTitle: 'Feedback utente',
  rating: 'Valutazione:',
  ratedModerator: 'Moderatore valutato:',
  noComment: 'Nessun commento.',
  noFeedback: 'Nessun feedback ricevuto.',
  feedbackDisabled: 'Feedback disattivato per questa categoria.',
  auditTitle: 'Audit',
  system: 'sistema'
};

const en: typeof it = {
  noAnswer: 'No answer',
  yes: 'Yes',
  no: 'No',
  loadError: 'The ticket could not be loaded.',
  actionFailed: 'Action failed: {code}',
  actionDone: 'Action completed.',
  downloadFailed: 'Download failed: {code}',
  transcriptConsumed: 'Transcript downloaded and removed from the database (single-use copy).',
  transcriptDownloaded: 'Transcript downloaded.',
  loading: 'Loading ticket...',
  deleteChannelConfirm: 'Permanently delete the Discord channel of ticket #{number}? The transcript is generated or delivered first, according to the category settings. The ticket stays in the history but can no longer be reopened.',
  eyebrow: 'Dispatch Ticket',
  summary: 'Status: {status} · Priority: {priority} · User: {user}',
  channelDeletedSuffix: ' · Channel deleted',
  allTickets: 'All tickets',
  openDiscord: 'Open Discord',
  statusPriorityTitle: 'Status and priority',
  statusLabel: 'Status',
  statusOpen: 'Open',
  statusWaiting: 'Waiting',
  statusInProgress: 'In progress',
  statusResolved: 'Resolved',
  statusReopening: 'Permission restore pending',
  statusClosed: 'Closed',
  priorityLabel: 'Priority',
  priorityLow: 'Low',
  priorityNormal: 'Normal',
  priorityHigh: 'High',
  priorityUrgent: 'Urgent',
  assignmentTitle: 'Assignment',
  assigned: 'Assigned:',
  nobody: 'Nobody',
  handledBy: 'Handled by:',
  notCredited: 'Not credited',
  staffThread: 'Staff thread:',
  openStaffThread: 'Open the private thread',
  threadDeleted: 'Deleted with the channel',
  claim: 'Claim',
  unclaim: 'Unclaim',
  assignTo: 'Assign to staff ID',
  userIdPlaceholder: 'Discord User ID',
  assign: 'Assign',
  categoryTitle: 'Category',
  transfer: 'Transfer',
  slaTitle: 'SLA',
  created: 'Created',
  lastActivity: 'Last activity',
  firstStaffResponse: 'First staff response',
  notYet: 'Not yet',
  slaFirstResponse: 'First response SLA',
  slaResolution: 'Resolution SLA',
  breached: 'Breached',
  minutes: '{count} min',
  hours: '{count} hours',
  disabledMasc: 'Off',
  disabledFem: 'Off',
  autoClose: 'Auto-close',
  escalation: 'Escalation',
  userReopen: 'User reopening',
  initialAnswersTitle: 'Initial answers',
  noForm: 'No form configured for this ticket.',
  transcriptTitle: 'Transcript',
  transcriptInfo: '{count} messages · {date}',
  autoDeliveryRetained: 'Automatic delivery happens on close; an encrypted copy is kept.',
  autoDeliveryNotRetained: 'Automatic delivery happens on close. No copy is kept.',
  notGenerated: 'Not generated yet',
  generate: 'Generate/Update',
  downloadHtml: 'Download HTML',
  singleUseCopy: 'This copy is single-use: it is removed from the database on the first download. In any case it is deleted together with the ticket.',
  staffReplyTitle: 'Staff reply',
  templateLabel: 'Canned reply',
  customMessage: 'Custom message',
  manageReplies: 'Manage canned replies',
  messageLabel: 'Message',
  sendToTicket: 'Send to ticket',
  internalNoteTitle: 'Internal note',
  notePlaceholder: 'Visible only in the staff dashboard.',
  addNote: 'Add note',
  delete: 'Delete',
  noNotes: 'No internal notes.',
  membersTitle: 'Members',
  add: 'Add',
  remove: 'Remove',
  reopenTitle: 'Reopening',
  closeTitle: 'Closing',
  reason: 'Reason:',
  noReason: 'No reason given.',
  channelDeletedNotice: 'Channel deleted on {date}: the ticket stays in the history until retention but can no longer be reopened.',
  reopen: 'Reopen ticket',
  deleting: 'Deleting...',
  deleteChannel: 'Delete channel',
  closeReasonLabel: 'Closing reason',
  optional: 'Optional',
  closeTicket: 'Close ticket',
  feedbackTitle: 'User feedback',
  rating: 'Rating:',
  ratedModerator: 'Rated moderator:',
  noComment: 'No comment.',
  noFeedback: 'No feedback received.',
  feedbackDisabled: 'Feedback is off for this category.',
  auditTitle: 'Audit',
  system: 'system'
};

const copy: Record<Locale, typeof it> = { it, en };

// Local mirror of @dispatch/shared displayAnswer (the web app does not depend on it).
function formatAnswer(
  answer: FormAnswer,
  c: typeof it,
  field?: { type?: string; options?: Array<{ label: string; value: string }> }
) {
  const labels = new Map((field?.options ?? []).map((option) => [option.value, option.label]));
  const value = answer.value;
  if (Array.isArray(value)) {
    return value.map((item) => labels.get(item) ?? item).join(', ') || c.noAnswer;
  }
  if (typeof value === 'boolean') return value ? c.yes : c.no;
  if ((answer.type ?? field?.type) === 'BOOLEAN') {
    return value === 'true' ? c.yes : value === 'false' ? c.no : c.noAnswer;
  }
  if (!value) return c.noAnswer;
  return labels.get(value) ?? value;
}

type TicketDetail = {
  id: string;
  ticketNumber: number;
  openerId: string;
  channelId: string;
  categoryId: string;
  status: string;
  priority: string;
  claimedById: string | null;
  closeReason: string | null;
  formData: FormAnswer[];
  firstStaffResponseAt: string | null;
  lastActivityAt: string;
  slaFirstBreachedAt: string | null;
  slaResolutionBreachedAt: string | null;
  createdAt: string;
  closedAt: string | null;
  channelDeletedAt: string | null;
  // Moderator credited at close and private staff thread (link only, never its content).
  handledById?: string | null;
  staffThreadId?: string | null;
  category: Category;
  members: TicketMember[];
  notes: TicketNote[];
  audit: TicketAudit[];
  transcript: { messageCount: number; createdAt: string } | null;
  feedback: TicketFeedback | null;
};

type Me = {
  userId: string;
  username: string;
};

type ResponseTemplate = {
  id: string;
  name: string;
  content: string;
};

type TicketFeedback = {
  id: string;
  rating: number;
  staffUserId?: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function TicketDetailPage() {
  const params = useParams<{ guildId: string; ticketId: string }>();
  const { guildId, ticketId } = params;
  const locale = useLocale();
  const c = useCopy(copy);
  const dateLocale = locale === 'it' ? 'it-IT' : 'en-US';

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<ResponseTemplate[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [transferCategoryId, setTransferCategoryId] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [replyContent, setReplyContent] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setError('');

    const [ticketResponse, categoriesResponse, templatesResponse, meResponse] = await Promise.all([
      fetch(`/backend/api/guilds/${guildId}/tickets/${ticketId}`),
      fetch(`/backend/api/guilds/${guildId}/categories`),
      fetch(`/backend/api/guilds/${guildId}/response-templates`),
      fetch('/backend/api/me')
    ]);

    if (ticketResponse.status === 401 || meResponse.status === 401) {
      window.location.href = '/backend/auth/discord';
      return;
    }

    if (!ticketResponse.ok || !categoriesResponse.ok || !templatesResponse.ok || !meResponse.ok) {
      setError(c.loadError);
      return;
    }

    const ticketData = await ticketResponse.json();
    setTicket(ticketData);
    setCategories(await categoriesResponse.json());
    setTemplates(await templatesResponse.json());
    setMe(await meResponse.json());
    setTransferCategoryId(ticketData.categoryId);
    setCloseReason(ticketData.closeReason ?? '');
  };

  useEffect(() => {
    void load();
  }, [guildId, ticketId]);

  const action = async (
    name: string,
    path: string,
    options: RequestInit = { method: 'POST' }
  ) => {
    setBusy(name);
    setError('');
    setNotice('');

    try {
      const response = await fetch(path, options);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(format(c.actionFailed, { code: body.error ?? response.status }));
        return false;
      }

      setNotice(c.actionDone);
      await load();
      return true;
    } finally {
      setBusy('');
    }
  };

  // POST, never a plain link: a non-retained transcript is consumed (deleted)
  // by the download, which must not happen on GET/HEAD or link prefetch.
  const downloadTranscript = async () => {
    setBusy('transcript-download');
    setError('');
    setNotice('');

    try {
      const response = await fetch(
        `/backend/api/guilds/${guildId}/tickets/${ticketId}/transcript/download`,
        { method: 'POST' }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (body.error === 'TRANSCRIPT_NOT_FOUND') {
          setTicket((current) => current ? { ...current, transcript: null } : current);
        }
        setError(format(c.downloadFailed, { code: body.error ?? response.status }));
        return;
      }

      const consumedHeader = response.headers.get('X-Transcript-Consumed');
      const consumed = consumedHeader === null ? !ticket?.category.transcriptRetain : consumedHeader === '1';
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `dispatch-ticket-${ticket?.ticketNumber ?? ticketId}.html`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);

      if (consumed) {
        setTicket((current) => current ? { ...current, transcript: null } : current);
        setNotice(c.transcriptConsumed);
      } else {
        setNotice(c.transcriptDownloaded);
      }
    } finally {
      setBusy('');
    }
  };

  const assign = async (event: FormEvent) => {
    event.preventDefault();
    if (!assigneeId) return;

    const ok = await action(
      'assign',
      `/backend/api/guilds/${guildId}/tickets/${ticketId}/assign`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeId })
      }
    );
    if (ok) setAssigneeId('');
  };

  const addMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!memberId) return;

    const ok = await action(
      'member-add',
      `/backend/api/guilds/${guildId}/tickets/${ticketId}/members`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: memberId })
      }
    );
    if (ok) setMemberId('');
  };

  const addNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!noteContent.trim()) return;

    const ok = await action(
      'note',
      `/backend/api/guilds/${guildId}/tickets/${ticketId}/notes`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: noteContent })
      }
    );
    if (ok) setNoteContent('');
  };

  const sendReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!templateId && !replyContent.trim()) return;

    const body = templateId
      ? { templateId }
      : { content: replyContent };

    const ok = await action(
      'reply',
      `/backend/api/guilds/${guildId}/tickets/${ticketId}/reply`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );

    if (ok) {
      setReplyContent('');
      setTemplateId('');
    }
  };

  if (!ticket) {
    return (
      <main className="shell">
        {error ? <p className="error">{error}</p> : <p className="muted">{c.loading}</p>}
      </main>
    );
  }

  const closed = ticket.status === 'CLOSED' || ticket.status === 'REOPENING';
  const channelDeleted = Boolean(ticket.channelDeletedAt);

  const deleteChannel = async () => {
    if (!window.confirm(format(c.deleteChannelConfirm, { number: ticket.ticketNumber }))) return;
    await action('delete-channel', `/backend/api/guilds/${guildId}/tickets/${ticketId}/delete-channel`);
  };

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">{c.eyebrow}</p>
          <h1>#{ticket.ticketNumber} · {ticket.category.name}</h1>
          <p className="muted">
            {format(c.summary, { status: ticket.status, priority: ticket.priority, user: ticket.openerId })}
            {channelDeleted && c.channelDeletedSuffix}
          </p>
        </div>
        <div className="actions">
          <a className="button secondary" href={`/dashboard/${guildId}/tickets/manage`}>{c.allTickets}</a>
          {!channelDeleted && (
            <a
              className="button secondary"
              href={`https://discord.com/channels/${guildId}/${ticket.channelId}`}
              target="_blank"
              rel="noreferrer"
            >
              {c.openDiscord}
            </a>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <section className="grid settings-grid">
        <article className="card form">
          <h2>{c.statusPriorityTitle}</h2>
          <label>
            {c.statusLabel}
            <select
              value={ticket.status}
              disabled={closed || Boolean(busy)}
              onChange={(event) => void action(
                'status',
                `/backend/api/guilds/${guildId}/tickets/${ticketId}/status`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: event.target.value })
                }
              )}
            >
              <option value="OPEN">{c.statusOpen}</option>
              <option value="WAITING">{c.statusWaiting}</option>
              <option value="IN_PROGRESS">{c.statusInProgress}</option>
              <option value="RESOLVED">{c.statusResolved}</option>
              {closed && <option value={ticket.status}>{ticket.status === 'REOPENING' ? c.statusReopening : c.statusClosed}</option>}
            </select>
          </label>

          <label>
            {c.priorityLabel}
            <select
              value={ticket.priority}
              disabled={closed || Boolean(busy)}
              onChange={(event) => void action(
                'priority',
                `/backend/api/guilds/${guildId}/tickets/${ticketId}/priority`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ priority: event.target.value })
                }
              )}
            >
              <option value="LOW">{c.priorityLow}</option>
              <option value="NORMAL">{c.priorityNormal}</option>
              <option value="HIGH">{c.priorityHigh}</option>
              <option value="URGENT">{c.priorityUrgent}</option>
            </select>
          </label>
        </article>

        <article className="card">
          <h2>{c.assignmentTitle}</h2>
          <p><strong>{c.assigned}</strong> {ticket.claimedById ?? c.nobody}</p>
          {closed && <p><strong>{c.handledBy}</strong> {ticket.handledById ?? c.notCredited}</p>}
          <p>
            <strong>{c.staffThread}</strong>{' '}
            {ticket.staffThreadId && !channelDeleted ? (
              <a href={`https://discord.com/channels/${guildId}/${ticket.staffThreadId}`} target="_blank" rel="noreferrer">
                {c.openStaffThread}
              </a>
            ) : ticket.staffThreadId ? c.threadDeleted : c.nobody}
          </p>
          <div className="actions">
            {!closed && me && (
              <button
                disabled={Boolean(busy)}
                onClick={() => void action(
                  'claim-self',
                  `/backend/api/guilds/${guildId}/tickets/${ticketId}/assign`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ assigneeId: me.userId })
                  }
                )}
              >
                {c.claim}
              </button>
            )}
            {!closed && ticket.claimedById && (
              <button
                className="secondary"
                disabled={Boolean(busy)}
                onClick={() => void action(
                  'unclaim',
                  `/backend/api/guilds/${guildId}/tickets/${ticketId}/unclaim`
                )}
              >
                {c.unclaim}
              </button>
            )}
          </div>

          {!closed && (
            <form className="form compact-form" onSubmit={assign}>
              <label>
                {c.assignTo}
                <input
                  required
                  pattern="[0-9]{17,20}"
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                  placeholder={c.userIdPlaceholder}
                />
              </label>
              <button disabled={busy === 'assign'} type="submit">{c.assign}</button>
            </form>
          )}
        </article>

        <article className="card form">
          <h2>{c.categoryTitle}</h2>
          <select
            value={transferCategoryId}
            disabled={closed || Boolean(busy)}
            onChange={(event) => setTransferCategoryId(event.target.value)}
          >
            {categories
              .filter((category) => category.enabled)
              .map((category) => (
                <option value={category.id} key={category.id}>{category.name}</option>
              ))}
          </select>
          {!closed && (
            <button
              disabled={Boolean(busy) || transferCategoryId === ticket.categoryId}
              onClick={() => void action(
                'transfer',
                `/backend/api/guilds/${guildId}/tickets/${ticketId}/transfer`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ categoryId: transferCategoryId })
                }
              )}
            >
              {c.transfer}
            </button>
          )}
        </article>
      </section>

      <section className="grid settings-grid">
        <article className="card">
          <h2>{c.slaTitle}</h2>
          <dl className="facts">
            <div><dt>{c.created}</dt><dd>{new Date(ticket.createdAt).toLocaleString(dateLocale)}</dd></div>
            <div><dt>{c.lastActivity}</dt><dd>{new Date(ticket.lastActivityAt).toLocaleString(dateLocale)}</dd></div>
            <div><dt>{c.firstStaffResponse}</dt><dd>{ticket.firstStaffResponseAt ? new Date(ticket.firstStaffResponseAt).toLocaleString(dateLocale) : c.notYet}</dd></div>
            <div><dt>{c.slaFirstResponse}</dt><dd>{ticket.slaFirstBreachedAt ? c.breached : ticket.category.slaFirstResponseMinutes ? format(c.minutes, { count: ticket.category.slaFirstResponseMinutes }) : c.disabledMasc}</dd></div>
            <div><dt>{c.slaResolution}</dt><dd>{ticket.slaResolutionBreachedAt ? c.breached : ticket.category.slaResolutionMinutes ? format(c.minutes, { count: ticket.category.slaResolutionMinutes }) : c.disabledMasc}</dd></div>
            <div><dt>{c.autoClose}</dt><dd>{ticket.category.inactivityCloseHours ? format(c.hours, { count: ticket.category.inactivityCloseHours }) : c.disabledFem}</dd></div>
            <div><dt>{c.escalation}</dt><dd>{ticket.category.escalationMinutes ? format(c.minutes, { count: ticket.category.escalationMinutes }) : c.disabledFem}</dd></div>
            <div><dt>{c.userReopen}</dt><dd>{ticket.category.reopenWindowHours ? format(c.hours, { count: ticket.category.reopenWindowHours }) : c.disabledFem}</dd></div>
          </dl>
        </article>

        <article className="card">
          <h2>{c.initialAnswersTitle}</h2>
          {ticket.formData?.length ? (
            <dl className="facts">
              {ticket.formData.map((answer) => (
                <div key={answer.id}>
                  <dt>{answer.label}</dt>
                  <dd className="preserve">
                    {formatAnswer(answer, c, ticket.category.formFields?.find((field) => field.id === answer.id))}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted">{c.noForm}</p>
          )}
        </article>

        <article className="card">
          <h2>{c.transcriptTitle}</h2>
          <p className="muted">
            {ticket.transcript
              ? format(c.transcriptInfo, {
                count: ticket.transcript.messageCount,
                date: new Date(ticket.transcript.createdAt).toLocaleString(dateLocale)
              })
              : ticket.category.transcriptAutoGenerate
                ? ticket.category.transcriptRetain
                  ? c.autoDeliveryRetained
                  : c.autoDeliveryNotRetained
                : c.notGenerated}
          </p>
          <div className="actions">
            <button
              disabled={Boolean(busy) || channelDeleted}
              onClick={() => void action(
                'transcript',
                `/backend/api/guilds/${guildId}/tickets/${ticketId}/transcript`
              )}
            >
              {c.generate}
            </button>
            {ticket.transcript && (
              <button
                className="secondary"
                disabled={Boolean(busy)}
                onClick={() => void downloadTranscript()}
              >
                {c.downloadHtml}
              </button>
            )}
          </div>
          {!ticket.category.transcriptRetain && ticket.transcript && (
            <p className="muted">
              {c.singleUseCopy}
            </p>
          )}
        </article>
      </section>

      <section className="grid settings-grid">
        <form className="card form" onSubmit={sendReply}>
          <h2>{c.staffReplyTitle}</h2>
          <label>
            {c.templateLabel}
            <select
              value={templateId}
              disabled={closed}
              onChange={(event) => {
                setTemplateId(event.target.value);
                if (event.target.value) setReplyContent('');
              }}
            >
              <option value="">{c.customMessage}</option>
              {templates.map((template) => (
                <option value={template.id} key={template.id}>{template.name}</option>
              ))}
            </select>
            <a className="muted" href={`/dashboard/${guildId}/replies`}>{c.manageReplies}</a>
          </label>

          {!templateId && (
            <label>
              {c.messageLabel}
              <textarea
                required
                maxLength={2000}
                disabled={closed}
                value={replyContent}
                onChange={(event) => setReplyContent(event.target.value)}
              />
            </label>
          )}

          {templateId && (
            <p className="muted preserve">
              {templates.find((template) => template.id === templateId)?.content}
            </p>
          )}

          <button disabled={closed || busy === 'reply'} type="submit">{c.sendToTicket}</button>
        </form>

        <form className="card form" onSubmit={addNote}>
          <h2>{c.internalNoteTitle}</h2>
          <textarea
            required
            maxLength={4000}
            value={noteContent}
            onChange={(event) => setNoteContent(event.target.value)}
            placeholder={c.notePlaceholder}
          />
          <button disabled={busy === 'note'} type="submit">{c.addNote}</button>

          <div className="audit-list">
            {ticket.notes.map((note) => (
              <div className="list-item" key={note.id}>
                <div className="row">
                  <div>
                    <strong>{note.authorId}</strong>
                    <div className="muted">{new Date(note.createdAt).toLocaleString(dateLocale)}</div>
                  </div>
                  <button
                    className="danger"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void action(
                      `note-delete:${note.id}`,
                      `/backend/api/guilds/${guildId}/tickets/${ticketId}/notes/${note.id}`,
                      { method: 'DELETE' }
                    )}
                  >
                    {c.delete}
                  </button>
                </div>
                <p className="preserve">{note.content}</p>
              </div>
            ))}
            {ticket.notes.length === 0 && <p className="muted">{c.noNotes}</p>}
          </div>
        </form>
      </section>

      <section className="card">
        <h2>{c.membersTitle}</h2>
        {!closed && (
          <form className="row member-form" onSubmit={addMember}>
            <input
              required
              pattern="[0-9]{17,20}"
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
              placeholder={c.userIdPlaceholder}
            />
            <button disabled={busy === 'member-add'} type="submit">{c.add}</button>
          </form>
        )}

        <div className="member-list">
          {ticket.members.map((member) => (
            <div className="row list-item" key={member.id}>
              <div>
                <strong>{member.userId}</strong>
                <div className="muted">{member.access}</div>
              </div>
              {!closed && member.userId !== ticket.openerId && (
                <button
                  className="danger"
                  disabled={Boolean(busy)}
                  onClick={() => void action(
                    `remove:${member.userId}`,
                    `/backend/api/guilds/${guildId}/tickets/${ticketId}/members/${member.userId}`,
                    { method: 'DELETE' }
                  )}
                >
                  {c.remove}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>{closed ? c.reopenTitle : c.closeTitle}</h2>

        {closed ? (
          <>
            <p><strong>{c.reason}</strong> {ticket.closeReason || c.noReason}</p>
            {channelDeleted ? (
              <p className="notice notice-warn">
                {format(c.channelDeletedNotice, { date: new Date(ticket.channelDeletedAt!).toLocaleString(dateLocale) })}
              </p>
            ) : (
              <div className="actions">
                <button
                  disabled={Boolean(busy)}
                  onClick={() => void action(
                    'reopen',
                    `/backend/api/guilds/${guildId}/tickets/${ticketId}/reopen`
                  )}
                >
                  {c.reopen}
                </button>
                {ticket.status === 'CLOSED' && (
                  <button
                    className="danger"
                    disabled={Boolean(busy)}
                    onClick={() => void deleteChannel()}
                  >
                    {busy === 'delete-channel' ? c.deleting : c.deleteChannel}
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <label className="form">
              {c.closeReasonLabel}
              <textarea
                maxLength={1000}
                value={closeReason}
                onChange={(event) => setCloseReason(event.target.value)}
                placeholder={c.optional}
              />
            </label>
            <button
              className="danger"
              disabled={Boolean(busy)}
              onClick={() => void action(
                'close',
                `/backend/api/guilds/${guildId}/tickets/${ticketId}/close`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ reason: closeReason || null })
                }
              )}
            >
              {c.closeTicket}
            </button>
          </>
        )}
      </section>

      <section className="card">
        <h2>{c.feedbackTitle}</h2>
        {ticket.feedback ? (
          <>
            <p><strong>{c.rating}</strong> {'★'.repeat(ticket.feedback.rating)}{'☆'.repeat(5 - ticket.feedback.rating)} ({ticket.feedback.rating}/5)</p>
            <p><strong>{c.ratedModerator}</strong> {ticket.feedback.staffUserId ?? c.notCredited}</p>
            <p className="muted">{new Date(ticket.feedback.updatedAt).toLocaleString(dateLocale)}</p>
            <p className="preserve">{ticket.feedback.comment || c.noComment}</p>
          </>
        ) : (
          <p className="muted">
            {ticket.category.feedbackEnabled
              ? c.noFeedback
              : c.feedbackDisabled}
          </p>
        )}
      </section>

      <section className="card">
        <h2>{c.auditTitle}</h2>
        <div className="audit-list">
          {ticket.audit.map((entry) => (
            <div className="list-item" key={entry.id}>
              <strong>{entry.action}</strong>
              <div className="muted">
                {new Date(entry.createdAt).toLocaleString(dateLocale)} · {entry.actorId ?? c.system}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
