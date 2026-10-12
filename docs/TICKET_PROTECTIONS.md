# Ticket protections: main menu, anti-spam and retention

The dashboard is available in English and Italian; labels are quoted in Italian followed by their English equivalent. Texts posted by the bot follow the server's bot language (English or Italian); they are quoted here in English.

## Configuration

Open the server dashboard, then **Sistema e menu** (*System and menu*, `/dashboard/<guildId>/tickets/system`). The page requires Admin/Owner.

1. Create the request categories in **Configurazione ticket** (*Ticket configuration*), with the Discord category, staff roles and any opening questions.
2. In **Sistema e menu**, enable the main menu, choose the channel, fill in title, description and button text, select the available requests and publish.
3. The public message shows **Open a ticket**. The button opens a private selector visible only to the user; the choice opens the request's form, when there is one, and finally its private ticket channel. Up to 25 requests per menu are allowed. Disabled categories cannot be selected. Old messages no longer associated with the configuration are rejected.

Publishing updates the existing message. A new message is created only when none exists or Discord explicitly returns Unknown Message: permission or network errors never cause a duplicate publication. If the channel is changed, the old message stays inactive and can be removed by hand.

### Ticket panels

Ticket panels are managed in the **Pannelli** (*Panels*) section ([PANELS.md](PANELS.md)), with a select menu or buttons. Both follow the same protected path described below: ingress limiter, reservation with key `p_<panelId>`, check that the message is the panel's current one and that the category is still included in the panel and enabled. Panel publication also uses the Unknown Message rule to avoid duplicates.

## Anti-spam and cooldowns

Configurable: global cooldown, per-category cooldown, number of attempts and length of the global/per-category time window, base duration of the temporary block. Initial values: 30 seconds global, 60 seconds per category, 5 global attempts per 10 minutes, 3 per category per 10 minutes, base block 15 minutes.

Repeated blocks grow with multiplier 1, 2, 4, 8; the absolute maximum is 7 days. Infractions decay after 24 hours without new infractions. An additional technical limit of 5 opening interactions every 5 seconds protects the database and does not apply to staff commands.

Every opening has a random single-use reservation, persisted in PostgreSQL and bound to server, user, category, source and form version. A transaction serialises concurrent requests; duplicate submissions, expired/changed forms and nonces belonging to other users are rejected. The open-ticket limits and the exclusion of simultaneous openings stay active even when cooldowns are disabled. The blacklist is checked again before the actual creation.

An abandoned form expires after 10 minutes. A Discord mutation with an uncertain outcome is NOT released automatically: the CREATING state stays persisted to avoid duplicate channels. The operator must check for any channels created before correcting the reservation. Do not blindly delete TicketUserGuard rows. An error in the private reply to the user does not delete a ticket that has already been saved.

## Transcripts

Automatic generation is configurable per ticket category and is disabled by default.

On close, it is possible to choose, also at the same time, to:

- send the HTML transcript by DM to the user who opened the ticket;
- send it as a file to a dedicated Discord channel;
- keep an encrypted copy in the Dispatch database.

If the Dispatch-side copy is not enabled, the automatic transcript is built exclusively in memory, sent to the configured destinations and then discarded. It is never written to the filesystem.

Manual generation from the dashboard saves an encrypted copy to allow the download. If the category does not keep a Dispatch-side copy (`transcriptRetain` off; on by default), the copy is one-shot: the download uses `POST .../transcript/download`, which deletes it atomically; `GET`/`HEAD` never delete anything. In every case the `Transcript -> Ticket` relation uses cascade deletion: deleting the ticket also deletes any transcript copy still present.

Delivery by DM or to the archive channel does not block the close if Discord returns an error; the outcome is recorded in the audit. A reopening followed by a new close generates an updated transcript.

## Closed tickets: dedicated category, reopening and channel deletion

### Discord category for closed tickets

