import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { threadUpdated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.ThreadUpdate,
  async execute(oldThread, newThread) {
    await threadUpdated(oldThread, newThread);
  },
});
