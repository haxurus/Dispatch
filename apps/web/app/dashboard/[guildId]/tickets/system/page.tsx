'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ResourcePicker, { CHANNEL_TYPES } from '../../../../_components/ResourcePicker';

type Channel = {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
  position: number;
};

type Category = {
  id: string;
  name: string;
  enabled: boolean;
};

type Settings = {
  antiSpamEnabled: boolean;
  antiSpamGlobalCooldownSeconds: number;
  antiSpamWindowMinutes: number;
  antiSpamMaxAttempts: number;
  antiSpamBlockMinutes: number;
  transcriptRetentionDays: number | null;
  closedTicketRetentionDays: number | null;
  retentionDeleteDiscordChannel: boolean;
  mainMenuEnabled: boolean;
  mainMenuChannelId: string | null;
  mainMenuMessageId: string | null;
  mainMenuTitle: string;
  mainMenuDescription: string;
  mainMenuButtonLabel: string;
  mainMenuCategoryIds: string[];
  ticketLogChannelId: string | null;
  ticketLogEvents: string[];
};

// Event keys, labels and descriptions are defined once in @dispatch/shared
// and served by the API together with the settings.
type LogEventInfo = { key: string; label: string; description: string };

const logTestErrors: Record<string, string> = {
  TICKET_LOG_CHANNEL_REQUIRED: 'Seleziona un canale log prima di inviare il messaggio di prova.',
  TICKET_LOG_CHANNEL_INVALID: 'Il canale log non esiste più oppure non è un canale testuale o di annunci di questo server.',
  TICKET_LOG_SEND_FAILED: 'Discord ha rifiutato il messaggio: controlla che il bot possa vedere il canale, scrivere e inviare embed.',
  GUILD_NOT_FOUND: 'Il bot non è presente nel server.'
};

const saveErrors: Record<string, string> = {
  TICKET_LOG_CHANNEL_NOT_FOUND: 'Il canale log selezionato non è un canale testuale o di annunci del server.',
  MAIN_MENU_CHANNEL_NOT_FOUND: 'Il canale del menu principale non è un canale testuale o di annunci del server.'
};

function nullableNumber(value: string) {
  return value === '' ? null : Number(value);
}

