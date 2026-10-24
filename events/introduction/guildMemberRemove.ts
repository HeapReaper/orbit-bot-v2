import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { handleIntroDelete } from '../../services/introduction';

export default defineEvent({
  name: Events.GuildMemberRemove,
  async execute(member) {
    await handleIntroDelete(member);
  },
});
