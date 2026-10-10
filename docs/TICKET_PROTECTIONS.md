# Menu principale, anti-spam e retention

## Configurazione

Aprire la dashboard del server, quindi **Configura ticket > Sistema ticket** (`/dashboard/<guildId>/tickets/system`). La pagina richiede Admin/Owner.

1. Creare le categorie di richiesta in **Configura ticket**, indicando categoria Discord, ruoli staff ed eventuali domande iniziali.
2. In **Sistema ticket**, abilitare il menu principale, scegliere il canale, compilare titolo, descrizione e testo del pulsante, selezionare le richieste disponibili e pubblicare.
3. Il messaggio pubblico mostra **Apri un ticket**. Il pulsante apre un selettore privato visibile solo all'utente; la scelta apre il modulo della richiesta, quando previsto, e infine il suo canale ticket privato. Sono ammesse fino a 25 richieste per menu. Le categorie disabilitate non sono selezionabili. I vecchi messaggi non piu associati alla configurazione vengono rifiutati.

La pubblicazione aggiorna il messaggio esistente. Un nuovo messaggio viene creato soltanto quando non ne esiste uno oppure Discord restituisce esplicitamente Unknown Message: errori di permessi/rete non causano una pubblicazione duplicata. Se si cambia canale, il vecchio messaggio resta inattivo e puo essere rimosso manualmente.

### Pannelli ticket

I pannelli ticket si gestiscono nella sezione **Pannelli** ([PANELS.md](PANELS.md)), con menu a tendina o pulsanti. Entrambi seguono lo stesso percorso protetto descritto sotto: limitatore di ingresso, prenotazione con chiave `p_<panelId>`, controllo che il messaggio sia quello attuale del pannello e che la categoria sia ancora inclusa nel pannello e abilitata. Anche la pubblicazione dei pannelli usa la regola Unknown Message per evitare duplicati.

## Anti-spam e cooldown

Sono configurabili cooldown globale, cooldown per categoria, numero di tentativi e durata della finestra temporale globale/per categoria, durata base del blocco temporaneo. Valori iniziali: 30 secondi globale, 60 secondi per categoria, 5 tentativi globali/10 minuti, 3 per categoria/10 minuti, blocco base 15 minuti.

I blocchi ripetuti crescono con moltiplicatore 1, 2, 4, 8; il massimo assoluto e 7 giorni. Le infrazioni decadono dopo 24 ore senza nuove infrazioni. Un limite tecnico aggiuntivo di 5 interazioni di apertura ogni 5 secondi protegge il database e non riguarda i comandi staff.

Ogni apertura ha una prenotazione casuale monouso, persistita in PostgreSQL e legata a server, utente, categoria, origine e versione del modulo. Una transazione serializza le richieste concorrenti; invii duplicati, moduli scaduti/modificati e nonce appartenenti ad altri utenti vengono rifiutati. I limiti di ticket aperti e l'esclusione delle aperture simultanee restano attivi anche disabilitando i cooldown. La blacklist viene ricontrollata prima della creazione effettiva.

Un modulo abbandonato scade dopo 10 minuti. Una mutazione Discord dall'esito incerto NON viene sbloccata automaticamente: lo stato CREATING resta persistito per evitare doppi canali. L'operatore deve verificare eventuali canali creati prima di correggere la prenotazione. Non cancellare alla cieca le righe TicketUserGuard. Un errore nella risposta privata all'utente non elimina un ticket gia salvato.

## Transcript

La generazione automatica è configurabile per singola categoria ticket ed è disattivata per impostazione predefinita.

Alla chiusura è possibile scegliere, anche contemporaneamente, di:

- inviare il transcript HTML in DM all'utente che ha aperto il ticket;
- inviarlo come file in un canale Discord dedicato;
- mantenere una copia cifrata nel database Dispatch.

Se la copia lato Dispatch non è abilitata, il transcript automatico viene costruito esclusivamente in memoria, inviato alle destinazioni configurate e poi scartato. Non viene scritto su filesystem.

