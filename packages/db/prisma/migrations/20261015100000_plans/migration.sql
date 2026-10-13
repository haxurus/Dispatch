-- Subscription plans (activated from the super console), coupons, public
-- contacts for the pricing page and Brand plan customisation.

ALTER TABLE "GuildSettings"
ADD COLUMN "planTier" TEXT NOT NULL DEFAULT 'FREE',
ADD COLUMN "planBilling" TEXT,
ADD COLUMN "planExpiresAt" TIMESTAMP(3),
ADD COLUMN "planCouponCode" TEXT,
ADD COLUMN "planNote" TEXT,
ADD COLUMN "planUpdatedAt" TIMESTAMP(3),
ADD COLUMN "brandNickname" TEXT,
ADD COLUMN "brandBannerSet" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "GuildSettings_planTier_planExpiresAt_idx" ON "GuildSettings"("planTier", "planExpiresAt");

-- Servers that used Dispatch before plans existed keep every feature: they
-- get Brand as a gift with no expiry (the operator can change it later).
UPDATE "GuildSettings"
SET "planTier" = 'TIER3', "planBilling" = 'GIFT', "planNote" = 'Early adopter (before plans)', "planUpdatedAt" = CURRENT_TIMESTAMP;

CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "percentOff" INTEGER,
    "amountOffCents" INTEGER,
    "tiers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "billing" TEXT NOT NULL DEFAULT 'ANY',
    "maxRedemptions" INTEGER,
    "redemptions" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "public" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- Single row (id = 1): contacts shown on the pricing page.
CREATE TABLE "InstanceConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "contactEmail" TEXT,
    "contactDiscord" TEXT,
    "contactUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanceConfig_pkey" PRIMARY KEY ("id")
);
