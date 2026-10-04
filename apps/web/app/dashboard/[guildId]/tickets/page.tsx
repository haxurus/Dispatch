'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

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
};

type FormField = {
  id: string;
  label: string;
  style: 'SHORT' | 'PARAGRAPH';
  required: boolean;
  placeholder: string | null;
  minLength: number | null;
  maxLength: number | null;
};

type Category = {
  id: string;
  name: string;
  description: string | null;
  discordCategoryId: string | null;
  staffRoleIds: string[];
  maxOpenPerUser: number;
  formFields: FormField[];
  slaFirstResponseMinutes: number | null;
  slaResolutionMinutes: number | null;
  inactivityCloseHours: number | null;
  inactivityWarningMinutes: number | null;
  enabled: boolean;
};

type Panel = {
  id: string;
  name: string;
  channelId: string;
  messageId: string | null;
  title: string;
  description: string | null;
  categoryIds: string[];
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
  formFields: [] as FormField[],
  slaFirstResponseMinutes: null as number | null,
  slaResolutionMinutes: null as number | null,
  inactivityCloseHours: null as number | null,
  inactivityWarningMinutes: null as number | null,
  enabled: true
});

const emptyPanel = {
  name: '',
  channelId: '',
  title: 'Apri un ticket',
  description: 'Seleziona la categoria più adatta alla tua richiesta.',
  categoryIds: [] as string[],
  enabled: true
};

function nullableNumber(value: string) {
  return value === '' ? null : Number(value);
}

