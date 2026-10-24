-- AlterTable
ALTER TABLE "number_guesser_game" ADD COLUMN     "cooldown_seconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "description" TEXT;

-- CreateTable
CREATE TABLE "chess_link" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(22) NOT NULL,
    "chess_username" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chess_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chess_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chess_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chess_link_user_id_key" ON "chess_link"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "chess_settings_guild_id_unique" ON "chess_settings"("guild_id");
