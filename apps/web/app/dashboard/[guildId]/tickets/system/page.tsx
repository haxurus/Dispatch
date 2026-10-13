'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ResourcePicker, { CHANNEL_TYPES } from '../../../../_components/ResourcePicker';
import { useCopy, useLocale } from '../../../../_components/locale-context';
import {
  PLAN_NAMES,
  PlanBadge,
  apiErrorText,
  pricingHref,
  usePlan,
  type GuildPlan,
  type PaidTier,
  type PlanBranding
} from '../../../../_components/plan-client';
import { format, inviteHref, type Locale } from '../../../../i18n';

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
  retentionPlaceholder: 'Vuoto = massimo consentito dal piano',
  retentionPlanCap: 'Con il piano {plan} transcript e ticket chiusi vengono conservati al massimo {days} giorni: un campo vuoto vale {days} giorni e i valori più alti vengono ridotti automaticamente al salvataggio.',
  retentionPlanUnlimited: 'Il piano {plan} non ha limiti di retention: un campo vuoto conserva i dati senza scadenza.',
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
  publishMenu: 'Pubblica menu su Discord',
  branding: {
    eyebrow: 'Brand',
    title: 'Nome e banner del bot',
    locked: 'Con il piano Brand puoi dare al bot un nome e un banner personalizzati, visibili solo in questo server.',
    seePlans: 'Vedi i piani',
    intro: 'Visibili solo in questo server. Il bot deve avere il permesso “Cambia nickname”. Il banner viene ritagliato al formato di Discord (680×240).',
    nickname: 'Nome nel server',
    nicknamePlaceholder: 'Dispatch',
    saveNickname: 'Salva nome',
    resetNickname: 'Ripristina',
    banner: 'Banner',
    bannerPreview: 'Anteprima del banner',
    uploadBanner: 'Carica banner',
    removeBanner: 'Rimuovi banner',
    bannerActive: 'Un banner personalizzato è attivo.',
    bannerNone: 'Nessun banner personalizzato: il bot usa il proprio profilo.',
    saving: 'Salvataggio...',
    saved: 'Profilo del bot aggiornato.',
    invalidImage: 'Immagine non valida o troppo complessa: prova con un file PNG, JPEG, WebP o GIF più semplice.',
    reinvite: 'Invita di nuovo il bot',
    errors: {
      PLAN_REQUIRED: 'Nome e banner personalizzati richiedono il piano {plan}.',
      INVALID_BODY: 'Valori non validi: il nome deve avere da 1 a 32 caratteri e il banner deve essere un’immagine PNG, JPEG, WebP o GIF.',
      BRANDING_MISSING_PERMISSION: 'Il bot non ha il permesso “Cambia nickname” in questo server: invitalo di nuovo per concedere i permessi aggiornati.',
      BRANDING_FAILED: 'Discord ha rifiutato la modifica del profilo del bot. Riprova più tardi.',
      TOO_LARGE: 'Il banner è troppo grande anche dopo la compressione: prova con un’immagine più semplice.'
    } as Record<string, string>,
    failed: 'Aggiornamento del profilo fallito: {code}'
  }
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
  retentionPlaceholder: 'Empty = as long as the plan allows',
  retentionPlanCap: 'On the {plan} plan transcripts and closed tickets are kept for at most {days} days: an empty field means {days} days and higher values are reduced automatically on save.',
  retentionPlanUnlimited: 'The {plan} plan has no retention limit: an empty field keeps data with no expiry.',
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
  publishMenu: 'Publish menu on Discord',
  branding: {
    eyebrow: 'Brand',
    title: 'Bot name and banner',
    locked: 'With the Brand plan you can give the bot a custom name and banner, visible only in this server.',
    seePlans: 'See plans',
    intro: 'Visible only in this server. The bot needs the “Change Nickname” permission. The banner is cropped to Discord’s format (680×240).',
    nickname: 'Name in this server',
    nicknamePlaceholder: 'Dispatch',
    saveNickname: 'Save name',
    resetNickname: 'Reset',
    banner: 'Banner',
    bannerPreview: 'Banner preview',
    uploadBanner: 'Upload banner',
    removeBanner: 'Remove banner',
    bannerActive: 'A custom banner is active.',
    bannerNone: 'No custom banner: the bot uses its own profile.',
    saving: 'Saving...',
    saved: 'Bot profile updated.',
    invalidImage: 'Invalid or overly complex image: try a simpler PNG, JPEG, WebP or GIF file.',
    reinvite: 'Invite the bot again',
    errors: {
      PLAN_REQUIRED: 'A custom name and banner require the {plan} plan.',
      INVALID_BODY: 'Invalid values: the name must be 1 to 32 characters and the banner must be a PNG, JPEG, WebP or GIF image.',
      BRANDING_MISSING_PERMISSION: 'The bot does not have the “Change Nickname” permission in this server: invite it again to grant the updated permissions.',
      BRANDING_FAILED: 'Discord rejected the bot profile change. Try again later.',
      TOO_LARGE: 'The banner is too large even after compression: try a simpler image.'
    },
    failed: 'Profile update failed: {code}'
  }
};

