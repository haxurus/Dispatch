-- Paid plans are sold only through Discord (Premium Apps guild subscriptions):
-- the bot mirrors each server's running entitlement here. Plans given from the
-- super console are gifts, so billing periods and coupons go away.

DROP TABLE "Coupon";

ALTER TABLE "GuildSettings"
DROP COLUMN "planBilling",
DROP COLUMN "planCouponCode",
ADD COLUMN "subscriptionTier" TEXT,
ADD COLUMN "subscriptionEndsAt" TIMESTAMP(3),
ADD COLUMN "subscriptionEntitlementId" TEXT,
ADD COLUMN "subscriptionSyncedAt" TIMESTAMP(3),
ADD COLUMN "planLimitsTier" TEXT NOT NULL DEFAULT 'FREE';

-- The plan whose limits were last applied: today's gifts.
UPDATE "GuildSettings" SET "planLimitsTier" = "planTier";
