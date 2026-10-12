'use client';

import { type CSSProperties, FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ResourcePicker, { CHANNEL_TYPES } from '../../../_components/ResourcePicker';
import { useCopy } from '../../../_components/locale-context';
import { format, type Locale } from '../../../i18n';

type AccessLevel = 'VIEWER' | 'MODERATOR' | 'ADMIN' | 'OWNER';
type Channel = { id: string; name: string; type: number; parentId: string | null; position: number };
type Role = { id: string; name: string; position: number; color?: number; managed?: boolean };
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
  ticketClosedParentCategoryId: string | null; ticketStaffRoleIds: string[]; ticketPrefix: string;
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
  createTicketOnSubmit: false, ticketCategoryId: '', ticketParentCategoryId: '', ticketClosedParentCategoryId: '',
  ticketStaffRoleIds: [] as string[], ticketPrefix: 'form'
});

const nullableNumber = (value: string) => value === '' ? null : Number(value);

const it = {
  errors: {
    FORM_FIELD_ADMIN_ONLY: 'Canale risultati, ruoli notificati e impostazioni ticket possono essere modificati solo da Admin/Owner.',
    FORBIDDEN: 'Permessi insufficienti per questa operazione.',
    QUOTA_EXCEEDED: 'Limite raggiunto per questo server: elimina un elemento esistente prima di crearne uno nuovo.',
    FORM_IN_USE: 'Il form ha già invii e non può essere eliminato.',
    TICKET_PARENT_NOT_FOUND: 'La categoria Discord override non è una categoria del server.',
    TICKET_CLOSED_PARENT_NOT_FOUND: 'La categoria Discord per i ticket chiusi non è una categoria del server.'
  } as Record<string, string>,
  loadError: 'Impossibile caricare la configurazione dei form.',
  saveFailed: 'Salvataggio fallito: {code}',
  updated: 'Form aggiornato.',
  created: 'Form creato.',
  deleteFailed: 'Eliminazione fallita.',
  deleted: 'Form eliminato.',
  permissionFailed: 'Aggiornamento permessi fallito.',
  title: 'Form',
  intro: 'Candidature, questionari e workflow con validazione e permessi granulari.',
  panels: 'Pannelli',
  tickets: 'Ticket',
  dashboardPermissions: 'Permessi dashboard',
  editForm: 'Modifica form',
  newForm: 'Nuovo form',
  cancel: 'Annulla',
  name: 'Nome',
  description: 'Descrizione',
  mode: 'Modalità',
  modeEphemeral: 'In chat - solo utente',
  modeDm: 'Messaggi privati',
  openAt: 'Apertura (ora locale)',
  closeAt: 'Chiusura (ora locale)',
  adminOnlyFields: 'Canale risultati, ruoli notificati e ticket automatico sono modificabili solo da Admin/Owner.',
  resultChannel: 'Canale risultati',
  none: 'Nessuno',
  resultRoles: 'Ruoli da notificare',
  accessLegend: 'Accesso e anti-spam',
  allowedRoles: 'Ruoli autorizzati',
  deniedRoles: 'Ruoli esclusi',
  maxSubmissions: 'Invii massimi per utente',
  cooldown: 'Cooldown secondi',
  window: 'Finestra tentativi minuti',
  maxAttempts: 'Tentativi massimi',
  autoTicketLegend: 'Ticket automatico dopo invio',
  createTicket: 'Crea canale privato con report, compilatore e staff',
  ticketCategory: 'Categoria ticket Dispatch',
  select: 'Seleziona...',
  parentOverride: 'Categoria Discord override',
  useCategoryDefault: 'Usa quella della categoria ticket',
  closedParentOverride: 'Categoria Discord per i ticket chiusi (override)',
  closedParentHint: 'Alla chiusura i ticket creati da questo form vengono spostati qui invece che nella categoria dei ticket chiusi della categoria ticket.',
  staffRoles: 'Ruoli staff',
  channelPrefix: 'Prefisso canale',
  questionsLegend: 'Domande ({count}/25)',
  questionN: 'Domanda {n}',
  remove: 'Rimuovi',
  id: 'ID',
  question: 'Domanda',
  type: 'Tipo',
  types: {
    SHORT_TEXT: 'Testo breve',
    LONG_TEXT: 'Testo lungo',
    INTEGER: 'Intero',
    NUMBER: 'Numero',
    EMAIL: 'Email',
    URL: 'URL',
    DATE: 'Data',
    BOOLEAN: 'Sì/No',
    SINGLE_SELECT: 'Scelta singola',
    MULTI_SELECT: 'Scelta multipla',
    DISCORD_ID: 'ID Discord'
  } as Record<QuestionType, string>,
  optionsLabel: 'Opzioni, una per riga: Etichetta|valore',
  minSelections: 'Selezioni minime',
  maxSelections: 'Selezioni massime',
  required: 'Obbligatoria',
  addQuestion: 'Aggiungi domanda',
  formEnabled: 'Form abilitato',
  saveChanges: 'Salva modifiche',
  createForm: 'Crea form',
  adminOnlyCreate: 'Solo Admin/Owner può creare nuovi form',
  configured: 'Form configurati',
  noDescription: 'Nessuna descrizione.',
  questionCount: (count: number) => count === 1 ? '1 domanda' : `${count} domande`,
  dm: 'DM',
  ephemeral: 'ephemeral',
  scheduled: 'aperto secondo pianificazione',
  disabled: 'disabilitato',
  edit: 'Modifica',
  permissions: 'Permessi',
  submissions: 'Invii',
  delete: 'Elimina',
  empty: 'Nessun form visibile.',
  permissionsTitle: 'Permessi del form',
  close: 'Chiudi',
  permissionsHelp: 'Owner/Admin hanno sempre accesso e sono gli unici a modificare queste regole. Manage: domande, testi, pianificazione e limiti. View: vede il form. Review: vede gli invii. Submit: può compilare.'
};

