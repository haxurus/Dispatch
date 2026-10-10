# Form e questionari

Dispatch supporta due flussi distinti ma integrati:

- domande iniziali dei ticket;
- form generici, ad esempio candidature, segnalazioni o raccolte dati.

## Domande iniziali dei ticket

Ogni categoria ticket può configurare fino a 5 domande. Sono disponibili:

- risposta breve;
- risposta lunga;
- menu a scelta singola.

Le risposte vengono completate prima della creazione del ticket, salvate cifrate nel record del ticket e pubblicate automaticamente nel messaggio iniziale. Le selezioni intermedie vengono persistite nella prenotazione di apertura, quindi riavvii, doppio click e replay non generano ticket duplicati.

## Form

Un form può contenere fino a 25 domande:

- testo breve o lungo;
- numero intero o decimale;
- email;
- URL;
- data;
- sì/no;
- scelta singola;
- scelta multipla;
- ID Discord.

Ogni risposta viene validata in base al tipo. Le sessioni hanno scadenza, sono persistenti e le risposte parziali sono cifrate.

Vincoli di configurazione verificati dall'API:

- limiti di lunghezza solo per testo breve/lungo, email e URL; limiti numerici solo per intero/decimale;
- `minSelections`/`maxSelections` solo per la scelta multipla, con `minSelections <= maxSelections <= numero opzioni`; una scelta multipla obbligatoria non può avere `minSelections = 0`;
- valori delle opzioni univoci.

In compilazione la scelta multipla usa gli stessi limiti del menu Discord: massimo `min(maxSelections ?? opzioni, opzioni)`, minimo `min(minSelections ?? (obbligatoria ? 1 : 0), massimo)`. Una domanda facoltativa può essere saltata (stringa vuota o nessuna selezione).

Gli orari di apertura e chiusura si inseriscono nella dashboard in ora locale del browser e vengono salvati in UTC.

### Modalità di compilazione

- **In chat**: il flusso usa risposte ephemeral, visibili soltanto all'utente che lo ha avviato.
- **DM**: il flusso prosegue nei messaggi privati del bot.

## Apertura, chiusura e limiti

Per ogni form si possono impostare:

- abilitazione manuale;
- data/ora di apertura;
- data/ora di chiusura;
- numero massimo di invii per utente;
- cooldown tra invii;
- finestra anti-spam;
- numero massimo di tentativi nella finestra;
- ruoli autorizzati;
- ruoli esclusi.

Una compilazione attiva impedisce l'avvio parallelo dello stesso form da parte dello stesso utente. Le sessioni scadute o già consumate non possono essere riutilizzate.

## Risultati

È possibile scegliere un canale Discord nel quale inviare il report e i ruoli da notificare. Il report contiene:

- utente e ID Discord;
- timestamp;
- ID della submission;
- tutte le domande e le risposte.

Le risposte archiviate sono cifrate con la stessa chiave usata dagli altri dati privati di Dispatch.

## Ticket automatico dopo un form

Un form può creare automaticamente un vero ticket Dispatch dopo l'invio.

Si configurano:

- categoria ticket Dispatch;
- eventuale categoria Discord alternativa;
- eventuale categoria Discord per i ticket chiusi (override di quella della categoria ticket);
- eventuali ruoli staff alternativi.

Il ticket creato:

