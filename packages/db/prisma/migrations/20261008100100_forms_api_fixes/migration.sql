-- "transcriptStoreTemporary" had inverted semantics (true = keep the stored
-- copy) and defaulted to false, so every existing category silently turned
-- legacy dashboard transcripts into one-shot downloads. Rename it to what it
-- means and default to keeping the encrypted copy.
ALTER TABLE "TicketCategory" RENAME COLUMN "transcriptStoreTemporary" TO "transcriptRetain";
ALTER TABLE "TicketCategory" ALTER COLUMN "transcriptRetain" SET DEFAULT true;

-- Legacy behaviour = keep. Categories with automatic delivery enabled exposed
-- the toggle in the dashboard, so their value is an explicit choice (false =
-- automatic transcript only in memory) and is preserved.
UPDATE "TicketCategory"
SET "transcriptRetain" = true
WHERE "transcriptAutoGenerate" = false;
