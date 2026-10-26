'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon, type IconName } from './Brand';
import { SiteHeader } from './SiteChrome';
import { SNOWFLAKE, initial, logout } from './session';
import { chromeCopy, loginHref, type Locale } from '../i18n';
import { LocaleToggle } from './locale-context';

/*
 * Super console, aligned with Sentinel's: tabs for servers and plans,
 * monitoring (bot watchdog, incidents, alert routing, instance events), logs,
 * public contacts, Discord subscriptions, status channel, blacklist and audit.
 * Every route is checked again by the API (super admin only).
 */

/* Plans: local mirror of the @dispatch/shared shapes (the web app does not depend on it). */
type PlanTier = 'FREE' | 'TIER1' | 'TIER2' | 'TIER3';
type PaidTier = Exclude<PlanTier, 'FREE'>;
const PLAN_TIERS: readonly PlanTier[] = ['FREE', 'TIER1', 'TIER2', 'TIER3'];
const PAID_TIERS: readonly PaidTier[] = ['TIER1', 'TIER2', 'TIER3'];
const TIER_NAMES: Record<PlanTier, string> = { FREE: 'Free', TIER1: 'Plus', TIER2: 'Pro', TIER3: 'Brand' };
const isPlanTier = (value: unknown): value is PlanTier => typeof value === 'string' && (PLAN_TIERS as readonly string[]).includes(value);
const tierIndex = (tier: PlanTier) => PLAN_TIERS.indexOf(tier);

type Guild = {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number;
  ownerId: string;
  installedAt: string | null;
  openTickets: number;
  totalTickets: number;
  blocked: boolean;
};
type Block = { id: string; kind: 'USER' | 'GUILD'; subjectId: string; reason: string | null; createdAt: string };
type Audit = { id: string; username: string; action: string; subjectType: string | null; subjectId: string | null; createdAt: string };
type BotStatus = { ready: boolean; uptimeMs: number | null; guildCount: number; pingMs: number | null; user: { username: string; avatarUrl: string | null } | null };
type StatusChannel = { guildId: string; channelId: string; updatedAt: string } | null;
type Config = { contactEmail: string | null; contactDiscord: string | null; contactUrl: string | null };
type PlanRow = {
  guildId: string;
  planTier: string;
  planExpiresAt: string | null;
  subscriptionTier: string | null;
  subscriptionEndsAt: string | null;
  planNote: string | null;
  planUpdatedAt: string | null;
};
type DiscordOverview = {
  enabled: boolean;
  store: string;
  links: Record<PaidTier, string | null>;
  skus: Partial<Record<PaidTier, string>>;
  lastSync: { at: string; ok: boolean; entitlements: number; changed: number } | null;
};
type PlansOverview = {
  config: Config;
  plans: PlanRow[];
  planCatalog: Array<{ tier: PlanTier; name: string; monthlyCents: number }>;
  discord: DiscordOverview;
};
type Overview = {
  bot: { reachable: boolean; status: BotStatus | null };
  metrics: { connectedGuilds: number; openTickets: number; ticketsLast7Days: number; forms: number; guildBlacklistEntries: number; installBlocks: number };
  guilds: Guild[];
  blocks: Block[];
  statusChannel: StatusChannel;
  /** null when the plan tables cannot be read (installer not re-run on the VPS). */
  plans: PlansOverview | null;
  audit: Audit[];
};

/** A server's plans: the gift set here and the Discord subscription (read-only). */
type GuildPlan = { gift: PlanTier; giftRunning: PlanTier; giftExpiresAt: string | null; subscription: PlanTier; subscriptionEndsAt: string | null; effective: PlanTier; note: string | null };

function running(tier: string | null | undefined, endsAt: string | null | undefined, now: number): PlanTier {
  if (!isPlanTier(tier) || tier === 'FREE') return 'FREE';
  if (!endsAt) return tier;
  const end = new Date(endsAt).getTime();
  return Number.isNaN(end) || end > now ? tier : 'FREE';
}

function guildPlan(row: PlanRow | undefined, now = Date.now()): GuildPlan {
  const giftRunning = running(row?.planTier, row?.planExpiresAt, now);
  const subscription = running(row?.subscriptionTier, row?.subscriptionEndsAt, now);
  return {
    gift: row && isPlanTier(row.planTier) ? row.planTier : 'FREE',
    giftRunning,
    giftExpiresAt: row?.planExpiresAt ?? null,
    subscription,
    subscriptionEndsAt: row?.subscriptionEndsAt ?? null,
    effective: tierIndex(subscription) > tierIndex(giftRunning) ? subscription : giftRunning,
    note: row?.planNote ?? null
  };
}

const formatPrice = (cents: number, locale: Locale) => new Intl.NumberFormat(locale === 'it' ? 'it-IT' : 'en-US', {
  style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: cents % 100 ? 2 : 0
}).format(cents / 100);

