import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { snapshotMessage } from '../../services/guildLogger';

// Keeps a snapshot of each message so deletions can be logged even when the
// message is no longer in discord.js' cache (e.g. after a restart).
export default defineEvent({
  name: Events.MessageCreate,
  async execute(message) {
    await snapshotMessage(message);
  },
});
