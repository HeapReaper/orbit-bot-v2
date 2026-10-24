import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { handleUnban, runModerationCommand } from '../../services/moderationCommands';

export default {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user')
    .addStringOption((option) =>
      option.setName('user_id').setDescription('The ID of the user to unban').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Why the user is unbanned')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    await runModerationCommand(interaction, PermissionFlagsBits.BanMembers, handleUnban);
  },
} satisfies Command;
