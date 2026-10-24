import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import { handleLink, handleProfile, handleStats, handleUnlink } from '../../services/lichess';

export default {
  data: new SlashCommandBuilder()
    .setName('lichess')
    .setDescription('Lichess integration')
    .addSubcommand((sub) =>
      sub
        .setName('link')
        .setDescription('Link your Lichess account to your Discord account')
        .addStringOption((opt) =>
          opt.setName('username').setDescription('Your Lichess username').setRequired(true)
        )
    )
    .addSubcommand((sub) => sub.setName('unlink').setDescription('Unlink your Lichess account'))
    .addSubcommand((sub) =>
      sub
        .setName('profile')
        .setDescription('View a Lichess profile')
        .addStringOption((opt) =>
          opt
            .setName('username')
            .setDescription('Lichess username (defaults to your linked account)')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('stats')
        .setDescription('View Lichess statistics')
        .addStringOption((opt) =>
          opt
            .setName('username')
            .setDescription('Lichess username (defaults to your linked account)')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!interaction.guild?.id) return;

    const guildSettings = await getGuildSettings(interaction.guild.id);

    const lichessSettings = await prisma.lichessSettings.findUnique({
      where: { guildId: interaction.guild.id },
    });

    if (!lichessSettings) {
      await interaction.reply({
        content: t(guildSettings?.language, 'not_configured'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!lichessSettings.enabled) {
      await interaction.reply({
        content: t(guildSettings?.language, 'not_enabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    switch (interaction.options.getSubcommand(false)) {
      case 'link':
        return handleLink(interaction);
      case 'unlink':
        return handleUnlink(interaction);
      case 'profile':
        return handleProfile(interaction);
      case 'stats':
        return handleStats(interaction);
    }
  },
} satisfies Command;
