'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useCopy } from '../../../_components/locale-context';
import { apiErrorText, usePlan } from '../../../_components/plan-client';
import { format, type Locale } from '../../../i18n';

/*
 * Canned replies (API: /guilds/:guildId/response-templates): messages the
 * staff sends into a ticket from its page in one click. Moderators can read
 * them; Admins and Owners create, edit and delete them. The count is limited
 * by the server's plan.
 */

type AccessLevel = 'VIEWER' | 'MODERATOR' | 'ADMIN' | 'OWNER';

type CannedReply = {
  id: string;
  name: string;
  content: string;
};

const it = {
  eyebrow: 'Dispatch',
  title: 'Risposte rapide',
  intro: 'Messaggi già pronti che lo staff invia in un ticket con un clic, dalla pagina del ticket: scegli la risposta nel menu “Risposta rapida” e premi “Invia nel ticket”.',
  usage: '{used} di {limit} risposte rapide usate con il tuo piano.',
  loadError: 'Impossibile caricare le risposte rapide.',
  viewerDenied: 'Serve almeno il livello Moderator per vedere le risposte rapide.',
  readOnly: 'Puoi vedere le risposte rapide; per crearle o modificarle serve il livello Admin o Owner.',
  newTitle: 'Nuova risposta rapida',
  editTitle: 'Modifica risposta rapida',
  name: 'Nome',
  namePlaceholder: 'Es. Benvenuto, Richiesta dettagli, Chiusura',
  nameHint: 'Lo vede solo lo staff, nel menu della pagina del ticket.',
  message: 'Messaggio',
  messagePlaceholder: 'Il testo che verrà inviato nel canale del ticket.',
  create: 'Crea risposta rapida',
  save: 'Salva modifiche',
  cancel: 'Annulla',
  listTitle: 'Le tue risposte rapide',
  empty: 'Nessuna risposta rapida. Creane una per rispondere più in fretta ai ticket più comuni.',
  edit: 'Modifica',
  delete: 'Elimina',
  confirmDelete: 'Eliminare la risposta rapida “{name}”?',
  created: 'Risposta rapida creata.',
  updated: 'Risposta rapida aggiornata.',
  deleted: 'Risposta rapida eliminata.',
  failed: 'Operazione non riuscita: {code}',
  errors: {
    QUOTA_EXCEEDED: 'Hai raggiunto il limite di {limit} risposte rapide del tuo piano: passa a un piano superiore o eliminane una.'
  } as Record<string, string>
};

const en: typeof it = {
  eyebrow: 'Dispatch',
  title: 'Canned replies',
  intro: 'Ready-made messages the staff sends into a ticket in one click, from the ticket page: pick the reply in the “Canned reply” menu and press “Send to ticket”.',
  usage: '{used} of {limit} canned replies used on your plan.',
  loadError: 'The canned replies could not be loaded.',
  viewerDenied: 'At least the Moderator level is required to see canned replies.',
  readOnly: 'You can see the canned replies; creating or editing them requires the Admin or Owner level.',
  newTitle: 'New canned reply',
  editTitle: 'Edit canned reply',
  name: 'Name',
  namePlaceholder: 'E.g. Welcome, Ask for details, Closing',
  nameHint: 'Only the staff sees it, in the menu of the ticket page.',
  message: 'Message',
  messagePlaceholder: 'The text sent into the ticket channel.',
  create: 'Create canned reply',
  save: 'Save changes',
  cancel: 'Cancel',
  listTitle: 'Your canned replies',
  empty: 'No canned replies yet. Create one to answer the most common tickets faster.',
  edit: 'Edit',
  delete: 'Delete',
  confirmDelete: 'Delete the canned reply “{name}”?',
  created: 'Canned reply created.',
  updated: 'Canned reply updated.',
  deleted: 'Canned reply deleted.',
  failed: 'The operation failed: {code}',
  errors: {
    QUOTA_EXCEEDED: 'You reached the {limit} canned replies of your plan: upgrade or delete one.'
  }
};

const copy: Record<Locale, typeof it> = { it, en };

