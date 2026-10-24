-- CreateTable
CREATE TABLE "anti_bot_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "time_window" INTEGER NOT NULL DEFAULT 10,
    "channel_limit" INTEGER NOT NULL DEFAULT 3,
    "punishment" VARCHAR(20) NOT NULL DEFAULT 'none',
    "forbidden_words" JSONB,
    "forbidden_usernames" JSONB,
    "notification_channel" VARCHAR(22),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "block_invites" BOOLEAN NOT NULL DEFAULT false,
    "exclude_admins" BOOLEAN NOT NULL DEFAULT false,
    "jail_role" VARCHAR(22),

    CONSTRAINT "anti_bot_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_message" (
    "id" TEXT NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "message_type" VARCHAR(7) NOT NULL DEFAULT '',
    "schedule_type" VARCHAR(10) NOT NULL DEFAULT 'daily',
    "monthly_date" INTEGER,
    "last_sent_at" TIMESTAMP(3),
    "message" TEXT NOT NULL,
    "embed" JSON DEFAULT '{}',
    "channel" VARCHAR(22) NOT NULL,
    "time" VARCHAR(5) NOT NULL,
    "days" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_role_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "auto_roles" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_role_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "birthday" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guild_id" VARCHAR(22) NOT NULL,
    "user_id" VARCHAR(22) NOT NULL,
    "birthdate" DATE NOT NULL,

    CONSTRAINT "birthday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "birthday_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "channel" VARCHAR(22) NOT NULL,
    "message_type" VARCHAR(7) NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "embed" JSON DEFAULT '{}',
    "time" VARCHAR(5) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "birthday_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_log" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "nickname" VARCHAR(50),
    "language" VARCHAR(3),
    "updates_channel" VARCHAR(22),
    "timezone" VARCHAR(22),
    "primary_color" VARCHAR(22),
    "secondary_color" VARCHAR(22),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "show_in_guild_list" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "bot_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bump_reminder_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "channel" VARCHAR(22) NOT NULL,
    "message_type" VARCHAR(7) NOT NULL DEFAULT '',
    "message" TEXT NOT NULL DEFAULT '',
    "embed" JSON DEFAULT '{}',
    "interval" INTEGER NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "xp_boost" INTEGER NOT NULL DEFAULT 0,
    "reward_role" VARCHAR(22),
    "boost_leaderboard" BOOLEAN NOT NULL DEFAULT false,
    "leaderboard_auto_updates" BOOLEAN NOT NULL DEFAULT false,
    "leaderboard_channel" VARCHAR(22),
    "auto_leaderboard_interval" VARCHAR(32),

    CONSTRAINT "bump_reminder_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_of_fame" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "channel" VARCHAR(22),
    "emoji" VARCHAR(10),
    "amount" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_of_fame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_log" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "giveaway_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "channel" VARCHAR(22),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "giveaway_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_invite_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guild_invite_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_log" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guild_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "introduction_settings" (
    "guild_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "channel" TEXT,
    "max_messages" INTEGER NOT NULL DEFAULT 1,
    "message_type" VARCHAR(7) NOT NULL DEFAULT '',
    "embed" JSON DEFAULT '{}',
    "auto_reply" TEXT,
    "auto_emoji" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "auto_delete" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "introduction_settings_pkey" PRIMARY KEY ("guild_id")
);

-- CreateTable
CREATE TABLE "invite_tracker_invite" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "invite_code" TEXT NOT NULL,
    "invite_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_tracker_invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kick_watcher" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "channel" VARCHAR(22) NOT NULL,
    "users" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kick_watcher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_message_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "messages" JSONB,
    "channel" VARCHAR(22),
    "enabled" INTEGER NOT NULL,
    "randomize" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_message_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leveling_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "channel" VARCHAR(22),
    "level_roles" JSONB,
    "xp_rate" DOUBLE PRECISION NOT NULL DEFAULT 200,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "curve_exponent" DOUBLE PRECISION NOT NULL DEFAULT 2.65,
    "xp_per_message" INTEGER NOT NULL DEFAULT 10,
    "xp_message_gain_speed" TEXT NOT NULL DEFAULT 'oneTimeAMinute',
    "xp_per_voice" INTEGER NOT NULL DEFAULT 5,
    "xp_voice_gain_speed" TEXT NOT NULL DEFAULT 'everyMinute',

    CONSTRAINT "leveling_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logging_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "channel" VARCHAR(22),
    "events" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logging_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "minecraft_settings" (
    "guild_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 25565,
    "notify_enabled" BOOLEAN NOT NULL DEFAULT false,
    "channel" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "minecraft_settings_pkey" PRIMARY KEY ("guild_id")
);

-- CreateTable
CREATE TABLE "picture_contest_item" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'New Contest',
    "contest_channel" TEXT NOT NULL,
    "announce_channel" TEXT NOT NULL,
    "vote_emoji" TEXT NOT NULL DEFAULT '?',
    "vote_type" TEXT NOT NULL DEFAULT 'highest',
    "required_votes" INTEGER,
    "schedule" TEXT NOT NULL DEFAULT 'end_month',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "picture_contest_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "picture_contest_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "picture_contest_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "premium_guild" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "premium" BOOLEAN NOT NULL DEFAULT false,
    "trial_ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "premium_guild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "channel" VARCHAR(22),
    "channel_conf" VARCHAR(22),
    "enabled" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twitch_watcher" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "channel" VARCHAR(22) NOT NULL,
    "users" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "twitch_watcher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_action" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "welcome_message_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "messages" JSONB,
    "channel" VARCHAR(22),
    "enabled" INTEGER NOT NULL,
    "randomize" BOOLEAN NOT NULL DEFAULT false,
    "delete_message" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "welcome_message_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "welcome_messages_sended" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "message_io" TEXT NOT NULL,

    CONSTRAINT "welcome_messages_sended_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "youtube_watcher" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "channel" VARCHAR(22) NOT NULL,
    "users" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "youtube_watcher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leveling_data" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leveling_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leveling" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leveling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "giveaway" (
    "id" SERIAL NOT NULL,
    "winners" INTEGER NOT NULL,
    "prize" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "extra_rules" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "message_id" TEXT,

    CONSTRAINT "giveaway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "giveaway_participant" (
    "winner" BOOLEAN NOT NULL DEFAULT false,
    "giveaway_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "giveaway_participant_pkey" PRIMARY KEY ("giveaway_id","user_id")
);