La generazione manuale dalla dashboard salva una copia cifrata per consentire il download. Se la categoria non prevede conservazione lato Dispatch (`transcriptRetain` disattivo; predefinito attivo), la copia è monouso: il download avviene con `POST .../transcript/download`, che la elimina in modo atomico; `GET`/`HEAD` non eliminano mai nulla. In ogni caso la relazione `Transcript -> Ticket` usa cancellazione a cascata: eliminando il ticket viene eliminata anche qualsiasi copia transcript ancora presente.

La consegna DM o nel canale archivio non blocca la chiusura del ticket in caso di errore Discord; l'esito viene registrato nell'audit. Una riapertura e una successiva nuova chiusura generano un transcript aggiornato.

## Ticket chiusi: categoria dedicata, riapertura ed eliminazione del canale

### Categoria Discord per i ticket chiusi

Ogni categoria ticket può indicare una **Categoria Discord per i ticket chiusi** (`TicketCategory.closedParentCategoryId`, facoltativa). Un form con ticket automatico può sovrascriverla con **Categoria Discord per i ticket chiusi (override)** (`FormDefinition.ticketClosedParentCategoryId`): il bot collega il ticket al form che lo ha creato (`Ticket.sourceFormId`, FK `ON DELETE SET NULL`). L'API accetta solo categorie Discord (tipo 4) del server.

Alla chiusura (modulo Discord, dashboard o chiusura automatica), dopo l'aggiornamento condizionale dello stato e il blocco dei permessi, il canale viene spostato nella categoria di destinazione (override del form, altrimenti quella della categoria ticket) con `lockPermissions: false`: il canale conserva i propri permessi (opener, partecipanti, staff, `@everyone` negato e thread negati) e non eredita quelli della categoria. Il parent precedente viene salvato in `Ticket.openParentId`. Se Discord rifiuta lo spostamento (categoria piena: 50 canali, permessi mancanti, categoria inesistente) il canale resta dov'è, l'audit registra `ticket.close.move_failed` con il codice d'errore e la chiusura prosegue normalmente. Il canale viene rinominato `closed-XXXX` come prima.

Alla riapertura, dopo il ripristino dei permessi, il canale torna in `openParentId` oppure, se mancante, nella categoria Discord della categoria ticket; `openParentId` viene azzerato. Un errore viene registrato come `ticket.reopen.move_failed` e non blocca la riapertura.

### Pulsanti del messaggio di chiusura

Il messaggio di chiusura contiene, oltre alle stelle del feedback quando attivo:

- **Riapri ticket** (`dispatch:reopen:<ticketId>`): lo staff della categoria (ruoli staff, Gestisci server o Gestisci canali) può sempre riaprire; l'utente che ha aperto il ticket solo entro la finestra di riapertura, come prima. Stesso percorso protetto della dashboard (prenotazione, lock del ticket, stato `REOPENING`).
- **Elimina canale** (`dispatch:delete-channel:<ticketId>`): solo staff. Il primo click mostra una conferma privata con **Conferma eliminazione** (`dispatch:delete-confirm:<ticketId>:<scadenza base36>`, valida 2 minuti); alla conferma staff e stato vengono ricontrollati.

### Eliminazione del canale

L'eliminazione è disponibile da Discord (pulsante sopra) e dalla dashboard (dettaglio ticket, **Elimina canale** con conferma, livello Moderator o superiore come le altre azioni sui ticket; `POST /api/guilds/:guildId/tickets/:ticketId/delete-channel`, azione RPC del bot `delete-channel`). Solo per ticket `CLOSED` senza marcatore di retention.

