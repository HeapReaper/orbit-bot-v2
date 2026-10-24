import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { memberBanned } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildBanAdd,
  async execute(ban) {
    await memberBanned(ban);
  },
});
