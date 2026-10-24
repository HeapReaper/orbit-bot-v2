import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { handleUnmute, runModerationCommand } from '../../services/moderationCommands';

export default {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Unmute a member')
    .addUserOption((option) =>
      option.setName('member').setDescription('The member to unmute').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    await runModerationCommand(interaction, PermissionFlagsBits.ModerateMembers, handleUnmute);
  },
} satisfies Command;
