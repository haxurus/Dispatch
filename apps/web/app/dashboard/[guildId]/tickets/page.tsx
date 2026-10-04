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

type Category = {
  id: string;
  name: string;
  description: string | null;
  discordCategoryId: string | null;
  staffRoleIds: string[];
  maxOpenPerUser: number;
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

const emptyCategory = {
  name: '',
  description: '',
  discordCategoryId: '',
  staffRoleIds: [] as string[],
  maxOpenPerUser: 1,
  enabled: true
};

const emptyPanel = {
  name: '',
  channelId: '',
  title: 'Apri un ticket',
  description: 'Seleziona la categoria più adatta alla tua richiesta.',
  categoryIds: [] as string[],
  enabled: true
};

export default function TicketConfigurationPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;

  const [access, setAccess] = useState<AccessLevel | null>(null);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [categoryForm, setCategoryForm] = useState(emptyCategory);
  const [panelForm, setPanelForm] = useState(emptyPanel);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setError('');

    const [accessResponse, resourcesResponse, categoriesResponse, panelsResponse] = await Promise.all([
      fetch(`/backend/api/guilds/${guildId}/access`),
      fetch(`/backend/api/guilds/${guildId}/resources`),
      fetch(`/backend/api/guilds/${guildId}/categories`),
      fetch(`/backend/api/guilds/${guildId}/panels`)
    ]);

    if (accessResponse.status === 401) {
      window.location.href = '/backend/auth/discord';
      return;
    }

    if (![accessResponse, resourcesResponse, categoriesResponse, panelsResponse].every((response) => response.ok)) {
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
  };

  useEffect(() => {
    void load();
  }, [guildId]);

  const createCategory = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('category');
    setError('');
    setNotice('');

    try {
      const response = await fetch(`/backend/api/guilds/${guildId}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...categoryForm,
          description: categoryForm.description || null,
          discordCategoryId: categoryForm.discordCategoryId || null
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(`Creazione categoria fallita: ${body.error ?? response.status}`);
        return;
      }

      setCategoryForm(emptyCategory);
      setNotice('Categoria creata.');
      await load();
    } finally {
      setBusy('');
    }
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
          <p className="muted">Categorie, staff e pannelli di apertura.</p>
        </div>
        <a className="button secondary" href={`/dashboard/${guildId}`}>Permessi dashboard</a>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <section className="grid settings-grid">
        <form className="card form" onSubmit={createCategory}>
          <h2>Nuova categoria ticket</h2>

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

          <button disabled={busy === 'category'} type="submit">
            {busy === 'category' ? 'Creazione...' : 'Crea categoria'}
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
                Limite: {category.maxOpenPerUser} • Ruoli staff: {category.staffRoleIds.length}
              </p>
              <button
                className="danger"
                disabled={busy === `category:${category.id}`}
                onClick={() => void deleteCategory(category.id)}
              >
                Elimina
              </button>
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
                Categorie: {panel.categoryIds.length} • {panel.messageId ? 'Pubblicato' : 'Non pubblicato'}
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
    </main>
  );
}
