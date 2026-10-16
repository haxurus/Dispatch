import type { IconName } from './_components/Brand';

/*
 * UI copy. Italian is the source language. The public site is served in both
 * languages under /it and /en; the dashboard (/dashboard/**) and the super
 * console (/super) pick the language from the dispatch_locale cookie (see
 * middleware.ts and _components/locale-context.tsx); page copy lives next to
 * each page.
 */

export type Locale = 'it' | 'en';
export const LOCALES: readonly Locale[] = ['it', 'en'];
export const isLocale = (value: unknown): value is Locale => value === 'it' || value === 'en';

export const loginHref = '/backend/auth/discord';
export const inviteHref = (locale: Locale) => `/backend/bot/invite?lang=${locale}`;

/* ---------------------------------------------------------------- Chrome */

const chromeIt = {
  homeLabel: 'Dispatch - Home',
  mainNav: 'Navigazione principale',
  openMenu: 'Apri menu',
  languageSelector: 'Selettore lingua',
  madeBy: 'Fatto da',
  footerTag: 'discord ticketing',
  openSource: 'Open source (AGPL-3.0)',
  terms: 'Termini',
  pricing: 'Prezzi',
  dashboard: 'Dashboard',
  superConsole: 'Super console',
  signIn: 'Accedi',
  signInDiscord: 'Accedi con Discord',
  addToDiscord: 'Aggiungi a Discord',
  logout: 'Esci'
};

export type ChromeCopy = typeof chromeIt;

const chromeEn: ChromeCopy = {
  homeLabel: 'Dispatch - Home',
  mainNav: 'Main navigation',
  openMenu: 'Open menu',
  languageSelector: 'Language selector',
  madeBy: 'Made by',
  footerTag: 'discord ticketing',
  openSource: 'Open source (AGPL-3.0)',
  terms: 'Terms',
  pricing: 'Pricing',
  dashboard: 'Dashboard',
  superConsole: 'Super console',
  signIn: 'Sign in',
  signInDiscord: 'Sign in with Discord',
  addToDiscord: 'Add to Discord',
  logout: 'Log out'
};

export const chromeCopy: Record<Locale, ChromeCopy> = { it: chromeIt, en: chromeEn };

/* ----------------------------------------------------------- Public home */

export type StreamState = 'ok' | 'info' | 'accent' | 'warn';

type HomeCopy = {
  meta: { title: string; description: string; keywords: string[] };
  nav: { features: string; flow: string; security: string; faq: string };
  hero: {
    kicker: string;
    title: [string, string, string];
    text: string;
    note: string;
    stream: string;
    live: string;
    rows: Array<{ time: string; key: string; text: string; state: StreamState; label: string }>;
    footer: string[];
  };
  stats: Array<[string, string]>;
  features: {
    kicker: string;
    title: string;
    intro: string;
    cards: Array<{ icon: IconName; kicker: string; title: string; text: string }>;
  };
  flow: { kicker: string; title: string; steps: Array<{ icon: IconName; title: string; text: string }> };
  how: { kicker: string; title: string; steps: Array<[string, string]> };
  security: { kicker: string; title: string; text: string; items: Array<[string, string]> };
  faq: { kicker: string; title: string; items: Array<[string, string]> };
  cta: { title: string; text: string };
  footer: string;
};

