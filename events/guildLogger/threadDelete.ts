import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { threadDeleted } from '../../services/guildLogger';

export default defineEvent({
  name: Events.ThreadDelete,
  async execute(thread) {
    await threadDeleted(thread);
  },
});
