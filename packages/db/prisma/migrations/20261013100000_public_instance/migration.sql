-- Public instance: data lifecycle after the bot leaves a server, and the
-- instance status channel chosen in the super console. Additive only.

-- Set when the bot is removed from (or leaves) a server, cleared when it is
-- added again. The API deletes every row of the server once it has been
-- gone for longer than the post-removal retention (30 days by default).
ALTER TABLE "GuildSettings" ADD COLUMN "leftAt" TIMESTAMP(3);
CREATE INDEX "GuildSettings_leftAt_idx" ON "GuildSettings"("leftAt");

-- Single row (id = 1): where the bot posts instance status notices
-- (startup, servers added or removed, rejected installations).
CREATE TABLE "StatusChannel" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatusChannel_pkey" PRIMARY KEY ("id")
);