const homeIt: HomeCopy = {
  meta: {
    title: 'Dispatch | Bot ticket per Discord con form, transcript e dashboard',
    description: 'Bot ticket per server Discord: pannelli e menu, form e candidature, claim e valutazioni dello staff, SLA, transcript, classifica moderatori e dashboard web con permessi a ruoli.',
    keywords: ['bot ticket Discord', 'ticket Discord', 'sistema ticket Discord', 'bot supporto Discord', 'form Discord', 'candidature staff Discord', 'transcript ticket', 'modmail Discord', 'dashboard bot Discord']
  },
  nav: { features: 'Funzioni', flow: 'Flusso', security: 'Sicurezza', faq: 'FAQ' },
  hero: {
    kicker: 'Bot ticket per Discord',
    title: ['Ogni richiesta', 'del tuo server,', 'presa in carico.'],
    text: 'Dispatch apre i ticket da pannelli e menu, raccoglie le informazioni con form e questionari, assegna lo staff giusto e tiene d’occhio gli SLA. A chiusura, transcript e feedback restano archiviati e cifrati.',
    note: 'Self-hosted · dati cifrati · permessi minimi',
    stream: 'ticket stream',
    live: 'in servizio',
    rows: [
      { time: '14:02:11', key: 'ticket.open', text: '#0142 · Supporto tecnico · aperto da giulia.r', state: 'ok', label: 'nuovo' },
      { time: '14:01:47', key: 'form.submit', text: 'Candidatura staff · 6/6 risposte valide', state: 'info', label: 'inviato' },
      { time: '13:58:30', key: 'ticket.claim', text: '#0139 · preso in carico da mod.luca · priorità alta', state: 'accent', label: 'assegnato' },
      { time: '13:55:02', key: 'sla.escalation', text: '#0131 · prima risposta oltre 30 min · @Supervisori', state: 'warn', label: 'escalation' },
      { time: '13:49:16', key: 'transcript.ready', text: '#0127 · 84 messaggi archiviati · feedback 5/5', state: 'ok', label: 'chiuso' }
    ],
    footer: ['5 ticket aperti', 'SLA rispettati', 'transcript cifrati']
  },
  stats: [
    ['4', 'livelli di accesso alla dashboard'],
    ['AES-256', 'cifratura di transcript e dati sensibili'],
    ['2 SLA', 'prima risposta e risoluzione'],
    ['0', 'permessi Administrator richiesti']
  ],
  features: {
    kicker: 'Funzioni',
    title: 'Tutto il supporto, in un solo bot.',
    intro: 'Dall’apertura alla chiusura: categorie, staff, automazioni e storico sono configurabili dalla dashboard, senza comandi da ricordare.',
    cards: [
      { icon: 'ticket', kicker: 'Apertura', title: 'Pannelli e menu ticket', text: 'Pannelli con pulsanti e un menu principale per scegliere la categoria. Ogni categoria ha il suo canale, i suoi ruoli staff e i suoi limiti.' },
      { icon: 'clipboard', kicker: 'Form', title: 'Form e questionari', text: 'Candidature e questionari con domande validate, invio in DM o effimero, pianificazione e permessi per ruolo. Le risposte possono aprire un ticket.' },
      { icon: 'userCheck', kicker: 'Staff', title: 'Claim, assegnazioni, priorità', text: 'Lo staff prende in carico, assegna, trasferisce di categoria e imposta stato e priorità, da Discord o dalla dashboard.' },
      { icon: 'clock', kicker: 'SLA', title: 'SLA ed escalation', text: 'Tempi di prima risposta e risoluzione per categoria, avvisi di inattività, chiusura automatica ed escalation ai ruoli di riferimento, dal piano Plus.' },
      { icon: 'file', kicker: 'Archivio', title: 'Transcript', text: 'Transcript HTML generati a chiusura, inviati al canale archivio o all’utente, cifrati a riposo e con retention configurabile.' },
      { icon: 'chart', kicker: 'Analytics', title: 'Analytics e feedback', text: 'Volumi giornalieri, tempi medi, violazioni SLA, valutazioni degli utenti e attività dello staff in un’unica vista.' },
      { icon: 'ban', kicker: 'Protezione', title: 'Anti-spam e blacklist', text: 'Cooldown, limiti di ticket aperti e finestre di tentativi bloccano gli abusi; la blacklist esclude gli utenti problematici.' },
      { icon: 'key', kicker: 'Accessi', title: 'RBAC e audit', text: 'Accesso con Discord e livelli Viewer, Moderator, Admin e Owner verificati in tempo reale. Ogni modifica al pannello resta tracciata.' },
      { icon: 'server', kicker: 'Infrastruttura', title: 'Sicurezza e self-hosting', text: 'Gira sulla tua infrastruttura con Docker: database a privilegi minimi, rete segmentata e segreti separati per ogni servizio.' }
    ]
  },
  flow: {
    kicker: 'Flusso',
    title: 'Dal pulsante al transcript, senza perdere nulla.',
    steps: [
      { icon: 'grid', title: 'Apertura', text: 'L’utente sceglie la categoria dal pannello o dal menu; anti-spam e blacklist vengono controllati prima di creare il canale.' },
      { icon: 'clipboard', title: 'Questionario', text: 'Le domande della categoria raccolgono subito le informazioni necessarie, con validazione delle risposte.' },
      { icon: 'userCheck', title: 'Staff', text: 'Claim, assegnazione, priorità e risposte rapide; gli SLA avvisano ed escalano se il ticket resta fermo.' },
      { icon: 'file', title: 'Chiusura', text: 'Transcript cifrato, feedback dell’utente e retention automatica di canali e dati.' }
    ]
  },
  how: {
    kicker: 'Come iniziare',
    title: 'Operativo in tre passaggi.',
    steps: [
      ['Aggiungi il bot', 'Autorizza Dispatch con i soli permessi necessari a gestire canali e messaggi dei ticket: niente Administrator.'],
      ['Accedi con Discord', 'La dashboard mostra i server che puoi gestire e applica il tuo livello di accesso.'],
      ['Configura le categorie', 'Crea categorie, ruoli staff, form e pannelli, poi pubblicali nel canale che preferisci.']
    ]
  },
  security: {
    kicker: 'Sicurezza',
    title: 'Progettato per i dati del tuo supporto.',
    text: 'I ticket contengono conversazioni private. Dispatch le tratta di conseguenza, dal database alla rete.',
    items: [
      ['Permessi minimi', 'Nessun Administrator, Manage Server, Ban o Kick: solo ciò che serve a canali e messaggi dei ticket.'],
      ['Dati cifrati', 'Transcript, note dello staff, motivi della blacklist e sessioni sono cifrati con AES-256-GCM.'],
      ['Sessioni protette', 'Cookie httpOnly, controllo dell’origine sulle modifiche e rate limit sulle API del pannello.'],
      ['Database a privilegi minimi', 'Ruoli Postgres distinti per API e bot: il bot non legge sessioni, note né audit del pannello.'],
      ['Rete segmentata', 'Database e API interna del bot non sono esposti; ogni container vede solo ciò che gli serve.']
    ]
  },
  faq: {
    kicker: 'FAQ',
    title: 'Domande frequenti.',
    items: [
      ['Cos’è Dispatch?', 'Dispatch è un bot ticket per Discord: gli utenti aprono richieste da un pannello o da un menu, lo staff le gestisce in canali privati e alla chiusura il transcript viene archiviato. Tutto si configura da una dashboard web.'],
      ['Come aggiungo un sistema di ticket al mio server Discord?', 'Aggiungi il bot con il pulsante “Aggiungi a Discord”, accedi alla dashboard con il tuo account Discord, crea una categoria con i ruoli staff e pubblica un pannello nel canale che preferisci.'],
      ['Dispatch richiede il permesso Administrator?', 'No. Il bot chiede solo i permessi necessari a creare e gestire i canali, i thread e i messaggi dei ticket.'],
      ['Posso creare form e candidature per lo staff?', 'Sì. I form raccolgono risposte validate, possono essere inviati in DM o in modo effimero, limitati per ruolo e, se vuoi, aprire automaticamente un ticket.'],
      ['I transcript dei ticket vengono salvati?', 'Sì. Alla chiusura Dispatch genera un transcript HTML, lo invia al canale archivio (e all’utente se lo abiliti) e lo conserva cifrato con una retention configurabile.'],
      ['Lo staff può valutare e premiare i moderatori?', 'Gli utenti valutano il ticket con le stelle, il voto va al moderatore che lo ha preso in carico e con i piani Pro e Brand Dispatch può pubblicare una classifica settimanale o mensile dei moderatori.'],
      ['Dispatch è gratuito?', 'Sì: il piano Free include ticket, pannelli, form, transcript, log dei ticket e valutazioni, per ogni server e senza scadenza. I piani a pagamento Plus, Pro e Brand alzano i limiti e la conservazione e aggiungono automazioni SLA, thread staff, classifica moderatori e personalizzazione del bot; si attivano contattando il gestore, come spiegato nella pagina dei prezzi.']
    ]
  },
  cta: { title: 'Porta ordine nel supporto del tuo server.', text: 'Aggiungi il bot, accedi con Discord e pubblica il primo pannello in pochi minuti.' },
  footer: 'Bot ticket per server Discord, con form, transcript e dashboard.'
};

