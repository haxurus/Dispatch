'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

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
  transcriptStoreTemporary: boolean;
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
  value: string;
};

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
  comment: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function TicketDetailPage() {
  const params = useParams<{ guildId: string; ticketId: string }>();
  const { guildId, ticketId } = params;

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
      setError('Impossibile caricare il ticket.');
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
        setError(`Operazione fallita: ${body.error ?? response.status}`);
        return false;
      }

      setNotice('Operazione completata.');
      await load();
      return true;
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
        {error ? <p className="error">{error}</p> : <p className="muted">Caricamento ticket...</p>}
      </main>
    );
  }

  const closed = ticket.status === 'CLOSED' || ticket.status === 'REOPENING';

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">Dispatch Ticket</p>
          <h1>#{ticket.ticketNumber} · {ticket.category.name}</h1>
          <p className="muted">
            Stato: {ticket.status} · Priorità: {ticket.priority} · Utente: {ticket.openerId}
          </p>
        </div>
        <div className="actions">
          <a className="button secondary" href={`/dashboard/${guildId}/tickets/manage`}>Tutti i ticket</a>
          <a
            className="button secondary"
            href={`https://discord.com/channels/${guildId}/${ticket.channelId}`}
            target="_blank"
            rel="noreferrer"
          >
            Apri Discord
          </a>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <section className="grid settings-grid">
        <article className="card form">
          <h2>Stato e priorità</h2>
          <label>
            Stato
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
              <option value="OPEN">Aperto</option>
              <option value="WAITING">In attesa</option>
              <option value="IN_PROGRESS">In lavorazione</option>
              <option value="RESOLVED">Risolto</option>
              {closed && <option value={ticket.status}>{ticket.status === 'REOPENING' ? 'Ripristino permessi da completare' : 'Chiuso'}</option>}
            </select>
          </label>

          <label>
            Priorità
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
              <option value="LOW">Bassa</option>
              <option value="NORMAL">Normale</option>
              <option value="HIGH">Alta</option>
              <option value="URGENT">Urgente</option>
            </select>
          </label>
        </article>

        <article className="card">
          <h2>Assegnazione</h2>
          <p><strong>Assegnato:</strong> {ticket.claimedById ?? 'Nessuno'}</p>
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
                Prendi in carico
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
                Unclaim
              </button>
            )}
          </div>

          {!closed && (
            <form className="form compact-form" onSubmit={assign}>
              <label>
                Assegna a staff ID
                <input
                  required
                  pattern="[0-9]{17,20}"
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                  placeholder="Discord User ID"
                />
              </label>
              <button disabled={busy === 'assign'} type="submit">Assegna</button>
            </form>
          )}
        </article>

        <article className="card form">
          <h2>Categoria</h2>
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
              Trasferisci
            </button>
          )}
        </article>
      </section>

      <section className="grid settings-grid">
        <article className="card">
          <h2>SLA</h2>
          <dl className="facts">
            <div><dt>Creato</dt><dd>{new Date(ticket.createdAt).toLocaleString()}</dd></div>
            <div><dt>Ultima attività</dt><dd>{new Date(ticket.lastActivityAt).toLocaleString()}</dd></div>
            <div><dt>Prima risposta staff</dt><dd>{ticket.firstStaffResponseAt ? new Date(ticket.firstStaffResponseAt).toLocaleString() : 'Non ancora'}</dd></div>
            <div><dt>SLA prima risposta</dt><dd>{ticket.slaFirstBreachedAt ? 'Superato' : ticket.category.slaFirstResponseMinutes ? `${ticket.category.slaFirstResponseMinutes} min` : 'Disattivato'}</dd></div>
            <div><dt>SLA risoluzione</dt><dd>{ticket.slaResolutionBreachedAt ? 'Superato' : ticket.category.slaResolutionMinutes ? `${ticket.category.slaResolutionMinutes} min` : 'Disattivato'}</dd></div>
            <div><dt>Auto-chiusura</dt><dd>{ticket.category.inactivityCloseHours ? `${ticket.category.inactivityCloseHours} ore` : 'Disattivata'}</dd></div>
            <div><dt>Escalation</dt><dd>{ticket.category.escalationMinutes ? `${ticket.category.escalationMinutes} min` : 'Disattivata'}</dd></div>
            <div><dt>Riapertura utente</dt><dd>{ticket.category.reopenWindowHours ? `${ticket.category.reopenWindowHours} ore` : 'Disattivata'}</dd></div>
          </dl>
        </article>

        <article className="card">
          <h2>Risposte iniziali</h2>
          {ticket.formData?.length ? (
            <dl className="facts">
              {ticket.formData.map((answer) => (
                <div key={answer.id}>
                  <dt>{answer.label}</dt>
                  <dd className="preserve">{answer.value || 'Nessuna risposta'}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted">Nessun form configurato per questo ticket.</p>
          )}
        </article>

        <article className="card">
          <h2>Transcript</h2>
          <p className="muted">
            {ticket.transcript
              ? `${ticket.transcript.messageCount} messaggi · ${new Date(ticket.transcript.createdAt).toLocaleString()}`
              : ticket.category.transcriptAutoGenerate
                ? 'La consegna automatica avviene alla chiusura. Nessuna copia è conservata se non configurato.'
                : 'Non ancora generato'}
          </p>
          <div className="actions">
            <button
              disabled={Boolean(busy)}
              onClick={() => void action(
                'transcript',
                `/backend/api/guilds/${guildId}/tickets/${ticketId}/transcript`
              )}
            >
              Genera/Aggiorna
            </button>
            {ticket.transcript && (
              <a
                className="button secondary"
                href={`/backend/api/guilds/${guildId}/tickets/${ticketId}/transcript`}
              >
                Scarica HTML
              </a>
            )}
          </div>
          {!ticket.category.transcriptStoreTemporary && ticket.transcript && (
            <p className="muted">
              Questa copia è temporanea: dopo il download viene rimossa dal database. In ogni caso viene eliminata
              insieme al ticket.
            </p>
          )}
          </div>
        </article>
      </section>

      <section className="grid settings-grid">
        <form className="card form" onSubmit={sendReply}>
          <h2>Risposta staff</h2>
          <label>
            Template
            <select
              value={templateId}
              disabled={closed}
              onChange={(event) => {
                setTemplateId(event.target.value);
                if (event.target.value) setReplyContent('');
              }}
            >
              <option value="">Messaggio personalizzato</option>
              {templates.map((template) => (
                <option value={template.id} key={template.id}>{template.name}</option>
              ))}
            </select>
          </label>

          {!templateId && (
            <label>
              Messaggio
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

          <button disabled={closed || busy === 'reply'} type="submit">Invia nel ticket</button>
        </form>

        <form className="card form" onSubmit={addNote}>
          <h2>Nota interna</h2>
          <textarea
            required
            maxLength={4000}
            value={noteContent}
            onChange={(event) => setNoteContent(event.target.value)}
            placeholder="Visibile solo nel pannello staff."
          />
          <button disabled={busy === 'note'} type="submit">Aggiungi nota</button>

          <div className="audit-list">
            {ticket.notes.map((note) => (
              <div className="list-item" key={note.id}>
                <div className="row">
                  <div>
                    <strong>{note.authorId}</strong>
                    <div className="muted">{new Date(note.createdAt).toLocaleString()}</div>
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
                    Elimina
                  </button>
                </div>
                <p className="preserve">{note.content}</p>
              </div>
            ))}
            {ticket.notes.length === 0 && <p className="muted">Nessuna nota interna.</p>}
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Membri</h2>
        {!closed && (
          <form className="row member-form" onSubmit={addMember}>
            <input
              required
              pattern="[0-9]{17,20}"
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
              placeholder="Discord User ID"
            />
            <button disabled={busy === 'member-add'} type="submit">Aggiungi</button>
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
                  Rimuovi
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>{closed ? 'Riapertura' : 'Chiusura'}</h2>

        {closed ? (
          <>
            <p><strong>Motivo:</strong> {ticket.closeReason || 'Nessun motivo indicato.'}</p>
            <button
              disabled={Boolean(busy)}
              onClick={() => void action(
                'reopen',
                `/backend/api/guilds/${guildId}/tickets/${ticketId}/reopen`
              )}
            >
              Riapri ticket
            </button>
          </>
        ) : (
          <>
            <label className="form">
              Motivo chiusura
              <textarea
                maxLength={1000}
                value={closeReason}
                onChange={(event) => setCloseReason(event.target.value)}
                placeholder="Opzionale"
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
              Chiudi ticket
            </button>
          </>
        )}
      </section>

      <section className="card">
        <h2>Feedback utente</h2>
        {ticket.feedback ? (
          <>
            <p><strong>Valutazione:</strong> {'★'.repeat(ticket.feedback.rating)}{'☆'.repeat(5 - ticket.feedback.rating)} ({ticket.feedback.rating}/5)</p>
            <p className="muted">{new Date(ticket.feedback.updatedAt).toLocaleString()}</p>
            <p className="preserve">{ticket.feedback.comment || 'Nessun commento.'}</p>
          </>
        ) : (
          <p className="muted">
            {ticket.category.feedbackEnabled
              ? 'Nessun feedback ricevuto.'
              : 'Feedback disattivato per questa categoria.'}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Audit</h2>
        <div className="audit-list">
          {ticket.audit.map((entry) => (
            <div className="list-item" key={entry.id}>
              <strong>{entry.action}</strong>
              <div className="muted">
                {new Date(entry.createdAt).toLocaleString()} · {entry.actorId ?? 'sistema'}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
