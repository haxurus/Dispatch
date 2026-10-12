'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ResourcePicker, { CHANNEL_TYPES } from '../../../_components/ResourcePicker';
import { useCopy } from '../../../_components/locale-context';
import { format, type Locale } from '../../../i18n';

type AccessLevel = 'VIEWER' | 'MODERATOR' | 'ADMIN' | 'OWNER';

type DiscordChannel = {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
};

type DiscordRole = {
  id: string;
  name: string;
  position: number;
  color?: number;
  managed?: boolean;
};

type FormField = {
  id: string;
  label: string;
  style: 'SHORT' | 'PARAGRAPH';
  type: 'SHORT_TEXT' | 'LONG_TEXT' | 'SINGLE_SELECT';
  required: boolean;
  placeholder: string | null;
  minLength: number | null;
  maxLength: number | null;
  options: Array<{ label: string; value: string; description?: string | null }>;
};

type Category = {
  id: string;
  name: string;
  description: string | null;
  discordCategoryId: string | null;
  closedParentCategoryId: string | null;
  staffRoleIds: string[];
  maxOpenPerUser: number;
  openCooldownSeconds: number;
  antiSpamWindowMinutes: number;
  antiSpamMaxAttempts: number;
  formFields: FormField[];
  slaFirstResponseMinutes: number | null;
  slaResolutionMinutes: number | null;
  inactivityCloseHours: number | null;
  inactivityWarningMinutes: number | null;
  escalationMinutes: number | null;
  escalationRoleIds: string[];
  reopenWindowHours: number | null;
  feedbackEnabled: boolean;
  transcriptAutoGenerate: boolean;
  transcriptSendToOpener: boolean;
  transcriptChannelId: string | null;
  transcriptRetain: boolean;
  enabled: boolean;
};

type ResponseTemplate = {
  id: string;
  name: string;
  content: string;
};

