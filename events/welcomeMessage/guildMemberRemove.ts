import { Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { defineEvent } from '../../types';
import { prisma } from '../../lib/prisma';
import { GuildLogger } from '../../lib/guildLog';
import { Logging } from '../../lib/logging';

async function memberRemove(member: GuildMember | PartialGuildMember) {
  // Fetch welcome message settings
  const settings = await prisma.welcomeMessageSettings.findFirst({
    where: {
      guildId: member.guild.id,
    },
  });

  // If no settings or deleteMessage disabled → stop
  if (!settings || !settings.deleteMessage) return;

  // Fetch stored welcome message info
  const messageInfo = await prisma.welcomeMessagesSended.findFirst({
    where: {
      guildId: member.guild.id,
      userId: member.user.id,
    },
  });

  if (!messageInfo) return;

  try {
    // Fetch channel
    const channel = await member.client.channels.fetch(messageInfo.channelId);

    if (!channel || !channel.isTextBased()) {
      GuildLogger.error(member.guild.id, 'Welcome message channel could not be found.');
      return;
    }

    // Fetch the message
    const message = await channel.messages.fetch(messageInfo.messageId);

    if (!message) return;

    // Delete the message
    await message.delete();

    // Remove record from DB
    await prisma.welcomeMessagesSended.delete({
      where: { id: messageInfo.id },
    });
  } catch (error) {
    Logging.error(`WelcomeMessage: failed to delete welcome message: ${error}`);
  }
}

/**
 * Removes the welcome message of a member that left, when the guild has that
 * turned on. v1 re-fetched the member first, which always fails for someone
 * who just left, so the cleanup never ran; only the ids are needed here.
 */
export default defineEvent({
  name: Events.GuildMemberRemove,
  async execute(member) {
    await memberRemove(member);
  },
});
