import type { AlertCategory } from './alerts.js';

/**
 * Texts of instance alerts in English and Italian. Alerts are stored as a key
 * plus parameters and rendered when they are delivered, in the language of
 * the server they are posted to (its bot language setting).
 */

export type AlertLocale = 'en' | 'it';
export type AlertParams = Record<string, string | number | null | undefined>;

export const normalizeAlertLocale = (value: unknown): AlertLocale => (typeof value === 'string' && value.toLowerCase().startsWith('it') ? 'it' : 'en');

const num = (value: unknown, locale: AlertLocale) => Number(value ?? 0).toLocaleString(locale === 'it' ? 'it-IT' : 'en-US');
const text = (value: unknown, fallback = '—') => (value === null || value === undefined || value === '' ? fallback : String(value));

type Message = {
  title: Record<AlertLocale, string>;
  description?: Record<AlertLocale, (p: AlertParams) => string>;
};

const MESSAGES = {
  'install.rejected': {
    title: { en: 'Installation rejected', it: 'Installazione rifiutata' },
    description: {
      en: (p) => `Dispatch left **${text(p.guild)}**: ${p.reason === 'blocked-installer' ? 'the person who added the bot is blacklisted' : 'the server is blacklisted'}.`,
      it: (p) => `Dispatch è uscito da **${text(p.guild)}**: ${p.reason === 'blocked-installer' ? 'chi ha aggiunto il bot è in blacklist' : 'il server è in blacklist'}.`
    }
  },
  'guild.added': { title: { en: 'Dispatch added to a server', it: 'Dispatch aggiunto a un server' } },
  'guild.removed': { title: { en: 'Dispatch removed from a server', it: 'Dispatch rimosso da un server' } },
  'bot.online': {
    title: { en: 'Dispatch online', it: 'Dispatch online' },
    description: {
      en: (p) => `Connected to Discord as **${text(p.user)}**${p.departed ? `; ${num(p.departed, 'en')} servers removed the bot while it was offline` : ''}.`,
      it: (p) => `Connesso a Discord come **${text(p.user)}**${p.departed ? `; ${num(p.departed, 'it')} server hanno rimosso il bot mentre era offline` : ''}.`
    }
  },
  'guilds.purged': {
    title: { en: 'Data of removed servers deleted', it: 'Dati di server rimossi cancellati' },
    description: {
      en: (p) => `Deleted the data of ${num(p.count, 'en')} servers Dispatch was removed from more than ${num(p.days, 'en')} days ago.`,
      it: (p) => `Cancellati i dati di ${num(p.count, 'it')} server da cui Dispatch è stato rimosso da più di ${num(p.days, 'it')} giorni.`
    }
  },
  'client.warning': { title: { en: 'Discord client warning', it: 'Warning del client Discord' }, description: { en: (p) => text(p.detail), it: (p) => text(p.detail) } },
  'client.error': { title: { en: 'Discord client error', it: 'Errore del client Discord' }, description: { en: (p) => text(p.detail), it: (p) => text(p.detail) } },
  'bot.unhandled': { title: { en: 'Unhandled error in the bot', it: 'Errore non gestito nel bot' }, description: { en: (p) => text(p.detail), it: (p) => text(p.detail) } },
  'interaction.failed': {
    title: { en: 'Interaction failed', it: 'Errore in un’interazione' },
    description: {
      en: (p) => `A ${text(p.component)} interaction failed with ${text(p.type)}. The member saw a generic error message.`,
      it: (p) => `Un’interazione ${text(p.component)} è fallita con ${text(p.type)}. Il membro ha visto un messaggio di errore generico.`
    }
  },
  'shard.disconnected': {
    title: { en: 'Discord Gateway disconnected', it: 'Gateway Discord disconnesso' },
    description: { en: (p) => `Shard ${text(p.shard)}, close code ${text(p.code)}.`, it: (p) => `Shard ${text(p.shard)}, codice di chiusura ${text(p.code)}.` }
  },
  'shard.resumed': {
    title: { en: 'Connection to Discord restored', it: 'Connessione a Discord ripristinata' },
    description: { en: (p) => `Shard ${text(p.shard)}: ${num(p.replayed, 'en')} events recovered.`, it: (p) => `Shard ${text(p.shard)}: ${num(p.replayed, 'it')} eventi recuperati.` }
  },
  'status.test': {
    title: { en: 'Status notifications active', it: 'Notifiche di stato attive' },
    description: {
      en: () => 'Test message from the super console. Alerts routed to this channel will arrive here.',
      it: () => 'Messaggio di prova dalla super console. Qui arriveranno gli allarmi instradati verso questo canale.'
    }
  },
  'bot.down': {
    title: { en: 'Bot unreachable', it: 'Bot non raggiungibile' },
    description: {
      en: (p) => p.mode === 'disconnected'
        ? 'The bot process answers but is not connected to Discord: tickets and forms are not working.'
        : `The bot has not answered for about ${num(p.minutes, 'en')} minutes${p.sinceStart ? ' (since the API started)' : ''}: tickets and forms are not working.`,
      it: (p) => p.mode === 'disconnected'
        ? 'Il processo del bot risponde ma non è connesso a Discord: ticket e form non funzionano.'
        : `Il bot non risponde da circa ${num(p.minutes, 'it')} minuti${p.sinceStart ? ' (dall’avvio dell’API)' : ''}: ticket e form non funzionano.`
    }
  },
  'bot.restored': {
    title: { en: 'Bot restored', it: 'Bot ripristinato' },
    description: {
      en: (p) => `Dispatch is connected to Discord again after ${durationText(p.durationMs, 'en')} of downtime (${num(p.guilds, 'en')} servers).`,
      it: (p) => `Dispatch è di nuovo connesso a Discord dopo ${durationText(p.durationMs, 'it')} di interruzione (${num(p.guilds, 'it')} server).`
    }
  },
  'sync.stopped': {
    title: { en: 'Discord subscription sync stopped', it: 'Sincronizzazione abbonamenti Discord ferma' },
    description: {
      en: () => 'Active subscriptions cannot be read from Discord: new purchases, renewals and cancellations do not reach the server plans.',
      it: () => 'Gli abbonamenti attivi non si possono leggere da Discord: nuovi acquisti, rinnovi e disdette non arrivano ai piani dei server.'
    }
  },
  'sync.restored': {
    title: { en: 'Subscription sync restored', it: 'Sincronizzazione abbonamenti ripristinata' },
    description: {
      en: (p) => `Discord subscriptions reach the plans again after ${durationText(p.durationMs, 'en')}.`,
      it: (p) => `Gli abbonamenti Discord tornano ad arrivare ai piani dopo ${durationText(p.durationMs, 'it')}.`
    }
  },
  'subscription.new': {
    title: { en: 'New Discord subscription', it: 'Nuovo abbonamento Discord' },
    description: { en: (p) => `The server now has the ${text(p.plan)} plan.`, it: (p) => `Il server ora ha il piano ${text(p.plan)}.` }
  },
  'subscription.changed': {
    title: { en: 'Discord subscription changed', it: 'Abbonamento Discord cambiato' },
    description: { en: (p) => `The server now has the ${text(p.plan)} plan.`, it: (p) => `Il server ora ha il piano ${text(p.plan)}.` }
  },
  'subscription.cancelled': {
    title: { en: 'Discord subscription cancelled', it: 'Abbonamento Discord disdetto' },
    description: {
      en: (p) => `The ${text(p.plan)} plan stays active until ${text(p.until)}.`,
      it: (p) => `Il piano ${text(p.plan)} resta attivo fino al ${text(p.until)}.`
    }
  },
  'subscription.ended': {
    title: { en: 'Discord subscription ended', it: 'Abbonamento Discord terminato' },
    description: { en: () => 'The subscription is no longer active: the server keeps only its gift plan, if any.', it: () => 'L’abbonamento non è più attivo: al server resta solo l’eventuale piano omaggio.' }
  },
  'webhook.test': {
    title: { en: 'Alarms active', it: 'Allarmi attivi' },
    description: {
      en: () => 'Test message from the super console: the alert and the reminders about the bot being unreachable, and its recovery, will arrive here.',
      it: () => 'Messaggio di prova dalla super console: qui arriveranno l’avviso e i promemoria quando il bot non è raggiungibile, e la notizia del ripristino.'
    }
  }
} satisfies Record<string, Message>;

