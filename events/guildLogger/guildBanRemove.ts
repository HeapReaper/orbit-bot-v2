import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { memberUnbanned } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildBanRemove,
  async execute(ban) {
    await memberUnbanned(ban);
  },
});
