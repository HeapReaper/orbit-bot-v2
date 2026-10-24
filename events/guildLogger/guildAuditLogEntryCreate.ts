import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { onAuditLogEntryCreate } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildAuditLogEntryCreate,
  async execute(entry, guild) {
    await onAuditLogEntryCreate(entry, guild);
  },
});
