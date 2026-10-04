-- CreateTable
CREATE TABLE "GuildSettings" (
    "guildId" TEXT NOT NULL,
    "guildName" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Rome',
    "locale" TEXT NOT NULL DEFAULT 'it',
    "ticketCounter" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GuildSettings_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "TicketCategory" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discordCategoryId" TEXT,
    "staffRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxOpenPerUser" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TicketCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TicketPanel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TicketPanel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "ticketNumber" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "openerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "subject" TEXT,
    "claimedById" TEXT,
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TicketMember" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'PARTICIPANT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TicketAudit" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "contentEncrypted" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PanelSession" (
    "id" TEXT NOT NULL,
    "sessionTokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "guilds" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PanelSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PanelRoleBinding" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordRoleId" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PanelRoleBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PanelAudit" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PanelAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Ticket_channelId_key" ON "Ticket"("channelId");
CREATE UNIQUE INDEX "Ticket_guildId_ticketNumber_key" ON "Ticket"("guildId", "ticketNumber");
CREATE INDEX "Ticket_guildId_status_createdAt_idx" ON "Ticket"("guildId", "status", "createdAt" DESC);
CREATE INDEX "Ticket_openerId_status_idx" ON "Ticket"("openerId", "status");
CREATE INDEX "Ticket_claimedById_status_idx" ON "Ticket"("claimedById", "status");

CREATE INDEX "TicketCategory_guildId_idx" ON "TicketCategory"("guildId");
CREATE INDEX "TicketPanel_guildId_idx" ON "TicketPanel"("guildId");

CREATE UNIQUE INDEX "TicketMember_ticketId_userId_key" ON "TicketMember"("ticketId", "userId");

CREATE INDEX "TicketAudit_ticketId_createdAt_idx" ON "TicketAudit"("ticketId", "createdAt" DESC);
CREATE INDEX "TicketAudit_guildId_createdAt_idx" ON "TicketAudit"("guildId", "createdAt" DESC);

CREATE UNIQUE INDEX "Transcript_ticketId_key" ON "Transcript"("ticketId");

CREATE UNIQUE INDEX "PanelSession_sessionTokenHash_key" ON "PanelSession"("sessionTokenHash");
CREATE INDEX "PanelSession_userId_idx" ON "PanelSession"("userId");
CREATE INDEX "PanelSession_expiresAt_idx" ON "PanelSession"("expiresAt");

CREATE UNIQUE INDEX "PanelRoleBinding_guildId_discordRoleId_key" ON "PanelRoleBinding"("guildId", "discordRoleId");
CREATE INDEX "PanelRoleBinding_guildId_idx" ON "PanelRoleBinding"("guildId");

CREATE INDEX "PanelAudit_guildId_createdAt_idx" ON "PanelAudit"("guildId", "createdAt" DESC);

ALTER TABLE "TicketCategory"
ADD CONSTRAINT "TicketCategory_guildId_fkey"
FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TicketPanel"
ADD CONSTRAINT "TicketPanel_guildId_fkey"
FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Ticket"
ADD CONSTRAINT "Ticket_guildId_fkey"
FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Ticket"
ADD CONSTRAINT "Ticket_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "TicketCategory"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TicketMember"
ADD CONSTRAINT "TicketMember_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TicketAudit"
ADD CONSTRAINT "TicketAudit_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Transcript"
ADD CONSTRAINT "Transcript_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PanelRoleBinding"
ADD CONSTRAINT "PanelRoleBinding_guildId_fkey"
FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PanelAudit"
ADD CONSTRAINT "PanelAudit_guildId_fkey"
FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId")
ON DELETE CASCADE ON UPDATE CASCADE;
