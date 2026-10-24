import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { handleWarnings, runModerationCommand } from '../../services/moderationCommands';

export default {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Show the active warnings of a member')
    .addUserOption((option) =>
      option.setName('member').setDescription('The member to look up').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    await runModerationCommand(interaction, PermissionFlagsBits.ModerateMembers, handleWarnings);
  },
} satisfies Command;
