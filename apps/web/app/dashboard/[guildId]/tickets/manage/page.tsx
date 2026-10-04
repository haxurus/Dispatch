'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type TicketRow = {
  id: string;
  ticketNumber: number;
  openerId: string;
  channelId: string;
  status: string;
  priority: string;
  claimedById: string | null;
  category: { id: string; name: string };
  memberCount: number;
  transcript: { messageCount: number; createdAt: string } | null;
  createdAt: string;
  closedAt: string | null;
};

export default function TicketManagementPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);

  const load = async () => {
    setError('');
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    const response = await fetch(`/backend/api/guilds/${guildId}/tickets${query}`);

    if (response.status === 401) {
      window.location.href = '/backend/auth/discord';
      return;
    }

    if (!response.ok) {
      setError('Non hai accesso alla gestione ticket o il servizio non è disponibile.');
      return;
    }

    const data = await response.json();
    setTickets(data.items);
    setTotal(data.total);
  };

  useEffect(() => {
    void load();
  }, [guildId, status]);

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">Dispatch</p>
          <h1>Ticket</h1>
          <p className="muted">{total} ticket trovati</p>
        </div>
        <div className="actions">
          <a className="button" href={`/dashboard/${guildId}/tickets`}>Configura ticket</a>
          <a className="button secondary" href={`/dashboard/${guildId}`}>Server</a>
        </div>
      </div>

      <section className="card filterbar">
        <label>
          Stato
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Tutti</option>
            <option value="OPEN">Aperti</option>
            <option value="WAITING">In attesa</option>
            <option value="IN_PROGRESS">In lavorazione</option>
            <option value="RESOLVED">Risolti</option>
            <option value="CLOSED">Chiusi</option>
          </select>
        </label>
      </section>

      {error && <p className="error">{error}</p>}

      <section className="ticket-list">
        {tickets.map((ticket) => (
          <article className="card ticket-row" key={ticket.id}>
            <div>
              <strong>#{ticket.ticketNumber} · {ticket.category.name}</strong>
              <div className="muted">
                Utente: {ticket.openerId} · Membri: {ticket.memberCount}
              </div>
            </div>
            <div>
              <span className="badge">{ticket.status}</span>
              <div className="muted">
                {ticket.claimedById ? `Staff: ${ticket.claimedById}` : 'Non assegnato'}
              </div>
            </div>
            <div className="actions">
              <a className="button" href={`/dashboard/${guildId}/tickets/${ticket.id}`}>Apri</a>
              <a className="button secondary" href={`https://discord.com/channels/${guildId}/${ticket.channelId}`} target="_blank" rel="noreferrer">Discord</a>
            </div>
          </article>
        ))}

        {!error && tickets.length === 0 && (
          <div className="card muted">Nessun ticket con questi filtri.</div>
        )}
      </section>
    </main>
  );
}
