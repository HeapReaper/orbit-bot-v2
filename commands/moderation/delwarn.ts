import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { handleDeleteWarning, runModerationCommand } from '../../services/moderationCommands';

export default {
  data: new SlashCommandBuilder()
    .setName('delwarn')
    .setDescription('Remove a warning by its case number')
    .addIntegerOption((option) =>
      option
        .setName('case')
        .setDescription('Case number, visible in /warnings')
        .setMinValue(1)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    await runModerationCommand(
      interaction,
      PermissionFlagsBits.ModerateMembers,
      handleDeleteWarning
    );
  },
} satisfies Command;
