'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ResourcePicker, { CHANNEL_TYPES } from '../../../../_components/ResourcePicker';
import { useCopy } from '../../../../_components/locale-context';
import { format, type Locale } from '../../../../i18n';

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
  locale: 'en' | 'it';
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

const it = {
  logTestErrors: {
    TICKET_LOG_CHANNEL_REQUIRED: 'Seleziona un canale log prima di inviare il messaggio di prova.',
    TICKET_LOG_CHANNEL_INVALID: 'Il canale log non esiste più oppure non è un canale testuale o di annunci di questo server.',
    TICKET_LOG_SEND_FAILED: 'Discord ha rifiutato il messaggio: controlla che il bot possa vedere il canale, scrivere e inviare embed.',
    GUILD_NOT_FOUND: 'Il bot non è presente nel server.'
  } as Record<string, string>,
  saveErrors: {
    TICKET_LOG_CHANNEL_NOT_FOUND: 'Il canale log selezionato non è un canale testuale o di annunci del server.',
    MAIN_MENU_CHANNEL_NOT_FOUND: 'Il canale del menu principale non è un canale testuale o di annunci del server.'
  } as Record<string, string>,
  // Local labels for the catalogue keys; unknown keys fall back to the API text.
  logEvents: {
    TICKET_OPEN: { label: 'Apertura ticket', description: 'Nuovo ticket creato da menu, pannello o form.' },
    TICKET_CLAIM: { label: 'Presa in carico', description: 'Claim, rilascio e assegnazione a un membro dello staff.' },
    TICKET_UPDATE: { label: 'Modifiche al ticket', description: 'Cambio di stato, priorità o trasferimento di categoria.' },
    TICKET_MEMBERS: { label: 'Partecipanti', description: 'Aggiunta o rimozione di un membro dal ticket.' },
    TICKET_CLOSE: { label: 'Chiusura', description: 'Chiusura manuale, dalla dashboard o automatica (il motivo non viene mai riportato).' },
    TICKET_REOPEN: { label: 'Riapertura', description: 'Riapertura da parte dello staff o dell’utente.' },
    TICKET_DELETE: { label: 'Eliminazione canale', description: 'Canale eliminato dallo staff o dalla retention.' },
    TICKET_TRANSCRIPT: { label: 'Transcript', description: 'Generazione manuale o consegna automatica del transcript.' },
    TICKET_FEEDBACK: { label: 'Feedback', description: 'Valutazione 1-5 inviata dall’utente (mai il commento).' },
    TICKET_STAFF_THREAD: { label: 'Thread staff', description: 'Thread privato dello staff creato e transcript del thread inviato (mai il contenuto).' },
    TICKET_AUTOMATION: { label: 'Automazioni', description: 'SLA superati, escalation, preavviso e chiusura per inattività.' },
    FORM_SUBMISSION: { label: 'Invii form', description: 'Nome del form, utente, ID invio ed eventuale ticket (mai le risposte).' },
    BLACKLIST: { label: 'Blacklist', description: 'Utente aggiunto o rimosso dalla blacklist dalla dashboard.' }
  } as Record<string, { label: string; description: string }>,
  forbidden: 'Questa pagina richiede il livello Admin o Owner.',
  loadError: 'Impossibile caricare le impostazioni di sistema.',
  saveFailed: 'Salvataggio fallito: {code}',
  saved: 'Impostazioni salvate.',
  logTestFailed: 'Invio di prova fallito: {code}',
  logTestSent: 'Impostazioni salvate e messaggio di prova inviato nel canale log.',
  publishFailed: 'Pubblicazione menu fallita: {code}',
  published: 'Menu principale pubblicato o aggiornato su Discord.',
  loading: 'Caricamento impostazioni...',
  eyebrow: 'Dispatch System',
  title: 'Anti-spam, retention, log e menu principale',
  intro: 'Impostazioni server-wide del sistema ticket.',
  setupLink: 'Configurazione',
  ticketsLink: 'Ticket',
  languageTitle: 'Lingua del bot',
  languageIntro: 'Lingua di tutto ciò che il bot scrive in questo server: pannelli, messaggi nei ticket, risposte ai pulsanti, form, log, transcript e classifiche. I testi che hai scritto tu restano come sono.',
  languageLabel: 'Lingua',
  languageHint: 'Dopo il cambio, ripubblica pannelli e menu principale per aggiornare i messaggi già inviati.',
  antiSpamTitle: 'Anti-spam globale',
  antiSpamEnabled: 'Abilita protezione anti-spam',
  antiSpamCooldown: 'Cooldown globale dopo apertura, secondi',
  antiSpamWindow: 'Finestra globale tentativi, minuti',
  antiSpamMaxAttempts: 'Tentativi globali massimi',
  antiSpamBlock: 'Blocco iniziale dopo abuso, minuti',
  antiSpamHint: 'I blocchi ripetuti aumentano progressivamente fino a 8× il valore iniziale.',
  retentionTitle: 'Retention automatica',
  transcriptRetention: 'Conservazione transcript, giorni',
  closedRetention: 'Conservazione ticket chiusi, giorni',
  retentionPlaceholder: 'Vuoto = disattivata',
  retentionDeleteChannel: 'Elimina anche il canale Discord quando scade la retention del ticket',
  retentionHint: 'La retention transcript riguarda soltanto le copie cifrate conservate lato Dispatch, non i file già inviati in DM o nei canali Discord. Ogni copia nel database viene comunque eliminata insieme al ticket. Il worker viene eseguito all’avvio del bot e poi ogni 6 ore.',
  logTitle: 'Log ticket',
  logIntro: 'Canale in cui Dispatch registra gli eventi selezionati con un breve embed. Non vengono mai pubblicati motivi di chiusura, risposte ai form, note interne o commenti dei feedback.',
  activeEvents: (count: number) => `${count} ${count === 1 ? 'evento attivo' : 'eventi attivi'}`,
  logDisabled: 'Disattivato',
  logChannel: 'Canale log',
  logChannelPlaceholder: 'Nessun canale (log disattivato)',
  channelHint: 'Canale testuale o di annunci. Il bot deve poter vedere il canale, scrivere e inviare embed.',
  loggedEvents: 'Eventi registrati',
  selectAll: 'Seleziona tutti',
  selectNone: 'Nessuno',
  saving: 'Salvataggio...',
  save: 'Salva impostazioni',
  sending: 'Invio...',
  sendTest: 'Invia messaggio di prova',
  menuTitle: 'Menu principale del server',
  menuIntro: 'Il messaggio mostra un unico pulsante. Dopo il click, l’utente riceve una finestra privata con le richieste disponibili.',
  menuPublished: 'Pubblicato',
  menuNotPublished: 'Non pubblicato',
  menuEnabled: 'Abilita menu principale',
  menuChannel: 'Canale Discord',
  menuChannelPlaceholder: 'Seleziona...',
  menuTitleLabel: 'Titolo',
  menuDescriptionLabel: 'Descrizione',
  menuButtonLabel: 'Testo pulsante',
  menuCategories: 'Richieste disponibili nel menu',
  menuCategoriesHint: "Massimo 25. L'ordine di selezione è l'ordine del menu.",
  publishing: 'Pubblicazione...',
  updateMenu: 'Aggiorna menu su Discord',
  publishMenu: 'Pubblica menu su Discord'
};

