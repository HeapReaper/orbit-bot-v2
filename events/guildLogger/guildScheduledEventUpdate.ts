import { Events, type GuildScheduledEvent } from 'discord.js';
import { defineEvent } from '../../types';
import { guildScheduledEventUpdated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildScheduledEventUpdate,
  async execute(oldEvent, newEvent) {
    if (oldEvent?.guild && newEvent.guild) {
      await guildScheduledEventUpdated(
        oldEvent as GuildScheduledEvent,
        newEvent as GuildScheduledEvent
      );
    }
  },
});
