import { Events, GuildChannel } from 'discord.js';
import { defineEvent } from '../../types';
import { channelCreated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.ChannelCreate,
  async execute(channel) {
    // These also fire for DM channels, which have no guild and no audit log
    if (channel instanceof GuildChannel) await channelCreated(channel);
  },
});
