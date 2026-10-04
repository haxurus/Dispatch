ALTER TABLE "TicketCategory"
ADD COLUMN "escalationMinutes" INTEGER,
ADD COLUMN "escalationRoleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "reopenWindowHours" INTEGER,
ADD COLUMN "feedbackEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Ticket"
ADD COLUMN "escalatedAt" TIMESTAMP(3),
ADD COLUMN "feedbackRequestedAt" TIMESTAMP(3);

CREATE TABLE "TicketFeedback" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "commentEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TicketFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuildBlacklist" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reasonEncrypted" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GuildBlacklist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TicketFeedback_ticketId_key" ON "TicketFeedback"("ticketId");
CREATE INDEX "TicketFeedback_guildId_createdAt_idx" ON "TicketFeedback"("guildId", "createdAt" DESC);
CREATE INDEX "TicketFeedback_guildId_rating_idx" ON "TicketFeedback"("guildId", "rating");

CREATE UNIQUE INDEX "GuildBlacklist_guildId_userId_key" ON "GuildBlacklist"("guildId", "userId");
CREATE INDEX "GuildBlacklist_guildId_expiresAt_idx" ON "GuildBlacklist"("guildId", "expiresAt");

ALTER TABLE "TicketFeedback"
ADD CONSTRAINT "TicketFeedback_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TicketFeedback"
ADD CONSTRAINT "TicketFeedback_guildId_fkey"
FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GuildBlacklist"
ADD CONSTRAINT "GuildBlacklist_guildId_fkey"
FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId")
ON DELETE CASCADE ON UPDATE CASCADE;
