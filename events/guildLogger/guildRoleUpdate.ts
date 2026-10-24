import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { roleUpdated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildRoleUpdate,
  async execute(oldRole, newRole) {
    await roleUpdated(oldRole, newRole);
  },
});
