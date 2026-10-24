import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { handleMute } from '../../services/modLink';

export default defineEvent({
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    await handleMute(oldMember, newMember);
  },
});
