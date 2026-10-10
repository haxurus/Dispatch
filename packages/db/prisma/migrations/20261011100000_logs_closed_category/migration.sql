-- Ticket log channel, closed-ticket Discord category and staff channel
-- deletion. Every new column is nullable or has a default that keeps the
-- previous behaviour: no log channel, closed tickets stay where they are,
-- channels are deleted only by retention.

-- Per-server ticket log channel and the enabled event keys
-- (TICKET_LOG_EVENTS in @dispatch/shared, validated by the API).
ALTER TABLE "GuildSettings"
ADD COLUMN "ticketLogChannelId" TEXT,
ADD COLUMN "ticketLogEvents" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Discord category for the closed tickets of a ticket category, and the
-- per-form override for tickets created by that form.
ALTER TABLE "TicketCategory" ADD COLUMN "closedParentCategoryId" TEXT;
ALTER TABLE "FormDefinition" ADD COLUMN "ticketClosedParentCategoryId" TEXT;

-- sourceFormId: form that created the ticket (set by the bot).
-- openParentId: Discord parent before the move to the closed category.
-- channelDeletedAt: channel deleted by staff; the row stays until retention.
ALTER TABLE "Ticket"
ADD COLUMN "sourceFormId" TEXT,
ADD COLUMN "openParentId" TEXT,
ADD COLUMN "channelDeletedAt" TIMESTAMP(3);

CREATE INDEX "Ticket_sourceFormId_idx" ON "Ticket"("sourceFormId");

ALTER TABLE "Ticket"
ADD CONSTRAINT "Ticket_sourceFormId_fkey" FOREIGN KEY ("sourceFormId")
REFERENCES "FormDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Defence in depth: the API validates the same rules.
ALTER TABLE "GuildSettings"
ADD CONSTRAINT "GuildSettings_ticketLogChannelId_check" CHECK ("ticketLogChannelId" IS NULL OR "ticketLogChannelId" ~ '^[0-9]{17,20}$'),
ADD CONSTRAINT "GuildSettings_ticketLogEvents_check" CHECK (cardinality("ticketLogEvents") <= 32);

ALTER TABLE "TicketCategory"
ADD CONSTRAINT "TicketCategory_closedParentCategoryId_check" CHECK ("closedParentCategoryId" IS NULL OR "closedParentCategoryId" ~ '^[0-9]{17,20}$');

ALTER TABLE "FormDefinition"
ADD CONSTRAINT "FormDefinition_ticketClosedParentCategoryId_check" CHECK ("ticketClosedParentCategoryId" IS NULL OR "ticketClosedParentCategoryId" ~ '^[0-9]{17,20}$');
