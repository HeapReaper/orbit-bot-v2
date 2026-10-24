import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { handlePunishment, runModerationCommand } from '../../services/moderationCommands';

export default {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member')
    .addUserOption((option) =>
      option.setName('member').setDescription('The member to ban').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Why the member is banned')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    await runModerationCommand(interaction, PermissionFlagsBits.BanMembers, handlePunishment);
  },
} satisfies Command;