export default function TicketSystemPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;

  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [logCatalog, setLogCatalog] = useState<LogEventInfo[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setError('');
    const [settingsResponse, resourcesResponse, categoriesResponse] = await Promise.all([
      fetch(`/backend/api/guilds/${guildId}/ticket-system-settings`),
      fetch(`/backend/api/guilds/${guildId}/resources`),
      fetch(`/backend/api/guilds/${guildId}/categories`)
    ]);

    if (settingsResponse.status === 401) {
      window.location.href = '/backend/auth/discord';
      return;
    }

    if (!settingsResponse.ok || !resourcesResponse.ok || !categoriesResponse.ok) {
      setError(settingsResponse.status === 403
        ? 'Questa pagina richiede il livello Admin o Owner.'
        : 'Impossibile caricare le impostazioni di sistema.');
      return;
    }

    const resources = await resourcesResponse.json();
    setChannels(resources.channels);
    setCategories(await categoriesResponse.json());
    applySettings(await settingsResponse.json());
  };

  // The catalogue travels with the settings but is never sent back.
  const applySettings = (body: Settings & { ticketLogEventCatalog?: LogEventInfo[] }) => {
    const { ticketLogEventCatalog, ...rest } = body;
    if (ticketLogEventCatalog) setLogCatalog(ticketLogEventCatalog);
    setSettings({ ...rest, ticketLogEvents: rest.ticketLogEvents ?? [], ticketLogChannelId: rest.ticketLogChannelId ?? null });
  };

  const putSettings = async (current: Settings) => {
    const response = await fetch(
      `/backend/api/guilds/${guildId}/ticket-system-settings`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current)
      }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(saveErrors[body.error] ?? `Salvataggio fallito: ${body.error ?? response.status}`);
      return false;
    }
    applySettings(await response.json());
    return true;
  };

  useEffect(() => {
    void load();
  }, [guildId]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings) return;

    setBusy('save');
    setError('');
    setNotice('');

    try {
      if (await putSettings(settings)) setNotice('Impostazioni salvate.');
    } finally {
      setBusy('');
    }
  };

  // Saves first, so the test always uses what the page shows.
  const sendLogTest = async () => {
    if (!settings) return;

    setBusy('log-test');
    setError('');
    setNotice('');

    try {
      if (!(await putSettings(settings))) return;
      const response = await fetch(`/backend/api/guilds/${guildId}/ticket-log/test`, { method: 'POST' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(logTestErrors[body.error] ?? `Invio di prova fallito: ${body.error ?? response.status}`);
        return;
      }
      setNotice('Impostazioni salvate e messaggio di prova inviato nel canale log.');
    } finally {
      setBusy('');
    }
  };

  const toggleLogEvent = (key: string, checked: boolean) => {
    if (!settings) return;
    const selected = new Set(settings.ticketLogEvents);
    if (checked) selected.add(key);
    else selected.delete(key);
    setSettings({
      ...settings,
      ticketLogEvents: logCatalog.map((event) => event.key).filter((event) => selected.has(event))
    });
  };

  const publish = async () => {
    if (!settings) return;

    setBusy('publish');
    setError('');
    setNotice('');

    try {
      if (!(await putSettings(settings))) return;

      const response = await fetch(
        `/backend/api/guilds/${guildId}/main-menu/publish`,
        { method: 'POST' }
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(`Pubblicazione menu fallita: ${body.error ?? response.status}`);
        return;
      }

      await load();
      setNotice('Menu principale pubblicato o aggiornato su Discord.');
    } finally {
      setBusy('');
    }
  };

  if (!settings) {
    return (
      <main className="shell">
        {error ? <p className="error">{error}</p> : <p className="muted">Caricamento impostazioni...</p>}
      </main>
    );
  }

  const enabledCategories = categories.filter((category) => category.enabled);

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">Dispatch System</p>
          <h1>Anti-spam, retention, log e menu principale</h1>
          <p className="muted">Impostazioni server-wide del sistema ticket.</p>
        </div>
        <div className="actions">
          <a className="button secondary" href={`/dashboard/${guildId}/tickets`}>Configurazione</a>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets/manage`}>Ticket</a>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <form className="form" onSubmit={save}>
        <section className="grid settings-grid">
          <article className="card form">
            <h2>Anti-spam globale</h2>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.antiSpamEnabled}
                onChange={(event) => setSettings({
                  ...settings,
                  antiSpamEnabled: event.target.checked
                })}
              />
              Abilita protezione anti-spam
            </label>

            <label>
              Cooldown globale dopo apertura, secondi
              <input
                type="number"
                min={0}
                max={86400}
                value={settings.antiSpamGlobalCooldownSeconds}
                onChange={(event) => setSettings({
                  ...settings,
                  antiSpamGlobalCooldownSeconds: Number(event.target.value)
                })}
              />
            </label>

            <label>
              Finestra globale tentativi, minuti
              <input
                type="number"
                min={1}
                max={1440}
                value={settings.antiSpamWindowMinutes}
                onChange={(event) => setSettings({
                  ...settings,
                  antiSpamWindowMinutes: Number(event.target.value)
                })}
              />
            </label>

            <label>
              Tentativi globali massimi
              <input
                type="number"
                min={1}
                max={100}
                value={settings.antiSpamMaxAttempts}
                onChange={(event) => setSettings({
                  ...settings,
                  antiSpamMaxAttempts: Number(event.target.value)
                })}
              />
            </label>

            <label>
              Blocco iniziale dopo abuso, minuti
              <input
                type="number"
                min={1}
                max={10080}
                value={settings.antiSpamBlockMinutes}
                onChange={(event) => setSettings({
                  ...settings,
                  antiSpamBlockMinutes: Number(event.target.value)
                })}
              />
            </label>

            <p className="muted">
              I blocchi ripetuti aumentano progressivamente fino a 8× il valore iniziale.
            </p>
          </article>

          <article className="card form">
            <h2>Retention automatica</h2>

            <label>
              Conservazione transcript, giorni
              <input
                type="number"
                min={1}
                max={3650}
                value={settings.transcriptRetentionDays ?? ''}
                onChange={(event) => setSettings({
                  ...settings,
                  transcriptRetentionDays: nullableNumber(event.target.value)
                })}
                placeholder="Vuoto = disattivata"
              />
            </label>

            <label>
              Conservazione ticket chiusi, giorni
              <input
                type="number"
                min={1}
                max={3650}
                value={settings.closedTicketRetentionDays ?? ''}
                onChange={(event) => setSettings({
                  ...settings,
                  closedTicketRetentionDays: nullableNumber(event.target.value)
                })}
                placeholder="Vuoto = disattivata"
              />
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.retentionDeleteDiscordChannel}
                onChange={(event) => setSettings({
                  ...settings,
                  retentionDeleteDiscordChannel: event.target.checked
                })}
              />
              Elimina anche il canale Discord quando scade la retention del ticket
            </label>

            <p className="muted">
              La retention transcript riguarda soltanto le copie cifrate conservate lato Dispatch, non i file già
              inviati in DM o nei canali Discord. Ogni copia nel database viene comunque eliminata insieme al ticket.
              Il worker viene eseguito all’avvio del bot e poi ogni 6 ore.
            </p>
          </article>
        </section>

        <section className="card form">
          <div className="row">
            <div>
              <h2>Log ticket</h2>
              <p className="muted">
                Canale in cui Dispatch registra gli eventi selezionati con un breve embed. Non vengono mai pubblicati
                motivi di chiusura, risposte ai form, note interne o commenti dei feedback.
              </p>
            </div>
            <span className="badge">
              {settings.ticketLogChannelId
                ? `${settings.ticketLogEvents.length} ${settings.ticketLogEvents.length === 1 ? 'evento attivo' : 'eventi attivi'}`
                : 'Disattivato'}
            </span>
          </div>

          <ResourcePicker
            label="Canale log"
            kind="channel"
            channels={channels}
            channelTypes={[CHANNEL_TYPES.text, CHANNEL_TYPES.announcement]}
            placeholder="Nessun canale (log disattivato)"
            hint="Canale testuale o di annunci. Il bot deve poter vedere il canale, scrivere e inviare embed."
            value={settings.ticketLogChannelId ?? ''}
            onChange={(channelId) => setSettings({
              ...settings,
              ticketLogChannelId: channelId || null
            })}
          />

          <div className="row">
            <strong>Eventi registrati</strong>
            <div className="actions">
              <button
                type="button"
                className="secondary button-sm"
                onClick={() => setSettings({ ...settings, ticketLogEvents: logCatalog.map((event) => event.key) })}
              >
                Seleziona tutti
              </button>
              <button
                type="button"
                className="secondary button-sm"
                onClick={() => setSettings({ ...settings, ticketLogEvents: [] })}
              >
                Nessuno
              </button>
            </div>
          </div>

          <div className="log-event-grid">
            {logCatalog.map((event) => (
              <label className="checkbox-row log-event" key={event.key}>
                <input
                  type="checkbox"
                  checked={settings.ticketLogEvents.includes(event.key)}
                  onChange={(change) => toggleLogEvent(event.key, change.target.checked)}
                />
                <span>
                  <strong>{event.label}</strong>
                  <span className="muted">{event.description}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="actions">
            <button disabled={Boolean(busy)} type="submit">
              {busy === 'save' ? 'Salvataggio...' : 'Salva impostazioni'}
            </button>
            <button
              disabled={Boolean(busy) || !settings.ticketLogChannelId}
              type="button"
              className="secondary"
              onClick={() => void sendLogTest()}
            >
              {busy === 'log-test' ? 'Invio...' : 'Invia messaggio di prova'}
            </button>
          </div>
        </section>

        <section className="card form">
          <div className="row">
            <div>
              <h2>Menu principale del server</h2>
              <p className="muted">
                Il messaggio mostra un unico pulsante. Dopo il click, l’utente riceve una finestra privata con le richieste disponibili.
              </p>
            </div>
            <span className="badge">
              {settings.mainMenuMessageId ? 'Pubblicato' : 'Non pubblicato'}
            </span>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.mainMenuEnabled}
              onChange={(event) => setSettings({
                ...settings,
                mainMenuEnabled: event.target.checked
              })}
            />
            Abilita menu principale
          </label>

          <ResourcePicker
            label="Canale Discord"
            kind="channel"
            channels={channels}
            channelTypes={[CHANNEL_TYPES.text, CHANNEL_TYPES.announcement]}
            placeholder="Seleziona..."
            value={settings.mainMenuChannelId ?? ''}
            onChange={(channelId) => setSettings({
              ...settings,
              mainMenuChannelId: channelId || null
            })}
          />

          <label>
            Titolo
            <input
              required
              maxLength={256}
              value={settings.mainMenuTitle}
              onChange={(event) => setSettings({
                ...settings,
                mainMenuTitle: event.target.value
              })}
            />
          </label>

          <label>
            Descrizione
            <textarea
              maxLength={2000}
              value={settings.mainMenuDescription}
              onChange={(event) => setSettings({
                ...settings,
                mainMenuDescription: event.target.value
              })}
            />
          </label>

          <label>
            Testo pulsante
            <input
              required
              maxLength={80}
              value={settings.mainMenuButtonLabel}
              onChange={(event) => setSettings({
                ...settings,
                mainMenuButtonLabel: event.target.value
              })}
            />
          </label>

          <ResourcePicker
            label="Richieste disponibili nel menu"
            kind="item"
            items={enabledCategories}
            multiple
            max={25}
            hint="Massimo 25. L'ordine di selezione è l'ordine del menu."
            value={settings.mainMenuCategoryIds}
            onChange={(mainMenuCategoryIds) => setSettings({ ...settings, mainMenuCategoryIds })}
          />

          <div className="actions">
            <button disabled={busy === 'save'} type="submit">
              {busy === 'save' ? 'Salvataggio...' : 'Salva impostazioni'}
            </button>
            <button
              disabled={busy === 'publish' || !settings.mainMenuEnabled}
              type="button"
              className="secondary"
              onClick={() => void publish()}
            >
              {busy === 'publish'
                ? 'Pubblicazione...'
                : settings.mainMenuMessageId
                  ? 'Aggiorna menu su Discord'
                  : 'Pubblica menu su Discord'}
            </button>
          </div>
        </section>
      </form>
    </main>
  );
}
