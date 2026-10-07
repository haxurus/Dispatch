CREATE TABLE "FormDefinition" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "questions" JSONB NOT NULL DEFAULT '[]',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "openAt" TIMESTAMP(3),
  "closeAt" TIMESTAMP(3),
  "deliveryMode" TEXT NOT NULL DEFAULT 'EPHEMERAL',
  "resultChannelId" TEXT,
  "resultRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "allowedRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "deniedRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "maxSubmissionsPerUser" INTEGER NOT NULL DEFAULT 1,
  "cooldownSeconds" INTEGER NOT NULL DEFAULT 300,
  "submissionWindowMinutes" INTEGER NOT NULL DEFAULT 60,
  "maxAttemptsPerWindow" INTEGER NOT NULL DEFAULT 5,
  "createTicketOnSubmit" BOOLEAN NOT NULL DEFAULT false,
  "ticketCategoryId" TEXT,
  "ticketParentCategoryId" TEXT,
  "ticketStaffRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "ticketPrefix" TEXT NOT NULL DEFAULT 'form',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FormDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FormPanel" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "messageId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "buttonLabel" TEXT NOT NULL DEFAULT 'Compila',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FormPanel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FormSubmission" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "answersEncrypted" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "reportChannelId" TEXT,
  "reportMessageId" TEXT,
  "ticketChannelId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FormSession" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "channelId" TEXT,
  "currentQuestion" INTEGER NOT NULL DEFAULT 0,
  "answersEncrypted" TEXT,
  "state" TEXT NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FormSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FormPermissionBinding" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "discordRoleId" TEXT NOT NULL,
  "canManage" BOOLEAN NOT NULL DEFAULT false,
  "canView" BOOLEAN NOT NULL DEFAULT false,
  "canReview" BOOLEAN NOT NULL DEFAULT false,
  "canSubmit" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FormPermissionBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FormSession_token_key" ON "FormSession"("token");
CREATE UNIQUE INDEX "FormPermissionBinding_formId_discordRoleId_key" ON "FormPermissionBinding"("formId", "discordRoleId");

CREATE INDEX "FormDefinition_guildId_enabled_idx" ON "FormDefinition"("guildId", "enabled");
CREATE INDEX "FormDefinition_guildId_createdAt_idx" ON "FormDefinition"("guildId", "createdAt");
CREATE INDEX "FormPanel_guildId_idx" ON "FormPanel"("guildId");
CREATE INDEX "FormPanel_formId_idx" ON "FormPanel"("formId");
CREATE INDEX "FormSubmission_guildId_formId_createdAt_idx" ON "FormSubmission"("guildId", "formId", "createdAt" DESC);
CREATE INDEX "FormSubmission_guildId_userId_createdAt_idx" ON "FormSubmission"("guildId", "userId", "createdAt" DESC);
CREATE INDEX "FormSubmission_formId_userId_createdAt_idx" ON "FormSubmission"("formId", "userId", "createdAt" DESC);
CREATE INDEX "FormSession_guildId_userId_state_idx" ON "FormSession"("guildId", "userId", "state");
CREATE INDEX "FormSession_expiresAt_idx" ON "FormSession"("expiresAt");
CREATE INDEX "FormPermissionBinding_guildId_discordRoleId_idx" ON "FormPermissionBinding"("guildId", "discordRoleId");

ALTER TABLE "FormDefinition" ADD CONSTRAINT "FormDefinition_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormPanel" ADD CONSTRAINT "FormPanel_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormPanel" ADD CONSTRAINT "FormPanel_formId_fkey"
  FOREIGN KEY ("formId") REFERENCES "FormDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formId_fkey"
  FOREIGN KEY ("formId") REFERENCES "FormDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FormSession" ADD CONSTRAINT "FormSession_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormSession" ADD CONSTRAINT "FormSession_formId_fkey"
  FOREIGN KEY ("formId") REFERENCES "FormDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormPermissionBinding" ADD CONSTRAINT "FormPermissionBinding_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "GuildSettings"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormPermissionBinding" ADD CONSTRAINT "FormPermissionBinding_formId_fkey"
  FOREIGN KEY ("formId") REFERENCES "FormDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