Each ticket category can set a **Discord category for closed tickets** (`TicketCategory.closedParentCategoryId`, optional). A form with an automatic ticket can override it with its own **closed-ticket Discord category (override)** (`FormDefinition.ticketClosedParentCategoryId`): the bot links the ticket to the form that created it (`Ticket.sourceFormId`, FK `ON DELETE SET NULL`). The API accepts only Discord categories (type 4) of the server.

On close (Discord form, dashboard or automatic close), after the conditional status update and the permission lock, the channel is moved to the destination category (the form's override, otherwise the ticket category's) with `lockPermissions: false`: the channel keeps its own permissions (opener, participants, staff, `@everyone` denied and threads denied) and does not inherit the category's. The previous parent is saved in `Ticket.openParentId`. If Discord rejects the move (category full: 50 channels, missing permissions, non-existent category) the channel stays where it is, the audit records `ticket.close.move_failed` with the error code and the close proceeds normally. The channel is renamed `closed-XXXX` as before.

On reopening, after the permissions are restored, the channel goes back to `openParentId` or, if missing, to the ticket category's Discord category; `openParentId` is cleared. An error is recorded as `ticket.reopen.move_failed` and does not block the reopening.

### Buttons of the closing message

Besides the feedback stars when enabled, the closing message contains:

- **Reopen ticket** (`dispatch:reopen:<ticketId>`): the category's staff (staff roles, Manage Server or Manage Channels) can always reopen; the user who opened the ticket only within the reopen window, as before. Same protected path as the dashboard (reservation, ticket lock, `REOPENING` state).
- **Delete channel** (`dispatch:delete-channel:<ticketId>`): staff only. The first click shows a private confirmation with **Confirm deletion** (`dispatch:delete-confirm:<ticketId>:<base36 expiry>`, valid for 2 minutes); on confirmation, staff and status are checked again.

### Channel deletion

Deletion is available from Discord (button above) and from the dashboard (ticket detail, **Elimina canale** — *Delete channel* — with confirmation, Moderator level or higher like the other ticket actions; `POST /api/guilds/:guildId/tickets/:ticketId/delete-channel`, bot RPC action `delete-channel`). Only for `CLOSED` tickets without a retention marker.

1. The channel is verified as for retention (same server, text channel, topic `Dispatch ticket #N - `): a reused channel is not deleted.
2. The transcript is secured according to the category settings before deleting: if automatic generation is on and the closing delivery is missing (or did not reach the configured archive channel), it is repeated; if the category keeps an encrypted copy and none exists, it is saved. If this is not possible, the deletion is refused (`TICKET_TRANSCRIPT_FAILED`). A transcript already expired by retention does not block the deletion.
3. Under the ticket lock, a conditional update (`status = CLOSED`, no retention marker, channel not yet deleted) sets `Ticket.channelDeletedAt` and records `ticket.channel.delete`.
4. The Discord channel is deleted. Unknown Channel counts as an already missing channel; any other error restores the marker, records `ticket.channel.delete_failed` and returns `TICKET_CHANNEL_DELETE_FAILED`.

The ticket record stays for history and analytics until retention. Reopening is refused with `TICKET_CHANNEL_DELETED` and the dashboard shows the *Canale eliminato* (*Channel deleted*) state without the reopen buttons.

## Ticket logs

In **Sistema e menu**, the **Log ticket** (*Ticket log*) card selects a text or announcement channel of the server (`GuildSettings.ticketLogChannelId`) and the events to record (`GuildSettings.ticketLogEvents`, keys defined once in `@dispatch/shared`):

| Event | Content |
| --- | --- |
| `TICKET_OPEN` | opened from menu, panel or form |
| `TICKET_CLAIM` | claim, release, assignment |
| `TICKET_UPDATE` | status, priority, category transfer |
| `TICKET_MEMBERS` | member added or removed |
| `TICKET_CLOSE` | close (only whether a reason was given, never the text) |
| `TICKET_REOPEN` | reopening |
| `TICKET_DELETE` | channel deleted by staff or by retention |
| `TICKET_TRANSCRIPT` | manual generation and automatic delivery |
| `TICKET_FEEDBACK` | 1-5 rating and rated moderator, never the comment |
| `TICKET_STAFF_THREAD` | staff thread created, thread transcript sent (never the content) |
| `TICKET_AUTOMATION` | SLA breaches, escalation, inactivity warning and close |
| `FORM_SUBMISSION` | form name, user, submission ID, linked ticket; never the answers |
| `BLACKLIST` | added or removed from the dashboard |

