import { Events, type GuildScheduledEvent } from 'discord.js';
import { defineEvent } from '../../types';
import { guildScheduledEventCreated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildScheduledEventCreate,
  async execute(event) {
    if (event.guild) await guildScheduledEventCreated(event as GuildScheduledEvent);
  },
});