const homeEn: HomeCopy = {
  meta: {
    title: 'Dispatch | Discord ticket bot with forms, transcripts and dashboard',
    description: 'Discord ticket bot for support teams: ticket panels and menus, forms and staff applications, claims and ratings, SLAs, transcripts, moderator leaderboards and a web dashboard with role-based access.',
    keywords: ['Discord ticket bot', 'Discord ticket system', 'Discord support bot', 'ticket tool for Discord', 'Discord forms bot', 'Discord staff applications', 'ticket transcripts', 'Discord modmail', 'Discord bot dashboard']
  },
  nav: { features: 'Features', flow: 'Flow', security: 'Security', faq: 'FAQ' },
  hero: {
    kicker: 'Discord ticket bot',
    title: ['Every request', 'on your server,', 'taken care of.'],
    text: 'Dispatch opens tickets from panels and menus, collects details with forms and questionnaires, routes them to the right staff and keeps an eye on SLAs. On close, transcripts and feedback are archived and encrypted.',
    note: 'Self-hosted · encrypted data · least privilege',
    stream: 'ticket stream',
    live: 'on duty',
    rows: [
      { time: '14:02:11', key: 'ticket.open', text: '#0142 · Tech support · opened by julia.r', state: 'ok', label: 'new' },
      { time: '14:01:47', key: 'form.submit', text: 'Staff application · 6/6 valid answers', state: 'info', label: 'submitted' },
      { time: '13:58:30', key: 'ticket.claim', text: '#0139 · claimed by mod.luke · high priority', state: 'accent', label: 'assigned' },
      { time: '13:55:02', key: 'sla.escalation', text: '#0131 · first response over 30 min · @Supervisors', state: 'warn', label: 'escalated' },
      { time: '13:49:16', key: 'transcript.ready', text: '#0127 · 84 messages archived · feedback 5/5', state: 'ok', label: 'closed' }
    ],
    footer: ['5 open tickets', 'SLAs met', 'encrypted transcripts']
  },
  stats: [
    ['4', 'dashboard access levels'],
    ['AES-256', 'encryption for transcripts and sensitive data'],
    ['2 SLAs', 'first response and resolution'],
    ['0', 'Administrator permissions required']
  ],
  features: {
    kicker: 'Features',
    title: 'Your whole support desk, in one bot.',
    intro: 'From open to close: categories, staff, automations and history are configured from the dashboard, with no commands to remember.',
    cards: [
      { icon: 'ticket', kicker: 'Intake', title: 'Ticket panels and menu', text: 'Button panels and a main menu to pick a category. Each category has its own channel, staff roles and limits.' },
      { icon: 'clipboard', kicker: 'Forms', title: 'Forms and questionnaires', text: 'Applications and questionnaires with validated questions, DM or ephemeral delivery, scheduling and per-role permissions. Answers can open a ticket.' },
      { icon: 'userCheck', kicker: 'Staff', title: 'Claims, assignment, priorities', text: 'Staff claim, assign, move tickets between categories and set status and priority, from Discord or the dashboard.' },
      { icon: 'clock', kicker: 'SLA', title: 'SLAs and escalation', text: 'First-response and resolution targets per category, inactivity warnings, auto-close and escalation to the roles in charge, from the Plus plan.' },
      { icon: 'file', kicker: 'Archive', title: 'Transcripts', text: 'HTML transcripts generated on close, sent to an archive channel or the user, encrypted at rest with configurable retention.' },
      { icon: 'chart', kicker: 'Analytics', title: 'Analytics and feedback', text: 'Daily volumes, average times, SLA breaches, user ratings and staff activity in a single view.' },
      { icon: 'ban', kicker: 'Protection', title: 'Anti-spam and blacklist', text: 'Cooldowns, open-ticket limits and attempt windows stop abuse; the blacklist keeps problem users out.' },
      { icon: 'key', kicker: 'Access', title: 'RBAC and audit', text: 'Discord sign-in with Viewer, Moderator, Admin and Owner levels verified live. Every panel change is audited.' },
      { icon: 'server', kicker: 'Infrastructure', title: 'Security and self-hosting', text: 'Runs on your own infrastructure with Docker: least-privilege database, segmented network and separate secrets per service.' }
    ]
  },
  flow: {
    kicker: 'Flow',
    title: 'From button to transcript, nothing lost.',
    steps: [
      { icon: 'grid', title: 'Intake', text: 'The user picks a category from a panel or the menu; anti-spam and blacklist are checked before the channel is created.' },
      { icon: 'clipboard', title: 'Questionnaire', text: 'The category questions collect what staff need up front, with answer validation.' },
      { icon: 'userCheck', title: 'Staff', text: 'Claims, assignment, priority and canned replies; SLAs warn and escalate when a ticket stalls.' },
      { icon: 'file', title: 'Close', text: 'Encrypted transcript, user feedback and automatic retention of channels and data.' }
    ]
  },
  how: {
    kicker: 'Getting started',
    title: 'Up and running in three steps.',
    steps: [
      ['Add the bot', 'Authorise Dispatch with only the permissions needed to manage ticket channels and messages: no Administrator.'],
      ['Sign in with Discord', 'The dashboard lists the servers you can manage and applies your access level.'],
      ['Set up categories', 'Create categories, staff roles, forms and panels, then publish them in the channel you like.']
    ]
  },
  security: {
    kicker: 'Security',
    title: 'Built for your support data.',
    text: 'Tickets hold private conversations. Dispatch treats them accordingly, from the database to the network.',
    items: [
      ['Least privilege', 'No Administrator, Manage Server, Ban or Kick: only what ticket channels and messages need.'],
      ['Encrypted data', 'Transcripts, staff notes, blacklist reasons and sessions are encrypted with AES-256-GCM.'],
      ['Protected sessions', 'httpOnly cookies, origin checks on every change and rate limits on the panel API.'],
      ['Least-privilege database', 'Separate Postgres roles for API and bot: the bot cannot read sessions, notes or panel audit.'],
      ['Segmented network', 'The database and the bot internal API are never exposed; each container reaches only what it needs.']
    ]
  },
  faq: {
    kicker: 'FAQ',
    title: 'Frequently asked questions.',
    items: [
      ['What is Dispatch?', 'Dispatch is a Discord ticket bot: members open requests from a panel or menu, staff handle them in private channels and transcripts are archived on close. Everything is configured from a web dashboard.'],
      ['How do I add a ticket system to my Discord server?', 'Add the bot with the “Add to Discord” button, sign in to the dashboard with your Discord account, create a category with its staff roles and publish a panel in any channel.'],
      ['Does Dispatch need Administrator permission?', 'No. The bot only asks for the permissions needed to create and manage ticket channels, threads and messages.'],
      ['Can I build forms and staff applications?', 'Yes. Forms collect validated answers, can be sent by DM or as ephemeral messages, restricted by role and, if you want, open a ticket automatically.'],
      ['Are ticket transcripts saved?', 'Yes. On close Dispatch generates an HTML transcript, sends it to your archive channel (and to the user if enabled) and keeps it encrypted with configurable retention.'],
      ['Can members rate the staff?', 'Members rate each ticket with stars, the rating goes to the moderator who claimed it, and on the Pro and Brand plans Dispatch can post a weekly or monthly moderator leaderboard.'],
      ['Is Dispatch free?', 'Yes: the Free plan includes tickets, panels, forms, transcripts, the ticket log and ratings, for every server and with no time limit. The paid Plus, Pro and Brand plans raise the limits and retention and add SLA automations, staff threads, the moderator leaderboard and bot branding; they are activated by contacting the operator, as explained on the pricing page.']
    ]
  },
  cta: { title: 'Bring order to your server support.', text: 'Add the bot, sign in with Discord and publish your first panel in minutes.' },
  footer: 'Discord ticket bot with forms, transcripts and a web dashboard.'
};

