-- Super console alignment with Sentinel: Discord SKUs set in the console,
-- alarm webhook, alert routing, instance events and incidents.
ALTER TABLE "InstanceConfig" ADD COLUMN "discordSkus" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "InstanceConfig" ADD COLUMN "alertWebhookUrl" TEXT;
ALTER TABLE "InstanceConfig" ADD COLUMN "alertSettings" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "InstanceConfig" ADD COLUMN "lastDigestAt" TIMESTAMP(3);

CREATE TABLE "InstanceEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'errors',
    "severity" TEXT NOT NULL DEFAULT 'info',
    "messageKey" TEXT,
    "title" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "deliveryState" TEXT NOT NULL DEFAULT 'pending',
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstanceEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InstanceEvent_createdAt_idx" ON "InstanceEvent"("createdAt" DESC);
CREATE INDEX "InstanceEvent_deliveryState_createdAt_idx" ON "InstanceEvent"("deliveryState", "createdAt");

CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "messageKey" TEXT,
    "params" JSONB NOT NULL DEFAULT '{}',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "lastRemindedAt" TIMESTAMP(3),
    "reminders" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Incident_key_resolvedAt_idx" ON "Incident"("key", "resolvedAt");
CREATE INDEX "Incident_openedAt_idx" ON "Incident"("openedAt" DESC);

-- Production roles already exist when this runs. harden-users.sh grants the
-- same right after the migrations; until the installer copies the new script,
-- the copy on the VPS revokes them again and these features stay unavailable.
-- The bot may only insert events (createMany, no RETURNING) and read the SKUs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dispatch_api') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "InstanceEvent", "Incident" TO dispatch_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dispatch_bot') THEN
    REVOKE ALL ON TABLE "InstanceEvent", "Incident" FROM dispatch_bot;
    GRANT INSERT ON TABLE "InstanceEvent" TO dispatch_bot;
    GRANT SELECT ("id", "discordSkus") ON TABLE "InstanceConfig" TO dispatch_bot;
  END IF;
END
$$;
