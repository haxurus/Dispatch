'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ResourcePicker, { CHANNEL_TYPES } from '../../../_components/ResourcePicker';

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

const newCategory = () => ({
  name: '',
  description: '',
  discordCategoryId: '',
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
      setError('Impossibile caricare la configurazione ticket.');
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
    setBusy('category');
    setError('');
    setNotice('');

    try {
      const path = editingCategoryId
        ? `/backend/api/guilds/${guildId}/categories/${editingCategoryId}`
        : `/backend/api/guilds/${guildId}/categories`;

      const response = await fetch(path, {
        method: editingCategoryId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...categoryForm,
          formFields: categoryForm.formFields.map((field) =>
            field.type === 'SINGLE_SELECT' && optionDrafts[field.id] !== undefined
              ? { ...field, options: parseFieldOptions(optionDrafts[field.id]) }
              : field
          ),
          description: categoryForm.description || null,
          discordCategoryId: categoryForm.discordCategoryId || null,
          transcriptChannelId: categoryForm.transcriptChannelId || null
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(`Salvataggio categoria fallito: ${body.error ?? response.status}`);
        return;
      }

      resetCategory();
      setNotice(editingCategoryId ? 'Categoria aggiornata.' : 'Categoria creata.');
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
          ? 'La categoria contiene già ticket e non può essere eliminata.'
          : body.error === 'CATEGORY_IN_USE_BY_FORM'
            ? 'La categoria è usata da uno o più form per il ticket automatico: aggiorna i form prima di eliminarla, oppure disabilitala.'
            : `Eliminazione categoria fallita: ${body.error ?? response.status}`);
        return;
      }

      setNotice('Categoria eliminata.');
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
        setError(`Creazione template fallita: ${body.error ?? response.status}`);
        return;
      }

      setTemplateName('');
      setTemplateContent('');
      setNotice('Template creato.');
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
        setError(`Eliminazione template fallita: ${body.error ?? response.status}`);
        return;
      }

      setNotice('Template eliminato.');
      await load();
    } finally {
      setBusy('');
    }
  };

  if (access && access !== 'ADMIN' && access !== 'OWNER') {
    return (
      <main className="shell">
        <section className="card">
          <h1>Configurazione ticket</h1>
          <p>Serve il livello Admin o Owner.</p>
          <a className="button secondary" href={`/dashboard/${guildId}`}>Torna indietro</a>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">Dispatch</p>
          <h1>Configurazione ticket</h1>
          <p className="muted">Categorie, form, SLA, automazioni e risposte rapide.</p>
        </div>
        <div className="actions">
          <a className="button" href={`/dashboard/${guildId}/tickets/manage`}>Gestisci ticket</a>
          <a className="button secondary" href={`/dashboard/${guildId}/panels`}>Pannelli</a>
          <a className="button secondary" href={`/dashboard/${guildId}/forms`}>Form</a>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets/system`}>Sistema</a>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets/analytics`}>Analytics</a>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets/security`}>Blacklist</a>
          <a className="button secondary" href={`/dashboard/${guildId}`}>Permessi dashboard</a>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <section>
        <form className="card form form-columns" onSubmit={saveCategory}>
          <div className="row">
            <h2>{editingCategoryId ? 'Modifica categoria' : 'Nuova categoria ticket'}</h2>
            {editingCategoryId && (
              <button className="secondary" type="button" onClick={resetCategory}>Annulla</button>
            )}
          </div>

          <label>
            Nome
            <input
              required
              maxLength={80}
              value={categoryForm.name}
              onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })}
            />
          </label>

          <label>
            Descrizione
            <textarea
              maxLength={500}
              value={categoryForm.description}
              onChange={(event) => setCategoryForm({ ...categoryForm, description: event.target.value })}
            />
          </label>

          <ResourcePicker
            label="Categoria Discord"
            kind="channel"
            channels={channels}
            channelTypes={[CHANNEL_TYPES.category]}
            placeholder="Nessuna"
            value={categoryForm.discordCategoryId}
            onChange={(discordCategoryId) => setCategoryForm({ ...categoryForm, discordCategoryId })}
          />

          <ResourcePicker
            label="Ruoli staff"
            kind="role"
            roles={roles}
            guildId={guildId}
            multiple
            value={categoryForm.staffRoleIds}
            onChange={(staffRoleIds) => setCategoryForm({ ...categoryForm, staffRoleIds })}
          />

          <label>
            Massimo ticket aperti per utente
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
            <legend>Anti-spam categoria</legend>
            <div className="grid compact-grid">
              <label>
                Cooldown dopo apertura, secondi
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
                Finestra tentativi, minuti
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
                Tentativi massimi nella finestra
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
            <legend>Form iniziale, massimo 5 domande</legend>
            <div className="form">
              {categoryForm.formFields.map((field, index) => (
                <div className="subcard form" key={field.id}>
                  <div className="row">
                    <strong>Domanda {index + 1}</strong>
                    <button className="danger" type="button" onClick={() => removeFormField(index)}>Rimuovi</button>
                  </div>
                  <label>
                    Etichetta
                    <input
                      required
                      maxLength={45}
                      value={field.label}
                      onChange={(event) => updateFormField(index, { label: event.target.value })}
                    />
                  </label>
                  <label>
                    Tipo
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
                      <option value="SHORT_TEXT">Risposta breve</option>
                      <option value="LONG_TEXT">Paragrafo</option>
                      <option value="SINGLE_SELECT">Menu a scelta singola</option>
                    </select>
                  </label>
                  <label>
                    Placeholder
                    <input
                      maxLength={100}
                      value={field.placeholder ?? ''}
                      onChange={(event) => updateFormField(index, { placeholder: event.target.value || null })}
                    />
                  </label>
                  {field.type === 'SINGLE_SELECT' && (
                    <label>
                      Opzioni, una per riga: Etichetta|valore
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
                    Obbligatoria
                  </label>
                  <div className="row">
                    <label>
                      Min caratteri
                      <input
                        type="number"
                        min={0}
                        max={4000}
                        value={field.minLength ?? ''}
                        onChange={(event) => updateFormField(index, { minLength: nullableNumber(event.target.value) })}
                      />
                    </label>
                    <label>
                      Max caratteri
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
                Aggiungi domanda
              </button>
            </div>
          </fieldset>

          <fieldset>
            <legend>SLA e automazioni</legend>
            <div className="grid compact-grid">
              <label>
                SLA prima risposta, minuti
                <input
                  type="number"
                  min={1}
                  max={10080}
                  value={categoryForm.slaFirstResponseMinutes ?? ''}
                  onChange={(event) => setCategoryForm({
                    ...categoryForm,
                    slaFirstResponseMinutes: nullableNumber(event.target.value)
                  })}
                />
              </label>
              <label>
                SLA risoluzione, minuti
                <input
                  type="number"
                  min={1}
                  max={43200}
                  value={categoryForm.slaResolutionMinutes ?? ''}
                  onChange={(event) => setCategoryForm({
                    ...categoryForm,
                    slaResolutionMinutes: nullableNumber(event.target.value)
                  })}
                />
              </label>
              <label>
                Auto-chiusura inattività, ore
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={categoryForm.inactivityCloseHours ?? ''}
                  onChange={(event) => setCategoryForm({
                    ...categoryForm,
                    inactivityCloseHours: nullableNumber(event.target.value)
                  })}
                />
              </label>
              <label>
                Preavviso auto-chiusura, minuti
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={categoryForm.inactivityWarningMinutes ?? ''}
                  onChange={(event) => setCategoryForm({
                    ...categoryForm,
                    inactivityWarningMinutes: nullableNumber(event.target.value)
                  })}
                />
              </label>
              <label>
                Escalation automatica, minuti
                <input
                  type="number"
                  min={1}
                  max={43200}
                  value={categoryForm.escalationMinutes ?? ''}
                  onChange={(event) => setCategoryForm({
                    ...categoryForm,
                    escalationMinutes: nullableNumber(event.target.value)
                  })}
                />
              </label>
              <label>
                Finestra riapertura utente, ore
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={categoryForm.reopenWindowHours ?? ''}
                  onChange={(event) => setCategoryForm({
                    ...categoryForm,
                    reopenWindowHours: nullableNumber(event.target.value)
                  })}
                />
              </label>
            </div>

            <ResourcePicker
              label="Ruoli escalation"
              kind="role"
              roles={roles}
              guildId={guildId}
              multiple
              value={categoryForm.escalationRoleIds}
              onChange={(escalationRoleIds) => setCategoryForm({ ...categoryForm, escalationRoleIds })}
            />

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={categoryForm.feedbackEnabled}
                onChange={(event) => setCategoryForm({
                  ...categoryForm,
                  feedbackEnabled: event.target.checked
                })}
              />
              Richiedi feedback 1-5 stelle alla chiusura
            </label>
          </fieldset>

          <fieldset>
            <legend>Transcript</legend>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={categoryForm.transcriptAutoGenerate}
                onChange={(event) => setCategoryForm({
                  ...categoryForm,
                  transcriptAutoGenerate: event.target.checked
                })}
              />
              Genera automaticamente il transcript alla chiusura
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
                  Invia il file HTML in DM all'utente che ha aperto il ticket
                </label>

                <ResourcePicker
                  label="Canale archivio transcript"
                  kind="channel"
                  channels={channels}
                  channelTypes={[CHANNEL_TYPES.text, CHANNEL_TYPES.announcement]}
                  placeholder="Non inviare in un canale"
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
              Conserva una copia cifrata lato Dispatch fino alla retention/eliminazione del ticket
            </label>

            <p className="muted">
              Attivo: la copia resta disponibile e può essere scaricata più volte dalla dashboard.
              Disattivo: il transcript generato dalla dashboard è monouso e viene eliminato dal database al primo
              download; il transcript automatico viene creato solo in memoria per l'invio e non viene salvato.
            </p>
          </fieldset>

          <button disabled={busy === 'category'} type="submit">
            {busy === 'category' ? 'Salvataggio...' : editingCategoryId ? 'Salva modifiche' : 'Crea categoria'}
          </button>
        </form>

      </section>

      <section>
        <h2>Categorie</h2>
        <div className="grid">
          {categories.map((category) => (
            <article className="card" key={category.id}>
              <h3>{category.name}</h3>
              <p>{category.description || 'Nessuna descrizione.'}</p>
              <p className="muted">
                Limite aperti: {category.maxOpenPerUser} · Cooldown: {category.openCooldownSeconds}s · Tentativi: {category.antiSpamMaxAttempts}/{category.antiSpamWindowMinutes}m
              </p>
              <p className="muted">
                SLA risposta: {category.slaFirstResponseMinutes ?? 'off'} · SLA risoluzione: {category.slaResolutionMinutes ?? 'off'} · Auto-close: {category.inactivityCloseHours ? `${category.inactivityCloseHours}h` : 'off'}
              </p>
              <p className="muted">
                Escalation: {category.escalationMinutes ? `${category.escalationMinutes} min` : 'off'} · Riapertura: {category.reopenWindowHours ? `${category.reopenWindowHours}h` : 'off'} · Feedback: {category.feedbackEnabled ? 'on' : 'off'} · Transcript: {category.transcriptAutoGenerate ? 'auto' : 'manuale'}
              </p>
              <div className="actions">
                <button className="secondary" onClick={() => editCategory(category)}>Modifica</button>
                <button
                  className="danger"
                  disabled={busy === `category:${category.id}`}
                  onClick={() => void deleteCategory(category.id)}
                >
                  Elimina
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="grid settings-grid">
        <form className="card form" onSubmit={createTemplate}>
          <h2>Nuovo template risposta</h2>
          <label>
            Nome
            <input
              required
              maxLength={80}
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
            />
          </label>
          <label>
            Messaggio
            <textarea
              required
              maxLength={2000}
              value={templateContent}
              onChange={(event) => setTemplateContent(event.target.value)}
            />
          </label>
          <button disabled={busy === 'template'} type="submit">Crea template</button>
        </form>

        <div className="card">
          <h2>Template disponibili</h2>
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
                    Elimina
                  </button>
                </div>
                <p className="muted preserve">{template.content}</p>
              </div>
            ))}
            {templates.length === 0 && <p className="muted">Nessun template configurato.</p>}
          </div>
        </div>
      </section>
    </main>
  );
}
