import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { handleBumpMessage } from '../../services/bumper';

export default defineEvent({
  name: Events.MessageUpdate,
  async execute(_old, updated) {
    // The bump bot edits its reply in after the initial (sometimes still empty)
    // response, so the confirmation can arrive on either event.
    await handleBumpMessage(updated);
  },
});