const en: typeof it = {
  errors: {
    FORM_FIELD_ADMIN_ONLY: 'Results channel, notified roles and ticket settings can only be changed by Admin/Owner.',
    FORBIDDEN: 'Insufficient permissions for this operation.',
    QUOTA_EXCEEDED: 'Limit reached for this server: delete an existing item before creating a new one.',
    FORM_IN_USE: 'The form already has submissions and cannot be deleted.',
    TICKET_PARENT_NOT_FOUND: 'The Discord category override is not a category of this server.',
    TICKET_CLOSED_PARENT_NOT_FOUND: 'The Discord category for closed tickets is not a category of this server.'
  } as Record<string, string>,
  loadError: 'Could not load the form configuration.',
  saveFailed: 'Save failed: {code}',
  updated: 'Form updated.',
  created: 'Form created.',
  deleteFailed: 'Delete failed.',
  deleted: 'Form deleted.',
  permissionFailed: 'Permission update failed.',
  title: 'Forms',
  intro: 'Applications, questionnaires and workflows with validation and granular permissions.',
  panels: 'Panels',
  tickets: 'Tickets',
  dashboardPermissions: 'Dashboard permissions',
  editForm: 'Edit form',
  newForm: 'New form',
  cancel: 'Cancel',
  name: 'Name',
  description: 'Description',
  mode: 'Delivery',
  modeEphemeral: 'In chat - user only',
  modeDm: 'Direct messages',
  openAt: 'Opens (local time)',
  closeAt: 'Closes (local time)',
  adminOnlyFields: 'Results channel, notified roles and automatic ticket can only be changed by Admin/Owner.',
  resultChannel: 'Results channel',
  none: 'None',
  resultRoles: 'Roles to notify',
  accessLegend: 'Access and anti-spam',
  allowedRoles: 'Allowed roles',
  deniedRoles: 'Excluded roles',
  maxSubmissions: 'Max submissions per user',
  cooldown: 'Cooldown seconds',
  window: 'Attempt window minutes',
  maxAttempts: 'Max attempts',
  autoTicketLegend: 'Automatic ticket after submission',
  createTicket: 'Create a private channel with the report, the submitter and staff',
  ticketCategory: 'Dispatch ticket category',
  select: 'Select...',
  parentOverride: 'Discord category override',
  useCategoryDefault: 'Use the ticket category one',
  closedParentOverride: 'Discord category for closed tickets (override)',
  closedParentHint: 'On close, tickets created by this form are moved here instead of the closed-tickets category of the ticket category.',
  staffRoles: 'Staff roles',
  channelPrefix: 'Channel prefix',
  questionsLegend: 'Questions ({count}/25)',
  questionN: 'Question {n}',
  remove: 'Remove',
  id: 'ID',
  question: 'Question',
  type: 'Type',
  types: {
    SHORT_TEXT: 'Short text',
    LONG_TEXT: 'Long text',
    INTEGER: 'Integer',
    NUMBER: 'Number',
    EMAIL: 'Email',
    URL: 'URL',
    DATE: 'Date',
    BOOLEAN: 'Yes/No',
    SINGLE_SELECT: 'Single choice',
    MULTI_SELECT: 'Multiple choice',
    DISCORD_ID: 'Discord ID'
  },
  optionsLabel: 'Options, one per line: Label|value',
  minSelections: 'Min selections',
  maxSelections: 'Max selections',
  required: 'Required',
  addQuestion: 'Add question',
  formEnabled: 'Form enabled',
  saveChanges: 'Save changes',
  createForm: 'Create form',
  adminOnlyCreate: 'Only Admin/Owner can create new forms',
  configured: 'Configured forms',
  noDescription: 'No description.',
  questionCount: (count: number) => count === 1 ? '1 question' : `${count} questions`,
  dm: 'DM',
  ephemeral: 'ephemeral',
  scheduled: 'open per schedule',
  disabled: 'disabled',
  edit: 'Edit',
  permissions: 'Permissions',
  submissions: 'Submissions',
  delete: 'Delete',
  empty: 'No visible forms.',
  permissionsTitle: 'Form permissions',
  close: 'Close',
  permissionsHelp: 'Owner/Admin always have access and are the only ones who can change these rules. Manage: questions, texts, schedule and limits. View: sees the form. Review: sees the submissions. Submit: can fill it in.'
};