const copy: Record<Locale, typeof it> = { it, en };

function nullableNumber(value: string) {
  return value === '' ? null : Number(value);
}

const NEXT_TIER: Record<GuildPlan['effectiveTier'], PaidTier | null> = { FREE: 'TIER1', TIER1: 'TIER2', TIER2: 'TIER3', TIER3: null };

// Discord shows member banners at 680×240; the API accepts up to 90,000
// characters, so the data URI stays under 85,000 with room for the JSON.
const BANNER_WIDTH = 680;
const BANNER_HEIGHT = 240;
const BANNER_MAX_CHARS = 85_000;
const BANNER_QUALITIES = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.35];

async function encodeBanner(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = BANNER_WIDTH;
    canvas.height = BANNER_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('CANVAS_UNAVAILABLE');
    // Cover: fill the frame and crop the overflow from the centre.
    const scale = Math.max(BANNER_WIDTH / bitmap.width, BANNER_HEIGHT / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (BANNER_WIDTH - width) / 2, (BANNER_HEIGHT - height) / 2, width, height);
    // WebP first (smaller); browsers without a WebP encoder return PNG, so
    // the prefix is checked before falling back to JPEG.
    for (const type of ['image/webp', 'image/jpeg']) {
      for (const quality of BANNER_QUALITIES) {
        const data = canvas.toDataURL(type, quality);
        if (!data.startsWith(`data:${type};`)) break;
        if (data.length <= BANNER_MAX_CHARS) return data;
      }
    }
    throw new Error('BANNER_TOO_LARGE');
  } finally {
    bitmap.close();
  }
}

type BrandingCopy = typeof it.branding;

