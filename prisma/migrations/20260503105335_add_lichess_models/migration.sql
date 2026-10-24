-- CreateTable
CREATE TABLE "lichess_link" (
    "id" SERIAL NOT NULL,
    "user_id" VARCHAR(22) NOT NULL,
    "lichess_username" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lichess_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lichess_settings" (
    "id" SERIAL NOT NULL,
    "guild_id" VARCHAR(22) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lichess_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lichess_link_user_id_key" ON "lichess_link"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "lichess_settings_guild_id_unique" ON "lichess_settings"("guild_id");
