import { ChannelType, Events } from 'discord.js';
import { defineEvent } from '../../types';
import { prisma } from '../../lib/prisma';
import { GuildLogger } from '../../lib/guildLog';

/** Thanks a member in the configured channel when they start boosting. */
export default defineEvent({
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    if (oldMember.partial) oldMember = await oldMember.fetch();

    const startedBoosting = !oldMember.premiumSince && newMember.premiumSince;
    if (!startedBoosting) return;

    const boostSettings = await prisma.boostSpotlightSettings.findUnique({
      where: { guildId: oldMember.guild.id },
    });

    if (!boostSettings) return;
    if (!boostSettings.enabled) return;
    if (!boostSettings.channel) return;

    const channel = await newMember.client.channels
      .fetch(boostSettings.channel as string)
      .catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return;

    const boostCount = newMember.guild.premiumSubscriptionCount;

    let messages: string[] = [];
    try {
      messages = Array.isArray(boostSettings.messages)
        ? (boostSettings.messages as string[])
        : JSON.parse(boostSettings.messages as unknown as string);
    } catch {
      GuildLogger.error(boostSettings.guildId, 'Could not parse boost messages array.');
      return;
    }

    if (messages.length === 0) return;

    const messageToSend = messages[Math.floor(Math.random() * messages.length)]!;

    const updatedMessage = messageToSend
      .replaceAll('{user}', `<@${newMember.user.id}>`)
      .replaceAll('{boostCount}', boostCount ? boostCount.toString() : '0');

    await channel.send({
      content: updatedMessage,
      allowedMentions: { users: [newMember.user.id] },
    });
  },
});
