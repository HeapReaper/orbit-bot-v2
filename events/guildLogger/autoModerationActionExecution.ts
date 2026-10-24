import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { autoModerationTriggered } from '../../services/guildLogger';

export default defineEvent({
  name: Events.AutoModerationActionExecution,
  async execute(execution) {
    await autoModerationTriggered(execution);
  },
});
