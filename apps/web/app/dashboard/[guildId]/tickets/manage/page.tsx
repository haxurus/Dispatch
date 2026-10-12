'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useCopy } from '../../../../_components/locale-context';
import { format, type Locale } from '../../../../i18n';

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
  channelDeletedAt?: string | null;
};

const it = {
  loadError: 'Non hai accesso alla gestione ticket o il servizio non è disponibile.',
  eyebrow: 'Dispatch',
  title: 'Ticket',
  found: '{count} ticket trovati',
  analytics: 'Analytics',
  configure: 'Configura ticket',
  blacklist: 'Blacklist',
  server: 'Server',
  status: 'Stato',
  statusAll: 'Tutti',
  statusOpen: 'Aperti',
  statusWaiting: 'In attesa',
  statusInProgress: 'In lavorazione',
  statusResolved: 'Risolti',
  statusClosed: 'Chiusi',
  userMembers: 'Utente: {user} · Membri: {members}',
  channelDeleted: 'Canale eliminato',
  staff: 'Staff: {user}',
  unassigned: 'Non assegnato',
  open: 'Apri',
  discord: 'Discord',
  empty: 'Nessun ticket con questi filtri.'
};

const en: typeof it = {
  loadError: 'You do not have access to ticket management, or the service is unavailable.',
  eyebrow: 'Dispatch',
  title: 'Tickets',
  found: '{count} tickets found',
  analytics: 'Analytics',
  configure: 'Ticket setup',
  blacklist: 'Blacklist',
  server: 'Server',
  status: 'Status',
  statusAll: 'All',
  statusOpen: 'Open',
  statusWaiting: 'Waiting',
  statusInProgress: 'In progress',
  statusResolved: 'Resolved',
  statusClosed: 'Closed',
  userMembers: 'User: {user} · Members: {members}',
  channelDeleted: 'Channel deleted',
  staff: 'Staff: {user}',
  unassigned: 'Unassigned',
  open: 'Open',
  discord: 'Discord',
  empty: 'No tickets match these filters.'
};

const copy: Record<Locale, typeof it> = { it, en };

export default function TicketManagementPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;
  const c = useCopy(copy);

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
      setError(c.loadError);
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
          <p className="eyebrow">{c.eyebrow}</p>
          <h1>{c.title}</h1>
          <p className="muted">{format(c.found, { count: total })}</p>
        </div>
        <div className="actions">
          <a className="button" href={`/dashboard/${guildId}/tickets/analytics`}>{c.analytics}</a>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets`}>{c.configure}</a>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets/security`}>{c.blacklist}</a>
          <a className="button secondary" href={`/dashboard/${guildId}`}>{c.server}</a>
        </div>
      </div>

      <section className="card filterbar">
        <label>
          {c.status}
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{c.statusAll}</option>
            <option value="OPEN">{c.statusOpen}</option>
            <option value="WAITING">{c.statusWaiting}</option>
            <option value="IN_PROGRESS">{c.statusInProgress}</option>
            <option value="RESOLVED">{c.statusResolved}</option>
            <option value="CLOSED">{c.statusClosed}</option>
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
                {format(c.userMembers, { user: ticket.openerId, members: ticket.memberCount })}
              </div>
            </div>
            <div>
              <span className="badge">{ticket.status}</span>
              {ticket.channelDeletedAt && <span className="badge">{c.channelDeleted}</span>}
              <div className="muted">
                {ticket.claimedById ? format(c.staff, { user: ticket.claimedById }) : c.unassigned}
              </div>
            </div>
            <div className="actions">
              <a className="button" href={`/dashboard/${guildId}/tickets/${ticket.id}`}>{c.open}</a>
              {!ticket.channelDeletedAt && (
                <a className="button secondary" href={`https://discord.com/channels/${guildId}/${ticket.channelId}`} target="_blank" rel="noreferrer">{c.discord}</a>
              )}
            </div>
          </article>
        ))}

        {!error && tickets.length === 0 && (
          <div className="card muted">{c.empty}</div>
        )}
      </section>
    </main>
  );
}
