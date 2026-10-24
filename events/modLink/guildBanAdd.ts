import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { handleBan } from '../../services/modLink';

export default defineEvent({
  name: Events.GuildBanAdd,
  async execute(ban) {
    await handleBan(ban);
  },
});
