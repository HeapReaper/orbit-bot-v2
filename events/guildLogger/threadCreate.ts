import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { threadCreated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.ThreadCreate,
  async execute(thread) {
    await threadCreated(thread);
  },
});
