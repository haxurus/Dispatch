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

## Retention

Le nuove installazioni non cancellano nulla finche non viene impostata una durata. I valori gia salvati vengono mantenuti durante l'aggiornamento. Sono separati:

- durata dei transcript dei ticket chiusi;
- durata dei ticket chiusi e dei dati collegati;
- cancellazione opzionale del canale Discord.

Il controllo parte quando il bot e pronto e si ripete ogni 6 ore, con elaborazione paginata. La scadenza parte dalla chiusura, mai dall'apertura o dalla rigenerazione del transcript. La finestra di riapertura utente viene sempre rispettata. Ticket aperti o in fase REOPENING non vengono eliminati. Eliminare il ticket comporta anche la cancellazione di transcript, note, partecipanti, feedback e audit collegati; l'audit amministrativo generale e i template non sono cancellati da questa politica.

Prima di eliminare un canale viene salvato un indicatore persistente di cancellazione. La riapertura non puo oltrepassarlo. Errori Discord di permessi, rete o disponibilita conservano il record per il tentativo successivo; soltanto Unknown Channel e considerato equivalente a un canale gia assente. Un canale riutilizzato per altri scopi, senza il topic Dispatch atteso, non viene eliminato. Se la cancellazione Discord e disabilitata, il record viene eliminato ma il canale resta: questa opzione NON rimuove i messaggi da Discord.

I transcript scaduti non possono essere rigenerati per aggirare la retention. Le copie esportate, i backup della VPS e i sistemi di conservazione di Discord hanno un ciclo separato: questa funzione non garantisce la loro cancellazione. Gli aggregati analytics basati sui ticket eliminati cambiano di conseguenza.

## Verifica e deploy

Il workflow `Ticket protection tests` usa PostgreSQL temporaneo, migration reali e simulazioni dell'API Discord. Verifica concorrenza, replay, limiti, blacklist, menu privato, retention, errori Discord e privilegi DB. La build di produzione dipende da questi test. I test NON equivalgono a una prova dal vivo con Discord o alla verifica della VPS.

Il metodo di deploy resta quello di Sentinel: immagini costruite su GitHub, GHCR, digest immutabili e deploy SSH ristretto. Al primo setup usare la versione aggiornata di `deploy/runtime/harden-users.sh`; il bot deve poter usare TicketOpenAttempt, TicketUserGuard e TicketFeedback, ma non leggere PanelSession, TicketNote o _prisma_migrations.
