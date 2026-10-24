import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { guildUpdated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildUpdate,
  async execute(oldGuild, newGuild) {
    await guildUpdated(oldGuild, newGuild);
  },
});
