import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import { handleLink, handleProfile, handleStats, handleUnlink } from '../../services/chess';

export default {
  data: new SlashCommandBuilder()
    .setName('chess')
    .setDescription('Chess.com integration')
    .addSubcommand((sub) =>
      sub
        .setName('link')
        .setDescription('Link your Chess.com account to your Discord account')
        .addStringOption((opt) =>
          opt.setName('username').setDescription('Your Chess.com username').setRequired(true)
        )
    )
    .addSubcommand((sub) => sub.setName('unlink').setDescription('Unlink your Chess.com account'))
    .addSubcommand((sub) =>
      sub
        .setName('profile')
        .setDescription('View a Chess.com profile')
        .addStringOption((opt) =>
          opt
            .setName('username')
            .setDescription('Chess.com username (defaults to your linked account)')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('stats')
        .setDescription('View Chess.com statistics')
        .addStringOption((opt) =>
          opt
            .setName('username')
            .setDescription('Chess.com username (defaults to your linked account)')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('puzzle')
        .setDescription('View Chess.com statistics')
        .addStringOption((opt) =>
          opt
            .setName('username')
            .setDescription('Chess.com username (defaults to your linked account)')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!interaction.guild?.id) return;

    const guildSettings = await getGuildSettings(interaction.guild.id);

    const chessSettings = await prisma.chessSettings.findUnique({
      where: { guildId: interaction.guild.id },
    });

    if (!chessSettings) {
      await interaction.reply({
        content: t(guildSettings?.language, 'not_configured'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!chessSettings.enabled) {
      await interaction.reply({
        content: t(guildSettings?.language, 'not_enabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // The "puzzle" subcommand is registered but was never implemented in v1
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
