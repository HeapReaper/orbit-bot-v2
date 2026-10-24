import { Events, GuildChannel } from 'discord.js';
import { defineEvent } from '../../types';
import { channelDeleted } from '../../services/guildLogger';

export default defineEvent({
  name: Events.ChannelDelete,
  async execute(channel) {
    if (channel instanceof GuildChannel) await channelDeleted(channel);
  },
});