1. Il canale viene verificato come per la retention (stesso server, testuale, topic `Dispatch ticket #N - `): un canale riutilizzato non viene eliminato.
2. Il transcript viene messo al sicuro secondo le impostazioni della categoria prima di eliminare: se la generazione automatica è attiva e la consegna di chiusura manca (o non ha raggiunto il canale archivio configurato) viene ripetuta; se la categoria conserva una copia cifrata e non esiste, viene salvata. Se non è possibile, l'eliminazione viene rifiutata (`TICKET_TRANSCRIPT_FAILED`). Un transcript già scaduto per retention non blocca l'eliminazione.
3. Sotto lock del ticket un aggiornamento condizionale (`status = CLOSED`, nessun marcatore di retention, canale non ancora eliminato) imposta `Ticket.channelDeletedAt` e registra `ticket.channel.delete`.
4. Il canale Discord viene eliminato. Unknown Channel equivale a canale già assente; qualsiasi altro errore ripristina il marcatore, registra `ticket.channel.delete_failed` e restituisce `TICKET_CHANNEL_DELETE_FAILED`.

Il record del ticket resta per storico e analytics fino alla retention. La riapertura viene rifiutata con `TICKET_CHANNEL_DELETED` e la dashboard mostra lo stato *Canale eliminato* senza i pulsanti di riapertura.

## Log ticket

In **Sistema e menu** la scheda **Log ticket** sceglie un canale testuale o di annunci del server (`GuildSettings.ticketLogChannelId`) e gli eventi da registrare (`GuildSettings.ticketLogEvents`, chiavi definite una sola volta in `@dispatch/shared`):

| Evento | Contenuto |
| --- | --- |
| `TICKET_OPEN` | apertura da menu, pannello o form |
| `TICKET_CLAIM` | claim, rilascio, assegnazione |
| `TICKET_UPDATE` | stato, priorità, trasferimento di categoria |
| `TICKET_MEMBERS` | aggiunta o rimozione di un membro |
| `TICKET_CLOSE` | chiusura (solo se un motivo è stato indicato, mai il testo) |
| `TICKET_REOPEN` | riapertura |
| `TICKET_DELETE` | canale eliminato dallo staff o dalla retention |
| `TICKET_TRANSCRIPT` | generazione manuale e consegna automatica |
| `TICKET_FEEDBACK` | valutazione 1-5 e moderatore valutato, mai il commento |
| `TICKET_STAFF_THREAD` | thread staff creato, transcript del thread inviato (mai il contenuto) |
| `TICKET_AUTOMATION` | SLA superati, escalation, preavviso e chiusura per inattività |
| `FORM_SUBMISSION` | nome del form, utente, ID invio, ticket collegato; mai le risposte |
| `BLACKLIST` | aggiunta o rimozione dalla dashboard |

Ogni evento è un embed compatto (titolo, ticket e canale, autore con ID, categoria, dati specifici, data) inviato con `allowedMentions: { parse: [] }`. I campi cifrati (motivo di chiusura, risposte dei form, note, commento del feedback) non vengono mai pubblicati. L'invio è best effort: errori di Discord o di configurazione vengono registrati nel log del bot con il solo codice e non interrompono mai l'azione sul ticket. Le impostazioni sono lette con una cache di 30 secondi; **Invia messaggio di prova** (`POST /api/guilds/:guildId/ticket-log/test`, Admin) salva, ricarica la configurazione e restituisce codici stabili (`TICKET_LOG_CHANNEL_REQUIRED`, `TICKET_LOG_CHANNEL_INVALID`, `TICKET_LOG_SEND_FAILED`).

Gli eventi `BLACKLIST` nascono nell'API: dopo la modifica l'API invia al bot (`POST /guilds/:guildId/ticket-log/event`) solo un payload strutturato `{ event: 'BLACKLIST', action: 'add' | 'remove', targetUserId, actorId, expiresAt? }`. Il bot rifiuta qualunque altra chiave o testo libero (`INVALID_TICKET_LOG_EVENT`): il motivo della blacklist non viene mai inviato.

## Valutazioni attribuite al moderatore

Migrazione `20261012100000_ratings_leaderboard_threads`. Prima gli analytics attribuivano feedback e chiusure al `claimedById` *attuale*, che viene azzerato da rilascio e riapertura. Ora l'attribuzione viene fissata nel momento in cui avviene:

