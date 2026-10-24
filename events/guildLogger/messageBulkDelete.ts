import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { messagesBulkDelete } from '../../services/guildLogger';

export default defineEvent({
  name: Events.MessageBulkDelete,
  async execute(messages) {
    await messagesBulkDelete(messages);
  },
});