Each event is a compact embed (title, ticket and channel, author with ID, category, specific data, date) sent with `allowedMentions: { parse: [] }`. Encrypted fields (close reason, form answers, notes, feedback comment) are never posted. Delivery is best effort: Discord or configuration errors are recorded in the bot log with the error code only and never interrupt the ticket action. Settings are read with a 30-second cache; **Invia messaggio di prova** (*Send test message*, `POST /api/guilds/:guildId/ticket-log/test`, Admin) saves, reloads the configuration and returns stable codes (`TICKET_LOG_CHANNEL_REQUIRED`, `TICKET_LOG_CHANNEL_INVALID`, `TICKET_LOG_SEND_FAILED`).

`BLACKLIST` events originate in the API: after the change, the API sends the bot (`POST /guilds/:guildId/ticket-log/event`) only a structured payload `{ event: 'BLACKLIST', action: 'add' | 'remove', targetUserId, actorId, expiresAt? }`. The bot rejects any other key or free text (`INVALID_TICKET_LOG_EVENT`): the blacklist reason is never sent.

## Ratings attributed to the moderator

Migration `20261012100000_ratings_leaderboard_threads`. Previously analytics attributed feedback and closes to the *current* `claimedById`, which is cleared by unclaim and reopening. Now the attribution is fixed when it happens:

- **Close** (Discord form, dashboard, automatic close): `Ticket.closedById` = whoever closed, only if they have staff access to the category (staff roles, Manage Server or Manage Channels; checked by the bot on the Discord member, also for closes from the dashboard). Never the user who opened the ticket (even with a staff role) nor the bot (inactivity close). `Ticket.handledById` = claimer at the time of the close, otherwise `closedById`, otherwise `NULL`. Reopening clears both; the next close recalculates them.
- **Feedback**: `TicketFeedback.staffUserId` = claimer of the closed ticket, otherwise `closedById`, otherwise `NULL` (not attributed). The value stays even if the claim later changes.
- The closing message names the moderator ("Rate the help you received from @moderator", a mention **without** notification: `allowedMentions: { parse: [] }`), or the generic text if the ticket is not attributed.
- Analytics (`GET /api/guilds/:guildId/analytics`): in the staff table, `closures` counts the tickets with `handledById` = moderator and `averageRating`/`feedbackCount` use `staffUserId`. The other fields are unchanged.
- Backfill: existing feedback is attributed to the ticket's current claimer (what analytics showed so far) and already closed tickets get `handledById` = claimer. Non-snowflake values stay `NULL`; snowflake `CHECK` constraints on the new columns.

## Moderator leaderboard

On the **Analytics** page, the **Classifica moderatori** (*Moderator leaderboard*) section shows (Moderator level or higher, like analytics) the leaderboard of the current or previous week or month. For a period `[start, end)` and per moderator:

- **tickets handled**: tickets closed in the period with `handledById` = moderator;
- **average rating** and number of ratings: feedback created in the period with `staffUserId` = moderator; the average counts only with at least `leaderboardMinRatings` ratings (0..50, default 3), otherwise it is shown as "—";
- **first response**: median time of the tickets in which the moderator was the first to answer (audit `ticket.first_staff_response` in the period);
- **claims**: claims and assignments in the period.

Order: tickets handled, then average rating (whoever does not reach the minimum ranks below those who do), then number of ratings, then ID; on a complete tie the position is shared (1, 1, 3). Ranking and periods are pure functions in `@dispatch/shared` (`rankLeaderboard`, `leaderboardPeriod`, `dueLeaderboardPeriods`): ISO 8601 weeks (key `2026-W41`; a week belongs to the year of its Thursday, so 28/12/2026-03/01/2027 is `2026-W53`) and calendar months (key `2026-09`), with local midnight in the server's time zone (`GuildSettings.timezone`, default `Europe/Rome`, `Intl` API, no dependency): the week of a DST change lasts 7 days ± 1 hour.

