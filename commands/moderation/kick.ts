import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { handlePunishment, runModerationCommand } from '../../services/moderationCommands';

export default {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member')
    .addUserOption((option) =>
      option.setName('member').setDescription('The member to kick').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Why the member is kicked')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    await runModerationCommand(interaction, PermissionFlagsBits.KickMembers, handlePunishment);
  },
} satisfies Command;
