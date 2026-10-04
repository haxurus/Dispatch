'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type BlacklistEntry = {
  id: string;
  userId: string;
  reason: string | null;
  expiresAt: string | null;
  createdById: string;
  createdAt: string;
};

export default function TicketSecurityPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;

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
        ? 'La gestione blacklist richiede il livello Admin o Owner.'
        : 'Impossibile caricare la blacklist.');
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
        setError(`Salvataggio fallito: ${body.error ?? response.status}`);
        return;
      }

      setUserId('');
      setReason('');
      setExpiresInHours('');
      setNotice('Utente inserito o aggiornato in blacklist.');
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
        setError(`Rimozione fallita: ${body.error ?? response.status}`);
        return;
      }

      setNotice('Utente rimosso dalla blacklist.');
      await load();
    } finally {
      setBusy('');
    }
  };

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">Dispatch Security</p>
          <h1>Blacklist ticket</h1>
          <p className="muted">Gli utenti attivi in blacklist non possono aprire nuovi ticket.</p>
        </div>
        <div className="actions">
          <a className="button secondary" href={`/dashboard/${guildId}/tickets`}>Configurazione</a>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets/manage`}>Ticket</a>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <section className="grid settings-grid">
        <form className="card form" onSubmit={save}>
          <h2>Aggiungi o aggiorna</h2>
          <label>
            Discord User ID
            <input
              required
              pattern="[0-9]{17,20}"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            />
          </label>
          <label>
            Motivo interno
            <textarea
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Cifrato nel database. Non viene mostrato all’utente."
            />
          </label>
          <label>
            Scadenza in ore
            <input
              type="number"
              min={1}
              max={8760}
              value={expiresInHours}
              onChange={(event) => setExpiresInHours(event.target.value)}
              placeholder="Vuoto = permanente"
            />
          </label>
          <button disabled={busy === 'save'} type="submit">
            {busy === 'save' ? 'Salvataggio...' : 'Salva blacklist'}
          </button>
        </form>

        <div className="card">
          <h2>Utenti bloccati</h2>
          <div className="member-list">
            {entries.map((entry) => (
              <div className="list-item" key={entry.id}>
                <div className="row">
                  <div>
                    <strong>{entry.userId}</strong>
                    <div className="muted">
                      {entry.expiresAt
                        ? `Scade: ${new Date(entry.expiresAt).toLocaleString()}`
                        : 'Permanente'}
                    </div>
                  </div>
                  <button
                    className="danger"
                    disabled={busy === entry.userId}
                    onClick={() => void remove(entry.userId)}
                  >
                    Rimuovi
                  </button>
                </div>
                {entry.reason && <p className="preserve">{entry.reason}</p>}
                <p className="muted">
                  Inserito da {entry.createdById} · {new Date(entry.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
            {!error && entries.length === 0 && (
              <p className="muted">Nessun utente attualmente in blacklist.</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
