'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type AccessLevel = 'VIEWER' | 'MODERATOR' | 'ADMIN' | 'OWNER';
type Answer = { id: string; label: string; type: string; value: string | string[] };
type Question = { id: string; type: string; options?: Array<{ label: string; value: string }> };
type Submission = {
  id: string; userId: string; username: string; source: string; status: string;
  reportChannelId: string | null; reportMessageId: string | null; ticketChannelId: string | null;
  createdAt: string; answers: Answer[]; unreadable?: boolean;
};

// Local mirror of @dispatch/shared displayAnswer (the web app does not depend on it).
function formatAnswer(answer: Answer, question?: Question) {
  const labels = new Map((question?.options ?? []).map((option) => [option.value, option.label]));
  if (Array.isArray(answer.value)) {
    return answer.value.map((value) => labels.get(value) ?? value).join(', ') || 'Nessuna risposta';
  }
  if (answer.type === 'BOOLEAN') {
    return answer.value === 'true' ? 'Sì' : answer.value === 'false' ? 'No' : 'Nessuna risposta';
  }
  if (!answer.value) return 'Nessuna risposta';
  return labels.get(answer.value) ?? answer.value;
}

export default function FormSubmissionsPage() {
  const params = useParams<{ guildId: string; formId: string }>();
  const { guildId, formId } = params;
  const [items, setItems] = useState<Submission[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [access, setAccess] = useState<AccessLevel | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isAdmin = access === 'ADMIN' || access === 'OWNER';

  useEffect(() => {
    void (async () => {
      const [response, accessResponse, formsResponse] = await Promise.all([
        fetch(`/backend/api/guilds/${guildId}/forms/${formId}/submissions`),
        fetch(`/backend/api/guilds/${guildId}/access`),
        fetch(`/backend/api/guilds/${guildId}/forms`)
      ]);
      if (response.status === 401) {
        window.location.href = '/backend/auth/discord';
        return;
      }
      if (!response.ok) {
        setError('Non hai il permesso di vedere gli invii di questo form.');
        return;
      }
      setItems(await response.json());
      if (accessResponse.ok) setAccess((await accessResponse.json()).access);
      if (formsResponse.ok) {
        const forms = await formsResponse.json() as Array<{ id: string; questions?: Question[] }>;
        setQuestions(forms.find((item) => item.id === formId)?.questions ?? []);
      }
    })();
  }, [guildId, formId]);

  const removeSubmission = async (id: string) => {
    if (!window.confirm('Eliminare definitivamente questo invio?')) return;
    setBusy(id); setError(''); setNotice('');
    try {
      const response = await fetch(`/backend/api/guilds/${guildId}/forms/${formId}/submissions/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(`Eliminazione fallita: ${body.error ?? response.status}`);
        return;
      }
      setItems((current) => current.filter((item) => item.id !== id));
      setNotice('Invio eliminato.');
    } finally {
      setBusy('');
    }
  };

  const questionById = new Map(questions.map((question) => [question.id, question]));

  return <main className="shell">
    <div className="row">
      <div><p className="eyebrow">Dispatch</p><h1>Invii form</h1><p className="muted">{items.length} invii recenti</p></div>
      <div className="actions"><a className="button secondary" href={`/dashboard/${guildId}/forms`}>Torna ai form</a></div>
    </div>
    {error && <p className="error">{error}</p>}
    {notice && <p className="success">{notice}</p>}
    <section className="ticket-list">
      {items.map((submission) => <article className="card" key={submission.id}>
        <div className="row">
          <div><strong>{submission.username}</strong><div className="muted">{submission.userId} · {new Date(submission.createdAt).toLocaleString('it-IT')}</div></div>
          <span className="badge">{submission.status}</span>
        </div>
        {submission.unreadable
          ? <p className="error">Risposte non leggibili (dati cifrati non decifrabili).</p>
          : <div className="member-list">
            {submission.answers.map((answer) => <div className="list-item" key={answer.id}><strong>{answer.label}</strong><p className="preserve">{formatAnswer(answer, questionById.get(answer.id))}</p></div>)}
          </div>}
        <div className="actions">
          {submission.reportChannelId && <a className="button secondary" target="_blank" rel="noreferrer" href={`https://discord.com/channels/${guildId}/${submission.reportChannelId}/${submission.reportMessageId ?? ''}`}>Report Discord</a>}
          {submission.ticketChannelId && <a className="button secondary" target="_blank" rel="noreferrer" href={`https://discord.com/channels/${guildId}/${submission.ticketChannelId}`}>Ticket</a>}
          {isAdmin && <button className="danger" disabled={busy === submission.id} onClick={() => void removeSubmission(submission.id)}>Elimina invio</button>}
        </div>
      </article>)}
      {!error && !items.length && <div className="card muted">Nessun invio.</div>}
    </section>
  </main>;
}
