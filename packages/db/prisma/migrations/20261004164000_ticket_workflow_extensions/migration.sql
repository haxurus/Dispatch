ALTER TABLE "TicketCategory"
ADD COLUMN "formFields" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "slaFirstResponseMinutes" INTEGER,
ADD COLUMN "slaResolutionMinutes" INTEGER,
ADD COLUMN "inactivityCloseHours" INTEGER,
ADD COLUMN "inactivityWarningMinutes" INTEGER;

ALTER TABLE "Ticket"
ADD COLUMN "formDataEncrypted" TEXT,
ADD COLUMN "firstStaffResponseAt" TIMESTAMP(3),
ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "inactivityWarnedAt" TIMESTAMP(3),
ADD COLUMN "slaFirstBreachedAt" TIMESTAMP(3),
ADD COLUMN "slaResolutionBreachedAt" TIMESTAMP(3);

CREATE TABLE "TicketNote" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "contentEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResponseTemplate" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResponseTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TicketNote_ticketId_createdAt_idx" ON "TicketNote"("ticketId", "createdAt" DESC);
CREATE INDEX "TicketNote_guildId_createdAt_idx" ON "TicketNote"("guildId", "createdAt" DESC);
CREATE UNIQUE INDEX "ResponseTemplate_guildId_name_key" ON "ResponseTemplate"("guildId", "name");
CREATE INDEX "ResponseTemplate_guildId_createdAt_idx" ON "ResponseTemplate"("guildId", "createdAt");

ALTER TABLE "TicketNote"
ADD CONSTRAINT "TicketNote_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResponseTemplate"
ADD CONSTRAINT "ResponseTemplate_guildId_fkey"
FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId")
ON DELETE CASCADE ON UPDATE CASCADE;
