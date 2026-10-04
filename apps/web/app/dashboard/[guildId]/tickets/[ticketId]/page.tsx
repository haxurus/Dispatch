'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type Category = {
  id: string;
  name: string;
  enabled: boolean;
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
  createdAt: string;
  closedAt: string | null;
  category: Category;
  members: TicketMember[];
  audit: TicketAudit[];
  transcript: { messageCount: number; createdAt: string } | null;
};

type Me = {
  userId: string;
  username: string;
};

export default function TicketDetailPage() {
  const params = useParams<{ guildId: string; ticketId: string }>();
  const { guildId, ticketId } = params;

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [transferCategoryId, setTransferCategoryId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setError('');

    const [ticketResponse, categoriesResponse, meResponse] = await Promise.all([
      fetch(`/backend/api/guilds/${guildId}/tickets/${ticketId}`),
      fetch(`/backend/api/guilds/${guildId}/categories`),
      fetch('/backend/api/me')
    ]);

    if (ticketResponse.status === 401 || meResponse.status === 401) {
      window.location.href = '/backend/auth/discord';
      return;
    }

    if (!ticketResponse.ok || !categoriesResponse.ok || !meResponse.ok) {
      setError('Impossibile caricare il ticket.');
      return;
    }

    const ticketData = await ticketResponse.json();
    setTicket(ticketData);
    setCategories(await categoriesResponse.json());
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

  if (!ticket) {
    return (
      <main className="shell">
        {error ? <p className="error">{error}</p> : <p className="muted">Caricamento ticket...</p>}
      </main>
    );
  }

  const closed = ticket.status === 'CLOSED';

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">Dispatch Ticket</p>
          <h1>#{ticket.ticketNumber} · {ticket.category.name}</h1>
          <p className="muted">
            Stato: {ticket.status} · Utente: {ticket.openerId}
          </p>
        </div>
        <div className="actions">
          <a className="button secondary" href={`/dashboard/${guildId}/tickets/manage`}>Tutti i ticket</a>
          <a className="button secondary" href={`https://discord.com/channels/${guildId}/${ticket.channelId}`} target="_blank" rel="noreferrer">Apri Discord</a>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <section className="grid settings-grid">
        <article className="card">
          <h2>Gestione</h2>
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

        <article className="card">
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

        <article className="card">
          <h2>Transcript</h2>
          <p className="muted">
            {ticket.transcript
              ? `${ticket.transcript.messageCount} messaggi · ${new Date(ticket.transcript.createdAt).toLocaleString()}`
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
        </article>
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
