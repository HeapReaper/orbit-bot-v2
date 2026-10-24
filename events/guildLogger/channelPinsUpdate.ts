import { Events, GuildChannel } from 'discord.js';
import { defineEvent } from '../../types';
import { channelPinsUpdated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.ChannelPinsUpdate,
  async execute(channel, time) {
    if (channel instanceof GuildChannel) await channelPinsUpdated(channel, time.getTime());
  },
});
