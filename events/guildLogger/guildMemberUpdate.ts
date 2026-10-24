import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { memberRoleChange, memberTimeout, memberUpdated } from '../../services/guildLogger';

export default defineEvent({
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    await memberUpdated(oldMember, newMember);
    await memberTimeout(oldMember, newMember);
    await memberRoleChange(oldMember, newMember);
  },
});
