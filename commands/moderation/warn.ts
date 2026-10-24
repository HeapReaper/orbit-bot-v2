import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { handlePunishment, runModerationCommand } from '../../services/moderationCommands';

export default {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member')
    .addUserOption((option) =>
      option.setName('member').setDescription('The member to warn').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Why the member is warned').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    await runModerationCommand(interaction, PermissionFlagsBits.ModerateMembers, handlePunishment);
  },
} satisfies Command;
