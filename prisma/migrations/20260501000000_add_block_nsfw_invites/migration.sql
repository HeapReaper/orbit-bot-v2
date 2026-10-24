-- Add block_nsfw_invites column if it doesn't exist, then enforce NOT NULL
ALTER TABLE "anti_bot_settings" ADD COLUMN IF NOT EXISTS "block_nsfw_invites" BOOLEAN DEFAULT false;
UPDATE "anti_bot_settings" SET "block_nsfw_invites" = false WHERE "block_nsfw_invites" IS NULL;
ALTER TABLE "anti_bot_settings" ALTER COLUMN "block_nsfw_invites" SET NOT NULL;