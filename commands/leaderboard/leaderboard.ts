import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { sendPaginatedLeaderboard } from '../../lib/leaderboard';
import { t } from '../../lib/i18n';
import { handleChessLeaderboard } from '../../services/chess';

async function bumpLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildSettings = await getGuildSettings(interaction.guild!.id);

  const bumps = await prisma.bumps.groupBy({
    by: ['userId'],
    where: { guildId: interaction.guild!.id },
    _count: { userId: true },
    orderBy: { _count: { userId: 'desc' } },
  });

  await sendPaginatedLeaderboard(interaction, {
    title: t(guildSettings?.language, 'bump_leaderboard_title'),
    language: guildSettings?.language,
    color: guildSettings?.primaryColor,
    entries: bumps.map((bump) => ({
      userId: bump.userId,
      value: t(guildSettings?.language, 'bump_bumps_field', {
        count: bump._count.userId.toString(),
      }),
    })),
  });
}

async function dhBumpLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildSettings = await getGuildSettings(interaction.guild!.id);

  const bumps = await prisma.dhBumps.groupBy({
    by: ['userId'],
    where: { guildId: interaction.guild!.id, userId: { not: null } },
    _count: { userId: true },
    orderBy: { _count: { userId: 'desc' } },
  });

  await sendPaginatedLeaderboard(interaction, {
    title: t(guildSettings?.language, 'dh_bump_leaderboard_title'),
    language: guildSettings?.language,
    color: guildSettings?.primaryColor,
    entries: bumps.map((bump) => ({
      userId: bump.userId as string,
      value: t(guildSettings?.language, 'bump_bumps_field', {
        count: bump._count.userId.toString(),
      }),
    })),
  });
}

async function levelingLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildSettings = await getGuildSettings(interaction.guild!.id);

  const leveling = await prisma.leveling.findMany({
    where: { guildId: interaction.guild!.id },
    orderBy: [{ level: 'desc' }, { xp: 'desc' }],
  });

  await sendPaginatedLeaderboard(interaction, {
    title: t(guildSettings?.language, 'leveling_leaderboard_title'),
    language: guildSettings?.language,
    color: guildSettings?.primaryColor,
    entries: leveling.map((user) => ({
      userId: user.userId,
      value: t(guildSettings?.language, 'leveling_level_xp_field', {
        level: user.level.toString(),
        xp: user.xp.toString(),
      }),
    })),
  });
}

async function streaksLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildSettings = await getGuildSettings(interaction.guild!.id);

  const streaks = await prisma.streak.findMany({
    where: {
      guildId: interaction.guild!.id,
      streak: { gt: 1 },
    },
    orderBy: [{ streak: 'desc' }],
  });

  await sendPaginatedLeaderboard(interaction, {
    title: t(guildSettings?.language, 'streaks_leaderboard_title'),
    language: guildSettings?.language,
    color: guildSettings?.primaryColor,
    entries: streaks.map((user) => ({
      userId: user.userId,
      value: t(guildSettings?.language, 'streaks_days_field', { days: user.streak.toString() }),
    })),
  });
}

async function countingLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildSettings = await getGuildSettings(interaction.guild!.id);

  const stats = await prisma.countingUserStats.findMany({
    where: {
      guildId: interaction.guild!.id,
      correctCounts: { gt: 0 },
    },
    orderBy: [{ correctCounts: 'desc' }],
  });

  await sendPaginatedLeaderboard(interaction, {
    title: t(guildSettings?.language, 'counting_leaderboard_title'),
    language: guildSettings?.language,
    color: guildSettings?.primaryColor,
    entries: stats.map((user) => ({
      userId: user.userId,
      value: t(guildSettings?.language, 'counting_counts_field', {
        count: user.correctCounts.toString(),
      }),
    })),
  });
}

/** In v1 every module listened for its own /leaderboard subcommand. */
const HANDLERS: Record<string, (interaction: ChatInputCommandInteraction) => Promise<void>> = {
  bump: bumpLeaderboard,
  'dh-bump': dhBumpLeaderboard,
  leveling: levelingLeaderboard,
  streaks: streaksLeaderboard,
  counting: countingLeaderboard,
  chess: handleChessLeaderboard,
};

export default {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Get the bump leaderboard!')
    .addSubcommand((add) => add.setName('bump').setDescription('See the bump leaderboard!'))
    .addSubcommand((add) =>
      add.setName('dh-bump').setDescription('See the DiscordHome bump leaderboard!')
    )
    .addSubcommand((add) => add.setName('leveling').setDescription('See the leveling leaderboard!'))
    .addSubcommand((add) => add.setName('streaks').setDescription('See the streaks leaderboard!'))
    .addSubcommand((add) =>
      add.setName('counting').setDescription('See the counting game leaderboard!')
    )
    .addSubcommand((add) =>
      add
        .setName('chess')
        .setDescription('See the chess leaderboard!')
        .addStringOption((option) =>
          option
            .setName('type')
            .setDescription('Which time control to rank by')
            .setRequired(false)
            .addChoices(
              { name: 'Rapid', value: 'rapid' },
              { name: 'Blitz', value: 'blitz' },
              { name: 'Bullet', value: 'bullet' }
            )
        )
    ),

  async execute(interaction) {
    if (!interaction.guild) return;

    const handler = HANDLERS[interaction.options.getSubcommand(false) ?? ''];
    if (handler) await handler(interaction);
  },
} satisfies Command;
