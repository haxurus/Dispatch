'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import ResourcePicker, { CHANNEL_TYPES, type PickerChannel } from '../../../_components/ResourcePicker';

type AccessLevel = 'VIEWER' | 'MODERATOR' | 'ADMIN' | 'OWNER';
type PanelKind = 'TICKET' | 'FORM';
type PanelStyle = 'SELECT' | 'BUTTONS';
type ButtonStyleName = 'PRIMARY' | 'SECONDARY' | 'SUCCESS' | 'DANGER';

type Category = { id: string; name: string; description: string | null; enabled: boolean };
type FormDef = { id: string; name: string; description: string | null; enabled: boolean };

type PanelAppearance = {
  id: string;
  channelId: string;
  messageId: string | null;
  title: string;
  description: string | null;
  style: string;
  placeholder: string | null;
  color: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  footerText: string | null;
  items: unknown;
  enabled: boolean;
};
type TicketPanel = PanelAppearance & { name: string; categoryIds: string[] };
type FormPanel = PanelAppearance & {
  name: string | null;
  formId: string;
  formIds: string[];
  buttonLabel: string;
  form?: { name: string };
};

type MainMenu = {
  mainMenuEnabled: boolean;
  mainMenuChannelId: string | null;
  mainMenuMessageId: string | null;
  mainMenuTitle: string;
  mainMenuCategoryIds: string[];
};

type ItemOverride = { label: string; emoji: string; description: string; buttonStyle: ButtonStyleName | '' };

type Draft = {
  kind: PanelKind;
  id: string | null;
  name: string;
  channelId: string;
  title: string;
  description: string;
  useColor: boolean;
  color: string;
  imageUrl: string;
  thumbnailUrl: string;
  footerText: string;
  enabled: boolean;
  style: PanelStyle;
  placeholder: string;
  entryIds: string[];
  overrides: Record<string, ItemOverride>;
  buttonLabel: string;
};

type Row = {
  kind: PanelKind;
  id: string;
  name: string;
  channelId: string;
  count: number;
  enabled: boolean;
  published: boolean;
  style: PanelStyle;
};

const LIMITS = {
  items: 25,
  title: 256,
  description: 4000,
  footer: 2048,
  url: 2048,
  placeholder: 150,
  buttonLabel: 80,
  selectLabel: 100,
  selectDescription: 100,
  embedTotal: 6000
};

const BUTTON_STYLES: Array<{ value: ButtonStyleName; label: string }> = [
  { value: 'PRIMARY', label: 'Primario (blu)' },
  { value: 'SECONDARY', label: 'Secondario (grigio)' },
  { value: 'SUCCESS', label: 'Successo (verde)' },
  { value: 'DANGER', label: 'Pericolo (rosso)' }
];

const CUSTOM_EMOJI = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/;
const DISCORD_IMAGE_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

const errorText: Record<string, string> = {
  INVALID_BODY: 'Alcuni campi non sono validi.',
  PANEL_CHANNEL_NOT_FOUND: 'Il canale scelto non esiste o non è un canale testuale.',
  FORM_PANEL_CHANNEL_NOT_FOUND: 'Il canale scelto non esiste o non è un canale testuale.',
  CATEGORY_NOT_FOUND: 'Una o più categorie non esistono più o sono disabilitate.',
  FORM_NOT_FOUND: 'Uno o più form non esistono più.',
  PANEL_NOT_FOUND: 'Pannello non trovato o disabilitato.',
  FORM_PANEL_NOT_FOUND: 'Pannello non trovato o disabilitato.',
  PANEL_HAS_NO_CATEGORIES: 'Il pannello non contiene categorie abilitate.',
  PANEL_TOO_MANY_CATEGORIES: 'Il pannello supera le 25 categorie.',
  PANEL_HAS_NO_ITEMS: 'Il pannello non contiene form validi.',
  PANEL_CHANNEL_INVALID: 'Il canale del pannello non è più disponibile per il bot.',
  FORM_PANEL_CHANNEL_INVALID: 'Il canale del pannello non è più disponibile per il bot.',
  GUILD_NOT_FOUND: 'Il bot non è presente nel server.',
  FORBIDDEN: 'Serve il livello Admin o Owner.'
};

const describeError = (prefix: string, body: { error?: string; reason?: string; details?: { fieldErrors?: Record<string, unknown> } }, status: number) => {
  const code = body.reason ?? body.error;
  const fields = body.details?.fieldErrors ? Object.keys(body.details.fieldErrors) : [];
  const text = (code && errorText[code]) ?? `${code ?? status}`;
  return `${prefix}: ${text}${fields.length ? ` (${fields.join(', ')})` : ''}`;
};