export default function CannedRepliesPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;
  const c = useCopy(copy);
  const { plan, reload: reloadPlan } = usePlan(guildId);

  const [access, setAccess] = useState<AccessLevel | null>(null);
  const [replies, setReplies] = useState<CannedReply[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canEdit = access === 'ADMIN' || access === 'OWNER';

  const load = async () => {
    setError('');
    const accessResponse = await fetch(`/backend/api/guilds/${guildId}/access`);
    if (accessResponse.status === 401) {
      window.location.href = '/backend/auth/discord';
      return;
    }
    if (!accessResponse.ok) {
      setError(c.loadError);
      return;
    }
    const level = (await accessResponse.json()).access as AccessLevel;
    setAccess(level);
    if (level === 'VIEWER') return;
    const response = await fetch(`/backend/api/guilds/${guildId}/response-templates`);
    if (!response.ok) {
      setError(c.loadError);
      return;
    }
    setReplies(await response.json());
  };

  useEffect(() => {
    void load();
  }, [guildId]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setContent('');
  };

  const startEdit = (reply: CannedReply) => {
    setEditingId(reply.id);
    setName(reply.name);
    setContent(reply.content);
    setNotice('');
    setError('');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('save');
    setError('');
    setNotice('');
    try {
      const url = editingId
        ? `/backend/api/guilds/${guildId}/response-templates/${editingId}`
        : `/backend/api/guilds/${guildId}/response-templates`;
      const response = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(apiErrorText(c.errors, body, format(c.failed, { code: body.error ?? response.status })));
        return;
      }
      setNotice(editingId ? c.updated : c.created);
      resetForm();
      await Promise.all([load(), reloadPlan()]);
    } finally {
      setBusy('');
    }
  };

  const remove = async (reply: CannedReply) => {
    if (!window.confirm(format(c.confirmDelete, { name: reply.name }))) return;
    setBusy(`delete:${reply.id}`);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/backend/api/guilds/${guildId}/response-templates/${reply.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(format(c.failed, { code: body.error ?? response.status }));
        return;
      }
      if (editingId === reply.id) resetForm();
      setNotice(c.deleted);
      await Promise.all([load(), reloadPlan()]);
    } finally {
      setBusy('');
    }
  };

  const limit = plan?.plan.limits.responseTemplates;

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">{c.eyebrow}</p>
          <h1>{c.title}</h1>
          <p className="muted">{c.intro}</p>
          {typeof limit === 'number' && access && access !== 'VIEWER' && (
            <p className="muted">{format(c.usage, { used: replies.length, limit })}</p>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}
      {access === 'VIEWER' && <p className="muted">{c.viewerDenied}</p>}
      {access === 'MODERATOR' && <p className="muted">{c.readOnly}</p>}

      {access && access !== 'VIEWER' && (
        <section className="grid settings-grid">
          {canEdit && (
            <form className="card form" onSubmit={save}>
              <div className="row">
                <h2>{editingId ? c.editTitle : c.newTitle}</h2>
                {editingId && <button className="secondary" type="button" onClick={resetForm}>{c.cancel}</button>}
              </div>
              <label>
                {c.name}
                <input
                  required
                  maxLength={80}
                  value={name}
                  placeholder={c.namePlaceholder}
                  onChange={(event) => setName(event.target.value)}
                />
                <small className="muted">{c.nameHint}</small>
              </label>
              <label>
                {c.message}
                <textarea
                  required
                  maxLength={2000}
                  rows={8}
                  value={content}
                  placeholder={c.messagePlaceholder}
                  onChange={(event) => setContent(event.target.value)}
                />
              </label>
              <button disabled={busy === 'save'} type="submit">{editingId ? c.save : c.create}</button>
            </form>
          )}

          <div className="card">
            <h2>{c.listTitle}</h2>
            <div className="member-list">
              {replies.map((reply) => (
                <div className="list-item" key={reply.id}>
                  <div className="row">
                    <strong>{reply.name}</strong>
                    {canEdit && (
                      <div className="actions">
                        <button className="secondary" type="button" onClick={() => startEdit(reply)}>{c.edit}</button>
                        <button
                          className="danger"
                          type="button"
                          disabled={busy === `delete:${reply.id}`}
                          onClick={() => void remove(reply)}
                        >
                          {c.delete}
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="muted preserve">{reply.content}</p>
                </div>
              ))}
              {replies.length === 0 && <p className="muted">{c.empty}</p>}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
