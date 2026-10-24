import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { handleMemberUpdate } from '../../services/moderationFilters';

export default defineEvent({
  name: Events.GuildMemberUpdate,
  async execute(previous, updated) {
    await handleMemberUpdate(previous, updated);
  },
});