const en: typeof it = {
  logTestErrors: {
    TICKET_LOG_CHANNEL_REQUIRED: 'Select a log channel before sending the test message.',
    TICKET_LOG_CHANNEL_INVALID: 'The log channel no longer exists or is not a text or announcement channel of this server.',
    TICKET_LOG_SEND_FAILED: 'Discord rejected the message: check that the bot can view the channel, send messages and embed links.',
    GUILD_NOT_FOUND: 'The bot is not in the server.'
  },
  saveErrors: {
    TICKET_LOG_CHANNEL_NOT_FOUND: 'The selected log channel is not a text or announcement channel of the server.',
    MAIN_MENU_CHANNEL_NOT_FOUND: 'The main menu channel is not a text or announcement channel of the server.'
  },
  logEvents: {
    TICKET_OPEN: { label: 'Ticket opened', description: 'New ticket created from the menu, a panel or a form.' },
    TICKET_CLAIM: { label: 'Claims', description: 'Claim, release and assignment to a staff member.' },
    TICKET_UPDATE: { label: 'Ticket changes', description: 'Status or priority change, or transfer to another category.' },
    TICKET_MEMBERS: { label: 'Participants', description: 'A member added to or removed from the ticket.' },
    TICKET_CLOSE: { label: 'Closing', description: 'Manual, dashboard or automatic closing (the reason is never included).' },
    TICKET_REOPEN: { label: 'Reopening', description: 'Reopened by the staff or by the user.' },
    TICKET_DELETE: { label: 'Channel deletion', description: 'Channel deleted by the staff or by retention.' },
    TICKET_TRANSCRIPT: { label: 'Transcripts', description: 'Manual generation or automatic delivery of the transcript.' },
    TICKET_FEEDBACK: { label: 'Feedback', description: '1-5 rating sent by the user (never the comment).' },
    TICKET_STAFF_THREAD: { label: 'Staff thread', description: 'Private staff thread created and thread transcript sent (never the content).' },
    TICKET_AUTOMATION: { label: 'Automations', description: 'SLA breaches, escalations, inactivity warnings and inactivity closing.' },
    FORM_SUBMISSION: { label: 'Form submissions', description: 'Form name, user, submission ID and related ticket, if any (never the answers).' },
    BLACKLIST: { label: 'Blacklist', description: 'User added to or removed from the blacklist from the dashboard.' }
  },
  forbidden: 'This page requires the Admin or Owner level.',
  loadError: 'The system settings could not be loaded.',
  saveFailed: 'Save failed: {code}',
  saved: 'Settings saved.',
  logTestFailed: 'Test message failed: {code}',
  logTestSent: 'Settings saved and test message sent to the log channel.',
  publishFailed: 'Menu publishing failed: {code}',
  published: 'Main menu published or updated on Discord.',
  loading: 'Loading settings...',
  eyebrow: 'Dispatch System',
  title: 'Anti-spam, retention, log and main menu',
  intro: 'Server-wide settings of the ticket system.',
  setupLink: 'Setup',
  ticketsLink: 'Tickets',
  languageTitle: 'Bot language',
  languageIntro: 'Language of everything the bot writes in this server: panels, ticket messages, button replies, forms, logs, transcripts and leaderboards. Texts you wrote yourself stay as they are.',
  languageLabel: 'Language',
  languageHint: 'After changing it, republish panels and the main menu to update messages already sent.',
  antiSpamTitle: 'Global anti-spam',
  antiSpamEnabled: 'Enable anti-spam protection',
  antiSpamCooldown: 'Global cooldown after opening, seconds',
  antiSpamWindow: 'Global attempt window, minutes',
  antiSpamMaxAttempts: 'Maximum global attempts',
  antiSpamBlock: 'Initial block after abuse, minutes',
  antiSpamHint: 'Repeated blocks grow progressively up to 8× the initial value.',
  retentionTitle: 'Automatic retention',
  transcriptRetention: 'Transcript retention, days',
  closedRetention: 'Closed ticket retention, days',
  retentionPlaceholder: 'Empty = off',
  retentionDeleteChannel: 'Also delete the Discord channel when the ticket retention expires',
  retentionHint: 'Transcript retention only covers the encrypted copies kept by Dispatch, not files already sent in DMs or Discord channels. Every copy in the database is deleted together with the ticket anyway. The worker runs when the bot starts and then every 6 hours.',
  logTitle: 'Ticket log',
  logIntro: 'Channel where Dispatch records the selected events with a short embed. Closing reasons, form answers, internal notes and feedback comments are never posted.',
  activeEvents: (count: number) => `${count} ${count === 1 ? 'active event' : 'active events'}`,
  logDisabled: 'Off',
  logChannel: 'Log channel',
  logChannelPlaceholder: 'No channel (log off)',
  channelHint: 'Text or announcement channel. The bot must be able to view the channel, send messages and embed links.',
  loggedEvents: 'Logged events',
  selectAll: 'Select all',
  selectNone: 'None',
  saving: 'Saving...',
  save: 'Save settings',
  sending: 'Sending...',
  sendTest: 'Send test message',
  menuTitle: 'Server main menu',
  menuIntro: 'The message shows a single button. After clicking it, the user gets a private window with the available requests.',
  menuPublished: 'Published',
  menuNotPublished: 'Not published',
  menuEnabled: 'Enable main menu',
  menuChannel: 'Discord channel',
  menuChannelPlaceholder: 'Select...',
  menuTitleLabel: 'Title',
  menuDescriptionLabel: 'Description',
  menuButtonLabel: 'Button text',
  menuCategories: 'Requests available in the menu',
  menuCategoriesHint: 'Up to 25. The selection order is the menu order.',
  publishing: 'Publishing...',
  updateMenu: 'Update menu on Discord',
  publishMenu: 'Publish menu on Discord'
};

