'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

type AccessLevel = 'VIEWER' | 'MODERATOR' | 'ADMIN' | 'OWNER';
type Channel = { id: string; name: string; type: number };
type Role = { id: string; name: string; position: number };
type QuestionType = 'SHORT_TEXT' | 'LONG_TEXT' | 'INTEGER' | 'NUMBER' | 'EMAIL' | 'URL' | 'DATE' | 'BOOLEAN' | 'SINGLE_SELECT' | 'MULTI_SELECT' | 'DISCORD_ID';
type Option = { label: string; value: string; description: string | null };
type Question = {
  id: string; label: string; description: string | null; type: QuestionType; required: boolean;
  placeholder: string | null; minLength: number | null; maxLength: number | null;
  minValue: number | null; maxValue: number | null; minSelections: number | null; maxSelections: number | null;
  options: Option[];
};
// clientKey: stable React key (the question ID is editable).
// optionsText: raw option editor text, parsed on blur and before save.
type DraftQuestion = Question & { clientKey: string; optionsText: string };
type FormDef = {
  id: string; name: string; description: string | null; questions: Question[]; enabled: boolean;
  openAt: string | null; closeAt: string | null; deliveryMode: 'EPHEMERAL' | 'DM';
  resultChannelId: string | null; resultRoleIds: string[]; allowedRoleIds: string[]; deniedRoleIds: string[];
  maxSubmissionsPerUser: number; cooldownSeconds: number; submissionWindowMinutes: number; maxAttemptsPerWindow: number;
  createTicketOnSubmit: boolean; ticketCategoryId: string | null; ticketParentCategoryId: string | null;
  ticketStaffRoleIds: string[]; ticketPrefix: string;
};
type Panel = {
  id: string; formId: string; channelId: string; messageId: string | null; title: string;
  description: string | null; buttonLabel: string; enabled: boolean; form?: { name: string };
};
type Permission = {
  id: string; discordRoleId: string; canManage: boolean; canView: boolean; canReview: boolean; canSubmit: boolean;
};

const TEXT_TYPES: QuestionType[] = ['SHORT_TEXT', 'LONG_TEXT', 'EMAIL', 'URL'];
const NUMERIC_TYPES: QuestionType[] = ['INTEGER', 'NUMBER'];
const isSelectType = (type: QuestionType) => type === 'SINGLE_SELECT' || type === 'MULTI_SELECT';

let clientKeySeq = 0;
const nextClientKey = () => `q-${++clientKeySeq}`;

function formatOptions(options: Option[]) {
  return options.map((option) => `${option.label}|${option.value}`).join('\n');
}

function parseOptions(text: string): Option[] {
  return text.split('\n').map((line) => {
    const separator = line.indexOf('|');
    const label = (separator >= 0 ? line.slice(0, separator) : line).trim();
    const value = (separator >= 0 ? line.slice(separator + 1) : line).trim() || label;
    return { label, value, description: null };
  }).filter((option) => option.label && option.value).slice(0, 25);
}

