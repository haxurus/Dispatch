-- Canned replies can be limited to some ticket categories or forms; existing
-- ones stay available in every ticket.
ALTER TABLE "ResponseTemplate"
ADD COLUMN "allTickets" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "formIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
