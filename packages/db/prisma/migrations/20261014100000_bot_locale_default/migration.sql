-- New servers start with the bot in English (international default).
-- Existing servers keep the language they already have ('it').
ALTER TABLE "GuildSettings" ALTER COLUMN "locale" SET DEFAULT 'en';
