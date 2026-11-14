import { Events, type Message } from 'discord.js';
import { defineEvent } from '../../types';
import { messageUpdate, snapshotMessage } from '../../services/guildLogger';

export default defineEvent({
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    await messageUpdate(oldMessage, newMessage as Message);
    // Keep the delete-log snapshot in sync with the edited content
    if (!newMessage.partial) await snapshotMessage(newMessage as Message);
  },
});
