import { prisma } from '@dispatch/db';
import type { TicketLogEvent } from '@dispatch/shared';

/*
 * Bot texts in English and Italian. A server's language is
 * GuildSettings.locale ('en' by default for new servers, chosen in the
 * dashboard) and applies to everything the bot posts there: ticket channels,
 * ephemeral replies, logs, transcripts, leaderboards. Both dictionaries share
 * the same shape, so a missing translation is a type error.
 *
 * The instance status channel (status.ts) is owner-facing and stays Italian,
 * like the super console.
 */

export type BotLocale = 'en' | 'it';

export const botLocale = (value: unknown): BotLocale => (value === 'it' ? 'it' : 'en');

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { locale: BotLocale; expiresAt: number }>();

export function invalidateGuildLocale(guildId?: string) {
  if (guildId) cache.delete(guildId);
  else cache.clear();
}

/** The server's bot language, cached briefly. Unknown servers fall back to English. */
export async function guildLocale(guildId: string | null | undefined): Promise<BotLocale> {
  if (!guildId) return 'en';
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.locale;
  const row = await prisma.guildSettings.findUnique({ where: { guildId }, select: { locale: true } }).catch(() => null);
  const locale = botLocale(row?.locale);
  if (cache.size > 5000) cache.clear();
  cache.set(guildId, { locale, expiresAt: Date.now() + CACHE_TTL_MS });
  return locale;
}

/** Messages of a server, in one call. */
export async function guildMessages(guildId: string | null | undefined) {
  return messages[await guildLocale(guildId)];
}

