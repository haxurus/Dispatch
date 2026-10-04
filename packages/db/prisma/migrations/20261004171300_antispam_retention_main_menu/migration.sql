ALTER TABLE "GuildSettings"
ADD COLUMN "antiSpamEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "antiSpamGlobalCooldownSeconds" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "antiSpamWindowMinutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "antiSpamMaxAttempts" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "antiSpamBlockMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN "transcriptRetentionDays" INTEGER DEFAULT 30,
ADD COLUMN "closedTicketRetentionDays" INTEGER DEFAULT 90,
ADD COLUMN "retentionDeleteDiscordChannel" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "mainMenuEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "mainMenuChannelId" TEXT,
ADD COLUMN "mainMenuMessageId" TEXT,
ADD COLUMN "mainMenuTitle" TEXT NOT NULL DEFAULT 'Centro assistenza',
ADD COLUMN "mainMenuDescription" TEXT NOT NULL DEFAULT 'Premi il pulsante per scegliere il tipo di richiesta.',
ADD COLUMN "mainMenuButtonLabel" TEXT NOT NULL DEFAULT 'Apri un ticket',
ADD COLUMN "mainMenuCategoryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "TicketCategory"
ADD COLUMN "openCooldownSeconds" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "antiSpamWindowMinutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "antiSpamMaxAttempts" INTEGER NOT NULL DEFAULT 3;

CREATE TABLE "TicketOpenAttempt" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketOpenAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TicketUserGuard" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastOpenedAt" TIMESTAMP(3),
    "pendingUntil" TIMESTAMP(3),
    "blockedUntil" TIMESTAMP(3),
    "strikes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketUserGuard_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TicketOpenAttempt_guildId_userId_createdAt_idx"
ON "TicketOpenAttempt"("guildId", "userId", "createdAt" DESC);

CREATE INDEX "TicketOpenAttempt_guildId_userId_categoryId_createdAt_idx"
ON "TicketOpenAttempt"("guildId", "userId", "categoryId", "createdAt" DESC);

CREATE INDEX "TicketOpenAttempt_createdAt_idx"
ON "TicketOpenAttempt"("createdAt");

CREATE UNIQUE INDEX "TicketUserGuard_guildId_userId_key"
ON "TicketUserGuard"("guildId", "userId");

CREATE INDEX "TicketUserGuard_guildId_blockedUntil_idx"
ON "TicketUserGuard"("guildId", "blockedUntil");

ALTER TABLE "TicketOpenAttempt"
ADD CONSTRAINT "TicketOpenAttempt_guildId_fkey"
FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TicketOpenAttempt"
ADD CONSTRAINT "TicketOpenAttempt_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "TicketCategory"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TicketUserGuard"
ADD CONSTRAINT "TicketUserGuard_guildId_fkey"
FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GuildSettings"
ADD CONSTRAINT "GuildSettings_antiSpamGlobalCooldownSeconds_check"
CHECK ("antiSpamGlobalCooldownSeconds" BETWEEN 0 AND 86400),
ADD CONSTRAINT "GuildSettings_antiSpamWindowMinutes_check"
CHECK ("antiSpamWindowMinutes" BETWEEN 1 AND 1440),
ADD CONSTRAINT "GuildSettings_antiSpamMaxAttempts_check"
CHECK ("antiSpamMaxAttempts" BETWEEN 1 AND 100),
ADD CONSTRAINT "GuildSettings_antiSpamBlockMinutes_check"
CHECK ("antiSpamBlockMinutes" BETWEEN 1 AND 10080);

ALTER TABLE "TicketCategory"
ADD CONSTRAINT "TicketCategory_openCooldownSeconds_check"
CHECK ("openCooldownSeconds" BETWEEN 0 AND 86400),
ADD CONSTRAINT "TicketCategory_antiSpamWindowMinutes_check"
CHECK ("antiSpamWindowMinutes" BETWEEN 1 AND 1440),
ADD CONSTRAINT "TicketCategory_antiSpamMaxAttempts_check"
CHECK ("antiSpamMaxAttempts" BETWEEN 1 AND 100);
