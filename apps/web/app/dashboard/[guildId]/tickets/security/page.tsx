'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useCopy, useLocale } from '../../../../_components/locale-context';
import { format, type Locale } from '../../../../i18n';

type BlacklistEntry = {
  id: string;
  userId: string;
  reason: string | null;
  expiresAt: string | null;
  createdById: string;
  createdAt: string;
};

const it = {
  forbidden: 'La gestione blacklist richiede il livello Admin o Owner.',
  loadError: 'Impossibile caricare la blacklist.',
  errors: {
    QUOTA_EXCEEDED: 'Limite raggiunto per questo server: elimina un elemento esistente prima di crearne uno nuovo.'
  } as Record<string, string>,
  saveFailed: 'Salvataggio fallito: {code}',
  removeFailed: 'Rimozione fallita: {code}',
  saved: 'Utente inserito o aggiornato in blacklist.',
  removed: 'Utente rimosso dalla blacklist.',
  eyebrow: 'Dispatch Security',
  title: 'Blacklist ticket',
  intro: 'Gli utenti attivi in blacklist non possono aprire nuovi ticket.',
  setup: 'Configurazione',
  tickets: 'Ticket',
  formTitle: 'Aggiungi o aggiorna',
  userId: 'Discord User ID',
  reason: 'Motivo interno',
  reasonPlaceholder: 'Cifrato nel database. Non viene mostrato all’utente.',
  expiresIn: 'Scadenza in ore',
  expiresPlaceholder: 'Vuoto = permanente',
  saving: 'Salvataggio...',
  save: 'Salva blacklist',
  listTitle: 'Utenti bloccati',
  expires: 'Scade: {date}',
  permanent: 'Permanente',
  remove: 'Rimuovi',
  addedBy: 'Inserito da {user} · {date}',
  empty: 'Nessun utente attualmente in blacklist.'
};

const en: typeof it = {
  forbidden: 'Managing the blacklist requires the Admin or Owner level.',
  loadError: 'The blacklist could not be loaded.',
  errors: {
    QUOTA_EXCEEDED: 'Limit reached for this server: delete an existing item before creating a new one.'
  } as Record<string, string>,
  saveFailed: 'Save failed: {code}',
  removeFailed: 'Removal failed: {code}',
  saved: 'User added to or updated in the blacklist.',
  removed: 'User removed from the blacklist.',
  eyebrow: 'Dispatch Security',
  title: 'Ticket blacklist',
  intro: 'Users with an active blacklist entry cannot open new tickets.',
  setup: 'Setup',
  tickets: 'Tickets',
  formTitle: 'Add or update',
  userId: 'Discord User ID',
  reason: 'Internal reason',
  reasonPlaceholder: 'Encrypted in the database. Never shown to the user.',
  expiresIn: 'Expires in (hours)',
  expiresPlaceholder: 'Empty = permanent',
  saving: 'Saving...',
  save: 'Save blacklist',
  listTitle: 'Blocked users',
  expires: 'Expires: {date}',
  permanent: 'Permanent',
  remove: 'Remove',
  addedBy: 'Added by {user} · {date}',
  empty: 'No users are currently blacklisted.'
};

const copy: Record<Locale, typeof it> = { it, en };

export default function TicketSecurityPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;
  const locale = useLocale();
  const c = useCopy(copy);
  const dateLocale = locale === 'it' ? 'it-IT' : 'en-US';

  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const [expiresInHours, setExpiresInHours] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setError('');
    const response = await fetch(`/backend/api/guilds/${guildId}/blacklist`);

    if (response.status === 401) {
      window.location.href = '/backend/auth/discord';
      return;
    }

    if (!response.ok) {
      setError(response.status === 403
        ? c.forbidden
        : c.loadError);
      return;
    }

    setEntries(await response.json());
  };

  useEffect(() => {
    void load();
  }, [guildId]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('save');
    setError('');
    setNotice('');

    try {
      const response = await fetch(`/backend/api/guilds/${guildId}/blacklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          reason: reason.trim() || null,
          expiresInHours: expiresInHours ? Number(expiresInHours) : null
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const code = body.error ?? response.status;
        setError(c.errors[String(code)] ?? format(c.saveFailed, { code }));
        return;
      }

      setUserId('');
      setReason('');
      setExpiresInHours('');
      setNotice(c.saved);
      await load();
    } finally {
      setBusy('');
    }
  };

  const remove = async (targetUserId: string) => {
    setBusy(targetUserId);
    setError('');
    setNotice('');

    try {
      const response = await fetch(
        `/backend/api/guilds/${guildId}/blacklist/${targetUserId}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(format(c.removeFailed, { code: body.error ?? response.status }));
        return;
      }

      setNotice(c.removed);
      await load();
    } finally {
      setBusy('');
    }
  };

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">{c.eyebrow}</p>
          <h1>{c.title}</h1>
          <p className="muted">{c.intro}</p>
        </div>
        <div className="actions">
          <a className="button secondary" href={`/dashboard/${guildId}/tickets`}>{c.setup}</a>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets/manage`}>{c.tickets}</a>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <section className="grid settings-grid">
        <form className="card form" onSubmit={save}>
          <h2>{c.formTitle}</h2>
          <label>
            {c.userId}
            <input
              required
              pattern="[0-9]{17,20}"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            />
          </label>
          <label>
            {c.reason}
            <textarea
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={c.reasonPlaceholder}
            />
          </label>
          <label>
            {c.expiresIn}
            <input
              type="number"
              min={1}
              max={8760}
              value={expiresInHours}
              onChange={(event) => setExpiresInHours(event.target.value)}
              placeholder={c.expiresPlaceholder}
            />
          </label>
          <button disabled={busy === 'save'} type="submit">
            {busy === 'save' ? c.saving : c.save}
          </button>
        </form>

        <div className="card">
          <h2>{c.listTitle}</h2>
          <div className="member-list">
            {entries.map((entry) => (
              <div className="list-item" key={entry.id}>
                <div className="row">
                  <div>
                    <strong>{entry.userId}</strong>
                    <div className="muted">
                      {entry.expiresAt
                        ? format(c.expires, { date: new Date(entry.expiresAt).toLocaleString(dateLocale) })
                        : c.permanent}
                    </div>
                  </div>
                  <button
                    className="danger"
                    disabled={busy === entry.userId}
                    onClick={() => void remove(entry.userId)}
                  >
                    {c.remove}
                  </button>
                </div>
                {entry.reason && <p className="preserve">{entry.reason}</p>}
                <p className="muted">
                  {format(c.addedBy, { user: entry.createdById, date: new Date(entry.createdAt).toLocaleString(dateLocale) })}
                </p>
              </div>
            ))}
            {!error && entries.length === 0 && (
              <p className="muted">{c.empty}</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
