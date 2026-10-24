import { Events, type TextChannel } from 'discord.js';
import { defineEvent, type EmbedData } from '../../types';
import { GuildLogger } from '../../lib/guildLog';
import { prisma } from '../../lib/prisma';
import { sendEmbed } from '../../lib/sendEmbed';

/** Posts the configured leave message when a member leaves. */
export default defineEvent({
  name: Events.GuildMemberRemove,
  async execute(member) {
    const res = await prisma.leaveMessageSettings.findFirst({
      where: {
        guildId: member.guild.id,
        enabled: 1,
      },
    });

    if (!res) return;

    let channel: TextChannel | null = null;
    try {
      const fetchedChannel = await member.client.channels.fetch(res.channel as string);
      if (fetchedChannel?.isTextBased()) {
        channel = fetchedChannel as TextChannel;
      }
    } catch {
      GuildLogger.error(
        res.guildId,
        'Leave message channel could not be fetched. Please configure it again.'
      );
      return;
    }

    if (!channel) {
      GuildLogger.error(
        res.guildId,
        'Leave message channel could not be found. Please configure it again.'
      );
      return;
    }

    if (res.messageType === 'embed') {
      if (!res.embed) return;

      await sendEmbed(channel, res.embed as EmbedData, [['{user}', `<@${member.user.id}>`]]);
      return;
    }

    if (!res.messages) return;

    let messages: string[] = [];
    try {
      messages = Array.isArray(res.messages)
        ? (res.messages as string[])
        : JSON.parse(res.messages as unknown as string);
    } catch {
      GuildLogger.error(res.guildId, 'Could not parse leave messages array.');
      return;
    }

    if (!messages.length) return;

    const messageToSend = res.randomize
      ? messages[Math.floor(Math.random() * messages.length)]!
      : messages[0]!;

    const updatedMessage = messageToSend.replace(/{user}/g, `<@${member.user.id}>`);

    await channel.send({
      content: updatedMessage,
      allowedMentions: { users: [member.user.id] },
    });
  },
});
