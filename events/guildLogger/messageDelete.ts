import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { messageDelete } from '../../services/guildLogger';

export default defineEvent({
  name: Events.MessageDelete,
  async execute(message) {
    await messageDelete(message);
  },
});