const it = {
  loadError: 'Impossibile caricare la configurazione ticket.',
  escalationMissing: 'Indica dopo quanti minuti attivare l’escalation automatica, oppure disattivala.',
  categoryErrors: {
    QUOTA_EXCEEDED: 'Limite raggiunto per questo server: elimina un elemento esistente prima di crearne uno nuovo.'
  } as Record<string, string>,
  categorySaveFailed: 'Salvataggio categoria fallito: {code}',
  categoryUpdated: 'Categoria aggiornata.',
  categoryCreated: 'Categoria creata.',
  categoryInUse: 'La categoria contiene già ticket e non può essere eliminata.',
  categoryInUseByForm: 'La categoria è usata da uno o più form per il ticket automatico: aggiorna i form prima di eliminarla, oppure disabilitala.',
  categoryDeleteFailed: 'Eliminazione categoria fallita: {code}',
  categoryDeleted: 'Categoria eliminata.',
  templateErrors: {
    QUOTA_EXCEEDED: 'Limite raggiunto per questo server: elimina un elemento esistente prima di crearne uno nuovo.'
  } as Record<string, string>,
  templateCreateFailed: 'Creazione template fallita: {code}',
  templateCreated: 'Template creato.',
  templateDeleteFailed: 'Eliminazione template fallita: {code}',
  templateDeleted: 'Template eliminato.',
  title: 'Configurazione ticket',
  adminRequired: 'Serve il livello Admin o Owner.',
  back: 'Torna indietro',
  eyebrow: 'Dispatch',
  intro: 'Categorie, form, SLA, automazioni e risposte rapide.',
  navManage: 'Gestisci ticket',
  navPanels: 'Pannelli',
  navForms: 'Form',
  navSystem: 'Sistema',
  navAnalytics: 'Analytics',
  navBlacklist: 'Blacklist',
  navPermissions: 'Permessi dashboard',
  editCategoryTitle: 'Modifica categoria',
  newCategoryTitle: 'Nuova categoria ticket',
  cancel: 'Annulla',
  name: 'Nome',
  description: 'Descrizione',
  discordCategory: 'Categoria Discord',
  none: 'Nessuna',
  closedCategory: 'Categoria Discord per i ticket chiusi',
  closedCategoryPlaceholder: 'Nessuna (restano dove sono)',
  closedCategoryHint: "Facoltativa. Alla chiusura il canale viene spostato qui mantenendo i propri permessi; alla riapertura torna nella categoria di origine. Una categoria Discord contiene al massimo 50 canali: se è piena il ticket resta dov'è.",
  staffRoles: 'Ruoli staff',
  maxOpenPerUser: 'Massimo ticket aperti per utente',
  antiSpam: 'Anti-spam categoria',
  openCooldown: 'Cooldown dopo apertura, secondi',
  antiSpamWindow: 'Finestra tentativi, minuti',
  antiSpamMaxAttempts: 'Tentativi massimi nella finestra',
  slaAutomations: 'SLA e automazioni',
  slaHelp: 'Lascia vuoto un campo per disattivare la relativa automazione.',
  slaFirstResponse: 'SLA prima risposta, minuti',
  slaResolution: 'SLA risoluzione, minuti',
  emptyDisabledMasc: 'Vuoto = disattivato',
  emptyDisabledFem: 'Vuoto = disattivata',
  inactivityClose: 'Auto-chiusura inattività, ore',
  inactivityWarning: 'Preavviso auto-chiusura, minuti',
  emptyNoWarning: 'Vuoto = nessun preavviso',
  reopenWindow: 'Finestra riapertura utente, ore',
  emptyStaffOnly: 'Vuoto = solo lo staff',
  escalationAuto: 'Escalation automatica',
  escalationAfter: 'Escalation dopo, minuti dall’apertura',
  escalationRoles: 'Ruoli escalation',
  escalationRolesHint: 'Vuoto = vengono menzionati i ruoli staff della categoria.',
  escalationOff: 'Disattivata: nessuna menzione automatica per i ticket aperti da troppo tempo.',
  feedbackToggle: 'Richiedi feedback 1-5 stelle alla chiusura',
  formLegend: 'Form iniziale, massimo 5 domande',
  question: 'Domanda {number}',
  remove: 'Rimuovi',
  fieldLabel: 'Etichetta',
  fieldType: 'Tipo',
  typeShort: 'Risposta breve',
  typeLong: 'Paragrafo',
  typeSelect: 'Menu a scelta singola',
  fieldPlaceholder: 'Placeholder',
  fieldOptions: 'Opzioni, una per riga: Etichetta|valore',
  required: 'Obbligatoria',
  minChars: 'Min caratteri',
  maxChars: 'Max caratteri',
  addQuestion: 'Aggiungi domanda',
  transcript: 'Transcript',
  transcriptAuto: 'Genera automaticamente il transcript alla chiusura',
  transcriptDm: "Invia il file HTML in DM all'utente che ha aperto il ticket",
  transcriptChannel: 'Canale archivio transcript',
  transcriptChannelPlaceholder: 'Non inviare in un canale',
  transcriptRetain: 'Conserva una copia cifrata lato Dispatch fino alla retention/eliminazione del ticket',
  transcriptRetainHelp: "Attivo: la copia resta disponibile e può essere scaricata più volte dalla dashboard. Disattivo: il transcript generato dalla dashboard è monouso e viene eliminato dal database al primo download; il transcript automatico viene creato solo in memoria per l'invio e non viene salvato.",
  saving: 'Salvataggio...',
  saveChanges: 'Salva modifiche',
  createCategory: 'Crea categoria',
  categoriesTitle: 'Categorie',
  noDescription: 'Nessuna descrizione.',
  limitsLine: 'Limite aperti: {max} · Cooldown: {cooldown}s · Tentativi: {attempts}/{window}m',
  slaLine: 'SLA risposta: {first} · SLA risoluzione: {resolution} · Auto-close: {autoClose}',
  automationLine: 'Escalation: {escalation} · Riapertura: {reopen} · Feedback: {feedback} · Transcript: {transcript}',
  off: 'off',
  on: 'on',
  hoursShort: '{value}h',
  minutesShort: '{value} min',
  transcriptAutoShort: 'auto',
  transcriptManual: 'manuale',
  closedTickets: 'Ticket chiusi: {where}',
  movedTo: 'spostati in {name}',
  stayInCategory: 'restano nella categoria',
  edit: 'Modifica',
  delete: 'Elimina',
  newTemplate: 'Nuovo template risposta',
  message: 'Messaggio',
  createTemplate: 'Crea template',
  templatesTitle: 'Template disponibili',
  noTemplates: 'Nessun template configurato.'
};