export const homeCopy: Record<Locale, HomeCopy> = { it: homeIt, en: homeEn };

/* ---------------------------------------------------------- Super console */

const superIt = {
  kicker: 'Super console',
  title: 'Controllo globale di Dispatch.',
  intro: 'Area riservata al proprietario dell’istanza. Le azioni qui sotto hanno effetto su tutti i server collegati al bot e vengono registrate nell’audit.',
  refresh: 'Aggiorna',
  loading: 'Caricamento super console…',
  denied: 'Accesso negato. Questa area è disponibile solo al super-admin configurato.',
  signedOut: 'Sessione assente o scaduta. Accedi con Discord per continuare.',
  failed: 'Operazione non riuscita.',
  refreshed: 'Dati aggiornati.',
  rateLimited: 'Troppe modifiche in poco tempo. Riprova tra un minuto.',
  botUnavailable: 'Il bot non è raggiungibile in questo momento.',
  cannotBlockSelf: 'Non puoi bloccare l’account super-admin.',
  notConnected: 'Il bot non è più in questo server.',
  invalidId: 'Inserisci un Discord ID valido (17-20 cifre).',
  blockedNotLeft: 'Blocco salvato, ma il bot non è riuscito a uscire subito: lo farà al prossimo avvio.',
  metrics: {
    servers: 'Server collegati',
    openTickets: 'Ticket aperti',
    lastWeek: 'Ticket ultimi 7 giorni',
    forms: 'Form',
    blocks: 'Blocchi installazione',
    guildBlacklist: 'voci blacklist ticket',
    bot: 'Bot',
    ready: 'Online',
    notReady: 'Non pronto',
    offline: 'Offline'
  },
  bot: { uptime: 'Uptime', ping: 'Ping', servers: 'server', unreachable: 'API interna del bot non raggiungibile: l’elenco server non è disponibile.' },
  guilds: {
    kicker: 'Discord',
    title: 'Server collegati',
    text: 'Elenco live dalla sessione Discord del bot, con i ticket dal database.',
    empty: 'Dispatch non è collegato ad alcun server.',
    owner: 'Proprietario',
    members: 'membri',
    installed: 'Installato',
    open: 'aperti',
    total: 'totali',
    blocked: 'Bloccato',
    leave: 'Fai uscire',
    blockLeave: 'Blocca ed espelli',
    confirmLeave: 'Vuoi davvero far uscire Dispatch da “{name}”?',
    confirmBlock: 'Bloccare “{name}” e far uscire Dispatch? Il bot uscirà anche se verrà aggiunto di nuovo.',
    blockReason: 'Bloccato dalla lista server della super console'
  },
  blacklist: {
    kicker: 'Policy',
    title: 'Blacklist installazioni',
    text: 'Blocca preventivamente un server o un utente Discord. I server bloccati vengono abbandonati anche se il bot viene aggiunto di nuovo; un utente bloccato viene riconosciuto quando il bot può leggere il registro attività del server.',
    userId: 'Discord User ID',
    guildId: 'Discord Server ID',
    reason: 'Motivo opzionale',
    blockUser: 'Blocca utente',
    blockGuild: 'Blocca server',
    empty: 'Nessun elemento in blacklist.',
    user: 'Utente',
    guild: 'Server',
    blocked: 'Bloccato',
    unblock: 'Sblocca',
    confirmUnblock: 'Rimuovere {kind} {id} dalla blacklist?'
  },
  status: {
    kicker: 'Notifiche',
    title: 'Canale di stato',
    text: 'Il bot pubblica qui avvio, server aggiunti o rimossi e installazioni rifiutate. Non contiene mai il contenuto dei ticket.',
    current: 'Canale attuale',
    notSet: 'Nessun canale configurato: le notifiche di stato non vengono inviate.',
    guild: 'Server',
    channel: 'Canale',
    chooseGuild: 'Scegli un server',
    chooseChannel: 'Scegli un canale',
    save: 'Salva',
    test: 'Invia prova',
    remove: 'Rimuovi',
    saved: 'Canale di stato salvato.',
    removed: 'Canale di stato rimosso.',
    testOk: 'Messaggio di prova inviato.',
    testFailed: 'Invio di prova non riuscito',
    channelMissing: 'Il canale non esiste più o non è un canale testuale.',
    errors: {
      STATUS_CHANNEL_NOT_SET: 'nessun canale configurato',
      STATUS_GUILD_UNAVAILABLE: 'il bot non è nel server',
      STATUS_CHANNEL_UNAVAILABLE: 'canale non trovato',
      STATUS_MISSING_PERMISSIONS: 'il bot non può scrivere nel canale',
      STATUS_SEND_FAILED: 'Discord ha rifiutato il messaggio'
    } as Record<string, string>
  },
  audit: {
    kicker: 'Audit',
    title: 'Audit super-admin',
    text: 'Ultime 200 azioni eseguite dalla super console.',
    empty: 'Nessuna azione registrata.'
  },
  plans: {
    unavailable: 'Piani e recapiti non sono disponibili: le tabelle dei piani mancano o l’API non ha i permessi. Riesegui l’installer sul VPS.',
    missingSkus: 'SKU Discord non ancora configurati per: {plans}. Finché mancano, gli acquisti di questi piani non vengono riconosciuti: crea gli SKU nel Developer Portal e inseriscili in packages/shared/src/plans.ts.',
    tier: 'Omaggio',
    noGift: 'Nessun omaggio',
    expires: 'Scadenza',
    expiresHint: 'Vuota = nessuna scadenza. L’omaggio scade a fine giornata.',
    expiresOn: 'scade il {date}',
    expiredOn: 'scaduto il {date}',
    noExpiry: 'senza scadenza',
    subscription: 'Abbonamento Discord: {plan}',
    renews: 'si rinnova ogni mese',
    cancelledUntil: 'disdetto, attivo fino al {date}',
    gift: 'Omaggio: {plan}',
    giftHint: 'Gli abbonamenti si gestiscono solo su Discord. L’omaggio si somma: vale il piano più alto tra omaggio e abbonamento.',
    note: 'Nota interna',
    notePlaceholder: 'Es. prova di un mese per il server partner',
    edit: 'Modifica omaggio',
    close: 'Chiudi',
    save: 'Salva omaggio',
    saved: 'Omaggio di “{name}” salvato.',
    updated: 'aggiornato il {date}',
    confirmDowngrade: 'Abbassare il piano in vigore di “{name}”? I limiti si applicano subito: conservazione ridotta, ruoli del pannello in eccesso rimossi e personalizzazione Brand azzerata.',
    metrics: {
      servers: 'server',
      subscriptions: 'abbonamenti',
      revenue: 'Abbonamenti mensili (lordo)',
      revenueHint: 'prezzi di listino, prima di imposte e commissioni Discord'
    },
    contacts: {
      kicker: 'Prezzi',
      title: 'Recapiti della pagina prezzi',
      text: 'Mostrati sotto “Come abbonarsi” a chi ha domande sui piani. Lascia vuoto un campo per nasconderlo.',
      email: 'Email',
      discord: 'Discord (username o link https)',
      url: 'Link (https): server Discord, sito o modulo',
      save: 'Salva recapiti',
      saved: 'Recapiti salvati.'
    },
    errors: {
      EXPIRY_IN_PAST: 'La scadenza è nel passato.',
      GUILD_NOT_FOUND: 'Server non presente nel database: il bot deve averlo registrato almeno una volta.',
      INVALID_BODY: 'Dati non validi: controlla i campi (email valida, link https).',
      NOT_FOUND: 'Elemento non trovato: forse è già stato eliminato.'
    } as Record<string, string>
  }
};

