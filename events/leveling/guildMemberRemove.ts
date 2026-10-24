import { Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { defineEvent } from '../../types';
import { prisma } from '../../lib/prisma';
import { Logging } from '../../lib/logging';

async function handleMemberRemove(member: GuildMember | PartialGuildMember) {
  try {
    const levelingSettings = await prisma.levelingSettings.findFirst({
      where: { guildId: member.guild.id },
    });

    if (!levelingSettings || !levelingSettings.enabled) return;
    if (levelingSettings.deleteXpOnLeave !== true) return;

    // deleteMany rather than delete: a member who never earned XP has no row,
    // and delete() throws on a missing record.
    await prisma.leveling.deleteMany({
      where: { guildId: member.guild.id, userId: member.id },
    });
  } catch (error) {
    Logging.error(`Error in [handleMemberRemove]: ${error}`);
  }
}

/** Deletes a leaving member's XP when the guild has that turned on. */
export default defineEvent({
  name: Events.GuildMemberRemove,
  async execute(member) {
    await handleMemberRemove(member);
  },
});
