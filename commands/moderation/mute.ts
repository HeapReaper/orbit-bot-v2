import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { handlePunishment, runModerationCommand } from '../../services/moderationCommands';

export default {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute a member')
    .addUserOption((option) =>
      option.setName('member').setDescription('The member to mute').setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('minutes')
        .setDescription('Duration in minutes, leave empty for the configured default')
        .setMinValue(0)
        .setMaxValue(40320)
    )
    .addStringOption((option) => option.setName('reason').setDescription('Why the member is muted'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    await runModerationCommand(interaction, PermissionFlagsBits.ModerateMembers, handlePunishment);
  },
} satisfies Command;
