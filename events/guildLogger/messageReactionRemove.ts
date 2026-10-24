import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { reactionRemove } from '../../services/guildLogger';

export default defineEvent({
  name: Events.MessageReactionRemove,
  async execute(reaction, user) {
    await reactionRemove(reaction, user);
  },
});
