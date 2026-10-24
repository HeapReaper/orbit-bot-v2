import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { roleCreated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildRoleCreate,
  async execute(role) {
    await roleCreated(role);
  },
});