const en: typeof it = {
  loadError: 'The ticket configuration could not be loaded.',
  escalationMissing: 'Enter after how many minutes automatic escalation should trigger, or turn it off.',
  categoryErrors: {
    QUOTA_EXCEEDED: 'Limit reached for this server: delete an existing item before creating a new one.'
  } as Record<string, string>,
  categorySaveFailed: 'Saving the category failed: {code}',
  categoryUpdated: 'Category updated.',
  categoryCreated: 'Category created.',
  categoryInUse: 'The category already contains tickets and cannot be deleted.',
  categoryInUseByForm: 'The category is used by one or more forms for automatic tickets: update those forms before deleting it, or disable it.',
  categoryDeleteFailed: 'Deleting the category failed: {code}',
  categoryDeleted: 'Category deleted.',
  templateErrors: {
    QUOTA_EXCEEDED: 'Limit reached for this server: delete an existing item before creating a new one.'
  } as Record<string, string>,
  templateCreateFailed: 'Creating the canned reply failed: {code}',
  templateCreated: 'Canned reply created.',
  templateDeleteFailed: 'Deleting the canned reply failed: {code}',
  templateDeleted: 'Canned reply deleted.',
  title: 'Ticket setup',
  adminRequired: 'The Admin or Owner level is required.',
  back: 'Go back',
  eyebrow: 'Dispatch',
  intro: 'Categories, forms, SLAs, automations and canned replies.',
  navManage: 'Manage tickets',
  navPanels: 'Panels',
  navForms: 'Forms',
  navSystem: 'System',
  navAnalytics: 'Analytics',
  navBlacklist: 'Blacklist',
  navPermissions: 'Dashboard permissions',
  editCategoryTitle: 'Edit category',
  newCategoryTitle: 'New ticket category',
  cancel: 'Cancel',
  name: 'Name',
  description: 'Description',
  discordCategory: 'Discord category',
  none: 'None',
  closedCategory: 'Discord category for closed tickets',
  closedCategoryPlaceholder: 'None (they stay where they are)',
  closedCategoryHint: 'Optional. On close the channel is moved here, keeping its own permissions; on reopen it goes back to its original category. A Discord category holds at most 50 channels: if it is full, the ticket stays where it is.',
  staffRoles: 'Staff roles',
  maxOpenPerUser: 'Maximum open tickets per user',
  antiSpam: 'Category anti-spam',
  openCooldown: 'Cooldown after opening, seconds',
  antiSpamWindow: 'Attempt window, minutes',
  antiSpamMaxAttempts: 'Maximum attempts in the window',
  slaAutomations: 'SLA and automations',
  slaHelp: 'Leave a field empty to turn off the related automation.',
  slaFirstResponse: 'First response SLA, minutes',
  slaResolution: 'Resolution SLA, minutes',
  emptyDisabledMasc: 'Empty = off',
  emptyDisabledFem: 'Empty = off',
  inactivityClose: 'Auto-close on inactivity, hours',
  inactivityWarning: 'Auto-close warning, minutes',
  emptyNoWarning: 'Empty = no warning',
  reopenWindow: 'User reopen window, hours',
  emptyStaffOnly: 'Empty = staff only',
  escalationAuto: 'Automatic escalation',
  escalationAfter: 'Escalate after, minutes from opening',
  escalationRoles: 'Escalation roles',
  escalationRolesHint: 'Empty = the category staff roles are mentioned.',
  escalationOff: 'Off: no automatic mention for tickets that have been open too long.',
  feedbackToggle: 'Ask for 1-5 star feedback on close',
  formLegend: 'Initial form, up to 5 questions',
  question: 'Question {number}',
  remove: 'Remove',
  fieldLabel: 'Label',
  fieldType: 'Type',
  typeShort: 'Short answer',
  typeLong: 'Paragraph',
  typeSelect: 'Single-choice menu',
  fieldPlaceholder: 'Placeholder',
  fieldOptions: 'Options, one per line: Label|value',
  required: 'Required',
  minChars: 'Min characters',
  maxChars: 'Max characters',
  addQuestion: 'Add question',
  transcript: 'Transcript',
  transcriptAuto: 'Automatically generate the transcript on close',
  transcriptDm: 'Send the HTML file by DM to the user who opened the ticket',
  transcriptChannel: 'Transcript archive channel',
  transcriptChannelPlaceholder: 'Do not send to a channel',
  transcriptRetain: 'Keep an encrypted copy on Dispatch until the ticket’s retention/deletion',
  transcriptRetainHelp: 'On: the copy stays available and can be downloaded multiple times from the dashboard. Off: a transcript generated from the dashboard is single-use and is deleted from the database on first download; the automatic transcript is created in memory only for delivery and is not saved.',
  saving: 'Saving...',
  saveChanges: 'Save changes',
  createCategory: 'Create category',
  categoriesTitle: 'Categories',
  noDescription: 'No description.',
  limitsLine: 'Open limit: {max} · Cooldown: {cooldown}s · Attempts: {attempts}/{window}m',
  slaLine: 'Response SLA: {first} · Resolution SLA: {resolution} · Auto-close: {autoClose}',
  automationLine: 'Escalation: {escalation} · Reopen: {reopen} · Feedback: {feedback} · Transcript: {transcript}',
  off: 'off',
  on: 'on',
  hoursShort: '{value}h',
  minutesShort: '{value} min',
  transcriptAutoShort: 'auto',
  transcriptManual: 'manual',
  closedTickets: 'Closed tickets: {where}',
  movedTo: 'moved to {name}',
  stayInCategory: 'stay in the category',
  edit: 'Edit',
  delete: 'Delete',
  newTemplate: 'New canned reply',
  message: 'Message',
  createTemplate: 'Create canned reply',
  templatesTitle: 'Available canned replies',
  noTemplates: 'No canned replies configured.'
};

const copy: Record<Locale, typeof it> = { it, en };

