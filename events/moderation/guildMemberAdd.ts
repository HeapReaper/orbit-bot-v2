import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { handleMemberJoin } from '../../services/moderationFilters';

export default defineEvent({
  name: Events.GuildMemberAdd,
  async execute(member) {
    await handleMemberJoin(member);
  },
});