const hexColor = (value: number | null) =>
  value === null ? '#38bdf8' : `#${value.toString(16).padStart(6, '0')}`;

const isHttps = (value: string) => {
  if (!value) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const emptyOverride = (): ItemOverride => ({ label: '', emoji: '', description: '', buttonStyle: '' });

function parseOverrides(raw: unknown): Record<string, ItemOverride> {
  const result: Record<string, ItemOverride> = {};
  if (!Array.isArray(raw)) return result;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== 'string') continue;
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    const style = text(row.buttonStyle);
    result[row.id] = {
      label: text(row.label),
      emoji: text(row.emoji),
      description: text(row.description),
      buttonStyle: BUTTON_STYLES.some((item) => item.value === style) ? style as ButtonStyleName : ''
    };
  }
  return result;
}

function newDraft(kind: PanelKind): Draft {
  return {
    kind,
    id: null,
    name: '',
    channelId: '',
    title: kind === 'TICKET' ? 'Apri un ticket' : 'Compila il form',
    description: kind === 'TICKET' ? 'Seleziona la categoria più adatta alla tua richiesta.' : '',
    useColor: false,
    color: '#38bdf8',
    imageUrl: '',
    thumbnailUrl: '',
    footerText: '',
    enabled: true,
    style: kind === 'TICKET' ? 'SELECT' : 'BUTTONS',
    placeholder: '',
    entryIds: [],
    overrides: {},
    buttonLabel: 'Compila'
  };
}

function draftFrom(kind: PanelKind, panel: TicketPanel | FormPanel, entryIds: string[]): Draft {
  return {
    kind,
    id: panel.id,
    name: panel.name ?? '',
    channelId: panel.channelId,
    title: panel.title,
    description: panel.description ?? '',
    useColor: panel.color !== null,
    color: hexColor(panel.color),
    imageUrl: panel.imageUrl ?? '',
    thumbnailUrl: panel.thumbnailUrl ?? '',
    footerText: panel.footerText ?? '',
    enabled: panel.enabled,
    style: panel.style === 'BUTTONS' ? 'BUTTONS' : 'SELECT',
    placeholder: panel.placeholder ?? '',
    entryIds,
    overrides: parseOverrides(panel.items),
    buttonLabel: 'buttonLabel' in panel ? panel.buttonLabel : 'Compila'
  };
}

function payloadFrom(draft: Draft) {
  const items = draft.entryIds.flatMap((id) => {
    const override = draft.overrides[id];
    if (!override) return [];
    const item = {
      id,
      label: override.label.trim() || null,
      emoji: override.emoji.trim() || null,
      description: draft.style === 'SELECT' ? override.description.trim() || null : null,
      buttonStyle: draft.style === 'BUTTONS' ? override.buttonStyle || null : null
    };
    return item.label || item.emoji || item.description || item.buttonStyle ? [item] : [];
  });
  const common = {
    channelId: draft.channelId,
    title: draft.title,
    description: draft.description.trim() || null,
    style: draft.style,
    placeholder: draft.style === 'SELECT' ? draft.placeholder.trim() || null : null,
    color: draft.useColor ? Number.parseInt(draft.color.slice(1), 16) : null,
    imageUrl: draft.imageUrl.trim() || null,
    thumbnailUrl: draft.thumbnailUrl.trim() || null,
    footerText: draft.footerText.trim() || null,
    enabled: draft.enabled,
    items
  };
  return draft.kind === 'TICKET'
    ? { ...common, name: draft.name, categoryIds: draft.entryIds }
    : { ...common, name: draft.name.trim() || null, formIds: draft.entryIds, buttonLabel: draft.buttonLabel || 'Compila' };
}

function EmojiPreview({ value }: { value: string }) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const custom = CUSTOM_EMOJI.exec(trimmed);
  if (custom) {
    const extension = custom[1] === 'a' ? 'gif' : 'webp';
    return <img className="discord-emoji" src={`https://cdn.discordapp.com/emojis/${custom[3]}.${extension}?size=48`} alt={`:${custom[2]}:`} />;
  }
  return <span className="discord-emoji-text" aria-hidden="true">{trimmed}</span>;
}