- **Chiusura** (modulo Discord, dashboard, chiusura automatica): `Ticket.closedById` = chi ha chiuso, solo se ha accesso staff alla categoria (ruoli staff, Gestisci server o Gestisci canali; verificato dal bot sul membro Discord, anche per le chiusure dalla dashboard). Mai l'utente che ha aperto il ticket (anche se ha un ruolo staff) né il bot (chiusura per inattività). `Ticket.handledById` = claimer al momento della chiusura, altrimenti `closedById`, altrimenti `NULL`. La riapertura azzera entrambi; la chiusura successiva li ricalcola.
- **Feedback**: `TicketFeedback.staffUserId` = claimer del ticket chiuso, altrimenti `closedById`, altrimenti `NULL` (non attribuito). Il valore resta anche se in seguito il claim cambia.
- Il messaggio di chiusura nomina il moderatore («Valuta l’assistenza ricevuta da @moderatore», menzione **senza** notifica: `allowedMentions: { parse: [] }`), oppure il testo generico se il ticket non è attribuito.
- Analytics (`GET /api/guilds/:guildId/analytics`): nella tabella staff `closures` conta i ticket con `handledById` = moderatore e `averageRating`/`feedbackCount` usano `staffUserId`. Gli altri campi restano invariati.
- Backfill: i feedback esistenti vengono attribuiti al claimer attuale del ticket (ciò che gli analytics mostravano finora) e i ticket già chiusi ricevono `handledById` = claimer. Valori non snowflake restano `NULL`; vincoli `CHECK` snowflake sulle nuove colonne.

## Classifica moderatori

Nella pagina **Analytics** la sezione **Classifica moderatori** mostra (livello Moderator o superiore, come gli analytics) la classifica della settimana o del mese corrente/precedente. Per periodo `[inizio, fine)` e per moderatore:

- **ticket gestiti**: ticket chiusi nel periodo con `handledById` = moderatore;
- **valutazione media** e numero di valutazioni: feedback creati nel periodo con `staffUserId` = moderatore; la media conta solo con almeno `leaderboardMinRatings` valutazioni (0..50, predefinito 3), altrimenti è mostrata come «—»;
- **prima risposta**: mediana dei tempi dei ticket in cui il moderatore è stato il primo a rispondere (audit `ticket.first_staff_response` nel periodo);
- **claim**: claim e assegnazioni nel periodo.

