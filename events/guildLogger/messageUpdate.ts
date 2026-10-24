import { Events, type Message } from 'discord.js';
import { defineEvent } from '../../types';
import { messageUpdate } from '../../services/guildLogger';

export default defineEvent({
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    await messageUpdate(oldMessage, newMessage as Message);
  },
});
