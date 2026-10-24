-- CreateTable
CREATE TABLE "number_guesser_game" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "channel_id" VARCHAR(22) NOT NULL,
    "min_number" INTEGER NOT NULL DEFAULT 1,
    "max_number" INTEGER NOT NULL DEFAULT 100,
    "secret_number" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "winner_id" VARCHAR(22),
    "guess_count" INTEGER NOT NULL DEFAULT 0,
    "message_id" VARCHAR(22),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "number_guesser_game_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "number_guesser_game_guild_id_channel_id_idx" ON "number_guesser_game"("guild_id", "channel_id");