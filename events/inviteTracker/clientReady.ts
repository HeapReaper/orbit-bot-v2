import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { Logging } from '../../lib/logging';
import { cacheAllInvites } from '../../services/inviteTracker';

/** Snapshots every invite on startup, so the first join can be attributed. */
export default defineEvent({
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    Logging.info('InviteTracker: caching invites...');
    await cacheAllInvites(client);
  },
});
