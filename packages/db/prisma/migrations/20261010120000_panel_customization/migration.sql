-- Panel customization (dashboard "Pannelli"): embed styling, interaction
-- style and per-item overrides for ticket and form panels. Every new column
-- has a default that reproduces the previous rendering, so already published
-- panels keep working unchanged:
--   * ticket panels: one select menu, footer 'Dispatch', no colour/images;
--   * form panels:   one button labelled "buttonLabel" for the panel form.

ALTER TABLE "TicketPanel"
ADD COLUMN "style" TEXT NOT NULL DEFAULT 'SELECT',
ADD COLUMN "placeholder" TEXT,
ADD COLUMN "color" INTEGER,
ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "thumbnailUrl" TEXT,
ADD COLUMN "footerText" TEXT,
ADD COLUMN "items" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "TicketPanel"
ADD CONSTRAINT "TicketPanel_style_check" CHECK ("style" IN ('SELECT', 'BUTTONS')),
ADD CONSTRAINT "TicketPanel_color_check" CHECK ("color" IS NULL OR ("color" >= 0 AND "color" <= 16777215)),
ADD CONSTRAINT "TicketPanel_items_check" CHECK (jsonb_typeof("items") = 'array');

ALTER TABLE "FormPanel"
ADD COLUMN "name" TEXT,
ADD COLUMN "formIds" TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN "style" TEXT NOT NULL DEFAULT 'BUTTONS',
ADD COLUMN "placeholder" TEXT,
ADD COLUMN "color" INTEGER,
ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "thumbnailUrl" TEXT,
ADD COLUMN "footerText" TEXT,
ADD COLUMN "items" JSONB NOT NULL DEFAULT '[]';

-- Existing panels offer exactly their single form. "formId" stays the FK
-- (primary form = formIds[0]) so deleting that form still cascades.
UPDATE "FormPanel" SET "formIds" = ARRAY["formId"] WHERE cardinality("formIds") = 0;

ALTER TABLE "FormPanel"
ADD CONSTRAINT "FormPanel_style_check" CHECK ("style" IN ('SELECT', 'BUTTONS')),
ADD CONSTRAINT "FormPanel_color_check" CHECK ("color" IS NULL OR ("color" >= 0 AND "color" <= 16777215)),
ADD CONSTRAINT "FormPanel_items_check" CHECK (jsonb_typeof("items") = 'array'),
ADD CONSTRAINT "FormPanel_formIds_check" CHECK (cardinality("formIds") <= 25);