// datetime-local works in the browser's local time; the API stores UTC.
function isoToLocalInput(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localInputToIso(value: string) {
  if (!value) return null;
  // "YYYY-MM-DDTHH:mm" without offset is parsed as local time.
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDraft(question: Question): DraftQuestion {
  const options = question.options ?? [];
  return { ...question, options, clientKey: nextClientKey(), optionsText: formatOptions(options) };
}

// Drop limits that do not apply to the type, so the API validation passes.
function toQuestionPayload(draft: DraftQuestion): Question {
  const type = draft.type;
  const options = isSelectType(type) ? parseOptions(draft.optionsText) : [];
  const textual = TEXT_TYPES.includes(type);
  const numeric = NUMERIC_TYPES.includes(type);
  let minSelections: number | null = null;
  let maxSelections: number | null = null;
  if (type === 'MULTI_SELECT') {
    maxSelections = draft.maxSelections === null ? null : Math.min(draft.maxSelections, options.length);
    const upper = maxSelections ?? options.length;
    minSelections = draft.minSelections === null ? null : Math.min(draft.minSelections, upper);
    if (draft.required && minSelections === 0) minSelections = null;
    if (maxSelections !== null && maxSelections < 1) maxSelections = null;
  }
  return {
    id: draft.id,
    label: draft.label,
    description: draft.description,
    type,
    required: draft.required,
    placeholder: draft.placeholder,
    minLength: textual ? draft.minLength : null,
    maxLength: textual ? draft.maxLength : null,
    minValue: numeric ? draft.minValue : null,
    maxValue: numeric ? draft.maxValue : null,
    minSelections,
    maxSelections,
    options
  };
}

const emptyQuestion = (index: number): DraftQuestion => ({
  id: `q${index}`, label: '', description: null, type: 'SHORT_TEXT', required: true,
  placeholder: null, minLength: null, maxLength: 1000, minValue: null, maxValue: null,
  minSelections: null, maxSelections: null, options: [],
  clientKey: nextClientKey(), optionsText: ''
});

const emptyForm = () => ({
  name: '', description: '', questions: [emptyQuestion(1)], enabled: true,
  openAt: '', closeAt: '', deliveryMode: 'EPHEMERAL' as 'EPHEMERAL' | 'DM', resultChannelId: '',
  resultRoleIds: [] as string[], allowedRoleIds: [] as string[], deniedRoleIds: [] as string[],
  maxSubmissionsPerUser: 1, cooldownSeconds: 300, submissionWindowMinutes: 60, maxAttemptsPerWindow: 5,
  createTicketOnSubmit: false, ticketCategoryId: '', ticketParentCategoryId: '',
  ticketStaffRoleIds: [] as string[], ticketPrefix: 'form'
});

const emptyPanel = { formId: '', channelId: '', title: 'Compila il form', description: '', buttonLabel: 'Compila', enabled: true };

const nullableNumber = (value: string) => value === '' ? null : Number(value);

const errorMessages: Record<string, string> = {
  FORM_FIELD_ADMIN_ONLY: 'Canale risultati, ruoli notificati e impostazioni ticket possono essere modificati solo da Admin/Owner.',
  FORBIDDEN: 'Permessi insufficienti per questa operazione.',
  FORM_IN_USE: 'Il form ha già invii e non può essere eliminato.'
};

export default function FormsPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;
  const [access, setAccess] = useState<AccessLevel | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [forms, setForms] = useState<FormDef[]>([]);
  const [ticketCategories, setTicketCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [panel, setPanel] = useState(emptyPanel);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedPermissionForm, setSelectedPermissionForm] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isAdmin = access === 'ADMIN' || access === 'OWNER';
  const textChannels = useMemo(() => channels.filter((channel) => channel.type === 0 || channel.type === 5), [channels]);
  const categories = useMemo(() => channels.filter((channel) => channel.type === 4), [channels]);

  const load = async () => {
    setError('');
    const [a, r, f, p, tc] = await Promise.all([
      fetch(`/backend/api/guilds/${guildId}/access`),
      fetch(`/backend/api/guilds/${guildId}/resources`),
      fetch(`/backend/api/guilds/${guildId}/forms`),
      fetch(`/backend/api/guilds/${guildId}/form-panels`),
      fetch(`/backend/api/guilds/${guildId}/categories`)
    ]);
    if (a.status === 401) {
      window.location.href = '/backend/auth/discord';
      return;
    }
    if (![a, r, f, p, tc].every((response) => response.ok)) {
      setError('Impossibile caricare la configurazione dei form.');
      return;
    }
    const accessData = await a.json();
    const resources = await r.json();
    setAccess(accessData.access);
    setChannels(resources.channels);
    setRoles(resources.roles);
    setForms(await f.json());
    setPanels(await p.json());
    setTicketCategories(await tc.json());
  };

  useEffect(() => { void load(); }, [guildId]);

  const loadPermissions = async (formId: string) => {
    setSelectedPermissionForm(formId);
    if (!formId) { setPermissions([]); return; }
    const response = await fetch(`/backend/api/guilds/${guildId}/forms/${formId}/permissions`);
    if (response.ok) setPermissions(await response.json());
    else setPermissions([]);
  };

  const editForm = (row: FormDef) => {
    setEditingId(row.id);
    setForm({
      name: row.name,
      description: row.description ?? '',
      questions: (row.questions ?? []).map(toDraft),
      enabled: row.enabled,
      openAt: isoToLocalInput(row.openAt),
      closeAt: isoToLocalInput(row.closeAt),
      deliveryMode: row.deliveryMode,
      resultChannelId: row.resultChannelId ?? '',
      resultRoleIds: row.resultRoleIds ?? [],
      allowedRoleIds: row.allowedRoleIds ?? [],
      deniedRoleIds: row.deniedRoleIds ?? [],
      maxSubmissionsPerUser: row.maxSubmissionsPerUser,
      cooldownSeconds: row.cooldownSeconds,
      submissionWindowMinutes: row.submissionWindowMinutes,
      maxAttemptsPerWindow: row.maxAttemptsPerWindow,
      createTicketOnSubmit: row.createTicketOnSubmit,
      ticketCategoryId: row.ticketCategoryId ?? '',
      ticketParentCategoryId: row.ticketParentCategoryId ?? '',
      ticketStaffRoleIds: row.ticketStaffRoleIds ?? [],
      ticketPrefix: row.ticketPrefix
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('form'); setError(''); setNotice('');
    try {
      const response = await fetch(
        editingId ? `/backend/api/guilds/${guildId}/forms/${editingId}` : `/backend/api/guilds/${guildId}/forms`,
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            questions: form.questions.map(toQuestionPayload),
            description: form.description || null,
            openAt: localInputToIso(form.openAt),
            closeAt: localInputToIso(form.closeAt),
            resultChannelId: form.resultChannelId || null,
            ticketCategoryId: form.ticketCategoryId || null,
            ticketParentCategoryId: form.ticketParentCategoryId || null
          })
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(errorMessages[body.error] ?? `Salvataggio fallito: ${body.error ?? response.status}`);
        return;
      }
      setNotice(editingId ? 'Form aggiornato.' : 'Form creato.');
      setEditingId(null); setForm(emptyForm());
      await load();
    } finally { setBusy(''); }
  };

  const removeForm = async (id: string) => {
    setBusy(`form:${id}`);
    const response = await fetch(`/backend/api/guilds/${guildId}/forms/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(errorMessages[body.error] ?? 'Eliminazione fallita.');
    } else {
      setNotice('Form eliminato.');
      await load();
    }
    setBusy('');
  };

  const addQuestion = () => {
    if (form.questions.length >= 25) return;
    let n = form.questions.length + 1;
    const used = new Set(form.questions.map((q) => q.id));
    while (used.has(`q${n}`)) n++;
    setForm({ ...form, questions: [...form.questions, emptyQuestion(n)] });
  };
  const updateQuestion = (index: number, patch: Partial<DraftQuestion>) =>
    setForm((current) => ({
      ...current,
      questions: current.questions.map((q, i) => i === index ? { ...q, ...patch } : q)
    }));
  const removeQuestion = (index: number) =>
    setForm({ ...form, questions: form.questions.filter((_, i) => i !== index) });
  const commitOptions = (index: number) => {
    const question = form.questions[index];
    if (!question) return;
    const options = parseOptions(question.optionsText);
    updateQuestion(index, { options, optionsText: formatOptions(options) });
  };

  const createPanel = async (event: FormEvent) => {
    event.preventDefault(); setBusy('panel'); setError(''); setNotice('');
    const response = await fetch(`/backend/api/guilds/${guildId}/form-panels`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...panel, description: panel.description || null })
    });
    if (!response.ok) setError('Creazione pannello fallita.');
    else { setPanel(emptyPanel); setNotice('Pannello creato.'); await load(); }
    setBusy('');
  };

  const publishPanel = async (id: string) => {
    setBusy(`publish:${id}`);
    const response = await fetch(`/backend/api/guilds/${guildId}/form-panels/${id}/publish`, { method: 'POST' });
    if (!response.ok) setError('Pubblicazione pannello fallita.');
    else { setNotice('Pannello pubblicato o aggiornato.'); await load(); }
    setBusy('');
  };

  const deletePanel = async (id: string) => {
    setBusy(`panel:${id}`);
    const response = await fetch(`/backend/api/guilds/${guildId}/form-panels/${id}`, { method: 'DELETE' });
    if (!response.ok) setError('Eliminazione pannello fallita.');
    else { setNotice('Pannello eliminato.'); await load(); }
    setBusy('');
  };

  const savePermission = async (roleId: string, patch: Partial<Permission>) => {
    if (!selectedPermissionForm) return;
    const current = permissions.find((item) => item.discordRoleId === roleId);
    const next = {
      canManage: patch.canManage ?? current?.canManage ?? false,
      canView: patch.canView ?? current?.canView ?? false,
      canReview: patch.canReview ?? current?.canReview ?? false,
      canSubmit: patch.canSubmit ?? current?.canSubmit ?? false
    };
    const response = await fetch(`/backend/api/guilds/${guildId}/forms/${selectedPermissionForm}/permissions/${roleId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next)
    });
    if (response.ok) await loadPermissions(selectedPermissionForm);
    else setError('Aggiornamento permessi fallito.');
  };

  return (
    <main className="shell">
      <div className="row">
        <div><p className="eyebrow">Dispatch</p><h1>Form</h1><p className="muted">Candidature, questionari e workflow con validazione e permessi granulari.</p></div>
        <div className="actions">
          <a className="button secondary" href={`/dashboard/${guildId}/tickets`}>Ticket</a>
          <a className="button secondary" href={`/dashboard/${guildId}`}>Permessi dashboard</a>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <section className="grid settings-grid">
        <form className="card form" onSubmit={save}>
          <div className="row"><h2>{editingId ? 'Modifica form' : 'Nuovo form'}</h2>{editingId && <button type="button" className="secondary" onClick={() => { setEditingId(null); setForm(emptyForm()); }}>Annulla</button>}</div>
          <label>Nome<input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label>
          <label>Descrizione<textarea maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label>
          <div className="grid compact-grid">
            <label>Modalità<select value={form.deliveryMode} onChange={(e) => setForm({ ...form, deliveryMode: e.target.value as 'EPHEMERAL' | 'DM' })}><option value="EPHEMERAL">In chat - solo utente</option><option value="DM">Messaggi privati</option></select></label>
            <label>Apertura (ora locale)<input type="datetime-local" value={form.openAt} onChange={(e) => setForm({ ...form, openAt: e.target.value })}/></label>
            <label>Chiusura (ora locale)<input type="datetime-local" value={form.closeAt} onChange={(e) => setForm({ ...form, closeAt: e.target.value })}/></label>
          </div>
          {!isAdmin && <p className="muted">Canale risultati, ruoli notificati e ticket automatico sono modificabili solo da Admin/Owner.</p>}
          <label>Canale risultati<select disabled={!isAdmin} value={form.resultChannelId} onChange={(e) => setForm({ ...form, resultChannelId: e.target.value })}><option value="">Nessuno</option>{textChannels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}</select></label>
          <label>Ruoli da notificare<select disabled={!isAdmin} multiple value={form.resultRoleIds} onChange={(e) => setForm({ ...form, resultRoleIds: [...e.target.selectedOptions].map((o) => o.value) })}>{roles.filter((r) => r.id !== guildId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <fieldset><legend>Accesso e anti-spam</legend>
            <label>Ruoli autorizzati<select multiple value={form.allowedRoleIds} onChange={(e) => setForm({ ...form, allowedRoleIds: [...e.target.selectedOptions].map((o) => o.value) })}>{roles.filter((r) => r.id !== guildId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <label>Ruoli esclusi<select multiple value={form.deniedRoleIds} onChange={(e) => setForm({ ...form, deniedRoleIds: [...e.target.selectedOptions].map((o) => o.value) })}>{roles.filter((r) => r.id !== guildId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <div className="grid compact-grid">
              <label>Invii massimi per utente<input type="number" min={0} max={1000} value={form.maxSubmissionsPerUser} onChange={(e) => setForm({ ...form, maxSubmissionsPerUser: Number(e.target.value) })}/></label>
              <label>Cooldown secondi<input type="number" min={0} max={2592000} value={form.cooldownSeconds} onChange={(e) => setForm({ ...form, cooldownSeconds: Number(e.target.value) })}/></label>
              <label>Finestra tentativi minuti<input type="number" min={1} max={10080} value={form.submissionWindowMinutes} onChange={(e) => setForm({ ...form, submissionWindowMinutes: Number(e.target.value) })}/></label>
              <label>Tentativi massimi<input type="number" min={1} max={100} value={form.maxAttemptsPerWindow} onChange={(e) => setForm({ ...form, maxAttemptsPerWindow: Number(e.target.value) })}/></label>
            </div>
          </fieldset>

          <fieldset><legend>Domande - massimo 25</legend>
            {form.questions.map((q, index) => <div className="subcard form" key={q.clientKey}>
              <div className="row"><strong>Domanda {index + 1}</strong><button type="button" className="danger" onClick={() => removeQuestion(index)}>Rimuovi</button></div>
              <label>ID<input required maxLength={40} value={q.id} onChange={(e) => updateQuestion(index, { id: e.target.value })}/></label>
              <label>Domanda<input required maxLength={100} value={q.label} onChange={(e) => updateQuestion(index, { label: e.target.value })}/></label>
              <label>Descrizione<textarea maxLength={500} value={q.description ?? ''} onChange={(e) => updateQuestion(index, { description: e.target.value || null })}/></label>
              <label>Tipo<select value={q.type} onChange={(e) => {
                const type = e.target.value as QuestionType;
                updateQuestion(index, {
                  type,
                  optionsText: isSelectType(type) ? q.optionsText : '',
                  options: isSelectType(type) ? q.options : [],
                  maxLength: TEXT_TYPES.includes(type) ? (q.maxLength ?? 1000) : null,
                  minLength: TEXT_TYPES.includes(type) ? q.minLength : null
                });
              }}>
                <option value="SHORT_TEXT">Testo breve</option><option value="LONG_TEXT">Testo lungo</option><option value="INTEGER">Intero</option><option value="NUMBER">Numero</option>
                <option value="EMAIL">Email</option><option value="URL">URL</option><option value="DATE">Data</option><option value="BOOLEAN">Sì/No</option>
                <option value="SINGLE_SELECT">Scelta singola</option><option value="MULTI_SELECT">Scelta multipla</option><option value="DISCORD_ID">ID Discord</option>
              </select></label>
              {isSelectType(q.type) && <label>Opzioni, una per riga: Etichetta|valore<textarea value={q.optionsText} onChange={(e) => updateQuestion(index, { optionsText: e.target.value })} onBlur={() => commitOptions(index)}/></label>}
              {q.type === 'MULTI_SELECT' && <div className="grid compact-grid">
                <label>Selezioni minime<input type="number" min={0} max={25} value={q.minSelections ?? ''} onChange={(e) => updateQuestion(index, { minSelections: nullableNumber(e.target.value) })}/></label>
                <label>Selezioni massime<input type="number" min={1} max={25} value={q.maxSelections ?? ''} onChange={(e) => updateQuestion(index, { maxSelections: nullableNumber(e.target.value) })}/></label>
              </div>}
              <label className="checkbox-row"><input type="checkbox" checked={q.required} onChange={(e) => updateQuestion(index, { required: e.target.checked })}/>Obbligatoria</label>
            </div>)}
            <button type="button" className="secondary" disabled={form.questions.length >= 25} onClick={addQuestion}>Aggiungi domanda</button>
          </fieldset>

          <fieldset disabled={!isAdmin}><legend>Ticket automatico dopo invio</legend>
            <label className="checkbox-row"><input type="checkbox" checked={form.createTicketOnSubmit} onChange={(e) => setForm({ ...form, createTicketOnSubmit: e.target.checked })}/>Crea canale privato con report, compilatore e staff</label>
            {form.createTicketOnSubmit && <>
              <label>Categoria ticket Dispatch<select required value={form.ticketCategoryId} onChange={(e) => setForm({ ...form, ticketCategoryId: e.target.value })}><option value="">Seleziona...</option>{ticketCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label>Categoria Discord override<select value={form.ticketParentCategoryId} onChange={(e) => setForm({ ...form, ticketParentCategoryId: e.target.value })}><option value="">Usa quella della categoria ticket</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label>Ruoli staff<select multiple value={form.ticketStaffRoleIds} onChange={(e) => setForm({ ...form, ticketStaffRoleIds: [...e.target.selectedOptions].map((o) => o.value) })}>{roles.filter((r) => r.id !== guildId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
              <label>Prefisso canale<input value={form.ticketPrefix} onChange={(e) => setForm({ ...form, ticketPrefix: e.target.value })}/></label>
            </>}
          </fieldset>
          <label className="checkbox-row"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })}/>Form abilitato</label>
          <button disabled={busy === 'form' || (!editingId && !isAdmin)} type="submit">
            {editingId ? 'Salva modifiche' : isAdmin ? 'Crea form' : 'Solo Admin/Owner può creare nuovi form'}
          </button>
        </form>

        {isAdmin && <form className="card form" onSubmit={createPanel}>
          <h2>Nuovo pannello form</h2>
          <label>Form<select required value={panel.formId} onChange={(e) => setPanel({ ...panel, formId: e.target.value })}><option value="">Seleziona...</option>{forms.filter((f) => f.enabled).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label>Canale<select required value={panel.channelId} onChange={(e) => setPanel({ ...panel, channelId: e.target.value })}><option value="">Seleziona...</option>{textChannels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}</select></label>
          <label>Titolo<input required maxLength={256} value={panel.title} onChange={(e) => setPanel({ ...panel, title: e.target.value })}/></label>
          <label>Descrizione<textarea maxLength={2000} value={panel.description} onChange={(e) => setPanel({ ...panel, description: e.target.value })}/></label>
          <label>Testo pulsante<input required maxLength={80} value={panel.buttonLabel} onChange={(e) => setPanel({ ...panel, buttonLabel: e.target.value })}/></label>
          <button disabled={busy === 'panel'} type="submit">Crea pannello</button>
        </form>}
      </section>

      <section><h2>Form configurati</h2><div className="grid">{forms.map((row) => <article className="card" key={row.id}>
        <h3>{row.name}</h3><p>{row.description || 'Nessuna descrizione.'}</p>
        <p className="muted">{row.questions.length} domande · {row.deliveryMode === 'DM' ? 'DM' : 'ephemeral'} · {row.enabled ? 'aperto secondo pianificazione' : 'disabilitato'}</p>
        <div className="actions"><button className="secondary" onClick={() => editForm(row)}>Modifica</button>
          {isAdmin && <button className="secondary" onClick={() => void loadPermissions(row.id)}>Permessi</button>}
          <a className="button secondary" href={`/dashboard/${guildId}/forms/${row.id}`}>Invii</a>
          {isAdmin && <button className="danger" disabled={busy === `form:${row.id}`} onClick={() => void removeForm(row.id)}>Elimina</button>}</div>
      </article>)}
      {!forms.length && <div className="card muted">Nessun form visibile.</div>}</div></section>

      <section><h2>Pannelli</h2><div className="grid">{panels.map((row) => <article className="card" key={row.id}>
        <h3>{row.form?.name ?? row.formId}</h3><p>{row.title}</p><p className="muted">{row.messageId ? 'Pubblicato' : 'Non pubblicato'}</p>
        {isAdmin && <div className="actions"><button onClick={() => void publishPanel(row.id)} disabled={busy === `publish:${row.id}`}>{row.messageId ? 'Aggiorna su Discord' : 'Pubblica'}</button>
          <button className="danger" onClick={() => void deletePanel(row.id)} disabled={busy === `panel:${row.id}`}>Elimina</button></div>}
      </article>)}</div></section>

      {isAdmin && selectedPermissionForm && <section className="card">
        <div className="row"><h2>Permessi del form</h2><button className="secondary" onClick={() => { setSelectedPermissionForm(''); setPermissions([]); }}>Chiudi</button></div>
        <p className="muted">
          Owner/Admin hanno sempre accesso e sono gli unici a modificare queste regole. Manage: domande, testi,
          pianificazione e limiti. View: vede il form. Review: vede gli invii. Submit: può compilare.
        </p>
        {roles.filter((r) => r.id !== guildId).map((role) => {
          const p = permissions.find((item) => item.discordRoleId === role.id);
          return <div className="role" key={role.id}><strong>{role.name}</strong>
            {(['canManage','canView','canReview','canSubmit'] as const).map((key) => <label className="checkbox-row" key={key}><input type="checkbox" checked={p?.[key] ?? false} onChange={(e) => void savePermission(role.id, { [key]: e.target.checked })}/>{key.replace('can','')}</label>)}
          </div>;
        })}
      </section>}
    </main>
  );
}