const en = {
  htmlLang: 'en',
  common: {
    interactionError: 'Something went wrong while handling the request.',
    yes: 'Yes',
    no: 'No',
    none: 'None',
    noAnswer: 'No answer',
    system: 'System',
    unknown: 'unknown',
    minutes: (value: number) => `${value} ${value === 1 ? 'minute' : 'minutes'}`,
    seconds: (value: number) => `${value} ${value === 1 ? 'second' : 'seconds'}`
  },
  buttons: {
    claim: 'Claim',
    unclaim: 'Unclaim',
    waiting: 'Waiting',
    resolved: 'Resolved',
    close: 'Close',
    staffThread: 'Staff thread',
    reopen: 'Reopen ticket',
    deleteChannel: 'Delete channel',
    confirmDelete: 'Confirm deletion',
    cancel: 'Cancel',
    skip: 'Skip',
    answer: 'Answer',
    answerOrSkip: 'Answer / skip',
    yes: 'Yes',
    no: 'No'
  },
  panel: {
    buttonsHint: 'Press the button for the type of ticket you want to open.',
    selectHint: 'Select the type of ticket you want to open.',
    selectPlaceholder: 'Select a category',
    formSelectHint: 'Choose the form you want to fill in.',
    formButtonHint: 'Press the button to fill in the form.',
    formPlaceholder: 'Choose a form'
  },
  mainMenu: {
    defaultTitle: 'Help center',
    defaultDescription: 'Press the button to choose the type of request.',
    defaultButton: 'Open a ticket',
    fallbackDescription: 'Select the type of request you want to open.',
    chooseRequestPlaceholder: 'Choose the type of request',
    chooseRequest: 'Select the request you want to open a ticket for.',
    invalidForServer: 'This menu is not valid for this server.',
    unavailable: 'The ticket menu is not available.',
    noRequests: 'There are no requests available.'
  },
  open: {
    tooFast: 'You are using the menu too quickly. Try again in a few seconds.',
    expiredOrChanged: 'The request expired or was changed. Open the menu again.',
    checkFields: 'Check the required fields and the length of your answers.',
    alreadyUsed: 'Request already used, expired or no longer allowed.',
    unavailable: 'This request is no longer available.',
    expired: 'This request has expired.',
    formChanged: 'The form was changed. Open the request again.',
    invalidSelection: 'Invalid selection.',
    selectionStale: 'This selection is no longer valid.',
    invalidCategory: 'Invalid category.',
    panelExpired: 'Panel expired or not valid.',
    invalidPanel: 'Invalid panel.',
    cannotOpen: 'You cannot open tickets in this server.',
    formExpiredOrUsed: 'The form expired or was already used. Open the menu again.',
    invalidForm: 'Invalid form. Open the request again.',
    created: (channelId: string) => `Ticket created: <#${channelId}>`,
    modalTitle: (category: string) => `Open ticket - ${category}`,
    step: (index: number, total: number, label: string) => `**${index}/${total} - ${label}**`,
    maxOpen: 'You have reached the limit of open tickets for this request.',
    inProgress: 'You already have a request in progress. Complete the open form.',
    limited: (wait: string) => `Opening is temporarily limited. Try again in about ${wait}.`
  },
  ticket: {
    introTitle: (number: number, category: string) => `Ticket #${number} - ${category}`,
    introDescription: 'Describe your request here. The staff will answer you in this channel.',
    openedViaForm: (number: number, userId: string, form: string) => `Ticket #${number} opened by <@${userId}> through the form **${form}**.`,
    unavailable: 'Ticket not available.',
    invalid: 'Invalid ticket.',
    noClaimPermission: 'You do not have permission to claim this ticket.',
    alreadyClaimedBy: (userId: string) => `Ticket already claimed by <@${userId}>.`,
    unavailableOrClaimed: 'Ticket not available or already claimed.',
    claimedBy: (userId: string) => `Ticket claimed by <@${userId}>.`,
    noReleasePermission: 'You do not have permission to release this ticket.',
    released: 'Ticket released.',
    noStatusPermission: 'You do not have permission to change the status.',
    setWaiting: 'Ticket set to waiting.',
    setResolved: 'Ticket marked as resolved.',
    alreadyClosed: 'The ticket is already closed or does not exist.',
    noClosePermission: 'You do not have permission to close this ticket.',
    closeReasonLabel: 'Reason for closing',
    optional: 'Optional',
    closeModalTitle: (number: number) => `Close ticket #${number}`,
    closed: 'Ticket closed.',
    closeFailed: 'The ticket is already closed or no longer available.',
    // Channel messages
    releasedBy: (actorId: string) => `Ticket released by <@${actorId}>.`,
    assignedTo: (assigneeId: string, actorId: string) => `Ticket assigned to <@${assigneeId}> by <@${actorId}>.`,
    transferredTo: (category: string, actorId: string) => `Ticket moved to the **${category}** category by <@${actorId}>.`,
    memberAdded: (userId: string, actorId: string) => `<@${userId}> was added to the ticket by <@${actorId}>.`,
    memberRemoved: (userId: string, actorId: string) => `<@${userId}> was removed from the ticket by <@${actorId}>.`,
    closedBy: (actorId: string) => `Ticket closed by <@${actorId}>.`,
    closedByWithReason: (actorId: string, reason: string) => `Ticket closed by <@${actorId}>. Reason: ${reason}`,
    rateHandler: (userId: string) => `Rate the help you received from <@${userId}>.`,
    rateGeneric: 'You can rate the help you received.',
    reopenWithin: (hours: number) => `You can reopen the ticket within ${hours} ${hours === 1 ? 'hour' : 'hours'} of closing.`,
    staffCanReopen: 'The staff can reopen the ticket or delete the channel.',
    reopenedNotice: 'Ticket reopened.',
    statusSetTo: (label: string, actorId: string) => `Ticket status set to **${label}** by <@${actorId}>.`,
    statusLabels: { OPEN: 'open', WAITING: 'waiting', IN_PROGRESS: 'in progress', RESOLVED: 'resolved', CLOSED: 'closed', REOPENING: 'reopening' } as Record<string, string>,
    prioritySetTo: (label: string, actorId: string) => `Priority set to **${label}** by <@${actorId}>.`,
    priorityLabels: { LOW: 'low', NORMAL: 'normal', HIGH: 'high', URGENT: 'urgent' } as Record<string, string>,
    slaFirstBreached: (number: number) => `First-response SLA exceeded for ticket #${number}.`,
    slaResolutionBreached: (number: number) => `Resolution SLA exceeded for ticket #${number}.`,
    escalation: (number: number) => `Automatic escalation for ticket #${number}.`,
    inactivityWarning: (userId: string, minutes: number) =>
      `<@${userId}> this ticket will be closed automatically in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} if there is no new activity.`,
    autoCloseReason: 'Closed automatically due to inactivity.',
    deleteAuditReason: (number: number) => `Dispatch: ticket #${number} channel deleted by staff`
  },
  feedback: {
    invalid: 'Invalid feedback.',
    notAllowed: 'You cannot send feedback for this ticket.',
    commentLabel: 'Optional comment',
    commentPlaceholder: 'What went well, or what could we improve?',
    modalTitle: (rating: number) => `Ticket feedback - ${rating}/5`,
    thanks: 'Thank you. Your feedback has been recorded.'
  },
  reopen: {
    notAllowed: 'You cannot reopen this ticket.',
    done: 'Ticket reopened.',
    windowExpired: 'The reopen window has expired.',
    disabled: 'Reopening by users is not enabled for this category.',
    channelDeleted: 'The channel of this ticket was deleted: it cannot be reopened.',
    failed: 'This ticket cannot be reopened.'
  },
  deleteChannel: {
    notAllowed: 'The channel of this ticket cannot be deleted.',
    noPermission: 'You do not have permission to delete this channel.',
    prompt: (number: number) => `Permanently delete the channel of ticket #${number}? ` +
      'The transcript is generated or delivered first, according to the category settings. ' +
      'The ticket stays in the dashboard history but can no longer be reopened.',
    expired: 'Confirmation expired. Press “Delete channel” again.',
    deleting: 'Deleting the channel…',
    deleted: 'Channel deleted.',
    transcriptFailed: 'The transcript could not be generated or delivered: the channel was not deleted.',
    rejected: 'Discord refused to delete the channel. Check the bot’s permissions.'
  },
  staffThread: {
    missingPermissions: 'The bot cannot create private threads: update its role permissions ' +
      '(Create Private Threads, Send Messages in Threads, Manage Threads).',
    busy: 'The staff thread is being created: try again in a few seconds.',
    forbidden: 'Only the staff of this category can use the staff thread.',
    inactive: 'The staff thread is only available for active tickets.',
    created: (threadId: string) => `Staff thread created: <#${threadId}>`,
    joined: (threadId: string) => `You were added to the staff thread: <#${threadId}>`,
    failed: 'The staff thread could not be opened.',
    planRequired: 'Private staff threads are part of the Plus plan and above. Plans are subscriptions on Discord: https://dispatch.haxurus.com/en/pricing',
    intro: (number: number) => `Private staff thread for ticket #${number}. ` +
      'The person who opened the ticket cannot see it; messages here do not count as a reply to the ticket.',
    transferred: (category: string) => `Ticket moved to **${category}**: `,
    createReason: (number: number) => `Dispatch: staff thread for ticket #${number}`,
    duplicateReason: 'Dispatch: duplicate staff thread',
    closedReason: 'Dispatch: ticket closed',
    reopenedReason: 'Dispatch: ticket reopened'
  },
  transcript: {
    noText: '[no text content]',
    attachment: 'attachment',
    embeds: 'Embeds',
    heading: (number: number) => `Ticket #${number}`,
    subtitle: (category: string, status: string) => `Category: ${category} · Status: ${status}`,
    staffTitle: (number: number) => `Dispatch Ticket #${number} - staff thread`,
    staffHeading: (number: number) => `Staff thread · Ticket #${number}`,
    staffSubtitle: (category: string) => `Category: ${category} · Private staff thread, not visible to the user`,
    dm: (number: number) => `Transcript of ticket #${number}.`,
    archive: (number: number, openerId: string) => `Transcript of ticket #${number} · <@${openerId}>`,
    staffArchive: (number: number) => `Staff thread transcript of ticket #${number} (staff only).`
  },
  forms: {
    serverUnavailable: 'Server not available.',
    mustBeMember: 'You must be a member of the server to fill in this form.',
    cannotSubmitHere: 'You cannot fill in forms in this server.',
    cannotSubmit: 'You cannot fill in this form.',
    roleNotAllowed: 'You do not have a role allowed to fill in this form.',
    rolesNotAllowed: 'Your roles do not allow you to submit this form.',
    inProgress: 'You already have a form in progress.',
    maxReached: 'You have reached the maximum number of submissions allowed.',
    tooManyAttempts: 'Too many recent attempts. Try again later.',
    retryIn: (seconds: number) => `Try again in about ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`,
    optional: '_Optional_',
    selectPlaceholder: 'Select...',
    expired: 'This form session has expired or is no longer valid.',
    questionStale: 'This question is no longer valid.',
    questionInvalid: 'Invalid question.',
    questionExpired: 'This question has expired.',
    reportQuestion: 'Question',
    continued: 'continued',
    filledBy: (userId: string) => `Submitted by <@${userId}> (\`${userId}\`)`,
    filledByEmpty: (userId: string) => `Submitted by <@${userId}> with no answers.`,
    expiredOrSent: 'This form session has expired or was already submitted.',
    incomplete: 'The form is not complete.',
    closedBeforeSubmit: 'The form was closed before you submitted it.',
    answersKept: ' Your answers are saved: press the form button again to retry.',
    sent: 'Form submitted.',
    ticketCreated: (channelId: string) => ` <#${channelId}> was created.`,
    ticketFailed: ' The related ticket could not be created: please contact the staff.',
    dmBlocked: 'I cannot send you direct messages. Allow direct messages from this server and press the button again.',
    dmResumed: 'You already have a form in progress: I sent you the current question again in private.',
    dmSent: 'I sent you the form in private.',
    unavailable: 'This form is not available.',
    noQuestions: 'This form has no valid questions.',
    cancelled: 'Form cancelled.'
  },
  log: {
    ticket: 'Ticket',
    author: 'Author',
    category: 'Category',
    channel: 'Channel',
    user: 'User',
    form: 'Form',
    submission: 'Submission',
    messages: 'Messages',
    before: 'Before',
    after: 'After',
    thread: 'Thread',
    ticketOpened: 'Ticket opened',
    ticketOpenedFromForm: 'Ticket opened from a form',
    origin: 'Origin',
    originPanel: 'Panel',
    originMenu: 'Main menu',
    claimed: 'Ticket claimed',
    released: 'Ticket released',
    previousAssignee: 'Previous assignee',
    assigned: 'Ticket assigned',
    assignee: 'Assignee',
    transferred: 'Category changed',
    previousCategory: 'Previous category',
    memberAdded: 'Member added',
    memberRemoved: 'Member removed',
    transcriptGenerated: 'Transcript generated',
    autoTranscript: 'Automatic transcript',
    dmToUser: 'DM to the user',
    archiveChannel: 'Archive channel',
    retainedCopy: 'Copy retained',
    closed: 'Ticket closed',
    reasonGiven: 'Reason given',
    movedTo: 'Moved to',
    reopened: 'Ticket reopened',
    byUser: 'By the user',
    channelDeletedByStaff: 'Channel deleted by staff',
    channelDeletedByRetention: 'Channel deleted by retention',
    statusChanged: 'Status changed',
    priorityChanged: 'Priority changed',
    staffThreadCreated: 'Staff thread created',
    staffThreadTranscript: 'Staff thread transcript sent',
    destination: 'Destination',
    archiveDestination: 'Transcript archive channel',
    logDestination: 'Ticket log channel',
    slaFirst: 'First-response SLA exceeded',
    slaResolution: 'Resolution SLA exceeded',
    threshold: 'Threshold',
    escalation: 'Automatic escalation',
    escalationAfter: 'After',
    roles: 'Roles',
    inactivityWarning: 'Inactivity close warning',
    closingIn: 'Closing in',
    autoClose: 'Closed for inactivity',
    inactivity: 'Inactivity',
    hours: (value: number) => `${value} ${value === 1 ? 'hour' : 'hours'}`,
    minutesShort: (value: number) => `${value} min`,
    feedback: 'Feedback received',
    rating: 'Rating',
    moderator: 'Moderator',
    unattributed: 'Unattributed',
    formSubmitted: 'Form submitted',
    ticketCreationFailed: 'Creation failed',
    testMessage: 'Test message',
    activeEvents: 'Enabled events',
    noEvents: 'No events selected',
    blacklistAdded: 'User added to the blacklist',
    blacklistRemoved: 'User removed from the blacklist',
    expiry: 'Expires',
    permanent: 'Permanent',
    eventLabels: {
      TICKET_OPEN: 'Ticket opened',
      TICKET_CLAIM: 'Claims',
      TICKET_UPDATE: 'Ticket changes',
      TICKET_MEMBERS: 'Participants',
      TICKET_CLOSE: 'Closing',
      TICKET_REOPEN: 'Reopening',
      TICKET_DELETE: 'Channel deletion',
      TICKET_TRANSCRIPT: 'Transcripts',
      TICKET_FEEDBACK: 'Feedback',
      TICKET_STAFF_THREAD: 'Staff thread',
      TICKET_AUTOMATION: 'Automations',
      FORM_SUBMISSION: 'Form submissions',
      BLACKLIST: 'Blacklist'
    } satisfies Record<TicketLogEvent, string>
  },
  leaderboard: {
    line: (handled: number, rating: string, firstResponse: string) =>
      `${handled} ${handled === 1 ? 'ticket' : 'tickets'} · ${rating} · 1st reply ${firstResponse}`,
    empty: 'No tickets handled in this period.',
    legend: (minRatings: number) =>
      `Order: tickets handled, then average rating (counted with at least ${minRatings} ` +
      `${minRatings === 1 ? 'rating' : 'ratings'}, otherwise “—”), then number of ratings. ` +
      '1st reply = median of the tickets where the moderator answered first.'
  }
};

