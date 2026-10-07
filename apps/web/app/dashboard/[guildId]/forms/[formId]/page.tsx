'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type Answer = { id: string; label: string; type: string; value: string | string[] };
type Submission = {
  id: string; userId: string; username: string; source: string; status: string;
  reportChannelId: string | null; reportMessageId: string | null; ticketChannelId: string | null;
  createdAt: string; answers: Answer[];
};

export default function FormSubmissionsPage() {
  const params = useParams<{ guildId: string; formId: string }>();
  const { guildId, formId } = params;
  const [items, setItems] = useState<Submission[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const response = await fetch(`/backend/api/guilds/${guildId}/forms/${formId}/submissions`);
      if (response.status === 401) {
        window.location.href = '/backend/auth/discord';
        return;
      }
      if (!response.ok) {
        setError('Non hai il permesso di vedere gli invii di questo form.');
        return;
      }
      setItems(await response.json());
    })();
  }, [guildId, formId]);

  return <main className="shell">
    <div className="row">
      <div><p className="eyebrow">Dispatch</p><h1>Invii form</h1><p className="muted">{items.length} invii recenti</p></div>
      <div className="actions"><a className="button secondary" href={`/dashboard/${guildId}/forms`}>Torna ai form</a></div>
    </div>
    {error && <p className="error">{error}</p>}
    <section className="ticket-list">
      {items.map((submission) => <article className="card" key={submission.id}>
        <div className="row">
          <div><strong>{submission.username}</strong><div className="muted">{submission.userId} · {new Date(submission.createdAt).toLocaleString('it-IT')}</div></div>
          <span className="badge">{submission.status}</span>
        </div>
        <div className="member-list">
          {submission.answers.map((answer) => <div className="list-item" key={answer.id}><strong>{answer.label}</strong><p className="preserve">{Array.isArray(answer.value) ? answer.value.join(', ') : answer.value || 'Nessuna risposta'}</p></div>)}
        </div>
        <div className="actions">
          {submission.reportChannelId && <a className="button secondary" target="_blank" rel="noreferrer" href={`https://discord.com/channels/${guildId}/${submission.reportChannelId}/${submission.reportMessageId ?? ''}`}>Report Discord</a>}
          {submission.ticketChannelId && <a className="button secondary" target="_blank" rel="noreferrer" href={`https://discord.com/channels/${guildId}/${submission.ticketChannelId}`}>Ticket</a>}
        </div>
      </article>)}
      {!error && !items.length && <div className="card muted">Nessun invio.</div>}
    </section>
  </main>;
}
