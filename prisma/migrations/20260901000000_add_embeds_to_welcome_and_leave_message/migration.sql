-- AlterTable: welcome messages can now be sent as an embed
ALTER TABLE "welcome_message_settings" ADD COLUMN IF NOT EXISTS "message_type" VARCHAR(7) NOT NULL DEFAULT 'text';
ALTER TABLE "welcome_message_settings" ADD COLUMN IF NOT EXISTS "embed" JSON DEFAULT '{}';

-- AlterTable: leave messages can now be sent as an embed
ALTER TABLE "leave_message_settings" ADD COLUMN IF NOT EXISTS "message_type" VARCHAR(7) NOT NULL DEFAULT 'text';
ALTER TABLE "leave_message_settings" ADD COLUMN IF NOT EXISTS "embed" JSON DEFAULT '{}';