### Automatic posting

**Pubblicazione della classifica** (*Leaderboard posting*) card (Admin/Owner): text or announcement channel (`leaderboardChannelId`), weekly and/or monthly leaderboard, weekday (`leaderboardWeekday`, 1 = Monday) and hour (`leaderboardHour`, 0..23) in the server's time zone, number of moderators (`leaderboardSize`, 3..25) and minimum ratings. API: `GET/PUT /api/guilds/:guildId/leaderboard/settings` (Admin; `LEADERBOARD_CHANNEL_NOT_FOUND` if the channel is not a text or announcement channel of the server), preview `GET /api/guilds/:guildId/leaderboard?period=week|month&offset=0` (Moderator), **Invia ora** (*Send now*) `POST /api/guilds/:guildId/leaderboard/send` `{ period, offset }` (Admin; bot RPC `POST /guilds/:guildId/leaderboard/send`, codes `LEADERBOARD_CHANNEL_REQUIRED`, `LEADERBOARD_CHANNEL_INVALID`, `LEADERBOARD_SEND_FAILED`). "Send now" posts the period shown in the preview and does not change the schedule.

The bot checks every 15 minutes (and at startup; cycles never overlap, errors are isolated per server). When the local time has passed (weekday, hour) of the current week it posts the previous week; when it has passed (day 1, hour) of the current month, the previous month. Before posting, the period key (`leaderboardLastWeekly` / `leaderboardLastMonthly`) is claimed with a conditional update on the previous value: restarts and two bot processes never post the same period twice; if Discord rejects the message the key is restored and the next cycle retries. A bot that is offline at the scheduled time posts the same period late. Enabling the schedule after the current week's slot posts the previous week at the next cycle. A period without handled tickets produces the short message "No tickets handled in this period." and is still marked as posted.

The embed ("Moderator leaderboard — week of 5–11 October 2026" / "— September 2026") has medals for the first three and one line per moderator: mention, tickets handled, ⭐ average (number of ratings), first response. Mentions notify nobody (`allowedMentions: { parse: [] }`).

## Private staff threads

The ticket controls have a second row with **Staff thread** (`dispatch:staff-thread:<ticketId>`). The button is reserved to the category's staff (staff roles, Manage Server or Manage Channels; never the user who opened the ticket, even with a staff role) and to active tickets (not closed, not reopening, channel not deleted). On the first click the bot creates a **private** thread (`staff-NNNN`, not invitable, auto-archived after one week of inactivity), adds whoever clicked **and all current members of the category's staff roles** (never the ticket author or bots; at most 200), posts an introduction that mentions them (they receive the notification) and saves `Ticket.staffThreadId` with a conditional update (two simultaneous clicks do not create two threads). If the ticket is transferred, the moderators of the new category are added and mentioned in the thread. Later clicks (for example moderators who joined the role after the creation) add the staff member to the existing thread (unarchiving it if archived) and reply privately with the link. The user and the participants are never added. Tickets opened before this version do not have the button in their initial message.

Ticket channel permissions:

- `@everyone`, user and participants: threads denied as before (public/private creation and sending in threads).
- Staff roles: can write in threads (`SendMessagesInThreads`), not create them.
- Bot: `CreatePrivateThreads`, `SendMessagesInThreads`, `ManageThreads` on its own overwrite.