const copy = {
  it: {
    kicker: 'SUPER CONSOLE',
    title: 'Controllo globale di Dispatch.',
    intro: 'Area riservata al proprietario dell’istanza. Le azioni qui sotto hanno effetto su tutti i server collegati al bot e vengono registrate nell’audit.',
    refresh: 'Aggiorna',
    pricing: 'Prezzi',
    tabs: { servers: 'Server e piani', monitor: 'Monitoraggio', logs: 'Log', contacts: 'Contatti', discord: 'Abbonamenti Discord', status: 'Notifiche', blacklist: 'Blacklist', audit: 'Audit' },
    metrics: { servers: 'Server collegati', paid: 'Con un piano', free: 'Server Free', subscriptions: 'Abbonamenti Discord', openTickets: 'Ticket aperti', bot: 'Bot', ready: 'Online', notReady: 'Non pronto', offline: 'Offline' },
    liveServers: 'Server collegati',
    liveServersText: 'Elenco live dalla sessione Discord del bot, con i ticket dal database. Da qui assegni un piano omaggio a ogni server.',
    members: 'membri',
    owner: 'Proprietario',
    installed: 'installato',
    tickets: (open: number, total: number) => `${open} aperti · ${total} totali`,
    blocked: 'Bloccato',
    leave: 'Fai uscire',
    blockLeave: 'Blocca ed espelli',
    managePlan: 'Gestisci piano',
    close: 'Chiudi',
    noServers: 'Dispatch non è collegato ad alcun server.',
    botUnreachable: 'API interna del bot non raggiungibile: l’elenco server non è disponibile.',
    plansUnavailable: 'Piani, abbonamenti e recapiti non sono disponibili: riesegui l’installer sul VPS per aggiornare i permessi del database.',
    plan: {
      tier: 'Piano omaggio',
      none: 'Nessun omaggio',
      manual: 'Da qui assegni solo piani gratuiti (prova, partner, omaggio): i piani a pagamento si vendono solo tramite Discord. Vale il piano più alto tra omaggio e abbonamento Discord.',
      discord: 'Abbonamento Discord',
      renews: 'si rinnova',
      cancelled: 'disdetto, fino al',
      gift: 'Omaggio',
      expires: 'Scadenza',
      noExpiry: 'Nessuna scadenza',
      plusMonth: '+1 mese',
      plusYear: '+1 anno',
      note: 'Nota interna',
      notePlaceholder: 'Es. prova di 30 giorni per un server partner',
      save: 'Salva omaggio',
      expiresOn: 'scade il',
      expired: 'scaduto il',
      confirmDowngrade: 'Ridurre il piano in vigore? I limiti si applicano subito: conservazione ridotta, ruoli della dashboard in eccesso rimossi e personalizzazione Brand azzerata.'
    },
    contacts: {
      title: 'Recapiti pubblici',
      text: 'Mostrati nella pagina prezzi a chi ha domande sui piani, per prove gratuite e collaborazioni. Lascia vuoto un campo per nasconderlo.',
      email: 'Email',
      discord: 'Discord (username o link https)',
      url: 'Link: server Discord, sito o modulo (https)',
      save: 'Salva recapiti'
    },
    alerts: {
      routingTitle: 'Instradamento degli allarmi',
      routingText: 'Scegli dove va ogni categoria. I messaggi usano la lingua del bot impostata nel server di destinazione. Gli avvisi uguali entro 10 minuti diventano un solo messaggio; i critici ti menzionano e ignorano gli orari di silenzio. “Bot giù” lo segnala il monitor esterno (e il webhook, se impostato).',
      categories: { availability: 'Disponibilità', security: 'Sicurezza', errors: 'Errori', billing: 'Abbonamenti', installations: 'Installazioni' },
      modes: { status: 'Canale di stato', channel: 'Altro canale', digest: 'Riepilogo giornaliero', log: 'Solo registro' },
      server: 'Server',
      channel: 'Canale',
      choose: 'Scegli…',
      mention: 'Menzionami per i critici',
      quiet: 'Orari di silenzio',
      quietText: 'In questa fascia arrivano solo gli avvisi critici; gli altri partono tutti insieme alla fine.',
      from: 'Dalle',
      to: 'alle',
      timezone: 'Fuso orario',
      digest: 'Riepilogo giornaliero',
      digestText: 'Un messaggio al giorno con il conteggio degli avvisi informativi.',
      digestAt: 'Ora di invio',
      digestWhere: 'Destinazione',
      save: 'Salva instradamento',
      incidents: 'Incidenti',
      incidentsText: 'Problemi che durano: restano aperti finché non si risolvono e mandano promemoria dopo 15 minuti, dopo un’ora e poi ogni 6 ore, finché non li segni come presi in carico.',
      open: 'Aperti',
      none: 'Nessun incidente aperto.',
      recent: 'Risolti di recente',
      ack: 'Preso in carico',
      acked: 'preso in carico da',
      openedAt: 'aperto',
      resolvedAt: 'risolto',
      reminders: 'promemoria',
      states: { pending: 'in attesa', sent: 'inviato', digest: 'nel riepilogo', digested: 'riepilogato', log: 'solo registro', failed: 'non consegnato' }
    },
    monitor: {
      title: 'Stato e allarmi',
      text: 'L’API controlla il bot ogni 30 secondi. Se non risponde per circa due minuti invia un allarme al webhook qui sotto, e un altro quando torna attivo. Gli avvisi passano da un webhook perché devono arrivare proprio quando il bot è fermo.',
      bot: 'Bot',
      up: 'Connesso',
      down: 'Non raggiungibile',
      unknown: 'In verifica',
      since: 'dal',
      lastCheck: 'ultimo controllo',
      servers: 'server',
      webhook: 'Webhook Discord per gli allarmi',
      webhookHelp: 'In un canale privato: Modifica canale → Integrazioni → Webhook → Nuovo webhook → Copia URL.',
      webhookSet: 'Webhook configurato',
      webhookNotSet: 'Nessun webhook: gli allarmi restano solo nel registro eventi.',
      save: 'Salva webhook',
      remove: 'Rimuovi',
      test: 'Invia prova',
      testOk: 'Messaggio di prova inviato.',
      events: 'Eventi dell’istanza',
      eventsText: 'Avvio e errori del bot, server aggiunti, rimossi o rifiutati, abbonamenti, bot giù e ripristinato. Conservati 90 giorni.',
      noEvents: 'Nessun evento registrato.',
      refresh: 'Aggiorna'
    },
    logs: {
      title: 'Log recenti',
      text: 'Le ultime righe di log di bot e API dall’ultimo riavvio, già ripulite da token e segreti. Restano solo in memoria; i file di Docker sono limitati a 50 MB per servizio.',
      service: 'Servizio',
      level: 'Livello minimo',
      empty: 'Nessuna riga per questo filtro.',
      refresh: 'Aggiorna',
      auto: 'Aggiornamento automatico'
    },
    discord: {
      title: 'Abbonamenti Discord',
      text: 'I piani a pagamento si vendono solo come abbonamenti mensili per server tramite le App premium di Discord, agli stessi prezzi della pagina prezzi. Crea gli SKU nel Portale sviluppatori (Monetizzazione) e incolla qui i loro ID: gli abbonamenti dei server si aggiornano da soli ogni due minuti.',
      sku: 'SKU mensile',
      price: 'Prezzo da impostare su Discord',
      save: 'Salva SKU',
      sync: 'Sincronizza ora',
      store: 'Apri lo store',
      notConfigured: 'Nessuno SKU configurato: i pulsanti “Abbonati” aprono lo store generico e gli acquisti non attivano alcun piano.',
      lastSync: 'Ultima sincronizzazione',
      never: 'non ancora eseguita',
      entitlements: 'abbonamenti attivi',
      changed: 'server aggiornati',
      failed: 'non riuscita: il bot non ha potuto leggere gli abbonamenti'
    },
    status: {
      title: 'Canale notifiche di stato',
      text: 'Destinazione predefinita degli allarmi: in Monitoraggio scegli quali categorie arrivano qui, in un altro canale o nel riepilogo giornaliero. Non contengono mai il contenuto dei ticket.',
      guild: 'Server',
      channel: 'Canale',
      choose: 'Scegli…',
      save: 'Salva canale',
      test: 'Invia messaggio di prova',
      remove: 'Disattiva notifiche',
      current: 'Configurazione attuale',
      notSet: 'Nessun canale configurato: le notifiche di stato non vengono inviate.',
      testOk: 'Messaggio di prova inviato.',
      testFailed: 'Invio non riuscito'
    },
    blacklist: 'Blacklist installazioni',
    blacklistText: 'Blocca preventivamente un server o un utente Discord. I server bloccati vengono espulsi anche se il bot viene aggiunto di nuovo. Un utente bloccato viene riconosciuto solo dove il bot può leggere il registro di controllo del server.',
    userId: 'Discord User ID',
    guildId: 'Discord Server ID',
    reason: 'Motivo opzionale',
    blockUser: 'Blocca utente',
    blockGuild: 'Blocca server',
    noBlocks: 'Nessun elemento in blacklist.',
    unblock: 'Sblocca',
    audit: 'Audit super-admin',
    auditText: 'Ultime azioni eseguite dalla super console e dal sistema (omaggi scaduti, abbonamenti, downgrade).',
    noAudit: 'Nessuna azione registrata.',
    loading: 'Caricamento super console…',
    denied: 'Accesso negato. Questa area è disponibile solo al super-admin configurato.',
    signedOut: 'Sessione assente o scaduta. Accedi con Discord per continuare.',
    failed: 'Operazione non riuscita',
    saved: 'Salvato.',
    blockedNotLeft: 'Blocco salvato, ma il bot non è riuscito a uscire subito: lo farà al prossimo avvio.',
    confirmLeave: 'Vuoi davvero far uscire Dispatch da questo server?',
    confirmBlock: 'Bloccare questo server e far uscire Dispatch? Il bot uscirà anche se verrà aggiunto di nuovo.',
    blockReason: 'Bloccato dalla lista server della super console',
    confirmUnblock: 'Rimuovere questo elemento dalla blacklist?',
    invalidId: 'Inserisci un Discord ID valido (17-20 cifre).',
    user: 'Utente',
    guild: 'Server',
    errors: {
      INVALID_SKU: 'ID SKU non valido (17-20 cifre).',
      DUPLICATE_SKU: 'Lo stesso SKU non può valere per due piani.',
      DISCORD_SYNC_FAILED: 'Sincronizzazione non riuscita: il bot non ha potuto leggere gli abbonamenti.',
      INVALID_WEBHOOK: 'URL del webhook non valido: copialo da Integrazioni → Webhook.',
      WEBHOOK_NOT_SET: 'Nessun webhook configurato.',
      WEBHOOK_FAILED: 'Discord ha rifiutato il messaggio: controlla che il webhook esista ancora.',
      CHANNEL_REQUIRED: 'Scegli server e canale per ogni categoria impostata su “Altro canale”.',
      CHANNEL_NOT_FOUND: 'Il canale non appartiene al server scelto o non può ricevere messaggi.',
      EXPIRY_IN_PAST: 'La scadenza è nel passato.',
      GUILD_NOT_FOUND: 'Server non presente nel database: il bot deve averlo registrato almeno una volta.',
      GUILD_NOT_CONNECTED: 'Il bot non è più in questo server.',
      STATUS_CHANNEL_NOT_SET: 'Nessun canale configurato.',
      BOT_UNAVAILABLE: 'Il bot non risponde.',
      RATE_LIMITED: 'Troppe modifiche in poco tempo. Riprova tra un minuto.',
      CANNOT_BLOCK_SUPER_ADMIN: 'Non puoi bloccare l’account super-admin.',
      INVALID_BODY: 'Dati non validi: controlla i campi (email valida, link https).',
      NOT_FOUND: 'Elemento non trovato: forse è già stato eliminato.'
    } as Record<string, string>
  },
  en: {
    kicker: 'SUPER CONSOLE',
    title: 'Global Dispatch control.',
    intro: 'Instance-owner area. Actions here affect every server connected to the bot and are recorded in the audit log.',
    refresh: 'Refresh',
    pricing: 'Pricing',
    tabs: { servers: 'Servers & plans', monitor: 'Monitoring', logs: 'Logs', contacts: 'Contacts', discord: 'Discord subscriptions', status: 'Notifications', blacklist: 'Blacklist', audit: 'Audit' },
    metrics: { servers: 'Connected servers', paid: 'With a plan', free: 'Free servers', subscriptions: 'Discord subscriptions', openTickets: 'Open tickets', bot: 'Bot', ready: 'Online', notReady: 'Not ready', offline: 'Offline' },
    liveServers: 'Connected servers',
    liveServersText: 'Live list from the bot’s Discord session, with tickets from the database. Assign each server a gift plan from here.',
    members: 'members',
    owner: 'Owner',
    installed: 'installed',
    tickets: (open: number, total: number) => `${open} open · ${total} total`,
    blocked: 'Blocked',
    leave: 'Leave server',
    blockLeave: 'Block & leave',
    managePlan: 'Manage plan',
    close: 'Close',
    noServers: 'Dispatch is not connected to any server.',
    botUnreachable: 'The bot’s internal API is unreachable: the server list is unavailable.',
    plansUnavailable: 'Plans, subscriptions and contacts are unavailable: re-run the installer on the VPS to update the database permissions.',
    plan: {
      tier: 'Gift plan',
      none: 'No gift',
      manual: 'Only free plans are assigned here (trial, partner, gift): paid plans are sold only through Discord. The higher of the gift and the Discord subscription applies.',
      discord: 'Discord subscription',
      renews: 'renews',
      cancelled: 'cancelled, until',
      gift: 'Gift',
      expires: 'Expiry',
      noExpiry: 'No expiry',
      plusMonth: '+1 month',
      plusYear: '+1 year',
      note: 'Internal note',
      notePlaceholder: 'E.g. 30-day trial for a partner server',
      save: 'Save gift',
      expiresOn: 'expires',
      expired: 'expired',
      confirmDowngrade: 'Lower the plan in force? Limits apply immediately: retention is capped, extra dashboard roles are removed and the Brand customisation is reset.'
    },
    contacts: {
      title: 'Public contacts',
      text: 'Shown on the pricing page to people with questions about plans, free trials and partnerships. Leave a field empty to hide it.',
      email: 'Email',
      discord: 'Discord (username or https link)',
      url: 'Link: Discord server, website or form (https)',
      save: 'Save contacts'
    },
    alerts: {
      routingTitle: 'Alert routing',
      routingText: 'Choose where each category goes. Messages use the bot language set in the destination server. Identical alerts within 10 minutes become a single message; critical ones mention you and ignore quiet hours. “Bot down” is reported by the external monitor (and by the webhook, if set).',
      categories: { availability: 'Availability', security: 'Security', errors: 'Errors', billing: 'Subscriptions', installations: 'Installations' },
      modes: { status: 'Status channel', channel: 'Another channel', digest: 'Daily digest', log: 'Log only' },
      server: 'Server',
      channel: 'Channel',
      choose: 'Choose…',
      mention: 'Mention me for critical alerts',
      quiet: 'Quiet hours',
      quietText: 'Only critical alerts arrive in this window; the others leave together when it ends.',
      from: 'From',
      to: 'to',
      timezone: 'Time zone',
      digest: 'Daily digest',
      digestText: 'One message a day with the count of informational alerts.',
      digestAt: 'Send at',
      digestWhere: 'Destination',
      save: 'Save routing',
      incidents: 'Incidents',
      incidentsText: 'Problems that last: they stay open until resolved and send reminders after 15 minutes, after an hour and then every 6 hours, until you acknowledge them.',
      open: 'Open',
      none: 'No open incidents.',
      recent: 'Recently resolved',
      ack: 'Acknowledge',
      acked: 'acknowledged by',
      openedAt: 'opened',
      resolvedAt: 'resolved',
      reminders: 'reminders',
      states: { pending: 'pending', sent: 'sent', digest: 'in digest', digested: 'digested', log: 'log only', failed: 'not delivered' }
    },
    monitor: {
      title: 'Status and alarms',
      text: 'The API checks the bot every 30 seconds. If it does not answer for about two minutes, an alarm is posted to the webhook below, and another one when it is back. Alarms use a webhook because they must arrive precisely when the bot is not running.',
      bot: 'Bot',
      up: 'Connected',
      down: 'Unreachable',
      unknown: 'Checking',
      since: 'since',
      lastCheck: 'last check',
      servers: 'servers',
      webhook: 'Discord webhook for alarms',
      webhookHelp: 'In a private channel: Edit channel → Integrations → Webhooks → New webhook → Copy URL.',
      webhookSet: 'Webhook configured',
      webhookNotSet: 'No webhook: alarms are only kept in the event log.',
      save: 'Save webhook',
      remove: 'Remove',
      test: 'Send test',
      testOk: 'Test message sent.',
      events: 'Instance events',
      eventsText: 'Bot startup and errors, servers added, removed or rejected, subscriptions, bot down and restored. Kept for 90 days.',
      noEvents: 'No events recorded.',
      refresh: 'Refresh'
    },
    logs: {
      title: 'Recent logs',
      text: 'The latest log lines of the bot and the API since their last restart, with tokens and secrets redacted. They stay in memory only; Docker log files are capped at 50 MB per service.',
      service: 'Service',
      level: 'Minimum level',
      empty: 'No lines for this filter.',
      refresh: 'Refresh',
      auto: 'Auto refresh'
    },
    discord: {
      title: 'Discord subscriptions',
      text: 'Paid plans are sold only as monthly per-server subscriptions through Discord Premium Apps, at the same prices as the pricing page. Create the SKUs in the Developer Portal (Monetization) and paste their IDs here: server subscriptions update by themselves every two minutes.',
      sku: 'Monthly SKU',
      price: 'Price to set on Discord',
      save: 'Save SKUs',
      sync: 'Sync now',
      store: 'Open the store',
      notConfigured: 'No SKU configured: the “Subscribe” buttons open the generic store and purchases do not turn any plan on.',
      lastSync: 'Last sync',
      never: 'not run yet',
      entitlements: 'active subscriptions',
      changed: 'servers updated',
      failed: 'failed: the bot could not read the subscriptions'
    },
    status: {
      title: 'Status notification channel',
      text: 'Default destination for alerts: in Monitoring choose which categories arrive here, in another channel or in the daily digest. They never contain ticket content.',
      guild: 'Server',
      channel: 'Channel',
      choose: 'Choose…',
      save: 'Save channel',
      test: 'Send a test message',
      remove: 'Turn off notifications',
      current: 'Current configuration',
      notSet: 'No channel configured: status notifications are not sent.',
      testOk: 'Test message sent.',
      testFailed: 'Delivery failed'
    },
    blacklist: 'Installation blacklist',
    blacklistText: 'Preemptively block a Discord server or user. Blocked servers are left even if the bot is added again. A blocked user is recognised only where the bot can read the server’s audit log.',
    userId: 'Discord User ID',
    guildId: 'Discord Server ID',
    reason: 'Optional reason',
    blockUser: 'Block user',
    blockGuild: 'Block server',
    noBlocks: 'Nothing is blacklisted.',
    unblock: 'Unblock',
    audit: 'Super-admin audit',
    auditText: 'Latest actions from the super console and the system (expired gifts, subscriptions, downgrades).',
    noAudit: 'No actions recorded.',
    loading: 'Loading super console…',
    denied: 'Access denied. This area is available only to the configured super-admin.',
    signedOut: 'No session or session expired. Sign in with Discord to continue.',
    failed: 'Operation failed',
    saved: 'Saved.',
    blockedNotLeft: 'Block saved, but the bot could not leave right away: it will at its next start.',
    confirmLeave: 'Do you really want Dispatch to leave this server?',
    confirmBlock: 'Block this server and make Dispatch leave it? The bot will leave even if it is added again.',
    blockReason: 'Blocked from the super console server list',
    confirmUnblock: 'Remove this item from the blacklist?',
    invalidId: 'Enter a valid Discord ID (17-20 digits).',
    user: 'User',
    guild: 'Server',
    errors: {
      INVALID_SKU: 'Invalid SKU ID (17-20 digits).',
      DUPLICATE_SKU: 'The same SKU cannot be used for two plans.',
      DISCORD_SYNC_FAILED: 'Sync failed: the bot could not read the subscriptions.',
      INVALID_WEBHOOK: 'Invalid webhook URL: copy it from Integrations → Webhooks.',
      WEBHOOK_NOT_SET: 'No webhook configured.',
      WEBHOOK_FAILED: 'Discord rejected the message: check that the webhook still exists.',
      CHANNEL_REQUIRED: 'Choose a server and a channel for every category set to “Another channel”.',
      CHANNEL_NOT_FOUND: 'The channel does not belong to the selected server or cannot receive messages.',
      EXPIRY_IN_PAST: 'The expiry date is in the past.',
      GUILD_NOT_FOUND: 'Server not in the database: the bot must have registered it at least once.',
      GUILD_NOT_CONNECTED: 'The bot is no longer in this server.',
      STATUS_CHANNEL_NOT_SET: 'No channel configured.',
      BOT_UNAVAILABLE: 'The bot is not responding.',
      RATE_LIMITED: 'Too many changes in a short time. Try again in a minute.',
      CANNOT_BLOCK_SUPER_ADMIN: 'You cannot block the super-admin account.',
      INVALID_BODY: 'Invalid data: check the fields (valid email, https link).',
      NOT_FOUND: 'Item not found: it may have been deleted already.'
    } as Record<string, string>
  }
};

