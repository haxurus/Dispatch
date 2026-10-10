-- Ratings attributed to the handling moderator, moderator leaderboard and
-- private staff threads. Every new column is nullable or has a default that
-- keeps the previous behaviour: no leaderboard is posted until a channel and
-- a schedule are configured, no staff thread exists until staff creates one.

-- Moderator the opener rated: snapshot taken when the feedback is submitted
-- (claimer, otherwise the staff member who closed the ticket; NULL =
-- unattributed). It survives unclaim/reopen, unlike Ticket.claimedById.
ALTER TABLE "TicketFeedback" ADD COLUMN "staffUserId" TEXT;

-- closedById: staff member who closed the ticket (never the opener, never the
-- automatic close). handledById: moderator credited with the closed ticket
-- (claimer at close, otherwise the staff closer). staffThreadId: private
-- staff thread of the ticket channel.
ALTER TABLE "Ticket"
ADD COLUMN "closedById" TEXT,
ADD COLUMN "handledById" TEXT,
ADD COLUMN "staffThreadId" TEXT;

-- Leaderboard schedule (times in GuildSettings.timezone). The last period
-- keys ('2026-W41', '2026-09') make the scheduled post idempotent.
ALTER TABLE "GuildSettings"
ADD COLUMN "leaderboardChannelId" TEXT,
ADD COLUMN "leaderboardWeekly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "leaderboardMonthly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "leaderboardSize" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "leaderboardMinRatings" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "leaderboardWeekday" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "leaderboardHour" INTEGER NOT NULL DEFAULT 9,
ADD COLUMN "leaderboardLastWeekly" TEXT,
ADD COLUMN "leaderboardLastMonthly" TEXT;

-- Backfill: existing feedback is attributed to the ticket's current claimer
-- (what the analytics showed so far) and already closed tickets are credited
-- to their claimer. Values that are not snowflakes are left NULL.
UPDATE "TicketFeedback" AS f
SET "staffUserId" = t."claimedById"
FROM "Ticket" AS t
WHERE t."id" = f."ticketId"
  AND f."staffUserId" IS NULL
  AND t."claimedById" ~ '^[0-9]{17,20}$';

UPDATE "Ticket"
SET "handledById" = "claimedById"
WHERE "status" = 'CLOSED'
  AND "handledById" IS NULL
  AND "claimedById" ~ '^[0-9]{17,20}$';

CREATE INDEX "TicketFeedback_guildId_staffUserId_createdAt_idx" ON "TicketFeedback"("guildId", "staffUserId", "createdAt" DESC);
CREATE INDEX "Ticket_guildId_handledById_closedAt_idx" ON "Ticket"("guildId", "handledById", "closedAt");

-- Defence in depth: the API and the bot validate the same rules.
ALTER TABLE "TicketFeedback"
ADD CONSTRAINT "TicketFeedback_staffUserId_check" CHECK ("staffUserId" IS NULL OR "staffUserId" ~ '^[0-9]{17,20}$');

ALTER TABLE "Ticket"
ADD CONSTRAINT "Ticket_closedById_check" CHECK ("closedById" IS NULL OR "closedById" ~ '^[0-9]{17,20}$'),
ADD CONSTRAINT "Ticket_handledById_check" CHECK ("handledById" IS NULL OR "handledById" ~ '^[0-9]{17,20}$'),
ADD CONSTRAINT "Ticket_staffThreadId_check" CHECK ("staffThreadId" IS NULL OR "staffThreadId" ~ '^[0-9]{17,20}$');

ALTER TABLE "GuildSettings"
ADD CONSTRAINT "GuildSettings_leaderboardChannelId_check" CHECK ("leaderboardChannelId" IS NULL OR "leaderboardChannelId" ~ '^[0-9]{17,20}$'),
ADD CONSTRAINT "GuildSettings_leaderboardSize_check" CHECK ("leaderboardSize" BETWEEN 3 AND 25),
ADD CONSTRAINT "GuildSettings_leaderboardMinRatings_check" CHECK ("leaderboardMinRatings" BETWEEN 0 AND 50),
ADD CONSTRAINT "GuildSettings_leaderboardWeekday_check" CHECK ("leaderboardWeekday" BETWEEN 1 AND 7),
ADD CONSTRAINT "GuildSettings_leaderboardHour_check" CHECK ("leaderboardHour" BETWEEN 0 AND 23),
ADD CONSTRAINT "GuildSettings_leaderboardLastWeekly_check" CHECK ("leaderboardLastWeekly" IS NULL OR "leaderboardLastWeekly" ~ '^[0-9]{4}-W[0-9]{2}$'),
ADD CONSTRAINT "GuildSettings_leaderboardLastMonthly_check" CHECK ("leaderboardLastMonthly" IS NULL OR "leaderboardLastMonthly" ~ '^[0-9]{4}-[0-9]{2}$');
