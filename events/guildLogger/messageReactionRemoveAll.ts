import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { reactionsCleared } from '../../services/guildLogger';

export default defineEvent({
  name: Events.MessageReactionRemoveAll,
  async execute(message) {
    await reactionsCleared(message);
  },
});
