import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { handleIntroCreate } from '../../services/introduction';

export default defineEvent({
  name: Events.MessageCreate,
  async execute(message) {
    await handleIntroCreate(message);
  },
});
