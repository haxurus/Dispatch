ALTER TABLE "TicketUserGuard"
  ADD COLUMN "reservationToken" TEXT,
  ADD COLUMN "reservationCategoryId" TEXT,
  ADD COLUMN "reservationSourceKey" TEXT,
  ADD COLUMN "reservationFormVersion" TEXT,
  ADD COLUMN "reservationPhase" TEXT,
  ADD COLUMN "lastViolationAt" TIMESTAMP(3);
ALTER TABLE "TicketOpenAttempt" ADD COLUMN "openedAt" TIMESTAMP(3);
ALTER TABLE "Ticket"
  ADD COLUMN "retentionPendingAt" TIMESTAMP(3),
  ADD COLUMN "retentionDeleteChannel" BOOLEAN;
CREATE INDEX "Ticket_guildId_status_closedAt_idx" ON "Ticket"("guildId", "status", "closedAt");
CREATE INDEX "TicketOpenAttempt_guildId_userId_categoryId_openedAt_idx"
  ON "TicketOpenAttempt"("guildId", "userId", "categoryId", "openedAt" DESC);
ALTER TABLE "TicketUserGuard" ADD CONSTRAINT "TicketUserGuard_reservationPhase_check"
  CHECK ("reservationPhase" IS NULL OR "reservationPhase" IN ('FORM', 'CREATING'));
-- New installations require an explicit retention policy. Existing policies
-- are deliberately preserved, not silently rewritten by a migration.
ALTER TABLE "GuildSettings"
  ALTER COLUMN "transcriptRetentionDays" DROP DEFAULT,
  ALTER COLUMN "closedTicketRetentionDays" DROP DEFAULT,
  ALTER COLUMN "retentionDeleteDiscordChannel" SET DEFAULT false;
