import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { memberLeft } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildMemberRemove,
  async execute(member) {
    await memberLeft(member);
  },
});
