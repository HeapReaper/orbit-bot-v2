import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { handleKick } from '../../services/modLink';

export default defineEvent({
  name: Events.GuildMemberRemove,
  async execute(member) {
    await handleKick(member);
  },
});
