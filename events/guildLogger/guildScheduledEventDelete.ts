import { Events, type GuildScheduledEvent } from 'discord.js';
import { defineEvent } from '../../types';
import { guildScheduledEventDeleted } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildScheduledEventDelete,
  async execute(event) {
    if (event.guild) await guildScheduledEventDeleted(event as GuildScheduledEvent);
  },
});
