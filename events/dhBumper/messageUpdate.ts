import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { handleDhBumpMessage } from '../../services/dhBumper';

export default defineEvent({
  name: Events.MessageUpdate,
  async execute(_old, updated) {
    // DH defers its /bump reply and edits the confirmation in afterwards, so it
    // can arrive on either event.
    await handleDhBumpMessage(updated);
  },
});
