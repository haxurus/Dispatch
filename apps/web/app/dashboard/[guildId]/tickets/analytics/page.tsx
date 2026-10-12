'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import ModeratorLeaderboard from '../../../../_components/ModeratorLeaderboard';
import { useCopy } from '../../../../_components/locale-context';
import { format, type Locale } from '../../../../i18n';

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

const it = {
  notAvailable: 'n/d',
  minutesUnit: '{value} min',
  hoursUnit: '{value} h',
  ratingValue: '{value}/5',
  loadError: 'Non hai accesso agli analytics o il servizio non è disponibile.',
  eyebrow: 'Dispatch Analytics',
  title: 'Performance ticket',
  intro: 'Volumi, SLA, feedback e attività staff.',
  periodDays: '{days} giorni',
  tickets: 'Ticket',
  setup: 'Configurazione',
  created: 'Creati',
  closed: 'Chiusi',
  currentOpen: 'Aperti adesso',
  avgFirstResponse: 'Prima risposta media',
  avgResolution: 'Risoluzione media',
  avgRating: 'Rating medio',
  feedback: 'Feedback',
  firstResponseBreaches: 'Breach SLA risposta',
  resolutionBreaches: 'Breach SLA risoluzione',
  dailyTitle: 'Andamento giornaliero',
  createdTitle: 'Creati: {count}',
  closedTitle: 'Chiusi: {count}',
  dailyLegend: 'Valori per riga: creati / chiusi.',
  categories: 'Categorie',
  category: 'Categoria',
  rating: 'Rating',
  staff: 'Staff',
  userId: 'User ID',
  claim: 'Claim',
  handled: 'Gestiti',
  handledTitle: 'Ticket chiusi attribuiti a chi li aveva in carico, altrimenti a chi li ha chiusi',
  firstResponse: '1ª risposta',
  replies: 'Reply',
  assigned: 'Assegnati',
  ratingTitle: 'Valutazioni attribuite al moderatore che gestiva il ticket'
};

const en: typeof it = {
  notAvailable: 'n/a',
  minutesUnit: '{value} min',
  hoursUnit: '{value} h',
  ratingValue: '{value}/5',
  loadError: 'You do not have access to analytics, or the service is unavailable.',
  eyebrow: 'Dispatch Analytics',
  title: 'Ticket performance',
  intro: 'Volumes, SLAs, feedback and staff activity.',
  periodDays: '{days} days',
  tickets: 'Tickets',
  setup: 'Setup',
  created: 'Created',
  closed: 'Closed',
  currentOpen: 'Open now',
  avgFirstResponse: 'Average first response',
  avgResolution: 'Average resolution',
  avgRating: 'Average rating',
  feedback: 'Feedback',
  firstResponseBreaches: 'Response SLA breaches',
  resolutionBreaches: 'Resolution SLA breaches',
  dailyTitle: 'Daily trend',
  createdTitle: 'Created: {count}',
  closedTitle: 'Closed: {count}',
  dailyLegend: 'Values per row: created / closed.',
  categories: 'Categories',
  category: 'Category',
  rating: 'Rating',
  staff: 'Staff',
  userId: 'User ID',
  claim: 'Claims',
  handled: 'Handled',
  handledTitle: 'Closed tickets credited to whoever had claimed them, otherwise to whoever closed them',
  firstResponse: '1st response',
  replies: 'Replies',
  assigned: 'Assigned',
  ratingTitle: 'Ratings credited to the moderator who was handling the ticket'
};

const copy: Record<Locale, typeof it> = { it, en };

function minutes(value: number | null, c: typeof it) {
  if (value === null) return c.notAvailable;
  if (value < 60) return format(c.minutesUnit, { value: value.toFixed(1) });
  return format(c.hoursUnit, { value: (value / 60).toFixed(1) });
}

function rating(value: number | null, c: typeof it) {
  return value === null ? c.notAvailable : format(c.ratingValue, { value: value.toFixed(2) });
}

export default function TicketAnalyticsPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;
  const c = useCopy(copy);

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
      setError(c.loadError);
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
          <p className="eyebrow">{c.eyebrow}</p>
          <h1>{c.title}</h1>
          <p className="muted">{c.intro}</p>
        </div>
        <div className="actions">
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>{format(c.periodDays, { days: 7 })}</option>
            <option value={30}>{format(c.periodDays, { days: 30 })}</option>
            <option value={90}>{format(c.periodDays, { days: 90 })}</option>
          </select>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets/manage`}>{c.tickets}</a>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets`}>{c.setup}</a>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {data && (
        <>
          <section className="stat-grid">
            <article className="card stat-card"><span>{c.created}</span><strong>{data.summary.created}</strong></article>
            <article className="card stat-card"><span>{c.closed}</span><strong>{data.summary.closed}</strong></article>
            <article className="card stat-card"><span>{c.currentOpen}</span><strong>{data.summary.currentOpen}</strong></article>
            <article className="card stat-card"><span>{c.avgFirstResponse}</span><strong>{minutes(data.summary.averageFirstResponseMinutes, c)}</strong></article>
            <article className="card stat-card"><span>{c.avgResolution}</span><strong>{minutes(data.summary.averageResolutionMinutes, c)}</strong></article>
            <article className="card stat-card"><span>{c.avgRating}</span><strong>{rating(data.summary.averageRating, c)}</strong></article>
            <article className="card stat-card"><span>{c.feedback}</span><strong>{data.summary.feedbackCount}</strong></article>
            <article className="card stat-card"><span>{c.firstResponseBreaches}</span><strong>{data.summary.firstResponseSlaBreaches}</strong></article>
            <article className="card stat-card"><span>{c.resolutionBreaches}</span><strong>{data.summary.resolutionSlaBreaches}</strong></article>
          </section>

          <section className="card">
            <h2>{c.dailyTitle}</h2>
            <div className="daily-chart">
              {data.daily.map((row) => (
                <div className="daily-row" key={row.date}>
                  <span>{row.date.slice(5)}</span>
                  <div className="bars">
                    <div
                      className="bar created"
                      style={{ width: row.created ? `${Math.max(2, (row.created / maxDaily) * 100)}%` : '0%' }}
                      title={format(c.createdTitle, { count: row.created })}
                    />
                    <div
                      className="bar closed"
                      style={{ width: row.closed ? `${Math.max(2, (row.closed / maxDaily) * 100)}%` : '0%' }}
                      title={format(c.closedTitle, { count: row.closed })}
                    />
                  </div>
                  <span>{row.created}/{row.closed}</span>
                </div>
              ))}
            </div>
            <p className="muted">{c.dailyLegend}</p>
          </section>

          <section className="grid settings-grid">
            <article className="card">
              <h2>{c.categories}</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>{c.category}</th><th>{c.created}</th><th>{c.closed}</th><th>{c.rating}</th></tr>
                  </thead>
                  <tbody>
                    {data.categories.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>{row.created}</td>
                        <td>{row.closed}</td>
                        <td>{rating(row.averageRating, c)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="card">
              <h2>{c.staff}</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{c.userId}</th>
                      <th>{c.claim}</th>
                      <th title={c.handledTitle}>{c.handled}</th>
                      <th>{c.firstResponse}</th>
                      <th>{c.replies}</th>
                      <th>{c.assigned}</th>
                      <th title={c.ratingTitle}>{c.rating}</th>
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
                        <td>{rating(row.averageRating, c)}{row.feedbackCount ? ` (${row.feedbackCount})` : ''}</td>
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
