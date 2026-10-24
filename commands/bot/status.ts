import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types';
import { handleStatus } from '../../services/botStatus';

export default {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('See the status of this bot and the dashboard'),

  async execute(interaction) {
    if (!interaction.guild) return;
    await handleStatus(interaction);
  },
} satisfies Command;
