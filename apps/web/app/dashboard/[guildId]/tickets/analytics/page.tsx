'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import ModeratorLeaderboard from '../../../../_components/ModeratorLeaderboard';

type Analytics = {
  period: { days: number; since: string };
  summary: {
    created: number;
    closed: number;
    currentOpen: number;
    averageFirstResponseMinutes: number | null;
    averageResolutionMinutes: number | null;
    firstResponseSlaBreaches: number;
    resolutionSlaBreaches: number;
    feedbackCount: number;
    averageRating: number | null;
  };
  categories: Array<{
    id: string;
    name: string;
    created: number;
    closed: number;
    averageRating: number | null;
  }>;
  staff: Array<{
    userId: string;
    claims: number;
    closures: number;
    firstResponses: number;
    replies: number;
    currentlyAssigned: number;
    averageRating: number | null;
    feedbackCount?: number;
  }>;
  daily: Array<{ date: string; created: number; closed: number }>;
};

function minutes(value: number | null) {
  if (value === null) return 'n/d';
  if (value < 60) return `${value.toFixed(1)} min`;
  return `${(value / 60).toFixed(1)} h`;
}

function rating(value: number | null) {
  return value === null ? 'n/d' : `${value.toFixed(2)}/5`;
}

export default function TicketAnalyticsPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;

  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState('');

  const maxDaily = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, ...data.daily.flatMap((row) => [row.created, row.closed]));
  }, [data]);

  const load = async () => {
    setError('');
    const response = await fetch(
      `/backend/api/guilds/${guildId}/analytics?days=${days}`
    );

    if (response.status === 401) {
      window.location.href = '/backend/auth/discord';
      return;
    }

    if (!response.ok) {
      setError('Non hai accesso agli analytics o il servizio non è disponibile.');
      return;
    }

    setData(await response.json());
  };

  useEffect(() => {
    void load();
  }, [guildId, days]);

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">Dispatch Analytics</p>
          <h1>Performance ticket</h1>
          <p className="muted">Volumi, SLA, feedback e attività staff.</p>
        </div>
        <div className="actions">
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>7 giorni</option>
            <option value={30}>30 giorni</option>
            <option value={90}>90 giorni</option>
          </select>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets/manage`}>Ticket</a>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets`}>Configurazione</a>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {data && (
        <>
          <section className="stat-grid">
            <article className="card stat-card"><span>Creati</span><strong>{data.summary.created}</strong></article>
            <article className="card stat-card"><span>Chiusi</span><strong>{data.summary.closed}</strong></article>
            <article className="card stat-card"><span>Aperti adesso</span><strong>{data.summary.currentOpen}</strong></article>
            <article className="card stat-card"><span>Prima risposta media</span><strong>{minutes(data.summary.averageFirstResponseMinutes)}</strong></article>
            <article className="card stat-card"><span>Risoluzione media</span><strong>{minutes(data.summary.averageResolutionMinutes)}</strong></article>
            <article className="card stat-card"><span>Rating medio</span><strong>{rating(data.summary.averageRating)}</strong></article>
            <article className="card stat-card"><span>Feedback</span><strong>{data.summary.feedbackCount}</strong></article>
            <article className="card stat-card"><span>Breach SLA risposta</span><strong>{data.summary.firstResponseSlaBreaches}</strong></article>
            <article className="card stat-card"><span>Breach SLA risoluzione</span><strong>{data.summary.resolutionSlaBreaches}</strong></article>
          </section>

          <section className="card">
            <h2>Andamento giornaliero</h2>
            <div className="daily-chart">
              {data.daily.map((row) => (
                <div className="daily-row" key={row.date}>
                  <span>{row.date.slice(5)}</span>
                  <div className="bars">
                    <div
                      className="bar created"
                      style={{ width: row.created ? `${Math.max(2, (row.created / maxDaily) * 100)}%` : '0%' }}
                      title={`Creati: ${row.created}`}
                    />
                    <div
                      className="bar closed"
                      style={{ width: row.closed ? `${Math.max(2, (row.closed / maxDaily) * 100)}%` : '0%' }}
                      title={`Chiusi: ${row.closed}`}
                    />
                  </div>
                  <span>{row.created}/{row.closed}</span>
                </div>
              ))}
            </div>
            <p className="muted">Valori per riga: creati / chiusi.</p>
          </section>

          <section className="grid settings-grid">
            <article className="card">
              <h2>Categorie</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Categoria</th><th>Creati</th><th>Chiusi</th><th>Rating</th></tr>
                  </thead>
                  <tbody>
                    {data.categories.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>{row.created}</td>
                        <td>{row.closed}</td>
                        <td>{rating(row.averageRating)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="card">
              <h2>Staff</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>User ID</th>
                      <th>Claim</th>
                      <th title="Ticket chiusi attribuiti a chi li aveva in carico, altrimenti a chi li ha chiusi">Gestiti</th>
                      <th>1ª risposta</th>
                      <th>Reply</th>
                      <th>Assegnati</th>
                      <th title="Valutazioni attribuite al moderatore che gestiva il ticket">Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.staff.map((row) => (
                      <tr key={row.userId}>
                        <td>{row.userId}</td>
                        <td>{row.claims}</td>
                        <td>{row.closures}</td>
                        <td>{row.firstResponses}</td>
                        <td>{row.replies}</td>
                        <td>{row.currentlyAssigned}</td>
                        <td>{rating(row.averageRating)}{row.feedbackCount ? ` (${row.feedbackCount})` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        </>
      )}

      <ModeratorLeaderboard guildId={guildId} />
    </main>
  );
}
