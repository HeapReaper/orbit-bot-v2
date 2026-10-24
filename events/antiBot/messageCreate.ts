import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { handleMessage } from '../../services/antiBot';

export default defineEvent({
  name: Events.MessageCreate,
  async execute(message) {
    await handleMessage(message);
  },
});
