# Forms and questionnaires

Dispatch supports two separate but integrated flows:

- opening questions of tickets;
- generic forms, for example applications, reports or data collection.

The dashboard is in Italian: labels are quoted as they appear, followed by an English gloss.

## Ticket opening questions

Each ticket category can configure up to 5 questions. Available types:

- short answer;
- long answer;
- single-choice menu.

The answers are completed before the ticket is created, stored encrypted in the ticket record and posted automatically in the initial message. Intermediate selections are persisted in the opening reservation, so restarts, double clicks and replays do not create duplicate tickets.

## Forms

A form can contain up to 25 questions:

- short or long text;
- integer or decimal number;
- email;
- URL;
- date;
- yes/no;
- single choice;
- multiple choice;
- Discord ID.

Each answer is validated according to its type. Sessions expire, are persistent, and partial answers are encrypted.

Configuration constraints checked by the API:

- length limits only for short/long text, email and URL; numeric limits only for integer/decimal;
- `minSelections`/`maxSelections` only for multiple choice, with `minSelections <= maxSelections <= number of options`; a required multiple choice cannot have `minSelections = 0`;
- unique option values.

When filling in, multiple choice uses the same limits as the Discord menu: maximum `min(maxSelections ?? options, options)`, minimum `min(minSelections ?? (required ? 1 : 0), maximum)`. An optional question can be skipped (empty string or no selection).

Opening and closing times are entered in the dashboard in the browser's local time and stored in UTC.

### Filling-in modes

- **In chat**: the flow uses ephemeral replies, visible only to the user who started it.
- **DM**: the flow continues in the bot's direct messages.

## Opening, closing and limits

For each form you can set:

- manual enabling;
- opening date/time;
- closing date/time;
- maximum number of submissions per user;
- cooldown between submissions;
- anti-spam window;
- maximum number of attempts in the window;
- allowed roles;
- excluded roles.

An active session prevents the same user from starting the same form in parallel. Expired or already consumed sessions cannot be reused.

## Results

You can choose a Discord channel to receive the report and the roles to notify. The report contains:

- user and Discord ID;
- timestamp;
- submission ID;
- every question and answer.

Stored answers are encrypted with the same key used for Dispatch's other private data.

## Automatic ticket after a form

A form can automatically create a real Dispatch ticket after the submission.

Configured with:

- Dispatch ticket category;
- optional alternative Discord category;
- optional Discord category for closed tickets (overriding the ticket category's);
- optional alternative staff roles.

The created ticket:

- is recorded in the Dispatch database;
- uses the server's ticket counter;
- adds the submitter as opener;
- grants access to the configured staff roles;
- contains the form report;
- has the usual Claim, Unclaim, status and close controls;
- appears in the dashboard and in the audits;
- remembers its source form (`Ticket.sourceFormId`): on close it is moved to the form's **Categoria Discord per i ticket chiusi (override)** (*closed-ticket Discord category, override*, `ticketClosedParentCategoryId`), if set, otherwise to the ticket category's. See [TICKET_PROTECTIONS.md](TICKET_PROTECTIONS.md#closed-tickets-dedicated-category-reopening-and-channel-deletion).

Each submission generates the log event `FORM_SUBMISSION` (form name, user, submission ID and any ticket, never the answers) when the ticket log channel is configured.

## Permissions

Besides the general dashboard levels, each form supports Discord role bindings (evaluated on the member's **current** roles, read from Discord on every request):

- **Manage**: editing questions, texts, schedule (opening/closing), anti-spam limits and allowed/excluded roles;
- **View**: the form appears in the user's dashboard;
- **Review**: viewing submissions;
- **Submit**: explicit permission to fill in the form.

Manage and Review imply View. A non-Admin user sees **only** the forms for which at least one of their roles has View, Manage or Review; submissions require Review.

Reserved to Owner/Admin:

- creating and deleting forms;
- changing bindings (`PUT`/`DELETE /api/guilds/:guildId/forms/:formId/permissions/:roleId`): a delegated manager cannot grant themselves other permissions;
- results channel, roles to notify, automatic ticket (`createTicketOnSubmit`, `ticketCategoryId`, `ticketParentCategoryId`, `ticketClosedParentCategoryId`, `ticketStaffRoleIds`). A `PUT` by a delegated manager that changes one of these fields receives `403 FORM_FIELD_ADMIN_ONLY`;
- all panel management (list, creation, editing, publication and deletion): see [PANELS.md](PANELS.md);
- deleting a single submission (`DELETE /api/guilds/:guildId/forms/:formId/submissions/:submissionId`, recorded in the dashboard audit as `form.submission.delete`).

A form with submissions cannot be deleted (`409 FORM_IN_USE`, also in case of a concurrent submission). A ticket category used by a form for the automatic ticket cannot be deleted (`409 CATEGORY_IN_USE_BY_FORM`): update the form or disable the category.

If a submission cannot be decrypted, the list returns it with `unreadable: true` and empty answers instead of failing entirely.

## Panels

Forms are published through Discord panels managed in the **Pannelli** (*Panels*) section of the dashboard ([PANELS.md](PANELS.md)). A panel can offer one or more forms (up to 25, ordered) with buttons or a select menu, a custom embed and emoji. Panels created before this feature keep showing a single button with their text. When a form is deleted, it is removed from the other panels; a panel left without forms is disabled or, if the form was its main one, deleted.

Republishing updates the existing message when possible and creates a new message only if the previous one no longer exists.

## Ticket transcripts

Each ticket category has the option **Conserva una copia cifrata lato Dispatch** (*keep an encrypted copy on the Dispatch side*, `transcriptRetain`, on by default):

- on: the encrypted copy stays in the database until retention or ticket deletion and can be downloaded several times;
- off: the transcript generated from the dashboard is one-shot and the automatic transcript is not saved.

The dashboard download uses `POST /api/guilds/:guildId/tickets/:ticketId/transcript/download`. For a one-shot copy the deletion is atomic (only one concurrent request gets the content, the others receive `404 TRANSCRIPT_NOT_FOUND`), it is recorded as `ticket.transcript.consume` and the response carries `X-Transcript-Consumed: 1`. `GET`/`HEAD /api/guilds/:guildId/tickets/:ticketId/transcript` never modify data and, for a one-shot copy, answer `409 TRANSCRIPT_ONE_SHOT`.

Migration `20261008100100_forms_api_fixes` renames the old column `transcriptStoreTemporary` (which had the inverted meaning) to `transcriptRetain` and sets `true` for categories without automatic generation, so existing transcripts are no longer deleted at the first download. Categories with automatic generation keep the explicit choice made before.
