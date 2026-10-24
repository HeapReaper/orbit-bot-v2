import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { roleDeleted } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildRoleDelete,
  async execute(role) {
    await roleDeleted(role);
  },
});
