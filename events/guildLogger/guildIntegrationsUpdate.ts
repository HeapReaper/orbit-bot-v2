import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { guildIntegrationsUpdated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildIntegrationsUpdate,
  async execute(guild) {
    await guildIntegrationsUpdated(guild);
  },
});