type Copy = (typeof copy)['it'];
type Tab = 'servers' | 'monitor' | 'logs' | 'contacts' | 'discord' | 'status' | 'blacklist' | 'audit';
type Status = { kind: 'ok' | 'error'; text: string } | null;
type Action = (url: string, init: RequestInit, options?: { reload?: boolean; quiet?: boolean }) => Promise<Record<string, unknown>>;
type SetStatus = (value: Status) => void;
type Fmt = (value: string | null, withTime?: boolean) => string;
type TabProps = { data: Overview; c: Copy; locale: Locale; action: Action; fmt: Fmt };

class ActionError extends Error {}
const ignore = () => undefined;

export default function SuperConsole({ locale }: { locale: Locale }) {
  const c = copy[locale];
  const chrome = chromeCopy[locale];
  const [data, setData] = useState<Overview | null>(null);
  const [denied, setDenied] = useState<'' | 'signed-out' | 'forbidden'>('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<Status>(null);
  const [tab, setTab] = useState<Tab>('servers');

  const load = useCallback(async () => {
    const response = await fetch('/backend/api/super/overview', { credentials: 'same-origin' });
    if (response.status === 401) { setDenied('signed-out'); return; }
    if (response.status === 403) { setDenied('forbidden'); return; }
    if (!response.ok) throw new Error('LOAD_FAILED');
    setData(await response.json() as Overview);
    setDenied('');
    setError('');
  }, []);

  useEffect(() => {
    load().catch(() => setError(c.failed));
  }, [load, c.failed]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), status.kind === 'error' ? 6000 : 2500);
    return () => window.clearTimeout(timer);
  }, [status]);

  /** Runs a request, reloads the overview and reports the outcome. */
  const action = useCallback<Action>(async (url, init, options = {}) => {
    setStatus(null);
    const response = await fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const code = typeof body.error === 'string' ? body.error : `HTTP_${response.status}`;
      const text = c.errors[code] ?? `${c.failed} (${code})`;
      setStatus({ kind: 'error', text });
      if (code === 'GUILD_NOT_CONNECTED') await load().catch(ignore);
      throw new ActionError(text);
    }
    if (options.reload !== false) await load();
    if (!options.quiet) setStatus({ kind: 'ok', text: c.saved });
    return body;
  }, [c, load]);

  const fmt = useCallback<Fmt>((value, withTime = true) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-GB', withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
  }, [locale]);

  const num = (value: number) => value.toLocaleString(locale === 'it' ? 'it-IT' : 'en-US');
  const bot = data?.bot.status ?? null;
  const botState = !data ? null : !data.bot.reachable || !bot ? 'offline' : bot.ready ? 'ready' : 'notReady';
  const plans = data?.plans ?? null;
  const planRows = new Map((plans?.plans ?? []).map((row) => [row.guildId, row]));
  const guildPlans = (data?.guilds ?? []).map((guild) => guildPlan(planRows.get(guild.id)));

  const tabs: Array<{ key: Tab; icon: IconName; label: string }> = [
    { key: 'servers', icon: 'grid', label: c.tabs.servers },
    { key: 'monitor', icon: 'globe', label: c.tabs.monitor },
    { key: 'logs', icon: 'terminal', label: c.tabs.logs },
    { key: 'contacts', icon: 'users', label: c.tabs.contacts },
    { key: 'discord', icon: 'key', label: c.tabs.discord },
    { key: 'status', icon: 'bolt', label: c.tabs.status },
    { key: 'blacklist', icon: 'lock', label: c.tabs.blacklist },
    { key: 'audit', icon: 'clock', label: c.tabs.audit }
  ];

  return (
    <main className="public-site super-console" lang={locale}>
      <SiteHeader
        locale={locale}
        homeHref={`/${locale}`}
        links={[
          { href: '/dashboard', label: chrome.dashboard },
          { href: `/${locale}/pricing`, label: c.pricing },
          { href: '/super', label: chrome.superConsole, current: true }
        ]}
        actions={<>
          <LocaleToggle />
          <button type="button" className="button button-ghost" onClick={() => void logout()}><Icon name="logout" size={15} />{chrome.logout}</button>
        </>}
      />

      <section className="page">
        <div className="site-container">
          <div className="page-head">
            <div>
              <span className="kicker kicker-danger">{c.kicker}</span>
              <h1>{c.title}</h1>
              <p>{c.intro}</p>
            </div>
            {data && (
              <div className="page-head-actions">
                <button type="button" className="button button-secondary" onClick={() => void load().catch(() => setError(c.failed))}>
                  <Icon name="refresh" size={15} />{c.refresh}
                </button>
              </div>
            )}
          </div>

          {status && <div className={`toast ${status.kind === 'error' ? 'toast-error' : ''}`} role="status" onClick={() => setStatus(null)}>{status.text}</div>}
          {error && <div className="notice notice-error" role="alert">{error}</div>}
          {denied === 'forbidden' && <div className="notice notice-error">{c.denied}</div>}
          {denied === 'signed-out' && (
            <div className="card card-feature">
              <span className="kicker">{c.kicker}</span>
              <h2>{c.signedOut}</h2>
              <a className="button button-primary button-lg" href={loginHref}>{chrome.signInDiscord}<Icon name="arrowRight" size={16} /></a>
            </div>
          )}
          {!data && !denied && !error && <div className="card">{c.loading}</div>}

          {data && <>
            <div className="metric-row">
              <div className="metric"><span>{c.metrics.servers}</span><strong>{num(data.metrics.connectedGuilds)}</strong></div>
              <div className="metric"><span>{c.metrics.paid}</span><strong>{num(guildPlans.filter((plan) => plan.effective !== 'FREE').length)}</strong></div>
              <div className="metric"><span>{c.metrics.free}</span><strong>{num(guildPlans.filter((plan) => plan.effective === 'FREE').length)}</strong></div>
              <div className="metric"><span>{c.metrics.subscriptions}</span><strong>{num(guildPlans.filter((plan) => plan.subscription !== 'FREE').length)}</strong></div>
              <div className="metric"><span>{c.metrics.openTickets}</span><strong>{num(data.metrics.openTickets)}</strong></div>
              <div className={`metric ${botState === 'ready' ? 'metric-ok' : botState === 'notReady' ? 'metric-warn' : 'metric-danger'}`}>
                <span>{c.metrics.bot}</span>
                <strong>{botState === 'ready' ? c.metrics.ready : botState === 'notReady' ? c.metrics.notReady : c.metrics.offline}</strong>
              </div>
            </div>

            {!plans && <div className="notice notice-warn" role="status">{c.plansUnavailable}</div>}

            <nav className="console-tabs" aria-label={c.kicker}>
              {tabs.map((item) => (
                <button type="button" key={item.key} className={tab === item.key ? 'active' : ''} aria-current={tab === item.key ? 'page' : undefined} onClick={() => setTab(item.key)}>
                  <Icon name={item.icon} size={15} />{item.label}
                </button>
              ))}
            </nav>

            {tab === 'servers' && <ServersTab data={data} c={c} locale={locale} action={action} fmt={fmt} />}
            {tab === 'monitor' && <MonitorTab data={data} c={c} locale={locale} action={action} fmt={fmt} setStatus={setStatus} />}
            {tab === 'logs' && <LogsTab c={c} fmt={fmt} />}
            {tab === 'contacts' && plans && <ContactsTab config={plans.config} c={c} action={action} />}
            {tab === 'discord' && plans && <DiscordTab discord={plans.discord} catalog={plans.planCatalog} c={c} locale={locale} action={action} fmt={fmt} />}
            {tab === 'status' && <StatusTab data={data} c={c} action={action} fmt={fmt} setStatus={setStatus} />}
            {tab === 'blacklist' && <BlacklistTab data={data} c={c} action={action} fmt={fmt} setStatus={setStatus} />}
            {tab === 'audit' && (
              <section className="card">
                <div className="card-head"><div><span className="kicker">Audit</span><h2>{c.audit}</h2><p>{c.auditText}</p></div></div>
                {!data.audit.length && <div className="empty">{c.noAudit}</div>}
                <div className="log-table">
                  {data.audit.map((item) => (
                    <div className="log-row" key={item.id}>
                      <strong className="mono">{item.action}</strong>
                      <span>{item.subjectType ? <>{item.subjectType} · <span className="mono">{item.subjectId}</span></> : '—'}</span>
                      <span>{item.username}</span>
                      <time className="mono" dateTime={item.createdAt}>{fmt(item.createdAt)}</time>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>}
        </div>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------------ servers */

function ServersTab({ data, c, locale, action, fmt }: TabProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const rows = new Map((data.plans?.plans ?? []).map((row) => [row.guildId, row]));

  const leave = (guild: Guild) => {
    if (confirm(c.confirmLeave)) action(`/backend/api/super/guilds/${guild.id}/leave`, { method: 'POST', body: '{}' }).catch(ignore);
  };
  const blockGuild = (guild: Guild) => {
    if (confirm(c.confirmBlock)) {
      action(`/backend/api/super/blocks/GUILD/${guild.id}`, { method: 'PUT', body: JSON.stringify({ reason: c.blockReason }) }).catch(ignore);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <div><span className="kicker">Discord</span><h2>{c.liveServers}</h2><p>{c.liveServersText}</p></div>
      </div>
      {!data.bot.reachable && <div className="notice notice-warn">{c.botUnreachable}</div>}
      {data.bot.reachable && !data.guilds.length && <div className="empty">{c.noServers}</div>}
      <div className="table-list">
        {data.guilds.map((guild) => {
          const plan = guildPlan(rows.get(guild.id));
          const giftExpired = plan.gift !== 'FREE' && plan.giftRunning === 'FREE';
          return (
            <article className="super-guild-block" key={guild.id}>
              <div className="super-guild">
                <div className="super-guild-identity">
                  {guild.iconUrl ? <img src={guild.iconUrl} alt="" /> : <div className="guild-placeholder">{initial(guild.name)}</div>}
                  <div><strong title={guild.name}>{guild.name}</strong><span className="mono">{guild.id}</span></div>
                </div>
                <div className="super-guild-meta">
                  <span>{c.owner}: <span className="mono">{guild.ownerId}</span></span>
                  <span>{guild.memberCount.toLocaleString(locale === 'it' ? 'it-IT' : 'en-US')} {c.members} · {c.installed} {fmt(guild.installedAt, false)}</span>
                  <span>{c.tickets(guild.openTickets, guild.totalTickets)}</span>
                </div>
                <div className="super-guild-plan">
                  <span className={`tag ${plan.effective !== 'FREE' ? 'tag-accent' : ''}`}>{TIER_NAMES[plan.effective]}</span>
                  {plan.subscription !== 'FREE' && (
                    <small>{c.plan.discord} · {plan.subscriptionEndsAt ? `${c.plan.cancelled} ${fmt(plan.subscriptionEndsAt, false)}` : c.plan.renews}</small>
                  )}
                  {plan.gift !== 'FREE' && (
                    <small className={giftExpired ? 'text-danger' : ''}>
                      {c.plan.gift} {TIER_NAMES[plan.gift]}{plan.giftExpiresAt ? ` · ${giftExpired ? c.plan.expired : c.plan.expiresOn} ${fmt(plan.giftExpiresAt, false)}` : ''}
                    </small>
                  )}
                  {guild.blocked && <span className="tag tag-danger">{c.blocked}</span>}
                </div>
                <div className="super-guild-actions">
                  {data.plans && (
                    <button type="button" className="button button-sm button-primary" onClick={() => setEditing(editing === guild.id ? null : guild.id)}>
                      {editing === guild.id ? c.close : c.managePlan}
                    </button>
                  )}
                  <button type="button" className="button button-sm button-secondary" onClick={() => leave(guild)}>{c.leave}</button>
                  <button type="button" className="button button-sm button-danger" onClick={() => blockGuild(guild)}>{c.blockLeave}</button>
                </div>
              </div>
              {editing === guild.id && <PlanEditor guild={guild} plan={plan} c={c} action={action} onDone={() => setEditing(null)} />}
            </article>
          );
        })}
      </div>
    </section>
  );
}

const toDateInput = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

function PlanEditor({ guild, plan, c, action, onDone }: { guild: Guild; plan: GuildPlan; c: Copy; action: Action; onDone: () => void }) {
  const [tier, setTier] = useState<PlanTier>(plan.gift);
  const [expires, setExpires] = useState(toDateInput(plan.giftExpiresAt));
  const [note, setNote] = useState(plan.note ?? '');
  const free = tier === 'FREE';

  const extend = (months: number) => {
    const start = expires && new Date(`${expires}T23:59:59`).getTime() > Date.now() ? new Date(`${expires}T12:00:00`) : new Date();
    start.setMonth(start.getMonth() + months);
    setExpires(toDateInput(start.toISOString()));
  };

  const save = () => {
    const nextEffective = tierIndex(plan.subscription) > tierIndex(tier) ? plan.subscription : tier;
    if (tierIndex(nextEffective) < tierIndex(plan.effective) && !confirm(c.plan.confirmDowngrade)) return;
    action(`/backend/api/super/guilds/${guild.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({
        tier,
        // End of the chosen day, in the browser's time zone.
        expiresAt: free || !expires ? null : new Date(`${expires}T23:59:59`).toISOString(),
        note: note.trim() || null
      })
    }).then(onDone, ignore);
  };

  return (
    <div className="plan-editor">
      <p className="muted">{c.plan.manual}</p>
      <div className="inline-fields">
        <label>{c.plan.tier}<select value={tier} onChange={(e) => { if (isPlanTier(e.target.value)) setTier(e.target.value); }}>
          {PLAN_TIERS.map((item) => <option key={item} value={item}>{item === 'FREE' ? c.plan.none : TIER_NAMES[item]}</option>)}
        </select></label>
        <label>{c.plan.expires}<input disabled={free} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
      </div>
      {!free && <div className="plan-editor-quick">
        <button type="button" className="button button-sm button-ghost" onClick={() => extend(1)}>{c.plan.plusMonth}</button>
        <button type="button" className="button button-sm button-ghost" onClick={() => extend(12)}>{c.plan.plusYear}</button>
        <button type="button" className="button button-sm button-ghost" onClick={() => setExpires('')}>{c.plan.noExpiry}</button>
      </div>}
      <label>{c.plan.note}<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={c.plan.notePlaceholder} /></label>
      <button type="button" className="button button-primary" onClick={save}>{c.plan.save}</button>
    </div>
  );
}

/* ------------------------------------------------------------------ monitor */

type MonitorEvent = { id: string; source: string; level: string; category: string; severity: string; deliveryState: string; title: string; description: string | null; fields: Array<{ name: string; value: string }>; createdAt: string };
type Monitor = {
  bot: { status: 'unknown' | 'up' | 'down'; since: string; lastCheck: string | null; guilds: number | null };
  events: MonitorEvent[];
  webhook: { configured: boolean; hint: string | null };
};

function MonitorTab({ data, c, locale, action, fmt, setStatus }: TabProps & { setStatus: SetStatus }) {
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [url, setUrl] = useState('');
  const load = useCallback(() => fetch(`/backend/api/super/monitor?locale=${locale}`, { credentials: 'same-origin' })
    .then((response) => response.ok ? response.json() : null)
    .then((value: Monitor | null) => { if (value) setMonitor(value); })
    .catch(() => null), [locale]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const saveWebhook = (value: string | null) => action('/backend/api/super/alert-webhook', { method: 'PUT', body: JSON.stringify({ url: value }) }, { reload: false })
    .then(() => { setUrl(''); void load(); }, ignore);
  const test = () => action('/backend/api/super/alert-webhook/test', { method: 'POST', body: '{}' }, { reload: false, quiet: true })
    .then(() => setStatus({ kind: 'ok', text: c.monitor.testOk }), ignore);

  const bot = monitor?.bot;
  const label = bot ? { up: c.monitor.up, down: c.monitor.down, unknown: c.monitor.unknown }[bot.status] : c.monitor.unknown;

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div><span className="kicker">{c.tabs.monitor}</span><h2>{c.monitor.title}</h2><p>{c.monitor.text}</p></div>
          <button type="button" className="button button-sm button-secondary" onClick={() => void load()}>{c.monitor.refresh}</button>
        </div>
        <div className="monitor-status">
          <span className={`status-dot status-${bot?.status ?? 'unknown'}`} aria-hidden="true" />
          <strong>{c.monitor.bot}: {label}</strong>
          {bot && <span>{c.monitor.since} {fmt(bot.since)}{bot.lastCheck ? ` · ${c.monitor.lastCheck} ${fmt(bot.lastCheck)}` : ''}{bot.guilds !== null && bot.status === 'up' ? ` · ${bot.guilds} ${c.monitor.servers}` : ''}</span>}
        </div>
        <label>{c.monitor.webhook}
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={monitor?.webhook.configured ? `${c.monitor.webhookSet} (${monitor.webhook.hint})` : 'https://discord.com/api/webhooks/…'} />
          <small className="field-help">{c.monitor.webhookHelp}</small>
        </label>
        {monitor && !monitor.webhook.configured && <p className="muted">{c.monitor.webhookNotSet}</p>}
        <div className="guide-actions">
          <button type="button" className="button button-primary" disabled={!url.trim()} onClick={() => void saveWebhook(url.trim())}>{c.monitor.save}</button>
          {monitor?.webhook.configured && <button type="button" className="button button-secondary" onClick={() => void test()}>{c.monitor.test}</button>}
          {monitor?.webhook.configured && <button type="button" className="button button-danger" onClick={() => void saveWebhook(null)}>{c.monitor.remove}</button>}
        </div>
      </section>

      <IncidentsCard c={c} locale={locale} action={action} fmt={fmt} />
      <RoutingCard data={data} c={c} locale={locale} action={action} />

      <section className="card">
        <div className="card-head"><div><span className="kicker">{c.tabs.monitor}</span><h2>{c.monitor.events}</h2><p>{c.monitor.eventsText}</p></div></div>
        {monitor && !monitor.events.length && <div className="empty">{c.monitor.noEvents}</div>}
        <div className="log-table">
          {monitor?.events.map((event) => (
            <div className="log-row event-row" key={event.id}>
              <span className={`level-badge level-${event.level}`}>{event.severity}</span>
              <div>
                <strong>{event.title}</strong>
                <span className="event-meta">{c.alerts.categories[event.category as AlertCategoryKey] ?? event.category} · {c.alerts.states[event.deliveryState as keyof Copy['alerts']['states']] ?? event.deliveryState}</span>
                {event.description && <span>{event.description}</span>}
                {event.fields.map((field) => <span key={field.name} className="event-field"><b>{field.name}:</b> {field.value}</span>)}
              </div>
              <span className="mono">{event.source}</span>
              <time className="mono">{fmt(event.createdAt)}</time>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------- alerts */

const ALERT_CATEGORY_KEYS = ['availability', 'security', 'errors', 'billing', 'installations'] as const;
type AlertCategoryKey = (typeof ALERT_CATEGORY_KEYS)[number];
type RouteMode = 'status' | 'channel' | 'digest' | 'log';
type AlertRoute = { mode: RouteMode; guildId: string | null; channelId: string | null; mention: boolean };
type AlertSettings = {
  routes: Record<AlertCategoryKey, AlertRoute>;
  quietHours: { enabled: boolean; start: string; end: string };
  digest: { time: string; mode: 'status' | 'channel'; guildId: string | null; channelId: string | null };
  timezone: string;
};
type Incident = { id: string; key: string; category: string; severity: string; title: string; description: string | null; openedAt: string; resolvedAt: string | null; acknowledgedAt: string | null; acknowledgedBy: string | null; reminders: number };
type AlertsData = { settings: AlertSettings; incidents: { open: Incident[]; recent: Incident[] }; mentionAvailable: boolean };

function useAlerts(locale: Locale) {
  const [alerts, setAlerts] = useState<AlertsData | null>(null);
  const load = useCallback(() => fetch(`/backend/api/super/alerts?locale=${locale}`, { credentials: 'same-origin' })
    .then((response) => response.ok ? response.json() : null)
    .then((value: AlertsData | null) => { if (value) setAlerts(value); })
    .catch(() => null), [locale]);
  useEffect(() => { void load(); }, [load]);
  return { alerts, load };
}

/** Text channels of a server the bot is in, loaded on demand. */
function useChannels(guildId: string | null) {
  const [channels, setChannels] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (!guildId) { setChannels([]); return; }
    let cancelled = false;
    fetch(`/backend/api/super/status-channel/channels?guildId=${guildId}`, { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : [])
      .then((rows: Array<{ id: string; name: string }>) => { if (!cancelled) setChannels(rows); })
      .catch(() => { if (!cancelled) setChannels([]); });
    return () => { cancelled = true; };
  }, [guildId]);
  return channels;
}

function ChannelPicker({ data, c, guildId, channelId, onChange }: { data: Overview; c: Copy; guildId: string | null; channelId: string | null; onChange: (guildId: string | null, channelId: string | null) => void }) {
  const channels = useChannels(guildId);
  return (
    <div className="inline-fields alert-picker">
      <label>{c.alerts.server}<select value={guildId ?? ''} onChange={(e) => onChange(e.target.value || null, null)}>
        <option value="">{c.alerts.choose}</option>
        {data.guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
      </select></label>
      <label>{c.alerts.channel}<select value={channelId ?? ''} disabled={!guildId} onChange={(e) => onChange(guildId, e.target.value || null)}>
        <option value="">{c.alerts.choose}</option>
        {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
      </select></label>
    </div>
  );
}

function IncidentsCard({ c, locale, action, fmt }: { c: Copy; locale: Locale; action: Action; fmt: Fmt }) {
  const { alerts, load } = useAlerts(locale);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);
  const ack = (incident: Incident) => action(`/backend/api/super/incidents/${incident.id}/ack`, { method: 'POST', body: '{}' }, { reload: false }).then(() => void load(), ignore);
  const row = (incident: Incident, open: boolean) => (
    <div className="log-row event-row" key={incident.id}>
      <span className={`level-badge level-${incident.severity === 'critical' ? 'error' : incident.severity === 'warning' ? 'warn' : 'info'}`}>{incident.severity}</span>
      <div>
        <strong>{incident.title}</strong>
        {incident.description && <span>{incident.description}</span>}
        <span className="event-meta">
          {c.alerts.categories[incident.category as AlertCategoryKey] ?? incident.category} · {c.alerts.openedAt} {fmt(incident.openedAt)}
          {incident.resolvedAt ? ` · ${c.alerts.resolvedAt} ${fmt(incident.resolvedAt)}` : ''}
          {incident.reminders ? ` · ${incident.reminders} ${c.alerts.reminders}` : ''}
          {incident.acknowledgedAt ? ` · ${c.alerts.acked} ${incident.acknowledgedBy ?? '—'}` : ''}
        </span>
      </div>
      <span className="mono">{incident.key}</span>
      {open && !incident.acknowledgedAt ? <button type="button" className="button button-sm button-secondary" onClick={() => void ack(incident)}>{c.alerts.ack}</button> : <span />}
    </div>
  );
  return (
    <section className="card">
      <div className="card-head"><div><span className="kicker">{c.tabs.monitor}</span><h2>{c.alerts.incidents}</h2><p>{c.alerts.incidentsText}</p></div></div>
      <h3 className="console-subtitle">{c.alerts.open}</h3>
      {alerts && !alerts.incidents.open.length && <div className="empty">{c.alerts.none}</div>}
      <div className="log-table">{alerts?.incidents.open.map((incident) => row(incident, true))}</div>
      {alerts && alerts.incidents.recent.length > 0 && <>
        <h3 className="console-subtitle">{c.alerts.recent}</h3>
        <div className="log-table">{alerts.incidents.recent.map((incident) => row(incident, false))}</div>
      </>}
    </section>
  );
}

function RoutingCard({ data, c, locale, action }: { data: Overview; c: Copy; locale: Locale; action: Action }) {
  const { alerts } = useAlerts(locale);
  const [draft, setDraft] = useState<AlertSettings | null>(null);
  useEffect(() => { if (alerts && !draft) setDraft(alerts.settings); }, [alerts, draft]);
  if (!draft) return null;

  const setRoute = (category: AlertCategoryKey, patch: Partial<AlertRoute>) =>
    setDraft({ ...draft, routes: { ...draft.routes, [category]: { ...draft.routes[category], ...patch } } });
  const save = () => action('/backend/api/super/alerts/settings', { method: 'PUT', body: JSON.stringify(draft) }, { reload: false })
    .then((body) => { if (body.settings) setDraft(body.settings as AlertSettings); }, ignore);

  return (
    <section className="card">
      <div className="card-head"><div><span className="kicker">{c.tabs.monitor}</span><h2>{c.alerts.routingTitle}</h2><p>{c.alerts.routingText}</p></div></div>
      <div className="alert-routes">
        {ALERT_CATEGORY_KEYS.map((category) => {
          const route = draft.routes[category];
          return (
            <div className="alert-route" key={category}>
              <strong>{c.alerts.categories[category]}</strong>
              <select value={route.mode} onChange={(e) => setRoute(category, { mode: e.target.value as RouteMode, ...(e.target.value === 'channel' ? {} : { guildId: null, channelId: null }) })}>
                {(['status', 'channel', 'digest', 'log'] as const).map((mode) => <option key={mode} value={mode}>{c.alerts.modes[mode]}</option>)}
              </select>
              {alerts?.mentionAvailable && (route.mode === 'status' || route.mode === 'channel') && (
                <label className="check"><input type="checkbox" checked={route.mention} onChange={(e) => setRoute(category, { mention: e.target.checked })} />{c.alerts.mention}</label>
              )}
              {route.mode === 'channel' && <ChannelPicker data={data} c={c} guildId={route.guildId} channelId={route.channelId} onChange={(guildId, channelId) => setRoute(category, { guildId, channelId })} />}
            </div>
          );
        })}
      </div>

      <h3 className="console-subtitle">{c.alerts.quiet}</h3>
      <p className="muted">{c.alerts.quietText}</p>
      <div className="inline-fields">
        <label className="check"><input type="checkbox" checked={draft.quietHours.enabled} onChange={(e) => setDraft({ ...draft, quietHours: { ...draft.quietHours, enabled: e.target.checked } })} />{c.alerts.quiet}</label>
        <label>{c.alerts.from}<input type="time" value={draft.quietHours.start} onChange={(e) => setDraft({ ...draft, quietHours: { ...draft.quietHours, start: e.target.value } })} /></label>
        <label>{c.alerts.to}<input type="time" value={draft.quietHours.end} onChange={(e) => setDraft({ ...draft, quietHours: { ...draft.quietHours, end: e.target.value } })} /></label>
        <label>{c.alerts.timezone}<input value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} placeholder="Europe/Rome" /></label>
      </div>

      <h3 className="console-subtitle">{c.alerts.digest}</h3>
      <p className="muted">{c.alerts.digestText}</p>
      <div className="inline-fields">
        <label>{c.alerts.digestAt}<input type="time" value={draft.digest.time} onChange={(e) => setDraft({ ...draft, digest: { ...draft.digest, time: e.target.value } })} /></label>
        <label>{c.alerts.digestWhere}<select value={draft.digest.mode} onChange={(e) => setDraft({ ...draft, digest: { ...draft.digest, mode: e.target.value as 'status' | 'channel', ...(e.target.value === 'channel' ? {} : { guildId: null, channelId: null }) } })}>
          <option value="status">{c.alerts.modes.status}</option>
          <option value="channel">{c.alerts.modes.channel}</option>
        </select></label>
      </div>
      {draft.digest.mode === 'channel' && <ChannelPicker data={data} c={c} guildId={draft.digest.guildId} channelId={draft.digest.channelId} onChange={(guildId, channelId) => setDraft({ ...draft, digest: { ...draft.digest, guildId, channelId } })} />}

      <button type="button" className="button button-primary" onClick={() => void save()}>{c.alerts.save}</button>
    </section>
  );
}

/* --------------------------------------------------------------------- logs */

type LogLine = { time: string; level: string; msg: string; context: Record<string, unknown> | null };

function LogsTab({ c, fmt }: { c: Copy; fmt: Fmt }) {
  const [service, setService] = useState<'bot' | 'api'>('bot');
  const [level, setLevel] = useState('info');
  const [auto, setAuto] = useState(false);
  const [lines, setLines] = useState<LogLine[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    const query = new URLSearchParams({ service, level, limit: '300' });
    return fetch(`/backend/api/super/logs?${query}`, { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then((value: { entries: LogLine[] }) => { setLines(value.entries); setFailed(false); })
      .catch(() => setFailed(true));
  }, [service, level]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [auto, load]);

  return (
    <section className="card">
      <div className="card-head"><div><span className="kicker">{c.tabs.logs}</span><h2>{c.logs.title}</h2><p>{c.logs.text}</p></div></div>
      <div className="inline-fields">
        <label>{c.logs.service}<select value={service} onChange={(e) => setService(e.target.value === 'api' ? 'api' : 'bot')}><option value="bot">Bot</option><option value="api">API</option></select></label>
        <label>{c.logs.level}<select value={level} onChange={(e) => setLevel(e.target.value)}>{['debug', 'info', 'warn', 'error'].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />{c.logs.auto}</label>
        <button type="button" className="button button-sm button-secondary" onClick={() => void load()}>{c.logs.refresh}</button>
      </div>
      {failed && <div className="notice notice-error">{c.errors.BOT_UNAVAILABLE}</div>}
      {lines && !lines.length && <div className="empty">{c.logs.empty}</div>}
      <div className="log-lines">
        {lines?.map((line, index) => (
          <details className={`log-line level-${line.level}`} key={`${line.time}-${index}`}>
            <summary><time className="mono">{fmt(line.time)}</time><span className={`level-badge level-${line.level}`}>{line.level}</span><span className="log-msg">{line.msg || '—'}</span></summary>
            {line.context && <pre>{JSON.stringify(line.context, null, 2)}</pre>}
          </details>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- contacts */

function ContactsTab({ config, c, action }: { config: Config; c: Copy; action: Action }) {
  const [email, setEmail] = useState(config.contactEmail ?? '');
  const [discord, setDiscord] = useState(config.contactDiscord ?? '');
  const [url, setUrl] = useState(config.contactUrl ?? '');
  // An empty string clears the contact.
  const save = () => action('/backend/api/super/config', {
    method: 'PUT',
    body: JSON.stringify({ contactEmail: email.trim(), contactDiscord: discord.trim(), contactUrl: url.trim() })
  }).catch(ignore);

  return (
    <section className="card">
      <div className="card-head"><div><span className="kicker">{c.tabs.contacts}</span><h2>{c.contacts.title}</h2><p>{c.contacts.text}</p></div></div>
      <div className="inline-fields">
        <label>{c.contacts.email}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} /></label>
        <label>{c.contacts.discord}<input value={discord} onChange={(e) => setDiscord(e.target.value)} maxLength={200} /></label>
        <label>{c.contacts.url}<input type="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} placeholder="https://" /></label>
      </div>
      <button type="button" className="button button-primary" onClick={() => void save()}>{c.contacts.save}</button>
    </section>
  );
}

/* ------------------------------------------------------------------ discord */

function DiscordTab({ discord, catalog, c, locale, action, fmt }: { discord: DiscordOverview; catalog: PlansOverview['planCatalog']; c: Copy; locale: Locale; action: Action; fmt: Fmt }) {
  const [skus, setSkus] = useState<Record<PaidTier, string>>(() => ({
    TIER1: discord.skus.TIER1 ?? '',
    TIER2: discord.skus.TIER2 ?? '',
    TIER3: discord.skus.TIER3 ?? ''
  }));

  const save = () => action('/backend/api/super/discord-skus', {
    method: 'PUT',
    body: JSON.stringify({ TIER1: skus.TIER1.trim() || null, TIER2: skus.TIER2.trim() || null, TIER3: skus.TIER3.trim() || null })
  }).catch(ignore);
  const sync = () => action('/backend/api/super/discord-sync', { method: 'POST', body: '{}' }).catch(ignore);
  const last = discord.lastSync;

  return (
    <section className="card">
      <div className="card-head">
        <div><span className="kicker">Discord</span><h2>{c.discord.title}</h2><p>{c.discord.text}</p></div>
        {discord.enabled && <a className="button button-sm button-secondary" href={discord.store} target="_blank" rel="noopener noreferrer">{c.discord.store}</a>}
      </div>
      {!discord.enabled && <div className="notice notice-warn">{c.discord.notConfigured}</div>}
      <div className="sku-form">
        {PAID_TIERS.map((tier) => {
          const plan = catalog.find((item) => item.tier === tier);
          return (
            <label key={tier}>
              {TIER_NAMES[tier]} · {c.discord.sku}
              <input
                className="mono"
                value={skus[tier]}
                onChange={(e) => setSkus((current) => ({ ...current, [tier]: e.target.value.replace(/\D/g, '') }))}
                inputMode="numeric"
                maxLength={20}
                placeholder="SKU ID"
              />
              {plan && <small className="field-help">{c.discord.price}: {formatPrice(plan.monthlyCents, locale)}</small>}
            </label>
          );
        })}
        <button type="button" className="button button-primary" onClick={() => void save()}>{c.discord.save}</button>
      </div>
      <div className="inline-fields">
        <p className="muted">
          {c.discord.lastSync}: {last
            ? last.ok
              ? `${fmt(last.at)} · ${last.entitlements} ${c.discord.entitlements} · ${last.changed} ${c.discord.changed}`
              : `${fmt(last.at)} · ${c.discord.failed}`
            : c.discord.never}
        </p>
        <button type="button" className="button button-sm button-secondary" disabled={!discord.enabled} onClick={() => void sync()}>{c.discord.sync}</button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- status */

function StatusTab({ data, c, action, fmt, setStatus }: Omit<TabProps, 'locale'> & { setStatus: SetStatus }) {
  const [guildId, setGuildId] = useState(data.statusChannel?.guildId ?? '');
  const [channelId, setChannelId] = useState(data.statusChannel?.channelId ?? '');
  const channels = useChannels(guildId || null);

  const currentGuild = data.guilds.find((guild) => guild.id === data.statusChannel?.guildId);
  const currentChannel = data.statusChannel && guildId === data.statusChannel.guildId
    ? channels.find((channel) => channel.id === data.statusChannel?.channelId)?.name
    : undefined;
  const save = () => action('/backend/api/super/status-channel', { method: 'PUT', body: JSON.stringify({ guildId, channelId }) }).catch(ignore);
  const remove = () => action('/backend/api/super/status-channel', { method: 'DELETE' }).catch(ignore);
  const test = async () => {
    try {
      const result = await action('/backend/api/super/status-channel/test', { method: 'POST', body: '{}' }, { reload: false, quiet: true });
      if (result.ok) setStatus({ kind: 'ok', text: c.status.testOk });
      else setStatus({ kind: 'error', text: `${c.status.testFailed}: ${c.errors[String(result.error)] ?? String(result.error)}` });
    } catch { /* already reported by action() */ }
  };

  return (
    <section className="card">
      <div className="card-head"><div><span className="kicker">{c.tabs.status}</span><h2>{c.status.title}</h2><p>{c.status.text}</p></div></div>
      <div className="notice">
        <strong>{c.status.current}: </strong>
        {data.statusChannel
          ? <>{currentGuild?.name ?? data.statusChannel.guildId} · <span className="mono">#{currentChannel ?? data.statusChannel.channelId}</span> · {fmt(data.statusChannel.updatedAt)}</>
          : c.status.notSet}
      </div>
      <div className="inline-fields">
        <label>{c.status.guild}<select value={guildId} onChange={(e) => { setGuildId(e.target.value); setChannelId(''); }}>
          <option value="">{c.status.choose}</option>
          {data.guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
        </select></label>
        <label>{c.status.channel}<select value={channelId} disabled={!guildId} onChange={(e) => setChannelId(e.target.value)}>
          <option value="">{c.status.choose}</option>
          {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
        </select></label>
      </div>
      <div className="button-row">
        <button type="button" className="button button-primary" disabled={!guildId || !channelId} onClick={() => void save()}>{c.status.save}</button>
        <button type="button" className="button button-secondary" disabled={!data.statusChannel} onClick={() => void test()}>{c.status.test}</button>
        <button type="button" className="button button-danger" disabled={!data.statusChannel} onClick={() => void remove()}>{c.status.remove}</button>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- blacklist */

function BlacklistTab({ data, c, action, fmt, setStatus }: Omit<TabProps, 'locale'> & { setStatus: SetStatus }) {
  const [userId, setUserId] = useState('');
  const [guildId, setGuildId] = useState('');
  const [userReason, setUserReason] = useState('');
  const [guildReason, setGuildReason] = useState('');

  const block = (kind: 'USER' | 'GUILD', id: string, reason: string) => {
    if (!SNOWFLAKE.test(id)) {
      setStatus({ kind: 'error', text: c.invalidId });
      return;
    }
    action(`/backend/api/super/blocks/${kind}/${id}`, { method: 'PUT', body: JSON.stringify({ reason: reason.trim() || null }) }).then((result) => {
      if (kind === 'GUILD' && result.leaveError) setStatus({ kind: 'error', text: c.blockedNotLeft });
      if (kind === 'USER') { setUserId(''); setUserReason(''); }
      else { setGuildId(''); setGuildReason(''); }
    }, ignore);
  };
  const unblock = (item: Block) => {
    if (confirm(c.confirmUnblock)) action(`/backend/api/super/blocks/${item.kind}/${item.subjectId}`, { method: 'DELETE' }).catch(ignore);
  };

  return (
    <section className="card">
      <div className="card-head"><div><span className="kicker">Policy</span><h2>{c.blacklist}</h2><p>{c.blacklistText}</p></div></div>
      <div className="block-forms">
        <div>
          <label>{c.userId}<input value={userId} onChange={(e) => setUserId(e.target.value.trim())} inputMode="numeric" placeholder="123456789012345678" /></label>
          <label>{c.reason}<input value={userReason} onChange={(e) => setUserReason(e.target.value)} maxLength={500} /></label>
          <button type="button" className="button button-secondary" onClick={() => block('USER', userId, userReason)}>{c.blockUser}</button>
        </div>
        <div>
          <label>{c.guildId}<input value={guildId} onChange={(e) => setGuildId(e.target.value.trim())} inputMode="numeric" placeholder="123456789012345678" /></label>
          <label>{c.reason}<input value={guildReason} onChange={(e) => setGuildReason(e.target.value)} maxLength={500} /></label>
          <button type="button" className="button button-danger" onClick={() => block('GUILD', guildId, guildReason)}>{c.blockGuild}</button>
        </div>
      </div>
      {!data.blocks.length && <div className="empty">{c.noBlocks}</div>}
      <div className="table-list">
        {data.blocks.map((item) => (
          <div className="block-row" key={item.id}>
            <div><strong>{item.kind === 'USER' ? c.user : c.guild} · <span className="mono">{item.subjectId}</span></strong><span>{item.reason || '—'} · {fmt(item.createdAt)}</span></div>
            <span className="tag tag-danger">{c.blocked}</span>
            <button type="button" className="button button-sm button-secondary" onClick={() => unblock(item)}>{c.unblock}</button>
          </div>
        ))}
      </div>
    </section>
  );
}
