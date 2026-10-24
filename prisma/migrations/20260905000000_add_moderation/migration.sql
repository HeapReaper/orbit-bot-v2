-- CreateTable: server wide moderation configuration
CREATE TABLE IF NOT EXISTS "moderation_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "log_channel" VARCHAR(22),
    "mute_role" VARCHAR(22),
    "dm_on_punishment" BOOLEAN NOT NULL DEFAULT true,
    "dm_message" TEXT,
    "ignore_admins" BOOLEAN NOT NULL DEFAULT true,
    "ignore_bots" BOOLEAN NOT NULL DEFAULT true,
    "immune_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ignored_channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "delete_message_days" INTEGER NOT NULL DEFAULT 1,
    "default_mute_duration" INTEGER NOT NULL DEFAULT 60,
    "warn_expiry_days" INTEGER NOT NULL DEFAULT 30,
    "escalations" JSONB DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moderation_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "moderation_settings_guild_id_key" ON "moderation_settings"("guild_id");

-- CreateTable: one row per auto-moderation filter
CREATE TABLE IF NOT EXISTS "moderation_filters" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "alert" BOOLEAN NOT NULL DEFAULT false,
    "log" BOOLEAN NOT NULL DEFAULT true,
    "delete" BOOLEAN NOT NULL DEFAULT true,
    "hard_action" VARCHAR(20) NOT NULL DEFAULT 'none',
    "hard_action_duration" INTEGER NOT NULL DEFAULT 0,
    "threshold_maximum" INTEGER NOT NULL DEFAULT 3,
    "threshold_duration" INTEGER NOT NULL DEFAULT 60,
    "limit" INTEGER NOT NULL DEFAULT 5,
    "window" INTEGER NOT NULL DEFAULT 10,
    "minimum_length" INTEGER NOT NULL DEFAULT 10,
    "entries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entries_mode" VARCHAR(10) NOT NULL DEFAULT 'blacklist',
    "ignored_channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ignored_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moderation_filters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "moderation_filters_guild_id_type_key" ON "moderation_filters"("guild_id", "type");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'moderation_filters_guild_id_fkey'
    ) THEN
        ALTER TABLE "moderation_filters"
            ADD CONSTRAINT "moderation_filters_guild_id_fkey"
            FOREIGN KEY ("guild_id") REFERENCES "moderation_settings"("guild_id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: warnings, mutes and every other action the bot took
CREATE TABLE IF NOT EXISTS "moderation_cases" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "user_id" VARCHAR(22) NOT NULL,
    "moderator_id" VARCHAR(22),
    "action" VARCHAR(20) NOT NULL,
    "reason" TEXT NOT NULL,
    "filter_type" VARCHAR(30),
    "duration" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_cases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "moderation_cases_guild_id_user_id_idx" ON "moderation_cases"("guild_id", "user_id");
CREATE INDEX IF NOT EXISTS "moderation_cases_active_expires_at_idx" ON "moderation_cases"("active", "expires_at");
