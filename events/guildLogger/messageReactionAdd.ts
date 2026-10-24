import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { reactionAdd } from '../../services/guildLogger';

export default defineEvent({
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    await reactionAdd(reaction, user);
  },
});
