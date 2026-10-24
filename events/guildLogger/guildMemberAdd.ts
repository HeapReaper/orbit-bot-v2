import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { memberJoined } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildMemberAdd,
  async execute(member) {
    await memberJoined(member);
  },
});