function PreviewImage({ url, className, label }: { url: string; className: string; label: string }) {
  if (!url || !isHttps(url)) return null;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  // The dashboard CSP only allows Discord CDN images: other hosts get a placeholder.
  if (DISCORD_IMAGE_HOSTS.has(host)) return <img className={className} src={url} alt={label} />;
  return <div className={`${className} discord-image-placeholder`}><span>{label}</span><small className="mono">{host}</small></div>;
}

type PreviewEntry = { id: string; label: string; description: string | null; emoji: string; buttonStyle: ButtonStyleName };

function PanelPreview({ draft, entries, fallbackDescription, defaultPlaceholder }: {
  draft: Draft;
  entries: PreviewEntry[];
  fallbackDescription: string;
  defaultPlaceholder: string;
}) {
  const rows: PreviewEntry[][] = [];
  for (let index = 0; index < Math.min(entries.length, LIMITS.items); index += 5) rows.push(entries.slice(index, index + 5));
  return (
    <div className="discord-preview" aria-label="Anteprima del messaggio Discord">
      <div className="discord-message">
        <div className="discord-avatar" aria-hidden="true">D</div>
        <div className="discord-body">
          <div className="discord-author"><strong>Dispatch</strong><span className="discord-app-tag">APP</span></div>
          <div className="discord-embed" style={draft.useColor ? { borderLeftColor: draft.color } : undefined}>
            <div className="discord-embed-grid">
              <div className="discord-embed-main">
                <div className="discord-embed-title">{draft.title || 'Titolo del pannello'}</div>
                <div className="discord-embed-description">{draft.description.trim() || fallbackDescription}</div>
              </div>
              <PreviewImage url={draft.thumbnailUrl.trim()} className="discord-embed-thumbnail" label="Miniatura" />
            </div>
            <PreviewImage url={draft.imageUrl.trim()} className="discord-embed-image" label="Immagine" />
            <div className="discord-embed-footer">{draft.footerText.trim() || 'Dispatch'}</div>
          </div>
          {!entries.length && <p className="discord-hint">Aggiungi almeno un elemento per vedere i componenti.</p>}
          {entries.length > 0 && draft.style === 'SELECT' && (
            <div className="discord-select">
              <div className="discord-select-box">
                <span>{draft.placeholder.trim() || defaultPlaceholder}</span>
                <span aria-hidden="true">▾</span>
              </div>
              <ul className="discord-select-options">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <EmojiPreview value={entry.emoji} />
                    <div>
                      <strong>{entry.label}</strong>
                      {entry.description && <span>{entry.description}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {entries.length > 0 && draft.style === 'BUTTONS' && (
            <div className="discord-buttons">
              {rows.map((row, rowIndex) => (
                <div className="discord-button-row" key={rowIndex}>
                  {row.map((entry) => (
                    <span className={`discord-button discord-button-${entry.buttonStyle.toLowerCase()}`} key={entry.id}>
                      <EmojiPreview value={entry.emoji} />
                      <span>{entry.label}</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  return <small className={`field-counter${value.length > max ? ' is-over' : ''}`}>{value.length}/{max}</small>;
}

export default function PanelsPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;

  const [access, setAccess] = useState<AccessLevel | null>(null);
  const [channels, setChannels] = useState<PickerChannel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [forms, setForms] = useState<FormDef[]>([]);
  const [ticketPanels, setTicketPanels] = useState<TicketPanel[]>([]);
  const [formPanels, setFormPanels] = useState<FormPanel[]>([]);
  const [mainMenu, setMainMenu] = useState<MainMenu | null>(null);
  const [view, setView] = useState<'list' | 'choose' | 'edit'>('list');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dropped, setDropped] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isAdmin = access === 'ADMIN' || access === 'OWNER';

  const load = async () => {
    setError('');
    const accessResponse = await fetch(`/backend/api/guilds/${guildId}/access`);
    if (accessResponse.status === 401) {
      window.location.href = '/backend/auth/discord';
      return;
    }
    if (!accessResponse.ok) {
      setError('Non hai accesso a questo server oppure Discord non è raggiungibile.');
      return;
    }
    const accessData = await accessResponse.json() as { access: AccessLevel };
    setAccess(accessData.access);
    if (accessData.access !== 'ADMIN' && accessData.access !== 'OWNER') return;

    const responses = await Promise.all([
      fetch(`/backend/api/guilds/${guildId}/resources`),
      fetch(`/backend/api/guilds/${guildId}/categories`),
      fetch(`/backend/api/guilds/${guildId}/forms`),
      fetch(`/backend/api/guilds/${guildId}/panels`),
      fetch(`/backend/api/guilds/${guildId}/form-panels`),
      fetch(`/backend/api/guilds/${guildId}/ticket-system-settings`)
    ]);
    if (!responses.every((response) => response.ok)) {
      setError('Impossibile caricare i pannelli.');
      return;
    }
    const [resources, categoryRows, formRows, ticketRows, formPanelRows, settings] = await Promise.all(
      responses.map((response) => response.json())
    );
    setChannels((resources as { channels: PickerChannel[] }).channels);
    setCategories(categoryRows as Category[]);
    setForms(formRows as FormDef[]);
    setTicketPanels(ticketRows as TicketPanel[]);
    setFormPanels(formPanelRows as FormPanel[]);
    setMainMenu(settings as MainMenu);
    setLoaded(true);
  };

  useEffect(() => {
    void load();
  }, [guildId]);

  const channelName = (id: string | null) => {
    if (!id) return '—';
    const channel = channels.find((row) => row.id === id);
    return channel ? `#${channel.name}` : id;
  };

  const rows: Row[] = useMemo(() => [
    ...ticketPanels.map((panel) => ({
      kind: 'TICKET' as const,
      id: panel.id,
      name: panel.name,
      channelId: panel.channelId,
      count: panel.categoryIds.length,
      enabled: panel.enabled,
      published: Boolean(panel.messageId),
      style: panel.style === 'BUTTONS' ? 'BUTTONS' as const : 'SELECT' as const
    })),
    ...formPanels.map((panel) => {
      const ids = panel.formIds.length ? panel.formIds : [panel.formId];
      const names = ids.map((id) => forms.find((form) => form.id === id)?.name).filter(Boolean);
      return {
        kind: 'FORM' as const,
        id: panel.id,
        name: panel.name || names.join(', ') || panel.form?.name || panel.title,
        channelId: panel.channelId,
        count: ids.length,
        enabled: panel.enabled,
        published: Boolean(panel.messageId),
        style: panel.style === 'SELECT' ? 'SELECT' as const : 'BUTTONS' as const
      };
    })
  ], [ticketPanels, formPanels, forms]);

  const startNew = (kind: PanelKind) => {
    setDraft(newDraft(kind));
    setDropped(0);
    setView('edit');
    setNotice('');
    setError('');
  };

  const editPanel = (kind: PanelKind, id: string) => {
    setNotice('');
    setError('');
    if (kind === 'TICKET') {
      const panel = ticketPanels.find((row) => row.id === id);
      if (!panel) return;
      const enabledIds = new Set(categories.filter((category) => category.enabled).map((category) => category.id));
      const entryIds = panel.categoryIds.filter((categoryId) => enabledIds.has(categoryId));
      setDropped(panel.categoryIds.length - entryIds.length);
      setDraft(draftFrom('TICKET', panel, entryIds));
    } else {
      const panel = formPanels.find((row) => row.id === id);
      if (!panel) return;
      const known = new Set(forms.map((form) => form.id));
      const ids = panel.formIds.length ? panel.formIds : [panel.formId];
      const entryIds = ids.filter((formId) => known.has(formId));
      setDropped(ids.length - entryIds.length);
      setDraft(draftFrom('FORM', panel, entryIds));
    }
    setView('edit');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeEditor = () => {
    setDraft(null);
    setView('list');
  };

  const basePath = (kind: PanelKind) =>
    `/backend/api/guilds/${guildId}/${kind === 'TICKET' ? 'panels' : 'form-panels'}`;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setError('');
    setNotice('');
    if (!draft.entryIds.length) {
      setError(draft.kind === 'TICKET' ? 'Scegli almeno una categoria.' : 'Scegli almeno un form.');
      return;
    }
    if (!draft.channelId) {
      setError('Scegli il canale in cui pubblicare il pannello.');
      return;
    }
    if (!isHttps(draft.imageUrl.trim()) || !isHttps(draft.thumbnailUrl.trim())) {
      setError('Immagine e miniatura devono essere URL https.');
      return;
    }
    setBusy('save');
    try {
      const response = await fetch(draft.id ? `${basePath(draft.kind)}/${draft.id}` : basePath(draft.kind), {
        method: draft.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFrom(draft))
      });
      if (!response.ok) {
        setError(describeError('Salvataggio fallito', await response.json().catch(() => ({})), response.status));
        return;
      }
      setNotice(draft.id
        ? 'Pannello aggiornato. Usa "Aggiorna su Discord" per applicare le modifiche al messaggio.'
        : 'Pannello creato. Ora puoi pubblicarlo su Discord.');
      closeEditor();
      await load();
    } finally {
      setBusy('');
    }
  };

  const publish = async (row: Row) => {
    setBusy(`publish:${row.id}`);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${basePath(row.kind)}/${row.id}/publish`, { method: 'POST' });
      if (!response.ok) {
        setError(describeError('Pubblicazione fallita', await response.json().catch(() => ({})), response.status));
        return;
      }
      setNotice(row.published ? 'Messaggio aggiornato su Discord.' : 'Pannello pubblicato su Discord.');
      await load();
    } finally {
      setBusy('');
    }
  };

  const remove = async (row: Row) => {
    const confirmed = window.confirm(
      `Eliminare il pannello "${row.name}"? Il messaggio già pubblicato su Discord non viene rimosso e smetterà di funzionare.`
    );
    if (!confirmed) return;
    setBusy(`delete:${row.id}`);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${basePath(row.kind)}/${row.id}`, { method: 'DELETE' });
      if (!response.ok) {
        setError(describeError('Eliminazione fallita', await response.json().catch(() => ({})), response.status));
        return;
      }
      setNotice('Pannello eliminato.');
      await load();
    } finally {
      setBusy('');
    }
  };

  if (access && !isAdmin) {
    return (
      <main className="shell">
        <section className="card">
          <p className="eyebrow">Pannelli</p>
          <h1>Accesso riservato</h1>
          <p>La gestione dei pannelli Discord richiede il livello Admin o Owner del server.</p>
          <a className="button secondary" href={`/dashboard/${guildId}`}>Torna alla panoramica</a>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">Dispatch</p>
          <h1>Pannelli</h1>
          <p className="muted">Messaggi Discord da cui gli utenti aprono ticket o compilano form.</p>
        </div>
        <div className="actions">
          {view === 'list' && (
            <button type="button" disabled={!loaded} onClick={() => { setView('choose'); setNotice(''); setError(''); }}>
              Nuovo pannello
            </button>
          )}
          {view !== 'list' && <button type="button" className="secondary" onClick={closeEditor}>Torna all’elenco</button>}
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}

      {view === 'list' && (
        <>
          {mainMenu && (
            <section className="card panel-menu-card">
              <div className="row">
                <div>
                  <span className="tag tag-accent">Menu principale</span>
                  <h2>{mainMenu.mainMenuTitle}</h2>
                  <p className="muted">
                    {mainMenu.mainMenuEnabled ? 'Abilitato' : 'Disabilitato'} · {channelName(mainMenu.mainMenuChannelId)} ·{' '}
                    {mainMenu.mainMenuCategoryIds.length} richieste · {mainMenu.mainMenuMessageId ? 'Pubblicato' : 'Non pubblicato'}
                  </p>
                  <p className="muted">Pulsante unico con selettore privato: si configura in Sistema e menu.</p>
                </div>
                <a className="button secondary" href={`/dashboard/${guildId}/tickets/system`}>Apri Sistema e menu</a>
              </div>
            </section>
          )}

          <section>
            <h2>Pannelli configurati</h2>
            {loaded && !rows.length && <div className="card muted">Nessun pannello configurato. Crea il primo con “Nuovo pannello”.</div>}
            {rows.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Nome</th>
                      <th>Canale</th>
                      <th>Elementi</th>
                      <th>Stato</th>
                      <th>Discord</th>
                      <th><span className="visually-hidden">Azioni</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.kind}:${row.id}`}>
                        <td>
                          <span className={`tag ${row.kind === 'TICKET' ? 'tag-accent' : 'tag-info'}`}>
                            {row.kind === 'TICKET' ? 'Ticket' : 'Form'}
                          </span>
                        </td>
                        <td className="panel-name-cell">
                          <strong>{row.name}</strong>
                          <small className="muted">{row.style === 'BUTTONS' ? 'Pulsanti' : 'Menu a tendina'}</small>
                        </td>
                        <td>{channelName(row.channelId)}</td>
                        <td className="mono">{row.count}</td>
                        <td>
                          <span className={`state ${row.enabled ? 'state-ok' : 'state-warn'}`}>{row.enabled ? 'Attivo' : 'Disattivo'}</span>
                        </td>
                        <td>
                          <span className={`state ${row.published ? 'state-info' : 'state-warn'}`}>{row.published ? 'Pubblicato' : 'Non pubblicato'}</span>
                        </td>
                        <td>
                          <div className="actions panel-row-actions">
                            <button type="button" className="secondary" onClick={() => editPanel(row.kind, row.id)}>Modifica</button>
                            <button
                              type="button"
                              disabled={!row.enabled || busy === `publish:${row.id}`}
                              title={row.enabled ? undefined : 'Abilita il pannello per pubblicarlo'}
                              onClick={() => void publish(row)}
                            >
                              {busy === `publish:${row.id}` ? 'Invio…' : row.published ? 'Aggiorna su Discord' : 'Pubblica'}
                            </button>
                            <button
                              type="button"
                              className="danger"
                              disabled={busy === `delete:${row.id}`}
                              onClick={() => void remove(row)}
                            >
                              Elimina
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {view === 'choose' && (
        <section>
          <h2>Che tipo di pannello vuoi creare?</h2>
          <div className="panel-kind-grid">
            <button type="button" className="panel-kind" onClick={() => startNew('TICKET')}>
              <span className="tag tag-accent">Ticket</span>
              <strong>Pannello ticket</strong>
              <span>Gli utenti scelgono una categoria e aprono un ticket privato, con eventuali domande iniziali.</span>
            </button>
            <button type="button" className="panel-kind" onClick={() => startNew('FORM')} disabled={!forms.length}>
              <span className="tag tag-info">Form</span>
              <strong>Pannello form</strong>
              <span>{forms.length
                ? 'Gli utenti scelgono e compilano uno dei form inclusi (candidature, segnalazioni...).'
                : 'Crea prima almeno un form nella sezione Form.'}</span>
            </button>
          </div>
        </section>
      )}

      {view === 'edit' && draft && (
        <PanelEditor
          draft={draft}
          setDraft={setDraft}
          dropped={dropped}
          channels={channels}
          categories={categories}
          forms={forms}
          busy={busy === 'save'}
          onSubmit={save}
          onCancel={closeEditor}
        />
      )}
    </main>
  );
}

function PanelEditor({ draft, setDraft, dropped, channels, categories, forms, busy, onSubmit, onCancel }: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  dropped: number;
  channels: PickerChannel[];
  categories: Category[];
  forms: FormDef[];
  busy: boolean;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  const ticket = draft.kind === 'TICKET';
  const update = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const available = ticket
    ? categories.filter((category) => category.enabled).map((category) => ({ id: category.id, name: category.name, hint: category.description }))
    : forms.map((form) => ({ id: form.id, name: form.name, hint: form.enabled ? null : 'Disabilitato' }));
  const sourceRows: Array<{ id: string; name: string; description: string | null }> = ticket ? categories : forms;
  const lookup = new Map(sourceRows.map((row) => [row.id, { name: row.name, description: row.description }]));
  const labelMax = draft.style === 'BUTTONS' ? LIMITS.buttonLabel : LIMITS.selectLabel;
  const single = !ticket && draft.entryIds.length === 1;

  const defaultLabel = (id: string) => {
    if (!ticket && draft.style === 'BUTTONS' && single) return draft.buttonLabel || 'Compila';
    return lookup.get(id)?.name ?? id;
  };

  const entries: PreviewEntry[] = draft.entryIds.map((id) => {
    const override = draft.overrides[id] ?? emptyOverride();
    return {
      id,
      label: (override.label.trim() || defaultLabel(id)).slice(0, labelMax),
      description: (override.description.trim() || lookup.get(id)?.description || '').slice(0, LIMITS.selectDescription) || null,
      emoji: override.emoji,
      buttonStyle: override.buttonStyle || 'PRIMARY'
    };
  });

  const setOverride = (id: string, patch: Partial<ItemOverride>) => update({
    overrides: { ...draft.overrides, [id]: { ...(draft.overrides[id] ?? emptyOverride()), ...patch } }
  });

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= draft.entryIds.length) return;
    const entryIds = [...draft.entryIds];
    [entryIds[index], entryIds[target]] = [entryIds[target]!, entryIds[index]!];
    update({ entryIds });
  };

  const fallbackDescription = ticket
    ? (draft.style === 'BUTTONS' ? 'Premi il pulsante del tipo di ticket da aprire.' : 'Seleziona il tipo di ticket da aprire.')
    : ((single ? lookup.get(draft.entryIds[0]!)?.description : null)
      || (draft.style === 'SELECT' ? 'Scegli il form da compilare.' : 'Premi il pulsante per compilare il form.'));
  const embedLength = draft.title.length + (draft.description.trim() || '').length + (draft.footerText.trim() || 'Dispatch').length;

  return (
    <form className="panel-editor" onSubmit={onSubmit}>
      <div className="panel-editor-fields">
        <section className="card form">
          <div className="row">
            <h2>{draft.id ? 'Modifica pannello' : 'Nuovo pannello'}</h2>
            <span className={`tag ${ticket ? 'tag-accent' : 'tag-info'}`}>{ticket ? 'Ticket' : 'Form'}</span>
          </div>
          {dropped > 0 && (
            <p className="notice notice-warn">
              {dropped} {ticket ? 'categorie disabilitate o eliminate sono state rimosse' : 'form eliminati sono stati rimossi'} dalla
              selezione: salva per aggiornare il pannello.
            </p>
          )}
          <label>
            Nome interno {ticket ? '' : '(facoltativo)'}
            <input
              required={ticket}
              maxLength={80}
              value={draft.name}
              placeholder={ticket ? 'Es. Supporto generale' : 'Predefinito: nomi dei form'}
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>
          <ResourcePicker
            label="Canale"
            kind="channel"
            channels={channels}
            channelTypes={[CHANNEL_TYPES.text, CHANNEL_TYPES.announcement]}
            placeholder="Cerca un canale testuale…"
            required
            value={draft.channelId}
            onChange={(channelId) => update({ channelId })}
            hint={draft.id ? 'Cambiando canale verrà pubblicato un nuovo messaggio; il vecchio va rimosso a mano.' : undefined}
          />
          <label className="checkbox-row">
            <input type="checkbox" checked={draft.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
            Pannello attivo (un pannello disattivato non risponde e non può essere pubblicato)
          </label>
        </section>

        <section className="card form">
          <h2>Embed</h2>
          <label>
            <span className="field-head">Titolo <Counter value={draft.title} max={LIMITS.title} /></span>
            <input required maxLength={LIMITS.title} value={draft.title} onChange={(event) => update({ title: event.target.value })} />
          </label>
          <label>
            <span className="field-head">Descrizione <Counter value={draft.description} max={LIMITS.description} /></span>
            <textarea
              maxLength={LIMITS.description}
              value={draft.description}
              placeholder={fallbackDescription}
              onChange={(event) => update({ description: event.target.value })}
            />
          </label>
          <div className="inline-fields">
            <label className="checkbox-row">
              <input type="checkbox" checked={draft.useColor} onChange={(event) => update({ useColor: event.target.checked })} />
              Colore laterale
            </label>
            <label>
              Colore
              <input
                type="color"
                value={draft.color}
                disabled={!draft.useColor}
                onChange={(event) => update({ color: event.target.value, useColor: true })}
              />
            </label>
          </div>
          <label>
            URL immagine (https)
            <input
              type="url"
              maxLength={LIMITS.url}
              value={draft.imageUrl}
              placeholder="https://..."
              aria-invalid={!isHttps(draft.imageUrl.trim()) || undefined}
              onChange={(event) => update({ imageUrl: event.target.value })}
            />
          </label>
          <label>
            URL miniatura (https)
            <input
              type="url"
              maxLength={LIMITS.url}
              value={draft.thumbnailUrl}
              placeholder="https://..."
              aria-invalid={!isHttps(draft.thumbnailUrl.trim()) || undefined}
              onChange={(event) => update({ thumbnailUrl: event.target.value })}
            />
          </label>
          <label>
            <span className="field-head">Footer <Counter value={draft.footerText} max={LIMITS.footer} /></span>
            <input
              maxLength={LIMITS.footer}
              value={draft.footerText}
              placeholder="Dispatch"
              onChange={(event) => update({ footerText: event.target.value })}
            />
          </label>
          {embedLength > LIMITS.embedTotal && (
            <p className="notice notice-error">Titolo, descrizione e footer superano i 6000 caratteri consentiti da Discord.</p>
          )}
        </section>

        <section className="card form">
          <h2>Interazione</h2>
          <div className="segmented" role="radiogroup" aria-label="Stile del pannello">
            {(['SELECT', 'BUTTONS'] as const).map((style) => (
              <label className={`segmented-option${draft.style === style ? ' is-active' : ''}`} key={style}>
                <input
                  type="radio"
                  name="panel-style"
                  value={style}
                  checked={draft.style === style}
                  onChange={() => update({ style })}
                />
                {style === 'SELECT' ? 'Menu a tendina' : 'Pulsanti'}
              </label>
            ))}
          </div>
          {draft.style === 'SELECT' ? (
            <label>
              <span className="field-head">Testo segnaposto del menu <Counter value={draft.placeholder} max={LIMITS.placeholder} /></span>
              <input
                maxLength={LIMITS.placeholder}
                value={draft.placeholder}
                placeholder={ticket ? 'Seleziona una categoria' : 'Scegli un form'}
                onChange={(event) => update({ placeholder: event.target.value })}
              />
            </label>
          ) : (
            <p className="muted">Un pulsante per elemento, 5 per riga, fino a 25.</p>
          )}
          {!ticket && draft.style === 'BUTTONS' && single && (
            <label>
              Testo del pulsante (se non personalizzato sotto)
              <input
                required
                maxLength={LIMITS.buttonLabel}
                value={draft.buttonLabel}
                onChange={(event) => update({ buttonLabel: event.target.value })}
              />
            </label>
          )}
        </section>

        <section className="card form">
          <h2>{ticket ? 'Categorie' : 'Form'}</h2>
          <ResourcePicker
            label={ticket ? 'Categorie incluse (solo abilitate)' : 'Form inclusi'}
            kind="item"
            items={available}
            multiple
            max={LIMITS.items}
            hint={`Massimo ${LIMITS.items}. Usa le frecce per cambiare l'ordine.`}
            value={draft.entryIds}
            onChange={(entryIds) => update({ entryIds })}
          />
          <ol className="panel-items">
            {draft.entryIds.map((id, index) => {
              const override = draft.overrides[id] ?? emptyOverride();
              const name = lookup.get(id)?.name ?? id;
              return (
                <li className="subcard panel-item" key={id}>
                  <div className="row">
                    <strong><span className="mono muted">{index + 1}.</span> {name}</strong>
                    <div className="actions">
                      <button type="button" className="secondary button-sm" aria-label={`Sposta su ${name}`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                      <button type="button" className="secondary button-sm" aria-label={`Sposta giù ${name}`} disabled={index === draft.entryIds.length - 1} onClick={() => move(index, 1)}>↓</button>
                      <button
                        type="button"
                        className="danger button-sm"
                        onClick={() => update({ entryIds: draft.entryIds.filter((entryId) => entryId !== id) })}
                      >
                        Rimuovi
                      </button>
                    </div>
                  </div>
                  <div className="panel-item-fields">
                    <label>
                      Etichetta
                      <input
                        maxLength={labelMax}
                        value={override.label}
                        placeholder={defaultLabel(id).slice(0, labelMax)}
                        onChange={(event) => setOverride(id, { label: event.target.value })}
                      />
                    </label>
                    <label>
                      Emoji
                      <input
                        maxLength={64}
                        value={override.emoji}
                        placeholder="🎫 oppure <:nome:id>"
                        onChange={(event) => setOverride(id, { emoji: event.target.value })}
                      />
                    </label>
                    {draft.style === 'SELECT' ? (
                      <label className="panel-item-wide">
                        Descrizione
                        <input
                          maxLength={LIMITS.selectDescription}
                          value={override.description}
                          placeholder={(lookup.get(id)?.description ?? '').slice(0, LIMITS.selectDescription) || 'Nessuna'}
                          onChange={(event) => setOverride(id, { description: event.target.value })}
                        />
                      </label>
                    ) : (
                      <label>
                        Stile pulsante
                        <select
                          value={override.buttonStyle}
                          onChange={(event) => setOverride(id, { buttonStyle: event.target.value as ButtonStyleName | '' })}
                        >
                          <option value="">Predefinito (primario)</option>
                          {BUTTON_STYLES.map((style) => <option value={style.value} key={style.value}>{style.label}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {!draft.entryIds.length && <p className="muted">Nessun elemento selezionato.</p>}
        </section>

        <div className="actions">
          <button type="submit" disabled={busy}>{busy ? 'Salvataggio…' : draft.id ? 'Salva modifiche' : 'Crea pannello'}</button>
          <button type="button" className="secondary" onClick={onCancel}>Annulla</button>
        </div>
      </div>

      <aside className="panel-editor-preview">
        <p className="eyebrow">Anteprima</p>
        <PanelPreview
          draft={draft}
          entries={entries}
          fallbackDescription={fallbackDescription}
          defaultPlaceholder={ticket ? 'Seleziona una categoria' : 'Scegli un form'}
        />
        <p className="muted panel-preview-note">
          Anteprima indicativa: Discord applica il proprio rendering. Le immagini esterne non sono caricate qui per la
          Content Security Policy della dashboard.
        </p>
      </aside>
    </form>
  );
}
