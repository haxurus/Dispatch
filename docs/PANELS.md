# Pannelli

La sezione **Pannelli** della dashboard (`/dashboard/<guildId>/panels`) gestisce i messaggi Discord da cui gli utenti aprono un ticket o compilano un form. È riservata a Owner/Admin: anche le API (`/api/guilds/:guildId/panels…` e `/api/guilds/:guildId/form-panels…`, lettura inclusa) rispondono `403` agli altri livelli.

L'elenco mostra tutti i pannelli (tipo Ticket/Form, nome, canale, numero di elementi, attivo/disattivo, pubblicato o no) con le azioni **Modifica**, **Pubblica / Aggiorna su Discord** ed **Elimina** (con conferma; il messaggio già pubblicato non viene cancellato da Discord e smette di rispondere). Il **menu principale** dei ticket compare in sola lettura e si configura sempre in *Sistema e menu*.

## Creazione e modifica

**Nuovo pannello** chiede il tipo (Ticket o Form) e apre l'editor con anteprima live in stile Discord.

Campi comuni:

| Campo | Limite |
| --- | --- |
| Nome interno | 80 caratteri (facoltativo per i form) |
| Canale | testuale o annunci del server |
| Titolo embed | 256 |
| Descrizione embed | 4000 |
| Colore | `#rrggbb`, salvato come intero `0..0xFFFFFF` |
| Immagine / miniatura | solo `https://`, 2048 caratteri |
| Footer | 2048, predefinito `Dispatch` |
| Totale titolo + descrizione + footer | 6000 (limite Discord degli embed) |

Stile di interazione:

- **Menu a tendina** (`SELECT`): un solo menu con segnaposto configurabile (150 caratteri).
- **Pulsanti** (`BUTTONS`): un pulsante per elemento, 5 per riga, massimo 25.

Elementi (categorie ticket abilitate oppure form del server, ordinati, massimo 25) con personalizzazioni per singolo pannello: etichetta (80 caratteri per i pulsanti, 100 per il menu), emoji (unicode oppure `<:nome:id>` / `<a:nome:id>`; un valore non valido viene scartato), descrizione (solo menu, 100 caratteri), stile del pulsante (Primario, Secondario, Successo, Pericolo).

Le modifiche vengono applicate al messaggio con **Aggiorna su Discord**. La pubblicazione modifica il messaggio esistente e ne invia uno nuovo solo se Discord risponde *Unknown Message*; errori di permessi o di rete non generano duplicati. Cambiando canale il riferimento al vecchio messaggio viene azzerato.

## Modello dati

Migrazione `20261010120000_panel_customization`:

- `TicketPanel`: `style` (`SELECT` predefinito, vincolo `CHECK`), `placeholder`, `color`, `imageUrl`, `thumbnailUrl`, `footerText`, `items` (JSONB, predefinito `[]`). `categoryIds` resta la lista ordinata degli elementi inclusi.
- `FormPanel`: stesse colonne (`style` predefinito `BUTTONS`), `name` e `formIds TEXT[]`, popolato con `ARRAY["formId"]` per i pannelli esistenti. `formId` resta la FK del form principale (`formIds[0]`) e la sua cascata.
- `items` è un array `[{ id, label, emoji, description, buttonStyle }]` indicizzato per id di categoria o di form.

I valori predefiniti riproducono l'aspetto precedente: i pannelli già pubblicati continuano a funzionare senza ripubblicazione.

Eliminando una categoria ticket o un form, l'API lo rimuove dagli altri pannelli (anche dalle personalizzazioni) e disattiva i pannelli rimasti senza elementi. Un pannello form il cui form principale viene eliminato passa al form successivo; se non ne restano viene eliminato dalla cascata della FK.

## Interazioni Discord

| customId | Uso |
| --- | --- |
| `dispatch:open:<panelId>` | menu del pannello ticket (valore = id categoria) |
| `dispatch:panel-btn:<panelId>:<categoryId>` | pulsante del pannello ticket |
| `dispatch:form:start:<panelId>:<formId>` | pulsante del pannello form |
| `dispatch:form:pick:<panelId>` | menu del pannello form (valore = id form) |
| `dispatch:form:start:<panelId>` | messaggi pubblicati prima dei pannelli multi-form: apre il primo form del pannello |

Tutti gli id restano sotto i 100 caratteri. Pulsanti e menu dei pannelli ticket seguono lo stesso flusso di apertura: limitatore di ingresso, prenotazione con chiave sorgente `p_<panelId>`, verifica che il messaggio sia quello attuale del pannello e che la categoria sia ancora inclusa e abilitata. Per i form il bot verifica che il form sia ancora incluso nel pannello e appartenga al server.

Codici di errore di pubblicazione (campo `reason` della risposta `502`): `PANEL_NOT_FOUND`, `PANEL_HAS_NO_CATEGORIES`, `PANEL_TOO_MANY_CATEGORIES`, `PANEL_CHANNEL_INVALID`, `FORM_PANEL_NOT_FOUND`, `PANEL_HAS_NO_ITEMS`, `FORM_PANEL_CHANNEL_INVALID`, `GUILD_NOT_FOUND`.

## Selettori di canali e ruoli

In tutta la dashboard canali, ruoli e categorie si scelgono con un selettore ricercabile (`ResourcePicker`): ricerca per nome o ID senza distinzione di maiuscole e accenti, navigazione da tastiera (frecce, Invio, Esc, Backspace per togliere l'ultimo elemento), elementi selezionati come chip rimovibili. I canali mostrano la categoria padre; i ruoli il colore e mai `@everyone`.
