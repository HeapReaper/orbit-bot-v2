import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { handleReaction } from '../../services/moderationFilters';

export default defineEvent({
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    await handleReaction(reaction, user);
  },
});