export default function TicketConfigurationPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;

  const [access, setAccess] = useState<AccessLevel | null>(null);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [templates, setTemplates] = useState<ResponseTemplate[]>([]);
  const [categoryForm, setCategoryForm] = useState(newCategory);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [panelForm, setPanelForm] = useState(emptyPanel);
  const [templateName, setTemplateName] = useState('');
  const [templateContent, setTemplateContent] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setError('');

    const [accessResponse, resourcesResponse, categoriesResponse, panelsResponse, templatesResponse] = await Promise.all([
      fetch(`/backend/api/guilds/${guildId}/access`),
      fetch(`/backend/api/guilds/${guildId}/resources`),
      fetch(`/backend/api/guilds/${guildId}/categories`),
      fetch(`/backend/api/guilds/${guildId}/panels`),
      fetch(`/backend/api/guilds/${guildId}/response-templates`)
    ]);

    if (accessResponse.status === 401) {
      window.location.href = '/backend/auth/discord';
      return;
    }

    if (![accessResponse, resourcesResponse, categoriesResponse, panelsResponse, templatesResponse].every((response) => response.ok)) {
      setError('Impossibile caricare la configurazione ticket.');
      return;
    }

    const accessData = await accessResponse.json();
    const resources = await resourcesResponse.json();

    setAccess(accessData.access);
    setChannels(resources.channels);
    setRoles(resources.roles);
    setCategories(await categoriesResponse.json());
    setPanels(await panelsResponse.json());
    setTemplates(await templatesResponse.json());
  };

  useEffect(() => {
    void load();
  }, [guildId]);

  const resetCategory = () => {
    setCategoryForm(newCategory());
    setEditingCategoryId(null);
  };

  const editCategory = (category: Category) => {
    setEditingCategoryId(category.id);
    setCategoryForm({
      name: category.name,
      description: category.description ?? '',
      discordCategoryId: category.discordCategoryId ?? '',
      staffRoleIds: category.staffRoleIds,
      maxOpenPerUser: category.maxOpenPerUser,
      formFields: category.formFields ?? [],
      slaFirstResponseMinutes: category.slaFirstResponseMinutes,
      slaResolutionMinutes: category.slaResolutionMinutes,
      inactivityCloseHours: category.inactivityCloseHours,
      inactivityWarningMinutes: category.inactivityWarningMinutes,
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
          description: categoryForm.description || null,
          discordCategoryId: categoryForm.discordCategoryId || null
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
          required: true,
          placeholder: null,
          minLength: null,
          maxLength: 1000
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
    setCategoryForm({
      ...categoryForm,
      formFields: categoryForm.formFields.filter((_, current) => current !== index)
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
          : `Eliminazione categoria fallita: ${body.error ?? response.status}`);
        return;
      }

      setNotice('Categoria eliminata.');
      await load();
    } finally {
      setBusy('');
    }
  };

  const createPanel = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('panel');
    setError('');
    setNotice('');

    try {
      const response = await fetch(`/backend/api/guilds/${guildId}/panels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...panelForm,
          description: panelForm.description || null
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(`Creazione pannello fallita: ${body.error ?? response.status}`);
        return;
      }

      setPanelForm(emptyPanel);
      setNotice('Pannello creato. Ora puoi pubblicarlo su Discord.');
      await load();
    } finally {
      setBusy('');
    }
  };

  const publish = async (panelId: string) => {
    setBusy(`publish:${panelId}`);
    setError('');
    setNotice('');

    try {
      const response = await fetch(`/backend/api/guilds/${guildId}/panels/${panelId}/publish`, {
        method: 'POST'
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(`Pubblicazione fallita: ${body.error ?? response.status}`);
        return;
      }

      setNotice('Pannello pubblicato o aggiornato su Discord.');
      await load();
    } finally {
      setBusy('');
    }
  };

  const deletePanel = async (panelId: string) => {
    setBusy(`panel:${panelId}`);
    setError('');
    setNotice('');

    try {
      const response = await fetch(`/backend/api/guilds/${guildId}/panels/${panelId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(`Eliminazione pannello fallita: ${body.error ?? response.status}`);
        return;
      }

      setNotice('Pannello eliminato dalla configurazione.');
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

  const categoryChannels = channels.filter((channel) => channel.type === 4);
  const textChannels = channels.filter((channel) => channel.type === 0 || channel.type === 5);

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">Dispatch</p>
          <h1>Configurazione ticket</h1>
          <p className="muted">Categorie, form, SLA, automazioni e pannelli di apertura.</p>
        </div>
        <div className="actions">
          <a className="button" href={`/dashboard/${guildId}/tickets/manage`}>Gestisci ticket</a>
          <a className="button secondary" href={`/dashboard/${guildId}`}>Permessi dashboard</a>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <section className="grid settings-grid">
        <form className="card form" onSubmit={saveCategory}>
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

          <label>
            Categoria Discord
            <select
              value={categoryForm.discordCategoryId}
              onChange={(event) => setCategoryForm({ ...categoryForm, discordCategoryId: event.target.value })}
            >
              <option value="">Nessuna</option>
              {categoryChannels.map((channel) => (
                <option value={channel.id} key={channel.id}>{channel.name}</option>
              ))}
            </select>
          </label>

          <label>
            Ruoli staff
            <select
              multiple
              value={categoryForm.staffRoleIds}
              onChange={(event) => setCategoryForm({
                ...categoryForm,
                staffRoleIds: [...event.target.selectedOptions].map((option) => option.value)
              })}
            >
              {roles
                .filter((role) => role.id !== guildId)
                .map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}
            </select>
          </label>

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
                      value={field.style}
                      onChange={(event) => updateFormField(index, { style: event.target.value as 'SHORT' | 'PARAGRAPH' })}
                    >
                      <option value="SHORT">Risposta breve</option>
                      <option value="PARAGRAPH">Paragrafo</option>
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
            </div>
          </fieldset>

          <button disabled={busy === 'category'} type="submit">
            {busy === 'category' ? 'Salvataggio...' : editingCategoryId ? 'Salva modifiche' : 'Crea categoria'}
          </button>
        </form>

        <form className="card form" onSubmit={createPanel}>
          <h2>Nuovo pannello</h2>

          <label>
            Nome interno
            <input
              required
              maxLength={80}
              value={panelForm.name}
              onChange={(event) => setPanelForm({ ...panelForm, name: event.target.value })}
            />
          </label>

          <label>
            Canale Discord
            <select
              required
              value={panelForm.channelId}
              onChange={(event) => setPanelForm({ ...panelForm, channelId: event.target.value })}
            >
              <option value="">Seleziona...</option>
              {textChannels.map((channel) => (
                <option value={channel.id} key={channel.id}>#{channel.name}</option>
              ))}
            </select>
          </label>

          <label>
            Titolo
            <input
              required
              maxLength={256}
              value={panelForm.title}
              onChange={(event) => setPanelForm({ ...panelForm, title: event.target.value })}
            />
          </label>

          <label>
            Descrizione
            <textarea
              maxLength={2000}
              value={panelForm.description}
              onChange={(event) => setPanelForm({ ...panelForm, description: event.target.value })}
            />
          </label>

          <label>
            Categorie disponibili
            <select
              required
              multiple
              value={panelForm.categoryIds}
              onChange={(event) => setPanelForm({
                ...panelForm,
                categoryIds: [...event.target.selectedOptions].map((option) => option.value)
              })}
            >
              {categories
                .filter((category) => category.enabled)
                .map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
            </select>
          </label>

          <button disabled={busy === 'panel'} type="submit">
            {busy === 'panel' ? 'Creazione...' : 'Crea pannello'}
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
                Limite: {category.maxOpenPerUser} · Domande: {category.formFields?.length ?? 0} · Ruoli staff: {category.staffRoleIds.length}
              </p>
              <p className="muted">
                SLA risposta: {category.slaFirstResponseMinutes ?? 'off'} · SLA risoluzione: {category.slaResolutionMinutes ?? 'off'} · Auto-close: {category.inactivityCloseHours ? `${category.inactivityCloseHours}h` : 'off'}
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

      <section>
        <h2>Pannelli</h2>
        <div className="grid">
          {panels.map((panel) => (
            <article className="card" key={panel.id}>
              <h3>{panel.name}</h3>
              <p>{panel.title}</p>
              <p className="muted">
                Categorie: {panel.categoryIds.length} · {panel.messageId ? 'Pubblicato' : 'Non pubblicato'}
              </p>
              <div className="actions">
                <button
                  disabled={busy === `publish:${panel.id}`}
                  onClick={() => void publish(panel.id)}
                >
                  {panel.messageId ? 'Aggiorna su Discord' : 'Pubblica su Discord'}
                </button>
                <button
                  className="danger"
                  disabled={busy === `panel:${panel.id}`}
                  onClick={() => void deletePanel(panel.id)}
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
