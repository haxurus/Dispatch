ALTER TABLE "TicketCategory"
ADD COLUMN "transcriptAutoGenerate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "transcriptSendToOpener" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "transcriptChannelId" TEXT,
ADD COLUMN "transcriptStoreTemporary" BOOLEAN NOT NULL DEFAULT false;