export type SuperCopy = typeof superIt;

const superEn: SuperCopy = {
  kicker: 'Super console',
  title: 'Global Dispatch control.',
  intro: 'Instance-owner area. Actions here affect every server connected to the bot and are recorded in the audit log.',
  refresh: 'Refresh',
  loading: 'Loading super console…',
  denied: 'Access denied. This area is available only to the configured super-admin.',
  signedOut: 'No session or session expired. Sign in with Discord to continue.',
  failed: 'Operation failed.',
  refreshed: 'Data refreshed.',
  rateLimited: 'Too many changes in a short time. Try again in a minute.',
  botUnavailable: 'The bot is not reachable right now.',
  cannotBlockSelf: 'You cannot block the super-admin account.',
  notConnected: 'The bot is no longer in this server.',
  invalidId: 'Enter a valid Discord ID (17-20 digits).',
  blockedNotLeft: 'Block saved, but the bot could not leave right away: it will on next start.',
  metrics: {
    servers: 'Connected servers',
    openTickets: 'Open tickets',
    lastWeek: 'Tickets, last 7 days',
    forms: 'Forms',
    blocks: 'Install blocks',
    guildBlacklist: 'ticket blacklist entries',
    bot: 'Bot',
    ready: 'Online',
    notReady: 'Not ready',
    offline: 'Offline'
  },
  bot: { uptime: 'Uptime', ping: 'Ping', servers: 'servers', unreachable: 'Bot internal API unreachable: the server list is unavailable.' },
  guilds: {
    kicker: 'Discord',
    title: 'Connected servers',
    text: 'Live list from the bot Discord session, with tickets from the database.',
    empty: 'Dispatch is not connected to any server.',
    owner: 'Owner',
    members: 'members',
    installed: 'Installed',
    open: 'open',
    total: 'total',
    blocked: 'Blocked',
    leave: 'Leave server',
    blockLeave: 'Block & leave',
    confirmLeave: 'Do you really want Dispatch to leave “{name}”?',
    confirmBlock: 'Block “{name}” and make Dispatch leave? The bot will leave again if re-added.',
    blockReason: 'Blocked from the super console server list'
  },
  blacklist: {
    kicker: 'Policy',
    title: 'Installation blacklist',
    text: 'Preemptively block a Discord server or user. Blocked servers are left even if the bot is added again; a blocked user is recognised when the bot can read the server’s audit log.',
    userId: 'Discord User ID',
    guildId: 'Discord Server ID',
    reason: 'Optional reason',
    blockUser: 'Block user',
    blockGuild: 'Block server',
    empty: 'Nothing is blacklisted.',
    user: 'User',
    guild: 'Server',
    blocked: 'Blocked',
    unblock: 'Unblock',
    confirmUnblock: 'Remove {kind} {id} from the blacklist?'
  },
  status: {
    kicker: 'Notifications',
    title: 'Status channel',
    text: 'The bot posts startup, servers added or removed and rejected installations here. It never contains ticket content.',
    current: 'Current channel',
    notSet: 'No channel configured: status notifications are not sent.',
    guild: 'Server',
    channel: 'Channel',
    chooseGuild: 'Choose a server',
    chooseChannel: 'Choose a channel',
    save: 'Save',
    test: 'Send test',
    remove: 'Remove',
    saved: 'Status channel saved.',
    removed: 'Status channel removed.',
    testOk: 'Test message sent.',
    testFailed: 'Test message failed',
    channelMissing: 'The channel no longer exists or is not a text channel.',
    errors: {
      STATUS_CHANNEL_NOT_SET: 'no channel configured',
      STATUS_GUILD_UNAVAILABLE: 'the bot is not in that server',
      STATUS_CHANNEL_UNAVAILABLE: 'channel not found',
      STATUS_MISSING_PERMISSIONS: 'the bot cannot write in the channel',
      STATUS_SEND_FAILED: 'Discord rejected the message'
    } as Record<string, string>
  },
  audit: {
    kicker: 'Audit',
    title: 'Super-admin audit',
    text: 'Latest 200 actions performed from the super console.',
    empty: 'No actions recorded.'
  },
  plans: {
    unavailable: 'Plans and contacts are unavailable: the plan tables are missing or the API lacks permissions. Re-run the installer on the VPS.',
    missingSkus: 'Discord SKUs not configured yet for: {plans}. Until they are, purchases of these plans are not recognised: create the SKUs in the Developer Portal and add them to packages/shared/src/plans.ts.',
    tier: 'Gift',
    noGift: 'No gift',
    expires: 'Expiry',
    expiresHint: 'Empty = no expiry. The gift expires at the end of the day.',
    expiresOn: 'expires {date}',
    expiredOn: 'expired {date}',
    noExpiry: 'no expiry',
    subscription: 'Discord subscription: {plan}',
    renews: 'renews monthly',
    cancelledUntil: 'cancelled, active until {date}',
    gift: 'Gift: {plan}',
    giftHint: 'Subscriptions are managed only on Discord. A gift adds up: the higher of the gift and the subscription applies.',
    note: 'Internal note',
    notePlaceholder: 'E.g. one-month trial for the partner server',
    edit: 'Edit gift',
    close: 'Close',
    save: 'Save gift',
    saved: 'Gift of “{name}” saved.',
    updated: 'updated {date}',
    confirmDowngrade: 'Lower the plan in force of “{name}”? Limits apply immediately: retention is capped, extra panel roles are removed and the Brand customisation is reset.',
    metrics: {
      servers: 'servers',
      subscriptions: 'subscriptions',
      revenue: 'Monthly subscriptions (gross)',
      revenueHint: 'list prices, before taxes and Discord fees'
    },
    contacts: {
      kicker: 'Pricing',
      title: 'Pricing page contacts',
      text: 'Shown under “How to subscribe” to people with questions about plans. Leave a field empty to hide it.',
      email: 'Email',
      discord: 'Discord (username or https link)',
      url: 'Link (https): Discord server, website or form',
      save: 'Save contacts',
      saved: 'Contacts saved.'
    },
    errors: {
      EXPIRY_IN_PAST: 'The expiry date is in the past.',
      GUILD_NOT_FOUND: 'Server not in the database: the bot must have registered it at least once.',
      INVALID_BODY: 'Invalid data: check the fields (valid email, https link).',
      NOT_FOUND: 'Item not found: it may have been deleted already.'
    } as Record<string, string>
  }
};

export const superCopy: Record<Locale, SuperCopy> = { it: superIt, en: superEn };

/** `{name}` style substitution for copy strings. */
export function format(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