export type AlertMessageKey = keyof typeof MESSAGES;
export const isAlertMessageKey = (value: unknown): value is AlertMessageKey => typeof value === 'string' && value in MESSAGES;

export function renderAlertMessage(key: AlertMessageKey, params: AlertParams, locale: AlertLocale) {
  const message: Message = MESSAGES[key];
  return { title: message.title[locale], description: message.description ? message.description[locale](params) : null };
}

const FIELDS = {
  server: { en: 'Server', it: 'Server' },
  servers: { en: 'Servers', it: 'Server' },
  members: { en: 'Members', it: 'Membri' },
  addedBy: { en: 'Added by', it: 'Aggiunto da' },
  component: { en: 'Component', it: 'Componente' },
  type: { en: 'Type', it: 'Tipo' }
} satisfies Record<string, Record<AlertLocale, string>>;

export type AlertFieldKey = keyof typeof FIELDS;
export type AlertField = { key: AlertFieldKey; value: string };
export const alertFieldLabel = (key: string, locale: AlertLocale) => (FIELDS as Record<string, Record<AlertLocale, string>>)[key]?.[locale] ?? key;

const CATEGORIES: Record<AlertCategory, Record<AlertLocale, string>> = {
  availability: { en: 'Availability', it: 'Disponibilità' },
  security: { en: 'Security', it: 'Sicurezza' },
  errors: { en: 'Errors', it: 'Errori' },
  billing: { en: 'Subscriptions', it: 'Abbonamenti' },
  installations: { en: 'Installations', it: 'Installazioni' }
};
export const alertCategoryLabel = (category: AlertCategory, locale: AlertLocale) => CATEGORIES[category][locale];