Ordine: ticket gestiti, poi valutazione media (chi non raggiunge il minimo sta sotto chi lo raggiunge), poi numero di valutazioni, poi ID; a parità completa la posizione è condivisa (1, 1, 3). Ranking e periodi sono funzioni pure in `@dispatch/shared` (`rankLeaderboard`, `leaderboardPeriod`, `dueLeaderboardPeriods`): settimane ISO 8601 (chiave `2026-W41`; la settimana appartiene all'anno del suo giovedì, quindi 28/12/2026-03/01/2027 è `2026-W53`) e mesi di calendario (chiave `2026-09`), con mezzanotte locale nel fuso del server (`GuildSettings.timezone`, predefinito `Europe/Rome`, API `Intl`, nessuna dipendenza): la settimana del cambio d'ora dura 7 giorni ± 1 ora.

### Pubblicazione automatica

Scheda **Pubblicazione della classifica** (Admin/Owner): canale testuale o di annunci (`leaderboardChannelId`), classifica settimanale e/o mensile, giorno della settimana (`leaderboardWeekday`, 1 = lunedì) e ora (`leaderboardHour`, 0..23) nel fuso del server, numero di moderatori (`leaderboardSize`, 3..25) e valutazioni minime. API: `GET/PUT /api/guilds/:guildId/leaderboard/settings` (Admin; `LEADERBOARD_CHANNEL_NOT_FOUND` se il canale non è testuale o di annunci del server), anteprima `GET /api/guilds/:guildId/leaderboard?period=week|month&offset=0` (Moderator), **Invia ora** `POST /api/guilds/:guildId/leaderboard/send` `{ period, offset }` (Admin; RPC del bot `POST /guilds/:guildId/leaderboard/send`, codici `LEADERBOARD_CHANNEL_REQUIRED`, `LEADERBOARD_CHANNEL_INVALID`, `LEADERBOARD_SEND_FAILED`). «Invia ora» pubblica il periodo mostrato nell'anteprima e non modifica la pianificazione.

Il bot controlla ogni 15 minuti (e all'avvio; cicli mai sovrapposti, errori isolati per server). Quando l'ora locale ha superato (giorno, ora) della settimana corrente pubblica la settimana precedente; quando ha superato (giorno 1, ora) del mese corrente, il mese precedente. Prima di pubblicare, la chiave del periodo (`leaderboardLastWeekly` / `leaderboardLastMonthly`) viene prenotata con un aggiornamento condizionale sul valore precedente: riavvii e due processi del bot non pubblicano mai due volte lo stesso periodo; se Discord rifiuta l'invio la chiave viene ripristinata e il ciclo successivo riprova. Un bot offline all'orario pubblica in ritardo lo stesso periodo. Abilitando la pianificazione dopo l'orario della settimana corrente, la settimana precedente viene pubblicata al ciclo successivo. Un periodo senza ticket gestiti produce il breve messaggio «Nessun ticket gestito in questo periodo» e viene comunque segnato come pubblicato.

L'embed («Classifica moderatori — settimana dal 5 all’11 ottobre 2026» / «— settembre 2026») ha medaglie per i primi tre e una riga per moderatore: menzione, ticket gestiti, ⭐ media (numero di valutazioni), prima risposta. Le menzioni non notificano nessuno (`allowedMentions: { parse: [] }`).

## Thread staff privati

I controlli del ticket hanno una seconda riga con **Thread staff** (`dispatch:staff-thread:<ticketId>`). Il pulsante è riservato allo staff della categoria (ruoli staff, Gestisci server o Gestisci canali; mai l'utente che ha aperto il ticket, anche se ha un ruolo staff) e ai ticket attivi (non chiusi, non in riapertura, canale non eliminato). Al primo click il bot crea un thread **privato** (`staff-NNNN`, non invitabile, archiviazione automatica dopo una settimana di inattività), vi aggiunge chi ha premuto, pubblica una breve introduzione senza menzioni e salva `Ticket.staffThreadId` con un aggiornamento condizionale (due click contemporanei non creano due thread). I click successivi aggiungono il membro dello staff al thread esistente (riattivandolo se archiviato) e rispondono in privato con il link. L'utente e i partecipanti non vengono mai aggiunti. I ticket aperti prima di questa versione non hanno il pulsante nel messaggio iniziale.

Permessi del canale ticket:

- `@everyone`, utente e partecipanti: thread negati come prima (creazione pubblica/privata e invio nei thread).
- Ruoli staff: possono scrivere nei thread (`SendMessagesInThreads`), non crearli.
- Bot: `CreatePrivateThreads`, `SendMessagesInThreads`, `ManageThreads` sul proprio override.

Discord permette al bot di concedere negli override solo i permessi che possiede: per questo il link di installazione richiede ora **Gestisci thread**, **Crea thread privati** e **Invia messaggi nei thread** (bitfield `361045814288`, vedi [DEPLOYMENT.md](DEPLOYMENT.md)). I nuovi canali ricevono i permessi dei thread solo se il ruolo del bot li possiede; per i ticket esistenti gli override di staff e bot vengono aggiornati alla creazione del primo thread. Se i permessi mancano il pulsante risponde «Il bot non ha i permessi per creare thread privati: aggiorna i permessi del suo ruolo» e l'audit registra `ticket.staff_thread.missing_permissions`. Un membro con Gestisci thread a livello di server può comunque vedere i thread privati: non concederlo agli utenti che aprono ticket.

Riservatezza:

- I messaggi del thread non sono attività del ticket né prima risposta dello staff (il tracciamento considera solo il canale ticket) e non entrano nel transcript dell'utente, che legge soltanto il canale principale.
- Alla chiusura (tutti i percorsi) il bot costruisce il transcript HTML del thread (stesso generatore con escaping del transcript ticket) e lo invia **solo** a un canale del server: il canale archivio transcript della categoria, se configurato, altrimenti il canale log ticket (`GuildSettings.ticketLogChannelId`). Mai all'utente, mai in DM, mai salvato nel database. Senza destinazione l'invio viene saltato con l'audit `ticket.staff_thread.transcript_skipped`; ogni invio è registrato come `ticket.staff_thread.transcript` (destinazione, esito, numero di messaggi). Poi il thread viene bloccato e archiviato; la riapertura lo sblocca.
- Prima dell'eliminazione del canale da parte dello staff (che elimina anche i thread) il transcript viene inviato se la chiusura non lo aveva già consegnato. È best effort e non blocca l'eliminazione.
- La dashboard (dettaglio ticket) mostra solo se il thread esiste, con il link Discord; mai il contenuto.

Eventi di log: `TICKET_STAFF_THREAD` (thread creato, transcript inviato).

## SLA ed escalation

Nell’editor delle categorie l’escalation è facoltativa e si attiva con la casella **Escalation automatica** (disattivata per le nuove categorie). Da disattivata vengono salvati `escalationMinutes = null` e `escalationRoleIds = []` (l’API azzera i ruoli anche se un client li invia) e il bot non la esegue. SLA, auto-chiusura, preavviso e finestra di riapertura restano campi numerici: vuoto = disattivato. Gli eventi automatici sono registrabili nel log come `TICKET_AUTOMATION`.

## Retention

Le nuove installazioni non cancellano nulla finche non viene impostata una durata. I valori gia salvati vengono mantenuti durante l'aggiornamento. Sono separati:

- durata dei transcript dei ticket chiusi;
- durata dei ticket chiusi e dei dati collegati;
- cancellazione opzionale del canale Discord.

Il controllo parte quando il bot e pronto e si ripete ogni 6 ore, con elaborazione paginata. La scadenza parte dalla chiusura, mai dall'apertura o dalla rigenerazione del transcript. La finestra di riapertura utente viene sempre rispettata. Ticket aperti o in fase REOPENING non vengono eliminati. Eliminare il ticket comporta anche la cancellazione di transcript, note, partecipanti, feedback e audit collegati; l'audit amministrativo generale e i template non sono cancellati da questa politica.

Un canale già eliminato dallo staff (`channelDeletedAt`) è considerato assente: la retention non tenta di eliminarlo di nuovo ed elimina soltanto il record.

Prima di eliminare un canale viene salvato un indicatore persistente di cancellazione. La riapertura non puo oltrepassarlo. Errori Discord di permessi, rete o disponibilita conservano il record per il tentativo successivo; soltanto Unknown Channel e considerato equivalente a un canale gia assente. Un canale riutilizzato per altri scopi, senza il topic Dispatch atteso, non viene eliminato. Se la cancellazione Discord e disabilitata, il record viene eliminato ma il canale resta: questa opzione NON rimuove i messaggi da Discord.

I transcript scaduti non possono essere rigenerati per aggirare la retention. Le copie esportate, i backup della VPS e i sistemi di conservazione di Discord hanno un ciclo separato: questa funzione non garantisce la loro cancellazione. Gli aggregati analytics basati sui ticket eliminati cambiano di conseguenza.

## Verifica e deploy

Il workflow `Ticket protection tests` usa PostgreSQL temporaneo, migration reali e simulazioni dell'API Discord. Verifica concorrenza, replay, limiti, blacklist, menu privato, retention, errori Discord e privilegi DB. La build di produzione dipende da questi test. I test NON equivalgono a una prova dal vivo con Discord o alla verifica della VPS.

Il metodo di deploy resta quello di Sentinel: immagini costruite su GitHub, GHCR, digest immutabili e deploy SSH ristretto. Al primo setup usare la versione aggiornata di `deploy/runtime/harden-users.sh`; il bot deve poter usare TicketOpenAttempt, TicketUserGuard e TicketFeedback, ma non leggere PanelSession, TicketNote o _prisma_migrations. Valutazioni attribuite, classifica e thread staff aggiungono solo colonne a tabelle esistenti (`GuildSettings`, `Ticket`, `TicketFeedback`): i grant non cambiano.