-- CreateTable
CREATE TABLE "account" (
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "provider_account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "image" TEXT,
    "email_verified" TIMESTAMP(3),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_token" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "streak" (
    "id" SERIAL NOT NULL,
    "streak" INTEGER NOT NULL,
    "user_id" VARCHAR(22) NOT NULL,
    "last_active" TIMESTAMP(3) NOT NULL,
    "guild_id" VARCHAR(22),

    CONSTRAINT "streak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "streak_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "channel" VARCHAR(22) NOT NULL,
    "role" VARCHAR(22),
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "streak_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boost_spotlight_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "messages" JSONB,
    "channel" VARCHAR(22),
    "enabled" BOOLEAN NOT NULL,
    "randomize" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boost_spotlight_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder" (
    "id" SERIAL NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guild_id" VARCHAR(32),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "remind_at" TIMESTAMP(3) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "channel_id" VARCHAR(32) NOT NULL,

    CONSTRAINT "reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_keeper_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_keeper_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_anniversary_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "message_type" VARCHAR(7) NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "embed" JSON DEFAULT '{}',
    "channel" VARCHAR(22),
    "enabled" BOOLEAN NOT NULL,
    "randomize" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "time" VARCHAR(5) NOT NULL,

    CONSTRAINT "server_anniversary_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_glue" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "message" TEXT NOT NULL,
    "channel" VARCHAR(22) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_glue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_backup_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "channel" VARCHAR(22) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "frequency" VARCHAR(10) NOT NULL,
    "time" VARCHAR(5) NOT NULL,
    "content" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_backup_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_backups" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "backup" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_backups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_report_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "channel" VARCHAR(22) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_report_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reports" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "user_id" VARCHAR(22) NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mod_link_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "channel" VARCHAR(22),
    "synced_guilds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "actions_to_sync" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mod_link_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bumps" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "user_id" VARCHAR(22) NOT NULL,
    "bumped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bumps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_api_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "api_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guild_api_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donations_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "currency" VARCHAR(4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "donations_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donations_goals" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "message_id" VARCHAR(22) NOT NULL,
    "author_id" VARCHAR(22) NOT NULL,
    "channel_id" VARCHAR(22) NOT NULL,
    "title" VARCHAR(30) NOT NULL,
    "description" VARCHAR(120) NOT NULL,
    "goal_amount" INTEGER NOT NULL,
    "stop_on_goal" BOOLEAN NOT NULL DEFAULT true,
    "notify_channel" VARCHAR(22) NOT NULL,
    "mention_role" VARCHAR(22),

    CONSTRAINT "donations_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donations" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "author_id" VARCHAR(22) NOT NULL,
    "goal_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_stats_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "server_stats_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_stats" (
    "id" SERIAL NOT NULL,
    "guild_id" TEXT NOT NULL,
    "member_count_channel_id" VARCHAR(22),
    "boost_count_channel_id" VARCHAR(22),
    "bot_count_channel_id" VARCHAR(22),
    "online_member_count_channel_id" VARCHAR(22),
    "channel_count_channel_id" VARCHAR(22),
    "roles_count_channel_id" VARCHAR(22),

    CONSTRAINT "server_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_kick_settings" (
    "id" SERIAL NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "guild_id" TEXT NOT NULL,
    "channel" VARCHAR(22) NOT NULL,
    "role" VARCHAR(22) NOT NULL,

    CONSTRAINT "role_kick_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "anti_bot_settings_guild_id_key" ON "anti_bot_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "auto_role_settings_guild_id_key" ON "auto_role_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "birthday_settings_guild_id_unique" ON "birthday_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "bot_settings_guild_id_unique" ON "bot_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "bump_reminder_settings_guild_id_key" ON "bump_reminder_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_of_fame_guild_id_key" ON "channel_of_fame"("guild_id");

-- CreateIndex
CREATE INDEX "dashboard_log_guild_id_idx" ON "dashboard_log"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "giveaway_settings_guild_id_key" ON "giveaway_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "guild_invite_settings_guild_id_key" ON "guild_invite_settings"("guild_id");

-- CreateIndex
CREATE INDEX "guild_log_guild_id_idx" ON "guild_log"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "invite_tracker_invite_invite_code_key" ON "invite_tracker_invite"("invite_code");

-- CreateIndex
CREATE INDEX "invite_tracker_invite_guild_id_idx" ON "invite_tracker_invite"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "guild_id_kick" ON "kick_watcher"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "leave_message_settings_guild_id_unique" ON "leave_message_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "leveling_settings_guild_id_key" ON "leveling_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "logging_settings_guild_id_key" ON "logging_settings"("guild_id");

-- CreateIndex
CREATE INDEX "picture_contest_item_guild_id_idx" ON "picture_contest_item"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "picture_contest_settings_guild_id_key" ON "picture_contest_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "premium_guild_guild_id_key" ON "premium_guild"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_settings_guild_id_unique" ON "ticket_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "twitch_watcher_guild_id_unique" ON "twitch_watcher"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "welcome_message_settings_guild_id_unique" ON "welcome_message_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "youtube_watcher_guild_id_unique" ON "youtube_watcher"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "leveling_data_guild_id_user_id_key" ON "leveling_data"("guild_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "leveling_guild_id_user_id_key" ON "leveling"("guild_id", "user_id");

-- CreateIndex
CREATE INDEX "giveaway_guild_id_idx" ON "giveaway"("guild_id");

-- CreateIndex
CREATE INDEX "Account_userId_fkey" ON "account"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_provider_provider_account_id_key" ON "account"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_session_token_key" ON "session"("session_token");

-- CreateIndex
CREATE INDEX "Session_userId_fkey" ON "session"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "verification_token_token_key" ON "verification_token"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_token_identifier_token_key" ON "verification_token"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "streak_user_id_guild_id_key" ON "streak"("user_id", "guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "streak_settings_guild_id_key" ON "streak_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "boost_spotlight_settings_guild_id_unique" ON "boost_spotlight_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "time_keeper_settings_guild_id_unique" ON "time_keeper_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "server_anniversary_settings_guild_id_unique" ON "server_anniversary_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "server_backup_settings_guild_id_key" ON "server_backup_settings"("guild_id");

-- CreateIndex
CREATE INDEX "ServerBackups_guildId_fkey" ON "server_backups"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_report_settings_guild_id_key" ON "message_report_settings"("guild_id");

-- CreateIndex
CREATE INDEX "message_reports_guild_id_user_id_idx" ON "message_reports"("guild_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mod_link_settings_guild_id_key" ON "mod_link_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "guild_api_settings_guild_id_key" ON "guild_api_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "donations_settings_guild_id_key" ON "donations_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "server_stats_settings_guild_id_key" ON "server_stats_settings"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "server_stats_guild_id_key" ON "server_stats"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_kick_settings_guild_id_key" ON "role_kick_settings"("guild_id");

-- AddForeignKey
ALTER TABLE "invite_tracker_invite" ADD CONSTRAINT "invite_tracker_invite_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guild_invite_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "picture_contest_item" ADD CONSTRAINT "picture_contest_item_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "picture_contest_settings"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "giveaway_participant" ADD CONSTRAINT "giveaway_participant_giveaway_id_fkey" FOREIGN KEY ("giveaway_id") REFERENCES "giveaway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_backups" ADD CONSTRAINT "server_backups_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "server_backup_settings"("guild_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "donations_goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