export function durationText(ms: unknown, locale: AlertLocale) {
  const minutes = Math.max(1, Math.round(Number(ms ?? 0) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return locale === 'it' ? `${days} giorni` : `${days} days`;
}

/** Texts added by the router around the alerts themselves. */
export const ALERT_UI = {
  en: {
    footer: (category: string) => `Dispatch · ${category}`,
    repeated: (count: number, since: string) => `${count} identical alerts since ${since}; the latest is shown above.`,
    digestTitle: 'Daily digest',
    digestText: (count: number) => `${count} informational alerts since the last digest. Details are in the super console → Monitoring.`,
    digestFooter: 'Dispatch · digest',
    reminder: (title: string) => `Reminder: ${title}`,
    reminderText: (duration: string) => `Still open after ${duration}. Acknowledge it in the super console → Monitoring to stop the reminders.`,
    monitorFooter: 'Dispatch · monitoring',
    statusFooter: 'Dispatch · bot status'
  },
  it: {
    footer: (category: string) => `Dispatch · ${category}`,
    repeated: (count: number, since: string) => `${count} avvisi uguali dalle ${since}; qui sopra il più recente.`,
    digestTitle: 'Riepilogo giornaliero',
    digestText: (count: number) => `${count} avvisi informativi dall’ultimo riepilogo. I dettagli sono nella super console → Monitoraggio.`,
    digestFooter: 'Dispatch · riepilogo',
    reminder: (title: string) => `Promemoria: ${title}`,
    reminderText: (duration: string) => `Ancora aperto da ${duration}. Segnalo come preso in carico nella super console → Monitoraggio per non ricevere altri promemoria.`,
    monitorFooter: 'Dispatch · monitoraggio',
    statusFooter: 'Dispatch · stato del bot'
  }
} as const;
