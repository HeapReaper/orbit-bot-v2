import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { handleMessage } from '../../services/moderationFilters';

export default defineEvent({
  name: Events.MessageCreate,
  async execute(message) {
    await handleMessage(message);
  },
});
