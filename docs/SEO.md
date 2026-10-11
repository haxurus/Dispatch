# SEO e visibilità internazionale

Il sito pubblico è pensato per un pubblico internazionale: l'inglese è la lingua
predefinita (`x-default`), l'italiano è un mirror completo.

## Cosa fa il codice

| Elemento | Dove | Note |
| --- | --- | --- |
| Redirect `/` per lingua | `apps/web/middleware.ts` | 307 lato server in base ad `Accept-Language`, inglese di default (i crawler non mandano la lingua → `/en`). |
| `<html lang>` corretto | `apps/web/app/layout.tsx` | `en` su `/en/**`, `it` altrove. |
| Title, description, keywords | `apps/web/app/i18n.ts` (`homeCopy.*.meta`) | Puntano su "Discord ticket bot", "ticket system", "forms", "transcripts". |
| Canonical + hreflang | `apps/web/app/site.ts` (`publicPageMetadata`) | `en`, `it`, `x-default` su ogni pagina pubblica. |
| Open Graph / Twitter | `apps/web/app/{en,it}/opengraph-image.tsx` | Anteprima 1200×630 localizzata, usata anche dagli embed di Discord. |
| Dati strutturati | `PublicHome.tsx` | JSON-LD `WebApplication` + `FAQPage`. |
| FAQ visibile | `PublicHome.tsx`, `i18n.ts` | Risponde alle ricerche tipiche ("how do I add a ticket system to my Discord server"). |
| `robots.txt`, `sitemap.xml` | `apps/web/app/robots.ts`, `sitemap.ts` | Dashboard, super console e `/backend/` esclusi. |
| Favicon, apple icon, manifest | `apps/web/app/icon.svg`, `apple-icon.tsx`, `manifest.ts` | |
| Stato personalizzato del bot | `apps/bot/src/config.ts` | `BOT_STATUS_TEXT` (default `Discord tickets · dispatch.haxurus.com`, vuoto = disattivato). |

Per un dominio diverso impostare `SITE_URL` (anche in build, perché sitemap e
immagini sono generate staticamente).

## Da fare a mano (una volta)

1. **Google Search Console**: aggiungi la proprietà *Dominio* `dispatch.haxurus.com`,
   verifica con il record TXT su Cloudflare, poi invia `https://dispatch.haxurus.com/sitemap.xml`.
2. **Bing Webmaster Tools**: importa la proprietà da Search Console (copre anche
   DuckDuckGo, Yahoo ed Ecosia) e invia la stessa sitemap.
3. **Verifica anteprime**: incolla `https://dispatch.haxurus.com/en` in un canale
   Discord e nel [Rich Results Test](https://search.google.com/test/rich-results).
4. **Discord Developer Portal → General Information**: imposta descrizione, tag
   e *Terms of Service / Privacy Policy URL* (requisito per l'App Directory).
5. **Directory dei bot**: la maggior parte degli utenti cerca i bot lì, non su
   Google. Registrare il bot (servono account personali) su:
   - Discord App Directory (richiede bot verificato, oltre 75 server),
   - top.gg,
   - discordbotlist.com,
   - discord.bots.gg,
   - discords.com.

   Usa i testi qui sotto e come sito `https://dispatch.haxurus.com/en`.
   Finché l'istanza pubblica accetta solo server autorizzati (pagina
   "in sviluppo"), rimanda le directory: un bot non installabile viene rimosso
   o recensito male.

## Testi per le directory

**Nome:** Dispatch

**Descrizione breve (≤ 140 caratteri):**
> Discord ticket bot with panels, forms, claims, SLAs, encrypted transcripts, staff ratings and a full web dashboard.

**Tag:** `tickets`, `support`, `moderation`, `forms`, `utility`

**Descrizione lunga:**
> **Dispatch is a Discord ticket bot built for support teams.**
>
> - **Ticket panels and menus**: buttons or a select menu, one category per topic, each with its own staff roles, limits and closed-ticket category.
> - **Forms and staff applications**: validated questions, DM or ephemeral delivery, role restrictions, and answers that can open a ticket.
> - **Claims, priorities and private staff threads**: every moderator of the category is added to a private thread automatically.
> - **SLAs and escalation**: first-response and resolution targets, inactivity warnings and auto-close.
> - **Transcripts**: HTML transcripts on close, encrypted at rest, with configurable retention.
> - **Ratings and leaderboards**: members rate the moderator who handled their ticket; weekly or monthly leaderboards.
> - **Ticket logs, analytics and a web dashboard** with Viewer, Moderator, Admin and Owner access levels.
>
> No Administrator permission required. Set everything up at https://dispatch.haxurus.com

## Limite noto

Il bot su Discord risponde ancora solo in italiano. Per un pubblico
internazionale il passo successivo è localizzare i messaggi del bot (lingua per
server dalla dashboard, oppure `interaction.locale`).