const copy: Record<Locale, typeof it> = { it, en };

const QUESTION_TYPES: QuestionType[] = ['SHORT_TEXT', 'LONG_TEXT', 'INTEGER', 'NUMBER', 'EMAIL', 'URL', 'DATE', 'BOOLEAN', 'SINGLE_SELECT', 'MULTI_SELECT', 'DISCORD_ID'];

export default function FormsPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;
  const c = useCopy(copy);
  const [access, setAccess] = useState<AccessLevel | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [forms, setForms] = useState<FormDef[]>([]);
  const [ticketCategories, setTicketCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedPermissionForm, setSelectedPermissionForm] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isAdmin = access === 'ADMIN' || access === 'OWNER';

  const load = async () => {
    setError('');
    const [a, r, f, tc] = await Promise.all([
      fetch(`/backend/api/guilds/${guildId}/access`),
      fetch(`/backend/api/guilds/${guildId}/resources`),
      fetch(`/backend/api/guilds/${guildId}/forms`),
      fetch(`/backend/api/guilds/${guildId}/categories`)
    ]);
    if (a.status === 401) {
      window.location.href = '/backend/auth/discord';
      return;
    }
    if (![a, r, f, tc].every((response) => response.ok)) {
      setError(c.loadError);
      return;
    }
    const accessData = await a.json();
    const resources = await r.json();
    setAccess(accessData.access);
    setChannels(resources.channels);
    setRoles(resources.roles);
    setForms(await f.json());
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
      ticketClosedParentCategoryId: row.ticketClosedParentCategoryId ?? '',
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
            ticketParentCategoryId: form.ticketParentCategoryId || null,
            ticketClosedParentCategoryId: form.ticketClosedParentCategoryId || null
          })
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(c.errors[body.error] ?? format(c.saveFailed, { code: body.error ?? response.status }));
        return;
      }
      setNotice(editingId ? c.updated : c.created);
      setEditingId(null); setForm(emptyForm());
      await load();
    } finally { setBusy(''); }
  };

  const removeForm = async (id: string) => {
    setBusy(`form:${id}`);
    const response = await fetch(`/backend/api/guilds/${guildId}/forms/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(c.errors[body.error] ?? c.deleteFailed);
    } else {
      setNotice(c.deleted);
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
    else {
      const body = await response.json().catch(() => ({}));
      setError(c.errors[body.error] ?? c.permissionFailed);
    }
  };

  return (
    <main className="shell">
      <div className="row">
        <div><p className="eyebrow">Dispatch</p><h1>{c.title}</h1><p className="muted">{c.intro}</p></div>
        <div className="actions">
          {isAdmin && <a className="button secondary" href={`/dashboard/${guildId}/panels`}>{c.panels}</a>}
          <a className="button secondary" href={`/dashboard/${guildId}/tickets`}>{c.tickets}</a>
          <a className="button secondary" href={`/dashboard/${guildId}`}>{c.dashboardPermissions}</a>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <form className="card form" onSubmit={save}>
        <div className="row"><h2>{editingId ? c.editForm : c.newForm}</h2>{editingId && <button type="button" className="secondary" onClick={() => { setEditingId(null); setForm(emptyForm()); }}>{c.cancel}</button>}</div>
        <div className="editor-split">
          <div className="form">
            <label>{c.name}<input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label>
            <label>{c.description}<textarea maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label>
            <div className="field-row" style={{ '--cols': 3 } as CSSProperties}>
              <label>{c.mode}<select value={form.deliveryMode} onChange={(e) => setForm({ ...form, deliveryMode: e.target.value as 'EPHEMERAL' | 'DM' })}><option value="EPHEMERAL">{c.modeEphemeral}</option><option value="DM">{c.modeDm}</option></select></label>
              <label>{c.openAt}<input type="datetime-local" value={form.openAt} onChange={(e) => setForm({ ...form, openAt: e.target.value })}/></label>
              <label>{c.closeAt}<input type="datetime-local" value={form.closeAt} onChange={(e) => setForm({ ...form, closeAt: e.target.value })}/></label>
            </div>
            {!isAdmin && <p className="muted">{c.adminOnlyFields}</p>}
            <div className="field-row">
              <ResourcePicker label={c.resultChannel} kind="channel" channels={channels}
                channelTypes={[CHANNEL_TYPES.text, CHANNEL_TYPES.announcement]} placeholder={c.none} disabled={!isAdmin}
                value={form.resultChannelId} onChange={(resultChannelId) => setForm({ ...form, resultChannelId })}/>
              <ResourcePicker label={c.resultRoles} kind="role" roles={roles} guildId={guildId} multiple disabled={!isAdmin}
                value={form.resultRoleIds} onChange={(resultRoleIds) => setForm({ ...form, resultRoleIds })}/>
            </div>
            <fieldset><legend>{c.accessLegend}</legend>
              <div className="field-row">
                <ResourcePicker label={c.allowedRoles} kind="role" roles={roles} guildId={guildId} multiple max={20}
                  value={form.allowedRoleIds} onChange={(allowedRoleIds) => setForm({ ...form, allowedRoleIds })}/>
                <ResourcePicker label={c.deniedRoles} kind="role" roles={roles} guildId={guildId} multiple max={20}
                  value={form.deniedRoleIds} onChange={(deniedRoleIds) => setForm({ ...form, deniedRoleIds })}/>
              </div>
              <div className="field-row" style={{ '--cols': 4 } as CSSProperties}>
                <label>{c.maxSubmissions}<input type="number" min={0} max={1000} value={form.maxSubmissionsPerUser} onChange={(e) => setForm({ ...form, maxSubmissionsPerUser: Number(e.target.value) })}/></label>
                <label>{c.cooldown}<input type="number" min={0} max={2592000} value={form.cooldownSeconds} onChange={(e) => setForm({ ...form, cooldownSeconds: Number(e.target.value) })}/></label>
                <label>{c.window}<input type="number" min={1} max={10080} value={form.submissionWindowMinutes} onChange={(e) => setForm({ ...form, submissionWindowMinutes: Number(e.target.value) })}/></label>
                <label>{c.maxAttempts}<input type="number" min={1} max={100} value={form.maxAttemptsPerWindow} onChange={(e) => setForm({ ...form, maxAttemptsPerWindow: Number(e.target.value) })}/></label>
              </div>
            </fieldset>

            <fieldset disabled={!isAdmin}><legend>{c.autoTicketLegend}</legend>
              <label className="checkbox-row"><input type="checkbox" checked={form.createTicketOnSubmit} onChange={(e) => setForm({ ...form, createTicketOnSubmit: e.target.checked })}/>{c.createTicket}</label>
              {form.createTicketOnSubmit && <>
                <div className="form">
                  <ResourcePicker label={c.ticketCategory} kind="item" items={ticketCategories} required
                    placeholder={c.select} disabled={!isAdmin}
                    value={form.ticketCategoryId} onChange={(ticketCategoryId) => setForm({ ...form, ticketCategoryId })}/>
                  <ResourcePicker label={c.parentOverride} kind="channel" channels={channels}
                    channelTypes={[CHANNEL_TYPES.category]} placeholder={c.useCategoryDefault} disabled={!isAdmin}
                    value={form.ticketParentCategoryId} onChange={(ticketParentCategoryId) => setForm({ ...form, ticketParentCategoryId })}/>
                  <ResourcePicker label={c.closedParentOverride} kind="channel" channels={channels}
                    channelTypes={[CHANNEL_TYPES.category]} placeholder={c.useCategoryDefault} disabled={!isAdmin}
                    hint={c.closedParentHint}
                    value={form.ticketClosedParentCategoryId} onChange={(ticketClosedParentCategoryId) => setForm({ ...form, ticketClosedParentCategoryId })}/>
                  <ResourcePicker label={c.staffRoles} kind="role" roles={roles} guildId={guildId} multiple max={20} disabled={!isAdmin}
                    value={form.ticketStaffRoleIds} onChange={(ticketStaffRoleIds) => setForm({ ...form, ticketStaffRoleIds })}/>
                </div>
                <label>{c.channelPrefix}<input value={form.ticketPrefix} onChange={(e) => setForm({ ...form, ticketPrefix: e.target.value })}/></label>
              </>}
            </fieldset>
          </div>
          <div className="form">
            <fieldset><legend>{format(c.questionsLegend, { count: form.questions.length })}</legend>
              {form.questions.map((q, index) => <div className="subcard form" key={q.clientKey}>
                <div className="row"><strong>{format(c.questionN, { n: index + 1 })}</strong><button type="button" className="danger" onClick={() => removeQuestion(index)}>{c.remove}</button></div>
                <div className="field-row" style={{ '--cols': 2 } as CSSProperties}>
                  <label>{c.id}<input required maxLength={40} value={q.id} onChange={(e) => updateQuestion(index, { id: e.target.value })}/></label>
                  <label>{c.question}<input required maxLength={100} value={q.label} onChange={(e) => updateQuestion(index, { label: e.target.value })}/></label>
                </div>
                <label>{c.description}<textarea maxLength={500} value={q.description ?? ''} onChange={(e) => updateQuestion(index, { description: e.target.value || null })}/></label>
                <label>{c.type}<select value={q.type} onChange={(e) => {
                  const type = e.target.value as QuestionType;
                  updateQuestion(index, {
                    type,
                    optionsText: isSelectType(type) ? q.optionsText : '',
                    options: isSelectType(type) ? q.options : [],
                    maxLength: TEXT_TYPES.includes(type) ? (q.maxLength ?? 1000) : null,
                    minLength: TEXT_TYPES.includes(type) ? q.minLength : null
                  });
                }}>
                  {QUESTION_TYPES.map((type) => <option key={type} value={type}>{c.types[type]}</option>)}
                </select></label>
                {isSelectType(q.type) && <label>{c.optionsLabel}<textarea value={q.optionsText} onChange={(e) => updateQuestion(index, { optionsText: e.target.value })} onBlur={() => commitOptions(index)}/></label>}
                {q.type === 'MULTI_SELECT' && <div className="grid compact-grid">
                  <label>{c.minSelections}<input type="number" min={0} max={25} value={q.minSelections ?? ''} onChange={(e) => updateQuestion(index, { minSelections: nullableNumber(e.target.value) })}/></label>
                  <label>{c.maxSelections}<input type="number" min={1} max={25} value={q.maxSelections ?? ''} onChange={(e) => updateQuestion(index, { maxSelections: nullableNumber(e.target.value) })}/></label>
                </div>}
                <label className="checkbox-row"><input type="checkbox" checked={q.required} onChange={(e) => updateQuestion(index, { required: e.target.checked })}/>{c.required}</label>
              </div>)}
              <button type="button" className="secondary" disabled={form.questions.length >= 25} onClick={addQuestion}>{c.addQuestion}</button>
            </fieldset>

          </div>
        </div>
        <label className="checkbox-row"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })}/>{c.formEnabled}</label>
        <button disabled={busy === 'form' || (!editingId && !isAdmin)} type="submit">
            {editingId ? c.saveChanges : isAdmin ? c.createForm : c.adminOnlyCreate}
        </button>
      </form>

      <section><h2>{c.configured}</h2><div className="grid">{forms.map((row) => <article className="card" key={row.id}>
        <h3>{row.name}</h3><p>{row.description || c.noDescription}</p>
        <p className="muted">{c.questionCount(row.questions.length)} · {row.deliveryMode === 'DM' ? c.dm : c.ephemeral} · {row.enabled ? c.scheduled : c.disabled}</p>
        <div className="actions"><button className="secondary" onClick={() => editForm(row)}>{c.edit}</button>
          {isAdmin && <button className="secondary" onClick={() => void loadPermissions(row.id)}>{c.permissions}</button>}
          <a className="button secondary" href={`/dashboard/${guildId}/forms/${row.id}`}>{c.submissions}</a>
          {isAdmin && <button className="danger" disabled={busy === `form:${row.id}`} onClick={() => void removeForm(row.id)}>{c.delete}</button>}</div>
      </article>)}
      {!forms.length && <div className="card muted">{c.empty}</div>}</div></section>

      {isAdmin && selectedPermissionForm && <section className="card">
        <div className="row"><h2>{c.permissionsTitle}</h2><button className="secondary" onClick={() => { setSelectedPermissionForm(''); setPermissions([]); }}>{c.close}</button></div>
        <p className="muted">{c.permissionsHelp}</p>
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