const newCategory = () => ({
  name: '',
  description: '',
  discordCategoryId: '',
  closedParentCategoryId: '',
  staffRoleIds: [] as string[],
  maxOpenPerUser: 1,
  openCooldownSeconds: 60,
  antiSpamWindowMinutes: 10,
  antiSpamMaxAttempts: 3,
  formFields: [] as FormField[],
  slaFirstResponseMinutes: null as number | null,
  slaResolutionMinutes: null as number | null,
  inactivityCloseHours: null as number | null,
  inactivityWarningMinutes: null as number | null,
  // UI-only toggle: escalation is off when escalationMinutes is null.
  escalationEnabled: false,
  escalationMinutes: null as number | null,
  escalationRoleIds: [] as string[],
  reopenWindowHours: 24 as number | null,
  feedbackEnabled: true,
  transcriptAutoGenerate: false,
  transcriptSendToOpener: false,
  transcriptChannelId: '',
  transcriptRetain: true,
  enabled: true
});

function nullableNumber(value: string) {
  return value === '' ? null : Number(value);
}

function formatFieldOptions(options: FormField['options']) {
  return options.map((option) => `${option.label}|${option.value}`).join('\n');
}

function parseFieldOptions(text: string): FormField['options'] {
  return text.split('\n').map((line) => {
    const separator = line.indexOf('|');
    const label = (separator >= 0 ? line.slice(0, separator) : line).trim();
    const value = (separator >= 0 ? line.slice(separator + 1) : line).trim() || label;
    return { label, value, description: null };
  }).filter((option) => option.label && option.value).slice(0, 25);
}

