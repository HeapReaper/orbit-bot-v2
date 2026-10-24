import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { handleMessageUpdate } from '../../services/moderationFilters';

export default defineEvent({
  name: Events.MessageUpdate,
  async execute(_old, updated) {
    await handleMessageUpdate(updated);
  },
});