Discord only lets the bot grant in overwrites the permissions it has: this is why the install link now requests **Manage Threads**, **Create Private Threads** and **Send Messages in Threads** (bitfield `361045814288`, see [DEPLOYMENT.md](DEPLOYMENT.md#prerequisites)). New channels get the thread permissions only if the bot's role has them; for existing tickets the staff and bot overwrites are updated when the first thread is created. If the permissions are missing, the button replies "The bot cannot create private threads: update its role permissions" and the audit records `ticket.staff_thread.missing_permissions`. A member with Manage Threads at server level can still see private threads: do not grant it to users who open tickets.

Confidentiality:

- Thread messages are neither ticket activity nor the first staff response (tracking considers only the ticket channel) and do not enter the user's transcript, which reads only the main channel.
- On close (every path) the bot builds the thread's HTML transcript (same generator, with the same escaping, as the ticket transcript) and sends it **only** to a channel of the server: the category's transcript archive channel, if configured, otherwise the ticket log channel (`GuildSettings.ticketLogChannelId`). Never to the user, never by DM, never saved in the database. Without a destination the delivery is skipped with the audit `ticket.staff_thread.transcript_skipped`; every delivery is recorded as `ticket.staff_thread.transcript` (destination, outcome, number of messages). The thread is then locked and archived; reopening unlocks it.
- Before staff delete the channel (which also deletes its threads) the transcript is sent if the close had not already delivered it. This is best effort and does not block the deletion.
- The dashboard (ticket detail) shows only whether the thread exists, with the Discord link; never the content.

Log events: `TICKET_STAFF_THREAD` (thread created, transcript sent).

## SLA and escalation

In the category editor, escalation is optional and is enabled with the **Escalation automatica** (*Automatic escalation*) checkbox (off for new categories). When off, `escalationMinutes = null` and `escalationRoleIds = []` are saved (the API clears the roles even if a client sends them) and the bot does not run it. SLA, auto-close, warning and reopen window remain numeric fields: empty = disabled. Automatic events can be logged as `TICKET_AUTOMATION`.

## Retention

New installations delete nothing until a duration is set. Values already saved are kept during the upgrade. The settings are separate:

- retention of closed tickets' transcripts;
- retention of closed tickets and linked data;
- optional deletion of the Discord channel.

The check starts when the bot is ready and repeats every 6 hours, with paginated processing. Expiry counts from the close, never from the opening or from the regeneration of the transcript. The user's reopen window is always respected. Open tickets or tickets in the REOPENING phase are not deleted. Deleting the ticket also deletes the linked transcripts, notes, participants, feedback and audit; the general administrative audit and the templates are not deleted by this policy.

A channel already deleted by staff (`channelDeletedAt`) is considered missing: retention does not try to delete it again and deletes only the record.

Before deleting a channel a persistent deletion marker is saved. Reopening cannot go past it. Discord permission, network or availability errors keep the record for the next attempt; only Unknown Channel is considered equivalent to an already missing channel. A channel reused for other purposes, without the expected Dispatch topic, is not deleted. If Discord deletion is disabled, the record is deleted but the channel stays: this option does NOT remove the messages from Discord.

Expired transcripts cannot be regenerated to bypass retention. Exported copies, VPS backups and Discord's own retention have a separate lifecycle: this feature does not guarantee their deletion. Analytics aggregates based on deleted tickets change accordingly.

Independently of these settings, all of a server's data is deleted 30 days after the bot is removed from it ([ARCHITECTURE.md](ARCHITECTURE.md#post-removal-purge)).

## Verification and deployment

The CI job `Typecheck, tests and migrations` uses a disposable PostgreSQL, the real migrations and simulations of the Discord API. It verifies concurrency, replay, limits, blacklist, private menu, retention, Discord errors and database privileges ([VALIDATION.md](VALIDATION.md)). The production build depends on these tests. The tests are NOT equivalent to a live test on Discord or to a verification of the VPS.

The deployment method is the same as Sentinel's: images built on GitHub, GHCR, immutable digests and restricted SSH deployment. On the first setup use the current version of `deploy/runtime/harden-users.sh`; the bot must be able to use TicketOpenAttempt, TicketUserGuard and TicketFeedback, but not read PanelSession, TicketNote or _prisma_migrations. Attributed ratings, the leaderboard and staff threads only add columns to existing tables (`GuildSettings`, `Ticket`, `TicketFeedback`): the grants do not change.
