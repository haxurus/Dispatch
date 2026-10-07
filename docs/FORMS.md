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
- eventuali ruoli staff alternativi.

Il ticket creato:

- viene registrato nel database Dispatch;
- utilizza il contatore ticket del server;
- aggiunge il compilatore come opener;
- concede accesso ai ruoli staff configurati;
- contiene il report del form;
- dispone dei normali controlli Claim, Unclaim, stato e chiusura;
- compare nella dashboard e negli audit.

## Permessi

Oltre ai livelli generali della dashboard, ogni form supporta binding per ruolo Discord:

- **Manage**: modifica configurazione, pannelli e permessi;
- **View**: accesso delegabile alle informazioni del form;
- **Review**: visualizzazione degli invii;
- **Submit**: autorizzazione esplicita alla compilazione.

Owner e Admin mantengono accesso amministrativo. La creazione di nuovi form rimane riservata a Owner/Admin; la gestione di form esistenti può essere delegata.

## Pannelli

I form vengono pubblicati tramite pannelli Discord con pulsante configurabile. La ripubblicazione aggiorna il messaggio esistente quando possibile e crea un nuovo messaggio solo se quello precedente non esiste più.
