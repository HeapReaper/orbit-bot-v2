import { type ColorResolvable, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

export default {
  data: new SlashCommandBuilder()
    .setName('counting')
    .setDescription('Counting game')
    .addSubcommand((add) =>
      add
        .setName('stats')
        .setDescription('See the counting game stats')
        .addUserOption((option) =>
          option.setName('user').setDescription('The user to see the stats for').setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!interaction.guild) return;
    if (interaction.options.getSubcommand(false) !== 'stats') return;

    const guildId = interaction.guild.id;
    const guildSettings = await getGuildSettings(guildId);

    const gameSettings = await prisma.countingGameSettings.findUnique({
      where: { guildId },
    });

    if (!gameSettings) {
      await interaction.reply({
        content: t(guildSettings?.language, 'not_configured'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!gameSettings.enabled) {
      await interaction.reply({
        content: t(guildSettings?.language, 'not_enabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetUser = interaction.options.getUser('user') ?? interaction.user;

    const userStats = await prisma.countingUserStats.findUnique({
      where: { guildId_userId: { guildId, userId: targetUser.id } },
    });

    const embed = new EmbedBuilder()
      .setTitle(t(guildSettings?.language, 'counting_stats_title'))
      .setColor((guildSettings?.primaryColor as ColorResolvable) ?? '#2F3136')
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        {
          name: t(guildSettings?.language, 'counting_current_count'),
          value: `${gameSettings.currentCount}`,
          inline: true,
        },
        {
          name: t(guildSettings?.language, 'counting_high_score'),
          value: `${gameSettings.highScore}`,
          inline: true,
        },
        {
          name: t(guildSettings?.language, 'counting_last_counter'),
          value: gameSettings.lastUserId
            ? `<@${gameSettings.lastUserId}>`
            : t(guildSettings?.language, 'none'),
          inline: true,
        },
        {
          name: t(guildSettings?.language, 'counting_correct_counts'),
          value: `${userStats?.correctCounts ?? 0}`,
          inline: true,
        },
        {
          name: t(guildSettings?.language, 'counting_failed_counts'),
          value: `${userStats?.failCounts ?? 0}`,
          inline: true,
        },
        {
          name: t(guildSettings?.language, 'counting_highest_number'),
          value: `${userStats?.highestNumber ?? 0}`,
          inline: true,
        }
      )
      .setFooter({
        text: t(guildSettings?.language, 'counting_stats_footer', { user: targetUser.username }),
      });

    await interaction.reply({ embeds: [embed] });
  },
} satisfies Command;