export default function TicketConfigurationPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;
  const c = useCopy(copy);

  const [access, setAccess] = useState<AccessLevel | null>(null);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<ResponseTemplate[]>([]);
  const [categoryForm, setCategoryForm] = useState(newCategory);
  // Raw option editor text per field ID: parsed on blur and before save, so
  // typing "Etichetta|" is not normalised away mid-keystroke.
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({});
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateContent, setTemplateContent] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setError('');

    const [accessResponse, resourcesResponse, categoriesResponse, templatesResponse] = await Promise.all([
      fetch(`/backend/api/guilds/${guildId}/access`),
      fetch(`/backend/api/guilds/${guildId}/resources`),
      fetch(`/backend/api/guilds/${guildId}/categories`),
      fetch(`/backend/api/guilds/${guildId}/response-templates`)
    ]);

    if (accessResponse.status === 401) {
      window.location.href = '/backend/auth/discord';
      return;
    }

    if (![accessResponse, resourcesResponse, categoriesResponse, templatesResponse].every((response) => response.ok)) {
      setError(c.loadError);
      return;
    }

    const accessData = await accessResponse.json();
    const resources = await resourcesResponse.json();

    setAccess(accessData.access);
    setChannels(resources.channels);
    setRoles(resources.roles);
    setCategories(await categoriesResponse.json());
    setTemplates(await templatesResponse.json());
  };

  useEffect(() => {
    void load();
  }, [guildId]);

  const resetCategory = () => {
    setCategoryForm(newCategory());
    setOptionDrafts({});
    setEditingCategoryId(null);
  };

  const editCategory = (category: Category) => {
    setEditingCategoryId(category.id);
    setOptionDrafts({});
    setCategoryForm({
      name: category.name,
      description: category.description ?? '',
      discordCategoryId: category.discordCategoryId ?? '',
      closedParentCategoryId: category.closedParentCategoryId ?? '',
      staffRoleIds: category.staffRoleIds,
      maxOpenPerUser: category.maxOpenPerUser,
      openCooldownSeconds: category.openCooldownSeconds,
      antiSpamWindowMinutes: category.antiSpamWindowMinutes,
      antiSpamMaxAttempts: category.antiSpamMaxAttempts,
      formFields: (category.formFields ?? []).map((field) => ({
        ...field,
        type: field.type ?? (field.style === 'PARAGRAPH' ? 'LONG_TEXT' : 'SHORT_TEXT'),
        options: field.options ?? []
      })),
      slaFirstResponseMinutes: category.slaFirstResponseMinutes,
      slaResolutionMinutes: category.slaResolutionMinutes,
      inactivityCloseHours: category.inactivityCloseHours,
      inactivityWarningMinutes: category.inactivityWarningMinutes,
      escalationEnabled: category.escalationMinutes != null,
      escalationMinutes: category.escalationMinutes,
      escalationRoleIds: category.escalationRoleIds ?? [],
      reopenWindowHours: category.reopenWindowHours,
      feedbackEnabled: category.feedbackEnabled,
      transcriptAutoGenerate: category.transcriptAutoGenerate ?? false,
      transcriptSendToOpener: category.transcriptSendToOpener ?? false,
      transcriptChannelId: category.transcriptChannelId ?? '',
      transcriptRetain: category.transcriptRetain ?? true,
      enabled: category.enabled
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveCategory = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');

    const { escalationEnabled, ...categoryData } = categoryForm;
    if (escalationEnabled && categoryData.escalationMinutes == null) {
      setError(c.escalationMissing);
      return;
    }

    setBusy('category');
    try {
      const path = editingCategoryId
        ? `/backend/api/guilds/${guildId}/categories/${editingCategoryId}`
        : `/backend/api/guilds/${guildId}/categories`;

      const response = await fetch(path, {
        method: editingCategoryId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...categoryData,
          // Escalation off: no minutes and no escalation roles are stored.
          escalationMinutes: escalationEnabled ? categoryData.escalationMinutes : null,
          escalationRoleIds: escalationEnabled ? categoryData.escalationRoleIds : [],
          formFields: categoryForm.formFields.map((field) =>
            field.type === 'SINGLE_SELECT' && optionDrafts[field.id] !== undefined
              ? { ...field, options: parseFieldOptions(optionDrafts[field.id]) }
              : field
          ),
          description: categoryForm.description || null,
          discordCategoryId: categoryForm.discordCategoryId || null,
          closedParentCategoryId: categoryForm.closedParentCategoryId || null,
          transcriptChannelId: categoryForm.transcriptChannelId || null
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const code = body.error ?? response.status;
        setError(c.categoryErrors[String(code)] ?? format(c.categorySaveFailed, { code }));
        return;
      }

      resetCategory();
      setNotice(editingCategoryId ? c.categoryUpdated : c.categoryCreated);
      await load();
    } finally {
      setBusy('');
    }
  };

  const addFormField = () => {
    if (categoryForm.formFields.length >= 5) return;
    const used = new Set(categoryForm.formFields.map((field) => field.id));
    let index = 1;
    while (used.has(`q${index}`)) index += 1;

    setCategoryForm({
      ...categoryForm,
      formFields: [
        ...categoryForm.formFields,
        {
          id: `q${index}`,
          label: '',
          style: 'SHORT',
          type: 'SHORT_TEXT',
          required: true,
          placeholder: null,
          minLength: null,
          maxLength: 1000,
          options: []
        }
      ]
    });
  };

  const updateFormField = (index: number, patch: Partial<FormField>) => {
    setCategoryForm({
      ...categoryForm,
      formFields: categoryForm.formFields.map((field, current) =>
        current === index ? { ...field, ...patch } : field
      )
    });
  };

  const removeFormField = (index: number) => {
    const removedId = categoryForm.formFields[index]?.id;
    setCategoryForm({
      ...categoryForm,
      formFields: categoryForm.formFields.filter((_, current) => current !== index)
    });
    if (removedId) {
      setOptionDrafts((current) => {
        const next = { ...current };
        delete next[removedId];
        return next;
      });
    }
  };

  const commitOptionDraft = (index: number, fieldId: string) => {
    const text = optionDrafts[fieldId];
    if (text === undefined) return;
    updateFormField(index, { options: parseFieldOptions(text) });
    setOptionDrafts((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  };

  const deleteCategory = async (categoryId: string) => {
    setBusy(`category:${categoryId}`);
    setError('');
    setNotice('');

    try {
      const response = await fetch(`/backend/api/guilds/${guildId}/categories/${categoryId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error === 'CATEGORY_IN_USE'
          ? c.categoryInUse
          : body.error === 'CATEGORY_IN_USE_BY_FORM'
            ? c.categoryInUseByForm
            : format(c.categoryDeleteFailed, { code: body.error ?? response.status }));
        return;
      }

      setNotice(c.categoryDeleted);
      await load();
    } finally {
      setBusy('');
    }
  };

  const createTemplate = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('template');
    setError('');
    setNotice('');

    try {
      const response = await fetch(`/backend/api/guilds/${guildId}/response-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: templateName, content: templateContent })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const code = body.error ?? response.status;
        setError(c.templateErrors[String(code)] ?? format(c.templateCreateFailed, { code }));
        return;
      }

      setTemplateName('');
      setTemplateContent('');
      setNotice(c.templateCreated);
      await load();
    } finally {
      setBusy('');
    }
  };

  const deleteTemplate = async (templateId: string) => {
    setBusy(`template:${templateId}`);
    setError('');
    setNotice('');

    try {
      const response = await fetch(`/backend/api/guilds/${guildId}/response-templates/${templateId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(format(c.templateDeleteFailed, { code: body.error ?? response.status }));
        return;
      }

      setNotice(c.templateDeleted);
      await load();
    } finally {
      setBusy('');
    }
  };

  if (access && access !== 'ADMIN' && access !== 'OWNER') {
    return (
      <main className="shell">
        <section className="card">
          <h1>{c.title}</h1>
          <p>{c.adminRequired}</p>
          <a className="button secondary" href={`/dashboard/${guildId}`}>{c.back}</a>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">{c.eyebrow}</p>
          <h1>{c.title}</h1>
          <p className="muted">{c.intro}</p>
        </div>
        <div className="actions">
          <a className="button" href={`/dashboard/${guildId}/tickets/manage`}>{c.navManage}</a>
          <a className="button secondary" href={`/dashboard/${guildId}/panels`}>{c.navPanels}</a>
          <a className="button secondary" href={`/dashboard/${guildId}/forms`}>{c.navForms}</a>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets/system`}>{c.navSystem}</a>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets/analytics`}>{c.navAnalytics}</a>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets/security`}>{c.navBlacklist}</a>
          <a className="button secondary" href={`/dashboard/${guildId}`}>{c.navPermissions}</a>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <section>
        <form className="card form" onSubmit={saveCategory}>
          <div className="row">
            <h2>{editingCategoryId ? c.editCategoryTitle : c.newCategoryTitle}</h2>
            {editingCategoryId && (
              <button className="secondary" type="button" onClick={resetCategory}>{c.cancel}</button>
            )}
          </div>

          {/* Fixed columns: toggling a section (escalation, transcript) only
              changes the height of its own column instead of reflowing the
              whole editor like CSS multi-column did. */}
          <div className="editor-split">
            <div className="form">
              <label>
                {c.name}
                <input
                  required
                  maxLength={80}
                  value={categoryForm.name}
                  onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })}
                />
              </label>

              <label>
                {c.description}
                <textarea
                  maxLength={500}
                  value={categoryForm.description}
                  onChange={(event) => setCategoryForm({ ...categoryForm, description: event.target.value })}
                />
              </label>

              <ResourcePicker
                label={c.discordCategory}
                kind="channel"
                channels={channels}
                channelTypes={[CHANNEL_TYPES.category]}
                placeholder={c.none}
                value={categoryForm.discordCategoryId}
                onChange={(discordCategoryId) => setCategoryForm({ ...categoryForm, discordCategoryId })}
              />

              <ResourcePicker
                label={c.closedCategory}
                kind="channel"
                channels={channels}
                channelTypes={[CHANNEL_TYPES.category]}
                placeholder={c.closedCategoryPlaceholder}
                hint={c.closedCategoryHint}
                value={categoryForm.closedParentCategoryId}
                onChange={(closedParentCategoryId) => setCategoryForm({ ...categoryForm, closedParentCategoryId })}
              />

              <ResourcePicker
                label={c.staffRoles}
                kind="role"
                roles={roles}
                guildId={guildId}
                multiple
                value={categoryForm.staffRoleIds}
                onChange={(staffRoleIds) => setCategoryForm({ ...categoryForm, staffRoleIds })}
              />

              <label>
                {c.maxOpenPerUser}
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={categoryForm.maxOpenPerUser}
                  onChange={(event) => setCategoryForm({
                    ...categoryForm,
                    maxOpenPerUser: Number(event.target.value)
                  })}
                />
              </label>

              <fieldset>
                <legend>{c.antiSpam}</legend>
                <div className="grid compact-grid">
                  <label>
                    {c.openCooldown}
                    <input
                      type="number"
                      min={0}
                      max={86400}
                      value={categoryForm.openCooldownSeconds}
                      onChange={(event) => setCategoryForm({
                        ...categoryForm,
                        openCooldownSeconds: Number(event.target.value)
                      })}
                    />
                  </label>
                  <label>
                    {c.antiSpamWindow}
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={categoryForm.antiSpamWindowMinutes}
                      onChange={(event) => setCategoryForm({
                        ...categoryForm,
                        antiSpamWindowMinutes: Number(event.target.value)
                      })}
                    />
                  </label>
                  <label>
                    {c.antiSpamMaxAttempts}
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={categoryForm.antiSpamMaxAttempts}
                      onChange={(event) => setCategoryForm({
                        ...categoryForm,
                        antiSpamMaxAttempts: Number(event.target.value)
                      })}
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset>
                <legend>{c.slaAutomations}</legend>
                <p className="muted">{c.slaHelp}</p>
                <div className="grid compact-grid">
                  <label>
                    {c.slaFirstResponse}
                    <input
                      type="number"
                      min={1}
                      max={10080}
                      placeholder={c.emptyDisabledMasc}
                      value={categoryForm.slaFirstResponseMinutes ?? ''}
                      onChange={(event) => setCategoryForm({
                        ...categoryForm,
                        slaFirstResponseMinutes: nullableNumber(event.target.value)
                      })}
                    />
                  </label>
                  <label>
                    {c.slaResolution}
                    <input
                      type="number"
                      min={1}
                      max={43200}
                      placeholder={c.emptyDisabledMasc}
                      value={categoryForm.slaResolutionMinutes ?? ''}
                      onChange={(event) => setCategoryForm({
                        ...categoryForm,
                        slaResolutionMinutes: nullableNumber(event.target.value)
                      })}
                    />
                  </label>
                  <label>
                    {c.inactivityClose}
                    <input
                      type="number"
                      min={1}
                      max={720}
                      placeholder={c.emptyDisabledFem}
                      value={categoryForm.inactivityCloseHours ?? ''}
                      onChange={(event) => setCategoryForm({
                        ...categoryForm,
                        inactivityCloseHours: nullableNumber(event.target.value)
                      })}
                    />
                  </label>
                  <label>
                    {c.inactivityWarning}
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      placeholder={c.emptyNoWarning}
                      value={categoryForm.inactivityWarningMinutes ?? ''}
                      onChange={(event) => setCategoryForm({
                        ...categoryForm,
                        inactivityWarningMinutes: nullableNumber(event.target.value)
                      })}
                    />
                  </label>
                  <label>
                    {c.reopenWindow}
                    <input
                      type="number"
                      min={1}
                      max={720}
                      placeholder={c.emptyStaffOnly}
                      value={categoryForm.reopenWindowHours ?? ''}
                      onChange={(event) => setCategoryForm({
                        ...categoryForm,
                        reopenWindowHours: nullableNumber(event.target.value)
                      })}
                    />
                  </label>
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={categoryForm.escalationEnabled}
                    onChange={(event) => setCategoryForm({
                      ...categoryForm,
                      escalationEnabled: event.target.checked,
                      escalationMinutes: event.target.checked
                        ? categoryForm.escalationMinutes ?? 60
                        : categoryForm.escalationMinutes
                    })}
                  />
                  {c.escalationAuto}
                </label>

                {categoryForm.escalationEnabled ? (
                  <div className="form">
                    <label>
                      {c.escalationAfter}
                      <input
                        type="number"
                        required
                        min={1}
                        max={43200}
                        value={categoryForm.escalationMinutes ?? ''}
                        onChange={(event) => setCategoryForm({
                          ...categoryForm,
                          escalationMinutes: nullableNumber(event.target.value)
                        })}
                      />
                    </label>

                    <ResourcePicker
                      label={c.escalationRoles}
                      kind="role"
                      roles={roles}
                      guildId={guildId}
                      multiple
                      hint={c.escalationRolesHint}
                      value={categoryForm.escalationRoleIds}
                      onChange={(escalationRoleIds) => setCategoryForm({ ...categoryForm, escalationRoleIds })}
                    />
                  </div>
                ) : (
                  <p className="muted">
                    {c.escalationOff}
                  </p>
                )}

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={categoryForm.feedbackEnabled}
                    onChange={(event) => setCategoryForm({
                      ...categoryForm,
                      feedbackEnabled: event.target.checked
                    })}
                  />
                  {c.feedbackToggle}
                </label>
              </fieldset>

            </div>
            <div className="form">
              <fieldset>
                <legend>{c.formLegend}</legend>
                <div className="form">
                  {categoryForm.formFields.map((field, index) => (
                    <div className="subcard form" key={field.id}>
                      <div className="row">
                        <strong>{format(c.question, { number: index + 1 })}</strong>
                        <button className="danger" type="button" onClick={() => removeFormField(index)}>{c.remove}</button>
                      </div>
                      <label>
                        {c.fieldLabel}
                        <input
                          required
                          maxLength={45}
                          value={field.label}
                          onChange={(event) => updateFormField(index, { label: event.target.value })}
                        />
                      </label>
                      <label>
                        {c.fieldType}
                        <select
                          value={field.type}
                          onChange={(event) => {
                            const type = event.target.value as FormField['type'];
                            updateFormField(index, {
                              type,
                              style: type === 'LONG_TEXT' ? 'PARAGRAPH' : 'SHORT',
                              options: type === 'SINGLE_SELECT' ? field.options : []
                            });
                          }}
                        >
                          <option value="SHORT_TEXT">{c.typeShort}</option>
                          <option value="LONG_TEXT">{c.typeLong}</option>
                          <option value="SINGLE_SELECT">{c.typeSelect}</option>
                        </select>
                      </label>
                      <label>
                        {c.fieldPlaceholder}
                        <input
                          maxLength={100}
                          value={field.placeholder ?? ''}
                          onChange={(event) => updateFormField(index, { placeholder: event.target.value || null })}
                        />
                      </label>
                      {field.type === 'SINGLE_SELECT' && (
                        <label>
                          {c.fieldOptions}
                          <textarea
                            value={optionDrafts[field.id] ?? formatFieldOptions(field.options)}
                            onChange={(event) => {
                              const text = event.target.value;
                              setOptionDrafts((current) => ({ ...current, [field.id]: text }));
                            }}
                            onBlur={() => commitOptionDraft(index, field.id)}
                          />
                        </label>
                      )}
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(event) => updateFormField(index, { required: event.target.checked })}
                        />
                        {c.required}
                      </label>
                      <div className="row">
                        <label>
                          {c.minChars}
                          <input
                            type="number"
                            min={0}
                            max={4000}
                            value={field.minLength ?? ''}
                            onChange={(event) => updateFormField(index, { minLength: nullableNumber(event.target.value) })}
                          />
                        </label>
                        <label>
                          {c.maxChars}
                          <input
                            type="number"
                            min={1}
                            max={4000}
                            value={field.maxLength ?? ''}
                            onChange={(event) => updateFormField(index, { maxLength: nullableNumber(event.target.value) })}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                  <button
                    className="secondary"
                    type="button"
                    disabled={categoryForm.formFields.length >= 5}
                    onClick={addFormField}
                  >
                    {c.addQuestion}
                  </button>
                </div>
              </fieldset>

              <fieldset>
                <legend>{c.transcript}</legend>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={categoryForm.transcriptAutoGenerate}
                    onChange={(event) => setCategoryForm({
                      ...categoryForm,
                      transcriptAutoGenerate: event.target.checked
                    })}
                  />
                  {c.transcriptAuto}
                </label>

                {categoryForm.transcriptAutoGenerate && (
                  <div className="form">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={categoryForm.transcriptSendToOpener}
                        onChange={(event) => setCategoryForm({
                          ...categoryForm,
                          transcriptSendToOpener: event.target.checked
                        })}
                      />
                      {c.transcriptDm}
                    </label>

                    <ResourcePicker
                      label={c.transcriptChannel}
                      kind="channel"
                      channels={channels}
                      channelTypes={[CHANNEL_TYPES.text, CHANNEL_TYPES.announcement]}
                      placeholder={c.transcriptChannelPlaceholder}
                      value={categoryForm.transcriptChannelId}
                      onChange={(transcriptChannelId) => setCategoryForm({ ...categoryForm, transcriptChannelId })}
                    />

                  </div>
                )}

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={categoryForm.transcriptRetain}
                    onChange={(event) => setCategoryForm({
                      ...categoryForm,
                      transcriptRetain: event.target.checked
                    })}
                  />
                  {c.transcriptRetain}
                </label>

                <p className="muted">
                  {c.transcriptRetainHelp}
                </p>
              </fieldset>

            </div>
          </div>

          <button disabled={busy === 'category'} type="submit">
            {busy === 'category' ? c.saving : editingCategoryId ? c.saveChanges : c.createCategory}
          </button>
        </form>

      </section>

      <section>
        <h2>{c.categoriesTitle}</h2>
        <div className="grid">
          {categories.map((category) => (
            <article className="card" key={category.id}>
              <h3>{category.name}</h3>
              <p>{category.description || c.noDescription}</p>
              <p className="muted">
                {format(c.limitsLine, {
                  max: category.maxOpenPerUser,
                  cooldown: category.openCooldownSeconds,
                  attempts: category.antiSpamMaxAttempts,
                  window: category.antiSpamWindowMinutes
                })}
              </p>
              <p className="muted">
                {format(c.slaLine, {
                  first: category.slaFirstResponseMinutes ?? c.off,
                  resolution: category.slaResolutionMinutes ?? c.off,
                  autoClose: category.inactivityCloseHours ? format(c.hoursShort, { value: category.inactivityCloseHours }) : c.off
                })}
              </p>
              <p className="muted">
                {format(c.automationLine, {
                  escalation: category.escalationMinutes ? format(c.minutesShort, { value: category.escalationMinutes }) : c.off,
                  reopen: category.reopenWindowHours ? format(c.hoursShort, { value: category.reopenWindowHours }) : c.off,
                  feedback: category.feedbackEnabled ? c.on : c.off,
                  transcript: category.transcriptAutoGenerate ? c.transcriptAutoShort : c.transcriptManual
                })}
              </p>
              <p className="muted">
                {format(c.closedTickets, {
                  where: category.closedParentCategoryId
                    ? format(c.movedTo, { name: channels.find((channel) => channel.id === category.closedParentCategoryId)?.name ?? category.closedParentCategoryId })
                    : c.stayInCategory
                })}
              </p>
              <div className="actions">
                <button className="secondary" onClick={() => editCategory(category)}>{c.edit}</button>
                <button
                  className="danger"
                  disabled={busy === `category:${category.id}`}
                  onClick={() => void deleteCategory(category.id)}
                >
                  {c.delete}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="grid settings-grid">
        <form className="card form" onSubmit={createTemplate}>
          <h2>{c.newTemplate}</h2>
          <label>
            {c.name}
            <input
              required
              maxLength={80}
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
            />
          </label>
          <label>
            {c.message}
            <textarea
              required
              maxLength={2000}
              value={templateContent}
              onChange={(event) => setTemplateContent(event.target.value)}
            />
          </label>
          <button disabled={busy === 'template'} type="submit">{c.createTemplate}</button>
        </form>

        <div className="card">
          <h2>{c.templatesTitle}</h2>
          <div className="member-list">
            {templates.map((template) => (
              <div className="list-item" key={template.id}>
                <div className="row">
                  <strong>{template.name}</strong>
                  <button
                    className="danger"
                    disabled={busy === `template:${template.id}`}
                    onClick={() => void deleteTemplate(template.id)}
                  >
                    {c.delete}
                  </button>
                </div>
                <p className="muted preserve">{template.content}</p>
              </div>
            ))}
            {templates.length === 0 && <p className="muted">{c.noTemplates}</p>}
          </div>
        </div>
      </section>
    </main>
  );
}
