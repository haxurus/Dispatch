-- Abandoned sessions used to stay ACTIVE forever. Expire them, then keep only
-- the newest ACTIVE session per (form, user) so the partial unique index below
-- can always be created.
UPDATE "FormSession" SET "state" = 'EXPIRED', "updatedAt" = CURRENT_TIMESTAMP
WHERE "state" = 'ACTIVE' AND "expiresAt" <= CURRENT_TIMESTAMP;

UPDATE "FormSession" AS s SET "state" = 'EXPIRED', "updatedAt" = CURRENT_TIMESTAMP
FROM (
  SELECT "id", row_number() OVER (
    PARTITION BY "formId", "userId" ORDER BY "createdAt" DESC, "id" DESC
  ) AS rank
  FROM "FormSession"
  WHERE "state" = 'ACTIVE'
) AS ranked
WHERE s."id" = ranked."id" AND ranked.rank > 1;

-- At most one in-progress compilation per user and form, enforced by PostgreSQL.
CREATE UNIQUE INDEX "FormSession_active_form_user_key" ON "FormSession"("formId", "userId") WHERE "state" = 'ACTIVE';
