import { type ColorResolvable, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';

export default {
  data: new SlashCommandBuilder()
    .setName('leveling')
    .setDescription('Leveling your server')
    .addSubcommand((add) =>
      add.setName('level').setDescription('See current level and how much you need to level up')
    ),

  async execute(interaction) {
    if (!interaction.guild) return;
    if (interaction.options.getSubcommand(false) !== 'level') return;

    const guildSettings = await getGuildSettings(interaction.guild.id);

    const levelingSettings = await prisma.levelingSettings.findFirst({
      where: { guildId: interaction.guild.id },
    });

    if (!levelingSettings || !levelingSettings.enabled) {
      await interaction.reply({
        content: t(guildSettings?.language, 'leveling_not_enabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const userData = await prisma.leveling.findFirst({
      where: { guildId: interaction.guild.id, userId: interaction.user.id },
    });

    const currentXp = userData?.xp ?? 0;
    const currentLevel = userData?.level ?? 0;

    // Calculate XP needed for the next level
    const xpForNextLevel = Math.ceil(
      8.196 * Math.pow(currentLevel + 1, levelingSettings.curveExponent) + 200
    );
    const xpNeeded = Math.max(0, xpForNextLevel - currentXp);

    // Progress bar (10 blocks)
    const progressPercent = xpForNextLevel > 0 ? Math.min(currentXp / xpForNextLevel, 1) : 1;
    const filled = Math.max(0, Math.min(10, Math.round(progressPercent * 10)));
    const progressBar = '█'.repeat(filled) + '░'.repeat(10 - filled);

    const embed = new EmbedBuilder()
      .setTitle(`${interaction.user.displayName}`)
      .setThumbnail(interaction.user.displayAvatarURL())
      .setColor((guildSettings?.primaryColor as ColorResolvable) ?? '#2F3136')
      .addFields(
        {
          name: t(guildSettings?.language, 'leveling_field_level'),
          value: `${currentLevel}`,
          inline: true,
        },
        {
          name: t(guildSettings?.language, 'leveling_field_xp'),
          value: `${currentXp}`,
          inline: true,
        },
        {
          name: t(guildSettings?.language, 'leveling_field_next_level'),
          value: `${currentLevel + 1}`,
          inline: true,
        },
        {
          name: `${t(guildSettings?.language, 'leveling_field_progress')}  ${progressBar}`,
          value: t(guildSettings?.language, 'leveling_progress_value', {
            current: currentXp.toString(),
            total: xpForNextLevel.toString(),
            needed: xpNeeded.toString(),
          }),
          inline: false,
        }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
} satisfies Command;
