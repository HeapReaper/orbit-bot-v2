import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { botCommandUsed } from '../../services/guildLogger';

export default defineEvent({
  name: Events.InteractionCreate,
  async execute(interaction) {
    await botCommandUsed(interaction);
  },
});