export type BotMessages = typeof en;

const it: BotMessages = {
  htmlLang: 'it',
  common: {
    interactionError: 'Si è verificato un errore durante la gestione della richiesta.',
    yes: 'Sì',
    no: 'No',
    none: 'Nessuno',
    noAnswer: 'Nessuna risposta',
    system: 'Sistema',
    unknown: 'sconosciuto',
    minutes: (value: number) => `${value} ${value === 1 ? 'minuto' : 'minuti'}`,
    seconds: (value: number) => `${value} ${value === 1 ? 'secondo' : 'secondi'}`
  },
  buttons: {
    claim: 'Claim',
    unclaim: 'Unclaim',
    waiting: 'In attesa',
    resolved: 'Risolto',
    close: 'Chiudi',
    staffThread: 'Thread staff',
    reopen: 'Riapri ticket',
    deleteChannel: 'Elimina canale',
    confirmDelete: 'Conferma eliminazione',
    cancel: 'Annulla',
    skip: 'Salta',
    answer: 'Rispondi',
    answerOrSkip: 'Rispondi / salta',
    yes: 'Sì',
    no: 'No'
  },
  panel: {
    buttonsHint: 'Premi il pulsante del tipo di ticket da aprire.',
    selectHint: 'Seleziona il tipo di ticket da aprire.',
    selectPlaceholder: 'Seleziona una categoria',
    formSelectHint: 'Scegli il form da compilare.',
    formButtonHint: 'Premi il pulsante per compilare il form.',
    formPlaceholder: 'Scegli un form'
  },
  mainMenu: {
    defaultTitle: 'Centro assistenza',
    defaultDescription: 'Premi il pulsante per scegliere il tipo di richiesta.',
    defaultButton: 'Apri un ticket',
    fallbackDescription: 'Seleziona il tipo di richiesta da aprire.',
    chooseRequestPlaceholder: 'Scegli il tipo di richiesta',
    chooseRequest: 'Seleziona la richiesta per cui vuoi aprire un ticket.',
    invalidForServer: 'Menu non valido per questo server.',
    unavailable: 'Il menu ticket non è disponibile.',
    noRequests: 'Non ci sono richieste disponibili.'
  },
  open: {
    tooFast: 'Stai usando il menu troppo rapidamente. Riprova tra pochi secondi.',
    expiredOrChanged: 'La richiesta è scaduta o è stata modificata. Apri nuovamente il menu.',
    checkFields: 'Controlla i campi obbligatori e le lunghezze delle risposte.',
    alreadyUsed: 'Richiesta già utilizzata, scaduta o non più consentita.',
    unavailable: 'Questa richiesta non è più disponibile.',
    expired: 'Questa richiesta è scaduta.',
    formChanged: 'Il modulo è stato modificato. Riapri la richiesta.',
    invalidSelection: 'Selezione non valida.',
    selectionStale: 'Questa selezione non è più valida.',
    invalidCategory: 'Categoria non valida.',
    panelExpired: 'Pannello scaduto o non valido.',
    invalidPanel: 'Pannello non valido.',
    cannotOpen: 'Non puoi aprire ticket in questo server.',
    formExpiredOrUsed: 'Il modulo è scaduto o è già stato utilizzato. Apri nuovamente il menu.',
    invalidForm: 'Modulo non valido. Apri nuovamente la richiesta.',
    created: (channelId: string) => `Ticket creato: <#${channelId}>`,
    modalTitle: (category: string) => `Apri ticket - ${category}`,
    step: (index: number, total: number, label: string) => `**${index}/${total} - ${label}**`,
    maxOpen: 'Hai raggiunto il limite di ticket aperti per questa richiesta.',
    inProgress: 'Hai già una richiesta in corso. Completa il modulo aperto.',
    limited: (wait: string) => `Apertura temporaneamente limitata. Riprova tra circa ${wait}.`
  },
  ticket: {
    introTitle: (number: number, category: string) => `Ticket #${number} - ${category}`,
    introDescription: 'Descrivi qui la tua richiesta. Lo staff ti risponderà in questo canale.',
    openedViaForm: (number: number, userId: string, form: string) => `Ticket #${number} aperto da <@${userId}> tramite il form **${form}**.`,
    unavailable: 'Ticket non disponibile.',
    invalid: 'Ticket non valido.',
    noClaimPermission: 'Non hai i permessi per prendere in carico questo ticket.',
    alreadyClaimedBy: (userId: string) => `Ticket già preso in carico da <@${userId}>.`,
    unavailableOrClaimed: 'Ticket non disponibile o già preso in carico.',
    claimedBy: (userId: string) => `Ticket preso in carico da <@${userId}>.`,
    noReleasePermission: 'Non hai i permessi per rilasciare questo ticket.',
    released: 'Ticket rilasciato.',
    noStatusPermission: 'Non hai i permessi per modificare lo stato.',
    setWaiting: 'Ticket impostato in attesa.',
    setResolved: 'Ticket segnato come risolto.',
    alreadyClosed: 'Il ticket è già chiuso o non esiste.',
    noClosePermission: 'Non hai i permessi per chiudere questo ticket.',
    closeReasonLabel: 'Motivo della chiusura',
    optional: 'Opzionale',
    closeModalTitle: (number: number) => `Chiudi ticket #${number}`,
    closed: 'Ticket chiuso.',
    closeFailed: 'Il ticket è già chiuso o non è più disponibile.',
    releasedBy: (actorId: string) => `Ticket rilasciato da <@${actorId}>.`,
    assignedTo: (assigneeId: string, actorId: string) => `Ticket assegnato a <@${assigneeId}> da <@${actorId}>.`,
    transferredTo: (category: string, actorId: string) => `Ticket trasferito alla categoria **${category}** da <@${actorId}>.`,
    memberAdded: (userId: string, actorId: string) => `<@${userId}> è stato aggiunto al ticket da <@${actorId}>.`,
    memberRemoved: (userId: string, actorId: string) => `<@${userId}> è stato rimosso dal ticket da <@${actorId}>.`,
    closedBy: (actorId: string) => `Ticket chiuso da <@${actorId}>.`,
    closedByWithReason: (actorId: string, reason: string) => `Ticket chiuso da <@${actorId}>. Motivo: ${reason}`,
    rateHandler: (userId: string) => `Valuta l’assistenza ricevuta da <@${userId}>.`,
    rateGeneric: 'Puoi valutare l’assistenza ricevuta.',
    reopenWithin: (hours: number) => `Puoi riaprire il ticket entro ${hours} ${hours === 1 ? 'ora' : 'ore'} dalla chiusura.`,
    staffCanReopen: 'Lo staff può riaprire il ticket o eliminare il canale.',
    reopenedNotice: 'Ticket riaperto.',
    statusSetTo: (label: string, actorId: string) => `Stato ticket impostato su **${label}** da <@${actorId}>.`,
    statusLabels: { OPEN: 'aperto', WAITING: 'in attesa', IN_PROGRESS: 'in lavorazione', RESOLVED: 'risolto', CLOSED: 'chiuso', REOPENING: 'in riapertura' },
    prioritySetTo: (label: string, actorId: string) => `Priorità impostata su **${label}** da <@${actorId}>.`,
    priorityLabels: { LOW: 'bassa', NORMAL: 'normale', HIGH: 'alta', URGENT: 'urgente' },
    slaFirstBreached: (number: number) => `SLA prima risposta superato per il ticket #${number}.`,
    slaResolutionBreached: (number: number) => `SLA risoluzione superato per il ticket #${number}.`,
    escalation: (number: number) => `Escalation automatica per il ticket #${number}.`,
    inactivityWarning: (userId: string, minutes: number) =>
      `<@${userId}> questo ticket verrà chiuso automaticamente tra circa ${minutes} ${minutes === 1 ? 'minuto' : 'minuti'} se non ci saranno nuove attività.`,
    autoCloseReason: 'Chiuso automaticamente per inattività.',
    deleteAuditReason: (number: number) => `Dispatch: canale del ticket #${number} eliminato dallo staff`
  },
  feedback: {
    invalid: 'Feedback non valido.',
    notAllowed: 'Non puoi inviare feedback per questo ticket.',
    commentLabel: 'Commento opzionale',
    commentPlaceholder: 'Cosa è andato bene o cosa possiamo migliorare?',
    modalTitle: (rating: number) => `Feedback ticket - ${rating}/5`,
    thanks: 'Grazie. Il tuo feedback è stato registrato.'
  },
  reopen: {
    notAllowed: 'Non puoi riaprire questo ticket.',
    done: 'Ticket riaperto.',
    windowExpired: 'La finestra di riapertura è scaduta.',
    disabled: 'La riapertura utente non è abilitata per questa categoria.',
    channelDeleted: 'Il canale di questo ticket è stato eliminato: non può essere riaperto.',
    failed: 'Non è possibile riaprire questo ticket.'
  },
  deleteChannel: {
    notAllowed: 'Il canale di questo ticket non può essere eliminato.',
    noPermission: 'Non hai i permessi per eliminare questo canale.',
    prompt: (number: number) => `Eliminare definitivamente il canale del ticket #${number}? ` +
      'Il transcript viene prima generato o consegnato secondo le impostazioni della categoria. ' +
      'Il ticket resta nello storico della dashboard ma non potrà più essere riaperto.',
    expired: 'Conferma scaduta. Premi di nuovo “Elimina canale”.',
    deleting: 'Eliminazione del canale in corso…',
    deleted: 'Canale eliminato.',
    transcriptFailed: 'Impossibile generare o consegnare il transcript: il canale non è stato eliminato.',
    rejected: 'Discord ha rifiutato l’eliminazione del canale. Controlla i permessi del bot.'
  },
  staffThread: {
    missingPermissions: 'Il bot non ha i permessi per creare thread privati: aggiorna i permessi del suo ruolo ' +
      '(Crea thread privati, Invia messaggi nei thread, Gestisci thread).',
    busy: 'Il thread staff è in fase di creazione: riprova tra qualche secondo.',
    forbidden: 'Solo lo staff di questa categoria può usare il thread staff.',
    inactive: 'Il thread staff è disponibile solo per i ticket attivi.',
    created: (threadId: string) => `Thread staff creato: <#${threadId}>`,
    joined: (threadId: string) => `Sei stato aggiunto al thread staff: <#${threadId}>`,
    failed: 'Impossibile aprire il thread staff.',
    planRequired: 'I thread staff privati sono inclusi dal piano Plus in su. I piani sono abbonamenti su Discord: https://dispatch.haxurus.com/it/pricing',
    intro: (number: number) => `Thread privato dello staff per il ticket #${number}. ` +
      'Chi ha aperto il ticket non può vederlo; i messaggi non contano come risposta al ticket.',
    transferred: (category: string) => `Ticket trasferito a **${category}**: `,
    createReason: (number: number) => `Dispatch: thread staff del ticket #${number}`,
    duplicateReason: 'Dispatch: thread staff duplicato',
    closedReason: 'Dispatch: ticket chiuso',
    reopenedReason: 'Dispatch: ticket riaperto'
  },
  transcript: {
    noText: '[nessun contenuto testuale]',
    attachment: 'allegato',
    embeds: 'Embed',
    heading: (number: number) => `Ticket #${number}`,
    subtitle: (category: string, status: string) => `Categoria: ${category} · Stato: ${status}`,
    staffTitle: (number: number) => `Dispatch Ticket #${number} - thread staff`,
    staffHeading: (number: number) => `Thread staff · Ticket #${number}`,
    staffSubtitle: (category: string) => `Categoria: ${category} · Thread privato dello staff, non visibile all’utente`,
    dm: (number: number) => `Transcript del ticket #${number}.`,
    archive: (number: number, openerId: string) => `Transcript ticket #${number} · <@${openerId}>`,
    staffArchive: (number: number) => `Transcript del thread staff del ticket #${number} (riservato allo staff).`
  },
  forms: {
    serverUnavailable: 'Server non disponibile.',
    mustBeMember: 'Devi essere nel server per compilare questo form.',
    cannotSubmitHere: 'Non puoi compilare form in questo server.',
    cannotSubmit: 'Non puoi compilare questo form.',
    roleNotAllowed: 'Non hai un ruolo autorizzato a compilare questo form.',
    rolesNotAllowed: 'I tuoi ruoli non consentono l’invio di questo form.',
    inProgress: 'Hai già una compilazione in corso.',
    maxReached: 'Hai raggiunto il numero massimo di invii consentiti.',
    tooManyAttempts: 'Troppi tentativi recenti. Riprova più tardi.',
    retryIn: (seconds: number) => `Riprova tra circa ${seconds} ${seconds === 1 ? 'secondo' : 'secondi'}.`,
    optional: '_Facoltativa_',
    selectPlaceholder: 'Seleziona...',
    expired: 'Questa compilazione è scaduta o non è più valida.',
    questionStale: 'Questa domanda non è più valida.',
    questionInvalid: 'Domanda non valida.',
    questionExpired: 'Questa domanda è scaduta.',
    reportQuestion: 'Domanda',
    continued: 'continua',
    filledBy: (userId: string) => `Compilato da <@${userId}> (\`${userId}\`)`,
    filledByEmpty: (userId: string) => `Compilato da <@${userId}> senza risposte.`,
    expiredOrSent: 'Questa compilazione è scaduta o è già stata inviata.',
    incomplete: 'La compilazione non è completa.',
    closedBeforeSubmit: 'Il form è stato chiuso prima dell’invio.',
    answersKept: ' Le tue risposte restano salvate: premi di nuovo il pulsante del form per riprovare.',
    sent: 'Form inviato correttamente.',
    ticketCreated: (channelId: string) => ` È stato creato <#${channelId}>.`,
    ticketFailed: ' Non è stato possibile creare il ticket associato: contatta lo staff.',
    dmBlocked: 'Non riesco a inviarti messaggi privati. Abilita i messaggi diretti da questo server e premi di nuovo il pulsante.',
    dmResumed: 'Hai già una compilazione in corso: ti ho inviato di nuovo la domanda corrente in privato.',
    dmSent: 'Ti ho inviato il form in privato.',
    unavailable: 'Questo form non è disponibile.',
    noQuestions: 'Questo form non contiene domande valide.',
    cancelled: 'Compilazione annullata.'
  },
  log: {
    ticket: 'Ticket',
    author: 'Autore',
    category: 'Categoria',
    channel: 'Canale',
    user: 'Utente',
    form: 'Form',
    submission: 'Invio',
    messages: 'Messaggi',
    before: 'Prima',
    after: 'Dopo',
    thread: 'Thread',
    ticketOpened: 'Ticket aperto',
    ticketOpenedFromForm: 'Ticket aperto da un form',
    origin: 'Origine',
    originPanel: 'Pannello',
    originMenu: 'Menu principale',
    claimed: 'Ticket preso in carico',
    released: 'Ticket rilasciato',
    previousAssignee: 'Assegnatario precedente',
    assigned: 'Ticket assegnato',
    assignee: 'Assegnatario',
    transferred: 'Categoria trasferita',
    previousCategory: 'Categoria precedente',
    memberAdded: 'Membro aggiunto',
    memberRemoved: 'Membro rimosso',
    transcriptGenerated: 'Transcript generato',
    autoTranscript: 'Transcript automatico',
    dmToUser: 'DM all’utente',
    archiveChannel: 'Canale archivio',
    retainedCopy: 'Copia conservata',
    closed: 'Ticket chiuso',
    reasonGiven: 'Motivo indicato',
    movedTo: 'Spostato in',
    reopened: 'Ticket riaperto',
    byUser: 'Da parte dell’utente',
    channelDeletedByStaff: 'Canale eliminato dallo staff',
    channelDeletedByRetention: 'Canale eliminato dalla retention',
    statusChanged: 'Stato modificato',
    priorityChanged: 'Priorità modificata',
    staffThreadCreated: 'Thread staff creato',
    staffThreadTranscript: 'Transcript del thread staff inviato',
    destination: 'Destinazione',
    archiveDestination: 'Canale archivio transcript',
    logDestination: 'Canale log ticket',
    slaFirst: 'SLA prima risposta superato',
    slaResolution: 'SLA risoluzione superato',
    threshold: 'Soglia',
    escalation: 'Escalation automatica',
    escalationAfter: 'Dopo',
    roles: 'Ruoli',
    inactivityWarning: 'Preavviso chiusura per inattività',
    closingIn: 'Chiusura tra',
    autoClose: 'Chiusura automatica per inattività',
    inactivity: 'Inattività',
    hours: (value: number) => `${value} ${value === 1 ? 'ora' : 'ore'}`,
    minutesShort: (value: number) => `${value} min`,
    feedback: 'Feedback ricevuto',
    rating: 'Valutazione',
    moderator: 'Moderatore',
    unattributed: 'Non attribuito',
    formSubmitted: 'Form inviato',
    ticketCreationFailed: 'Creazione non riuscita',
    testMessage: 'Messaggio di prova',
    activeEvents: 'Eventi attivi',
    noEvents: 'Nessun evento selezionato',
    blacklistAdded: 'Utente aggiunto alla blacklist',
    blacklistRemoved: 'Utente rimosso dalla blacklist',
    expiry: 'Scadenza',
    permanent: 'Permanente',
    eventLabels: {
      TICKET_OPEN: 'Apertura ticket',
      TICKET_CLAIM: 'Presa in carico',
      TICKET_UPDATE: 'Modifiche al ticket',
      TICKET_MEMBERS: 'Partecipanti',
      TICKET_CLOSE: 'Chiusura',
      TICKET_REOPEN: 'Riapertura',
      TICKET_DELETE: 'Eliminazione canale',
      TICKET_TRANSCRIPT: 'Transcript',
      TICKET_FEEDBACK: 'Feedback',
      TICKET_STAFF_THREAD: 'Thread staff',
      TICKET_AUTOMATION: 'Automazioni',
      FORM_SUBMISSION: 'Invii form',
      BLACKLIST: 'Blacklist'
    }
  },
  leaderboard: {
    line: (handled: number, rating: string, firstResponse: string) =>
      `${handled} ticket · ${rating} · 1ª risposta ${firstResponse}`,
    empty: 'Nessun ticket gestito in questo periodo.',
    legend: (minRatings: number) =>
      `Ordine: ticket gestiti, poi valutazione media (conteggiata con almeno ${minRatings} ` +
      `${minRatings === 1 ? 'valutazione' : 'valutazioni'}, altrimenti “—”), poi numero di valutazioni. ` +
      '1ª risposta = mediana dei ticket in cui il moderatore ha risposto per primo.'
  }
};

export const messages: Record<BotLocale, BotMessages> = { en, it };

/**
 * Main menu texts stored with the dashboard defaults are shown in the server's
 * language; anything an admin customised is shown as written.
 */
export function localizedMenuDefault(value: string, key: 'defaultTitle' | 'defaultDescription' | 'defaultButton', locale: BotLocale) {
  const known = [en.mainMenu[key], it.mainMenu[key]];
  return known.includes(value) ? messages[locale].mainMenu[key] : value;
}
