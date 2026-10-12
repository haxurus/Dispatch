'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useCopy, useLocale } from '../../../../_components/locale-context';
import { format, type Locale } from '../../../../i18n';

type AccessLevel = 'VIEWER' | 'MODERATOR' | 'ADMIN' | 'OWNER';
type Answer = { id: string; label: string; type: string; value: string | string[] };
type Question = { id: string; type: string; options?: Array<{ label: string; value: string }> };
type Submission = {
  id: string; userId: string; username: string; source: string; status: string;
  reportChannelId: string | null; reportMessageId: string | null; ticketChannelId: string | null;
  createdAt: string; answers: Answer[]; unreadable?: boolean;
};

const it = {
  yes: 'Sì',
  no: 'No',
  noAnswer: 'Nessuna risposta',
  loadError: 'Non hai il permesso di vedere gli invii di questo form.',
  confirmDelete: 'Eliminare definitivamente questo invio?',
  deleteFailed: 'Eliminazione fallita: {code}',
  deleted: 'Invio eliminato.',
  title: 'Invii form',
  recent: (count: number) => count === 1 ? '1 invio recente' : `${count} invii recenti`,
  backToForms: 'Torna ai form',
  unreadable: 'Risposte non leggibili (dati cifrati non decifrabili).',
  discordReport: 'Report Discord',
  ticket: 'Ticket',
  deleteSubmission: 'Elimina invio',
  empty: 'Nessun invio.'
};

const en: typeof it = {
  yes: 'Yes',
  no: 'No',
  noAnswer: 'No answer',
  loadError: 'You do not have permission to view the submissions of this form.',
  confirmDelete: 'Permanently delete this submission?',
  deleteFailed: 'Delete failed: {code}',
  deleted: 'Submission deleted.',
  title: 'Form submissions',
  recent: (count: number) => count === 1 ? '1 recent submission' : `${count} recent submissions`,
  backToForms: 'Back to forms',
  unreadable: 'Answers unreadable (encrypted data could not be decrypted).',
  discordReport: 'Discord report',
  ticket: 'Ticket',
  deleteSubmission: 'Delete submission',
  empty: 'No submissions.'
};

const copy: Record<Locale, typeof it> = { it, en };

// Local mirror of @dispatch/shared displayAnswer (the web app does not depend on it).
function formatAnswer(answer: Answer, c: typeof it, question?: Question) {
  const labels = new Map((question?.options ?? []).map((option) => [option.value, option.label]));
  if (Array.isArray(answer.value)) {
    return answer.value.map((value) => labels.get(value) ?? value).join(', ') || c.noAnswer;
  }
  if (answer.type === 'BOOLEAN') {
    return answer.value === 'true' ? c.yes : answer.value === 'false' ? c.no : c.noAnswer;
  }
  if (!answer.value) return c.noAnswer;
  return labels.get(answer.value) ?? answer.value;
}

export default function FormSubmissionsPage() {
  const params = useParams<{ guildId: string; formId: string }>();
  const { guildId, formId } = params;
  const c = useCopy(copy);
  const locale = useLocale();
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
        setError(c.loadError);
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
    if (!window.confirm(c.confirmDelete)) return;
    setBusy(id); setError(''); setNotice('');
    try {
      const response = await fetch(`/backend/api/guilds/${guildId}/forms/${formId}/submissions/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(format(c.deleteFailed, { code: body.error ?? response.status }));
        return;
      }
      setItems((current) => current.filter((item) => item.id !== id));
      setNotice(c.deleted);
    } finally {
      setBusy('');
    }
  };

  const questionById = new Map(questions.map((question) => [question.id, question]));

  return <main className="shell">
    <div className="row">
      <div><p className="eyebrow">Dispatch</p><h1>{c.title}</h1><p className="muted">{c.recent(items.length)}</p></div>
      <div className="actions"><a className="button secondary" href={`/dashboard/${guildId}/forms`}>{c.backToForms}</a></div>
    </div>
    {error && <p className="error">{error}</p>}
    {notice && <p className="success">{notice}</p>}
    <section className="ticket-list">
      {items.map((submission) => <article className="card" key={submission.id}>
        <div className="row">
          <div><strong>{submission.username}</strong><div className="muted">{submission.userId} · {new Date(submission.createdAt).toLocaleString(locale === 'it' ? 'it-IT' : 'en-US')}</div></div>
          <span className="badge">{submission.status}</span>
        </div>
        {submission.unreadable
          ? <p className="error">{c.unreadable}</p>
          : <div className="member-list">
            {submission.answers.map((answer) => <div className="list-item" key={answer.id}><strong>{answer.label}</strong><p className="preserve">{formatAnswer(answer, c, questionById.get(answer.id))}</p></div>)}
          </div>}
        <div className="actions">
          {submission.reportChannelId && <a className="button secondary" target="_blank" rel="noreferrer" href={`https://discord.com/channels/${guildId}/${submission.reportChannelId}/${submission.reportMessageId ?? ''}`}>{c.discordReport}</a>}
          {submission.ticketChannelId && <a className="button secondary" target="_blank" rel="noreferrer" href={`https://discord.com/channels/${guildId}/${submission.ticketChannelId}`}>{c.ticket}</a>}
          {isAdmin && <button className="danger" disabled={busy === submission.id} onClick={() => void removeSubmission(submission.id)}>{c.deleteSubmission}</button>}
        </div>
      </article>)}
      {!error && !items.length && <div className="card muted">{c.empty}</div>}
    </section>
  </main>;
}
