import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { threadMemberChange } from '../../services/guildLogger';

export default defineEvent({
  name: Events.ThreadMemberUpdate,
  async execute(oldMember, newMember) {
    await threadMemberChange(oldMember, newMember);
  },
});
