import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { prisma } from '../../lib/prisma';
import { getGuildSettings } from '../../lib/guildSettings';
import { t } from '../../lib/i18n';
import { create, deleteGiveaway, list, reroll } from '../../services/giveaway';

export default {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Commands for the giveaway system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a giveaway')
        .addIntegerOption((option) =>
          option
            .setName('day')
            .setDescription('On which day does the giveaway end?')
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName('month')
            .setDescription('In which month does the giveaway end?')
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName('year')
            .setDescription('In which year does the giveaway end?')
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('time')
            .setDescription('At what time does the giveaway end? (e.g., 16:24)')
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName('number_of_winners')
            .setDescription('How many winners are there?')
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('prize')
            .setDescription('What is the prize of this giveaway?')
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('extra_requirements')
            .setDescription('Extra requirements for participation')
            .setRequired(true)
        )
        .addBooleanOption((option) =>
          option.setName('mention_everyone').setDescription('Ping @everyone').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete a giveaway')
        .addStringOption((option) =>
          option.setName('id').setDescription('Enter the giveaway ID').setRequired(true)
        )
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('View all ongoing giveaways'))
    .addSubcommand((sub) =>
      sub
        .setName('reroll')
        .setDescription('Choose a new winner')
        .addStringOption((option) =>
          option.setName('id').setDescription('Enter the giveaway ID').setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!interaction.guild) return;

    const subCommandName = interaction.options.getSubcommand(true);

    const guildSettings = await getGuildSettings(interaction.guild.id);

    const giveawaySettings = await prisma.giveawaySettings.findUnique({
      where: { guildId: interaction.guild.id },
    });

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content: t(guildSettings?.language, 'missing_permissions'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!giveawaySettings || !giveawaySettings.enabled) {
      await interaction.reply({
        content: t(guildSettings?.language, 'not_configured'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    switch (subCommandName) {
      case 'create':
        return create(interaction, giveawaySettings, guildSettings);
      case 'delete':
        return deleteGiveaway(interaction, giveawaySettings, guildSettings);
      case 'reroll':
        return reroll(interaction, giveawaySettings, guildSettings);
      case 'list':
        return list(interaction, giveawaySettings, guildSettings);
    }
  },
} satisfies Command;
