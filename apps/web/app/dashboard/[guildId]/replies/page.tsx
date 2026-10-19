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
  /** Offered in every ticket, or only in tickets of these categories or forms. */
  allTickets: boolean;
  categoryIds: string[];
  formIds: string[];
};

type Option = { id: string; name: string };

const it = {
  eyebrow: 'Dispatch',
  title: 'Risposte rapide',
  intro: 'Messaggi già pronti che lo staff invia in un ticket con un clic, dalla pagina del ticket: scegli la risposta nel menu “Risposta rapida” e premi “Invia nel ticket”. Ognuna può valere per tutti i ticket o solo per alcune categorie e form.',
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
  scope: 'Dove usarla',
  scopeAll: 'In tutti i ticket',
  scopeSelected: 'Solo in alcune categorie o form',
  scopeHint: 'La risposta compare nel menu dei ticket di queste categorie e di quelli aperti da questi form.',
  categories: 'Categorie di ticket',
  forms: 'Form',
  noCategories: 'Nessuna categoria configurata.',
  noForms: 'Nessun form configurato.',
  scopeLabelAll: 'Tutti i ticket',
  scopeNowhere: 'Non associata: non compare in nessun ticket',
  unknown: 'eliminato',
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
    QUOTA_EXCEEDED: 'Hai raggiunto il limite di {limit} risposte rapide del tuo piano: passa a un piano superiore o eliminane una.',
    TEMPLATE_NAME_CONFLICT: 'Esiste già una risposta rapida con questo nome.',
    TEMPLATE_SCOPE_EMPTY: 'Scegli almeno una categoria o un form, oppure “In tutti i ticket”.',
    TEMPLATE_SCOPE_INVALID: 'Una categoria o un form scelto non esiste più: ricarica la pagina.'
  } as Record<string, string>
};

const en: typeof it = {
  eyebrow: 'Dispatch',
  title: 'Canned replies',
  intro: 'Ready-made messages the staff sends into a ticket in one click, from the ticket page: pick the reply in the “Canned reply” menu and press “Send to ticket”. Each one can apply to every ticket or only to some categories and forms.',
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
  scope: 'Where to use it',
  scopeAll: 'In every ticket',
  scopeSelected: 'Only in some categories or forms',
  scopeHint: 'The reply appears in the menu of tickets in these categories and of tickets opened by these forms.',
  categories: 'Ticket categories',
  forms: 'Forms',
  noCategories: 'No categories configured.',
  noForms: 'No forms configured.',
  scopeLabelAll: 'Every ticket',
  scopeNowhere: 'Not linked: it does not appear in any ticket',
  unknown: 'deleted',
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
    QUOTA_EXCEEDED: 'You reached the {limit} canned replies of your plan: upgrade or delete one.',
    TEMPLATE_NAME_CONFLICT: 'A canned reply with this name already exists.',
    TEMPLATE_SCOPE_EMPTY: 'Pick at least one category or form, or “In every ticket”.',
    TEMPLATE_SCOPE_INVALID: 'A chosen category or form no longer exists: reload the page.'
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
  const [allTickets, setAllTickets] = useState(true);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [formIds, setFormIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [forms, setForms] = useState<Option[]>([]);
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
    const [response, categoriesResponse, formsResponse] = await Promise.all([
      fetch(`/backend/api/guilds/${guildId}/response-templates`),
      fetch(`/backend/api/guilds/${guildId}/categories`),
      fetch(`/backend/api/guilds/${guildId}/forms`)
    ]);
    if (!response.ok) {
      setError(c.loadError);
      return;
    }
    setReplies(await response.json());
    // Names for the scope; a missing list only hides the choice.
    const pick = (rows: Array<{ id: string; name: string }>) => rows.map((row) => ({ id: row.id, name: row.name }));
    if (categoriesResponse.ok) setCategories(pick(await categoriesResponse.json()));
    if (formsResponse.ok) setForms(pick(await formsResponse.json()));
  };

  useEffect(() => {
    void load();
  }, [guildId]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setContent('');
    setAllTickets(true);
    setCategoryIds([]);
    setFormIds([]);
  };

  const startEdit = (reply: CannedReply) => {
    setEditingId(reply.id);
    setName(reply.name);
    setContent(reply.content);
    setAllTickets(reply.allTickets);
    setCategoryIds(reply.categoryIds);
    setFormIds(reply.formIds);
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
        body: JSON.stringify({
          name,
          content,
          allTickets,
          categoryIds: allTickets ? [] : categoryIds,
          formIds: allTickets ? [] : formIds
        })
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

  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((value) => value !== id));
  const nameOf = (options: Option[], id: string) => options.find((option) => option.id === id)?.name ?? c.unknown;
  const scopeText = (reply: CannedReply) => {
    if (reply.allTickets) return c.scopeLabelAll;
    const names = [
      ...reply.categoryIds.map((id) => nameOf(categories, id)),
      ...reply.formIds.map((id) => `${c.forms}: ${nameOf(forms, id)}`)
    ];
    return names.length ? names.join(' · ') : c.scopeNowhere;
  };

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
              <fieldset className="form">
                <legend>{c.scope}</legend>
                <label className="checkbox-row">
                  <input type="radio" name="reply-scope" checked={allTickets} onChange={() => setAllTickets(true)} />
                  {c.scopeAll}
                </label>
                <label className="checkbox-row">
                  <input type="radio" name="reply-scope" checked={!allTickets} onChange={() => setAllTickets(false)} />
                  {c.scopeSelected}
                </label>
                {!allTickets && (
                  <>
                    <small className="muted">{c.scopeHint}</small>
                    <strong>{c.categories}</strong>
                    {categories.map((category) => (
                      <label className="checkbox-row" key={category.id}>
                        <input
                          type="checkbox"
                          checked={categoryIds.includes(category.id)}
                          onChange={(event) => setCategoryIds(toggle(categoryIds, category.id, event.target.checked))}
                        />
                        {category.name}
                      </label>
                    ))}
                    {categories.length === 0 && <small className="muted">{c.noCategories}</small>}
                    <strong>{c.forms}</strong>
                    {forms.map((form) => (
                      <label className="checkbox-row" key={form.id}>
                        <input
                          type="checkbox"
                          checked={formIds.includes(form.id)}
                          onChange={(event) => setFormIds(toggle(formIds, form.id, event.target.checked))}
                        />
                        {form.name}
                      </label>
                    ))}
                    {forms.length === 0 && <small className="muted">{c.noForms}</small>}
                  </>
                )}
              </fieldset>
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
                  <span className={`tag ${reply.allTickets ? '' : 'tag-accent'}`}>{scopeText(reply)}</span>
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
