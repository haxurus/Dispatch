# Panels

The **Pannelli** (*Panels*) section of the dashboard (`/dashboard/<guildId>/panels`) manages the Discord messages from which users open a ticket or fill in a form. It is reserved to Owner/Admin: the API (`/api/guilds/:guildId/panels…` and `/api/guilds/:guildId/form-panels…`, reads included) also answers `403` to the other levels.

The dashboard is in Italian: labels are quoted as they appear, followed by an English gloss.

The list shows every panel (Ticket/Form type, name, channel, number of items, active/inactive, published or not) with the actions **Modifica** (*Edit*), **Pubblica / Aggiorna su Discord** (*Publish / Update on Discord*) and **Elimina** (*Delete*, with confirmation; a message already published is not deleted from Discord and stops responding). The ticket **main menu** appears read-only and is always configured in **Sistema e menu** (*System and menu*).

## Creating and editing

**Nuovo pannello** (*New panel*) asks for the type (Ticket or Form) and opens the editor with a live Discord-style preview.

Common fields:

| Field | Limit |
| --- | --- |
| Internal name | 80 characters (optional for forms) |
| Channel | text or announcement channel of the server |
| Embed title | 256 |
| Embed description | 4000 |
| Colour | `#rrggbb`, stored as an integer `0..0xFFFFFF` |
| Image / thumbnail | `https://` only, 2048 characters |
| Footer | 2048, default `Dispatch` |
| Total title + description + footer | 6000 (Discord embed limit) |

Interaction style:

- **Select menu** (`SELECT`): a single menu with a configurable placeholder (150 characters).
- **Buttons** (`BUTTONS`): one button per item, 5 per row, at most 25.

Items (enabled ticket categories or forms of the server, ordered, at most 25) with per-panel customisation: label (80 characters for buttons, 100 for the menu), emoji (unicode or `<:name:id>` / `<a:name:id>`; an invalid value is discarded), description (menu only, 100 characters), button style (Primary, Secondary, Success, Danger).

Changes are applied to the message with **Aggiorna su Discord**. Publishing edits the existing message and sends a new one only if Discord answers *Unknown Message*; permission or network errors do not create duplicates. Changing the channel clears the reference to the old message.

## Data model

Migration `20261010120000_panel_customization`:

- `TicketPanel`: `style` (`SELECT` by default, `CHECK` constraint), `placeholder`, `color`, `imageUrl`, `thumbnailUrl`, `footerText`, `items` (JSONB, default `[]`). `categoryIds` stays the ordered list of included items.
- `FormPanel`: the same columns (`style` default `BUTTONS`), `name` and `formIds TEXT[]`, filled with `ARRAY["formId"]` for existing panels. `formId` stays the FK of the main form (`formIds[0]`) with its cascade.
- `items` is an array `[{ id, label, emoji, description, buttonStyle }]` indexed by category or form id.

The defaults reproduce the previous look: panels already published keep working without republishing.

When a ticket category or a form is deleted, the API removes it from the other panels (customisations included) and disables the panels left without items. A form panel whose main form is deleted moves to the next form; if none is left, it is deleted by the FK cascade.

## Discord interactions

| customId | Use |
| --- | --- |
| `dispatch:open:<panelId>` | ticket panel menu (value = category id) |
| `dispatch:panel-btn:<panelId>:<categoryId>` | ticket panel button |
| `dispatch:form:start:<panelId>:<formId>` | form panel button |
| `dispatch:form:pick:<panelId>` | form panel menu (value = form id) |
| `dispatch:form:start:<panelId>` | messages published before multi-form panels: opens the panel's first form |

Every id stays below 100 characters. Ticket panel buttons and menus follow the same opening flow: ingress limiter, reservation with source key `p_<panelId>`, check that the message is the panel's current one and that the category is still included and enabled. For forms the bot checks that the form is still included in the panel and belongs to the server.

Publication error codes (`reason` field of the `502` response): `PANEL_NOT_FOUND`, `PANEL_HAS_NO_CATEGORIES`, `PANEL_TOO_MANY_CATEGORIES`, `PANEL_CHANNEL_INVALID`, `FORM_PANEL_NOT_FOUND`, `PANEL_HAS_NO_ITEMS`, `FORM_PANEL_CHANNEL_INVALID`, `GUILD_NOT_FOUND`.

## Channel and role pickers

Throughout the dashboard, channels, roles and categories are chosen with a searchable picker (`ResourcePicker`): search by name or ID ignoring case and accents, keyboard navigation (arrows, Enter, Esc, Backspace to remove the last item), selected items as removable chips. Channels show their parent category; roles show their colour and never `@everyone`.
