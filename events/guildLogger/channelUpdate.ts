import { Events, GuildChannel } from 'discord.js';
import { defineEvent } from '../../types';
import { channelUpdated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.ChannelUpdate,
  async execute(oldChannel, newChannel) {
    if (oldChannel instanceof GuildChannel && newChannel instanceof GuildChannel) {
      await channelUpdated(oldChannel, newChannel);
    }
  },
});
