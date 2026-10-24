import { Events } from 'discord.js';
import { defineEvent } from '../../types';
import { prisma } from '../../lib/prisma';
import { Logging } from '../../lib/logging';

/** Hands every new member the roles configured on the dashboard. */
export default defineEvent({
  name: Events.GuildMemberAdd,
  async execute(member) {
    const res = await prisma.autoRoleSettings.findUnique({
      where: { guildId: member.guild.id },
    });

    if (!res || res.enabled !== true) return;

    if (!res?.autoRoles || !Array.isArray(res.autoRoles)) return;

    for (const role of res.autoRoles as string[]) {
      try {
        await member.roles.add(role);
        Logging.trace(`Automatically added role`);
      } catch (error) {
        Logging.error(`Error adding role in AutoRole ${role}: ${error}`);
      }
    }
  },
});