function BrandingCard({ guildId, plan, text, locale, onSaved }: {
  guildId: string;
  plan: GuildPlan;
  text: BrandingCopy;
  locale: Locale;
  onSaved: (branding: PlanBranding) => void;
}) {
  const allowed = plan.plan.features.customBranding;
  const [nickname, setNickname] = useState(plan.branding.nickname ?? '');
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string; reinvite?: boolean } | null>(null);

  const send = async (body: { nickname?: string | null; banner?: string | null }, action: string) => {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch(`/backend/api/guilds/${guildId}/branding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const code = response.status === 413 ? 'TOO_LARGE' : error.error;
        setMessage({
          kind: 'error',
          text: apiErrorText(text.errors, { ...error, error: code }, format(text.failed, { code: code ?? response.status })),
          reinvite: code === 'BRANDING_MISSING_PERMISSION'
        });
        return;
      }
      const saved = await response.json() as { nickname: string | null; bannerSet: boolean };
      onSaved({ nickname: saved.nickname, bannerSet: saved.bannerSet });
      setNickname(saved.nickname ?? '');
      setBanner(null);
      setMessage({ kind: 'ok', text: text.saved });
    } catch {
      setMessage({ kind: 'error', text: format(text.failed, { code: 'NETWORK' }) });
    } finally {
      setBusy('');
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    try {
      setBanner(await encodeBanner(file));
    } catch (error) {
      setBanner(null);
      setMessage({ kind: 'error', text: error instanceof Error && error.message === 'BANNER_TOO_LARGE' ? text.errors.TOO_LARGE : text.invalidImage });
    }
  };

  const trimmed = nickname.trim();
  const disabled = !allowed || Boolean(busy);

  return (
    <section className={`card form branding-card ${allowed ? '' : 'is-locked'}`.trim()}>
      <div className="row">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h2 className="plan-heading">{text.title}{!allowed && <PlanBadge required="TIER3" />}</h2>
          <p className="muted">{allowed ? text.intro : text.locked}</p>
        </div>
        {!allowed && <a className="button secondary" href={pricingHref(locale)}>{text.seePlans}</a>}
      </div>

      {message && (
        <p className={message.kind === 'error' ? 'error' : 'success'} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
          {message.reinvite && <> <a className="inline-link" href={inviteHref(locale)}>{text.reinvite}</a></>}
        </p>
      )}

      <fieldset className="branding-grid" disabled={!allowed}>
        <div className="form">
          <label>
            {text.nickname}
            <input
              value={nickname}
              maxLength={32}
              placeholder={text.nicknamePlaceholder}
              onChange={(event) => setNickname(event.target.value)}
            />
          </label>
          <div className="actions">
            <button
              type="button"
              disabled={disabled || !trimmed || trimmed === (plan.branding.nickname ?? '')}
              onClick={() => void send({ nickname: trimmed }, 'nickname')}
            >
              {busy === 'nickname' ? text.saving : text.saveNickname}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={disabled || !plan.branding.nickname}
              onClick={() => void send({ nickname: null }, 'nickname-reset')}
            >
              {busy === 'nickname-reset' ? text.saving : text.resetNickname}
            </button>
          </div>
        </div>

        <div className="form">
          <label>
            {text.banner}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => {
                void pick(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
          {banner && <img className="banner-preview" src={banner} alt={text.bannerPreview} />}
          {!banner && <p className="muted">{plan.branding.bannerSet ? text.bannerActive : text.bannerNone}</p>}
          <div className="actions">
            <button
              type="button"
              disabled={disabled || !banner}
              onClick={() => { if (banner) void send({ banner }, 'banner'); }}
            >
              {busy === 'banner' ? text.saving : text.uploadBanner}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={disabled || !plan.branding.bannerSet}
              onClick={() => void send({ banner: null }, 'banner-remove')}
            >
              {busy === 'banner-remove' ? text.saving : text.removeBanner}
            </button>
          </div>
        </div>
      </fieldset>
    </section>
  );
}

export default function TicketSystemPage() {
  const params = useParams<{ guildId: string }>();
  const guildId = params.guildId;
  const c = useCopy(copy);
  const locale = useLocale();
  const { plan, setPlan } = usePlan(guildId);

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
  const retentionCap = plan ? plan.plan.limits.retentionDays : undefined;
  const nextTier = plan ? NEXT_TIER[plan.effectiveTier] : null;

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

            {plan && (
              <p className="plan-hint">
                {retentionCap !== null && nextTier && <PlanBadge required={nextTier} />}
                <span>
                  {retentionCap === null || retentionCap === undefined
                    ? format(c.retentionPlanUnlimited, { plan: PLAN_NAMES[plan.effectiveTier] })
                    : format(c.retentionPlanCap, { plan: PLAN_NAMES[plan.effectiveTier], days: retentionCap })}
                </span>
              </p>
            )}

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

      {plan && (
        <BrandingCard
          guildId={guildId}
          plan={plan}
          text={c.branding}
          locale={locale}
          onSaved={(branding) => setPlan({ ...plan, branding })}
        />
      )}
    </main>
  );
}