- viene registrato nel database Dispatch;
- utilizza il contatore ticket del server;
- aggiunge il compilatore come opener;
- concede accesso ai ruoli staff configurati;
- contiene il report del form;
- dispone dei normali controlli Claim, Unclaim, stato e chiusura;
- compare nella dashboard e negli audit;
- ricorda il form di origine (`Ticket.sourceFormId`): alla chiusura viene spostato nella **Categoria Discord per i ticket chiusi (override)** del form (`ticketClosedParentCategoryId`), se impostata, altrimenti in quella della categoria ticket. Vedi [TICKET_PROTECTIONS.md](TICKET_PROTECTIONS.md#ticket-chiusi-categoria-dedicata-riapertura-ed-eliminazione-del-canale).

Ogni invio genera l'evento di log `FORM_SUBMISSION` (nome del form, utente, ID invio ed eventuale ticket, mai le risposte) quando il canale log ticket è configurato.

## Permessi

Oltre ai livelli generali della dashboard, ogni form supporta binding per ruolo Discord (valutati sui ruoli **attuali** del membro, letti da Discord a ogni richiesta):

- **Manage**: modifica di domande, testi, pianificazione (apertura/chiusura), limiti anti-spam e ruoli autorizzati/esclusi;
- **View**: il form compare nella dashboard dell'utente;
- **Review**: visualizzazione degli invii;
- **Submit**: autorizzazione esplicita alla compilazione.

Manage e Review implicano View. Un utente non Admin vede **solo** i form per cui almeno uno dei suoi ruoli ha View, Manage o Review; gli invii richiedono Review.

Restano riservati a Owner/Admin:

- creazione ed eliminazione dei form;
- modifica dei binding (`PUT`/`DELETE /api/guilds/:guildId/forms/:formId/permissions/:roleId`): un manager delegato non può concedersi altri permessi;
- canale risultati, ruoli da notificare, ticket automatico (`createTicketOnSubmit`, `ticketCategoryId`, `ticketParentCategoryId`, `ticketClosedParentCategoryId`, `ticketStaffRoleIds`). Un `PUT` di un manager delegato che cambia uno di questi campi riceve `403 FORM_FIELD_ADMIN_ONLY`;
- tutta la gestione dei pannelli (elenco, creazione, modifica, pubblicazione ed eliminazione): vedi [PANELS.md](PANELS.md);
- eliminazione di un singolo invio (`DELETE /api/guilds/:guildId/forms/:formId/submissions/:submissionId`, registrata nell'audit del pannello come `form.submission.delete`).

Un form con invii non può essere eliminato (`409 FORM_IN_USE`, anche in caso di invio concorrente). Una categoria ticket usata da un form per il ticket automatico non può essere eliminata (`409 CATEGORY_IN_USE_BY_FORM`): aggiornare il form o disabilitare la categoria.

Se un invio non è decifrabile, l'elenco lo restituisce con `unreadable: true` e risposte vuote invece di fallire per intero.

## Pannelli

I form vengono pubblicati tramite pannelli Discord gestiti nella sezione **Pannelli** della dashboard ([PANELS.md](PANELS.md)). Un pannello può offrire uno o più form (fino a 25, ordinati) con pulsanti o menu a tendina, embed personalizzato ed emoji. I pannelli creati prima di questa funzione continuano a mostrare un solo pulsante con il loro testo. Eliminando un form, questo viene tolto dagli altri pannelli; un pannello rimasto senza form viene disattivato o, se il form era il suo principale, eliminato.

La ripubblicazione aggiorna il messaggio esistente quando possibile e crea un nuovo messaggio solo se quello precedente non esiste più.

## Transcript dei ticket

Ogni categoria ticket ha l'opzione **Conserva copia cifrata** (`transcriptRetain`, predefinita attiva):

- attiva: la copia cifrata resta nel database fino alla retention o all'eliminazione del ticket e può essere scaricata più volte;
- disattiva: il transcript generato dalla dashboard è monouso e il transcript automatico non viene salvato.

Il download dalla dashboard usa `POST /api/guilds/:guildId/tickets/:ticketId/transcript/download`. Per una copia monouso l'eliminazione è atomica (solo una richiesta concorrente ottiene il contenuto, le altre ricevono `404 TRANSCRIPT_NOT_FOUND`), viene registrata come `ticket.transcript.consume` e la risposta riporta `X-Transcript-Consumed: 1`. `GET`/`HEAD /api/guilds/:guildId/tickets/:ticketId/transcript` non modificano mai i dati e per una copia monouso rispondono `409 TRANSCRIPT_ONE_SHOT`.

La migrazione `20261008100100_forms_api_fixes` rinomina la vecchia colonna `transcriptStoreTemporary` (che aveva significato invertito) in `transcriptRetain` e imposta `true` per le categorie senza generazione automatica, così i transcript esistenti non vengono più eliminati al primo download. Le categorie con generazione automatica mantengono la scelta esplicita fatta in precedenza.