const copy: Record<Locale, typeof it> = { it, en };

function nullableNumber(value: string) {
  return value === '' ? null : Number(value);
}

export default function TicketSystemPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;
  const c = useCopy(copy);

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
        ? c.forbidden
        : c.loadError);
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
    setSettings({
      ...rest,
      locale: rest.locale === 'it' ? 'it' : 'en',
      ticketLogEvents: rest.ticketLogEvents ?? [],
      ticketLogChannelId: rest.ticketLogChannelId ?? null
    });
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
      setError(c.saveErrors[body.error] ?? format(c.saveFailed, { code: body.error ?? response.status }));
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
      if (await putSettings(settings)) setNotice(c.saved);
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
        setError(c.logTestErrors[body.error] ?? format(c.logTestFailed, { code: body.error ?? response.status }));
        return;
      }
      setNotice(c.logTestSent);
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
        setError(format(c.publishFailed, { code: body.error ?? response.status }));
        return;
      }

      await load();
      setNotice(c.published);
    } finally {
      setBusy('');
    }
  };

  if (!settings) {
    return (
      <main className="shell">
        {error ? <p className="error">{error}</p> : <p className="muted">{c.loading}</p>}
      </main>
    );
  }

  const enabledCategories = categories.filter((category) => category.enabled);

  return (
    <main className="shell">
      <div className="row">
        <div>
          <p className="eyebrow">{c.eyebrow}</p>
          <h1>{c.title}</h1>
          <p className="muted">{c.intro}</p>
        </div>
        <div className="actions">
          <a className="button secondary" href={`/dashboard/${guildId}/tickets`}>{c.setupLink}</a>
          <a className="button secondary" href={`/dashboard/${guildId}/tickets/manage`}>{c.ticketsLink}</a>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <form className="form" onSubmit={save}>
        <section className="grid settings-grid">
          <article className="card form">
            <h2>{c.languageTitle}</h2>
            <p className="muted">
              {c.languageIntro}
            </p>
            <label>
              {c.languageLabel}
              <select
                value={settings.locale}
                onChange={(event) => setSettings({ ...settings, locale: event.target.value === 'it' ? 'it' : 'en' })}
              >
                <option value="en">English</option>
                <option value="it">Italiano</option>
              </select>
            </label>
            <p className="muted">{c.languageHint}</p>
          </article>

          <article className="card form">
            <h2>{c.antiSpamTitle}</h2>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.antiSpamEnabled}
                onChange={(event) => setSettings({
                  ...settings,
                  antiSpamEnabled: event.target.checked
                })}
              />
              {c.antiSpamEnabled}
            </label>

            <label>
              {c.antiSpamCooldown}
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
              {c.antiSpamWindow}
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
              {c.antiSpamMaxAttempts}
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
              {c.antiSpamBlock}
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
              {c.antiSpamHint}
            </p>
          </article>

          <article className="card form">
            <h2>{c.retentionTitle}</h2>

            <label>
              {c.transcriptRetention}
              <input
                type="number"
                min={1}
                max={3650}
                value={settings.transcriptRetentionDays ?? ''}
                onChange={(event) => setSettings({
                  ...settings,
                  transcriptRetentionDays: nullableNumber(event.target.value)
                })}
                placeholder={c.retentionPlaceholder}
              />
            </label>

            <label>
              {c.closedRetention}
              <input
                type="number"
                min={1}
                max={3650}
                value={settings.closedTicketRetentionDays ?? ''}
                onChange={(event) => setSettings({
                  ...settings,
                  closedTicketRetentionDays: nullableNumber(event.target.value)
                })}
                placeholder={c.retentionPlaceholder}
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
              {c.retentionDeleteChannel}
            </label>

            <p className="muted">
              {c.retentionHint}
            </p>
          </article>
        </section>

        <section className="card form">
          <div className="row">
            <div>
              <h2>{c.logTitle}</h2>
              <p className="muted">
                {c.logIntro}
              </p>
            </div>
            <span className="badge">
              {settings.ticketLogChannelId
                ? c.activeEvents(settings.ticketLogEvents.length)
                : c.logDisabled}
            </span>
          </div>

          <ResourcePicker
            label={c.logChannel}
            kind="channel"
            channels={channels}
            channelTypes={[CHANNEL_TYPES.text, CHANNEL_TYPES.announcement]}
            placeholder={c.logChannelPlaceholder}
            hint={c.channelHint}
            value={settings.ticketLogChannelId ?? ''}
            onChange={(channelId) => setSettings({
              ...settings,
              ticketLogChannelId: channelId || null
            })}
          />

          <div className="row">
            <strong>{c.loggedEvents}</strong>
            <div className="actions">
              <button
                type="button"
                className="secondary button-sm"
                onClick={() => setSettings({ ...settings, ticketLogEvents: logCatalog.map((event) => event.key) })}
              >
                {c.selectAll}
              </button>
              <button
                type="button"
                className="secondary button-sm"
                onClick={() => setSettings({ ...settings, ticketLogEvents: [] })}
              >
                {c.selectNone}
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
                  <strong>{c.logEvents[event.key]?.label ?? event.label}</strong>
                  <span className="muted">{c.logEvents[event.key]?.description ?? event.description}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="actions">
            <button disabled={Boolean(busy)} type="submit">
              {busy === 'save' ? c.saving : c.save}
            </button>
            <button
              disabled={Boolean(busy) || !settings.ticketLogChannelId}
              type="button"
              className="secondary"
              onClick={() => void sendLogTest()}
            >
              {busy === 'log-test' ? c.sending : c.sendTest}
            </button>
          </div>
        </section>

        <section className="card form">
          <div className="row">
            <div>
              <h2>{c.menuTitle}</h2>
              <p className="muted">
                {c.menuIntro}
              </p>
            </div>
            <span className="badge">
              {settings.mainMenuMessageId ? c.menuPublished : c.menuNotPublished}
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
            {c.menuEnabled}
          </label>

          <ResourcePicker
            label={c.menuChannel}
            kind="channel"
            channels={channels}
            channelTypes={[CHANNEL_TYPES.text, CHANNEL_TYPES.announcement]}
            placeholder={c.menuChannelPlaceholder}
            value={settings.mainMenuChannelId ?? ''}
            onChange={(channelId) => setSettings({
              ...settings,
              mainMenuChannelId: channelId || null
            })}
          />

          <label>
            {c.menuTitleLabel}
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
            {c.menuDescriptionLabel}
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
            {c.menuButtonLabel}
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
            label={c.menuCategories}
            kind="item"
            items={enabledCategories}
            multiple
            max={25}
            hint={c.menuCategoriesHint}
            value={settings.mainMenuCategoryIds}
            onChange={(mainMenuCategoryIds) => setSettings({ ...settings, mainMenuCategoryIds })}
          />

          <div className="actions">
            <button disabled={busy === 'save'} type="submit">
              {busy === 'save' ? c.saving : c.save}
            </button>
            <button
              disabled={busy === 'publish' || !settings.mainMenuEnabled}
              type="button"
              className="secondary"
              onClick={() => void publish()}
            >
              {busy === 'publish'
                ? c.publishing
                : settings.mainMenuMessageId
                  ? c.updateMenu
                  : c.publishMenu}
            </button>
          </div>
        </section>
      </form>
    </main>
  );
}
