import { Events, type GuildMember, type Message, type TextChannel } from 'discord.js';
import { defineEvent, type EmbedData } from '../../types';
import { prisma } from '../../lib/prisma';
import { GuildLogger } from '../../lib/guildLog';
import { sendEmbed } from '../../lib/sendEmbed';

async function memberAdd(member: GuildMember) {
  const res = await prisma.welcomeMessageSettings.findFirst({
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
      'Welcome message channel could not be fetched. Please configure it again.'
    );
    return;
  }

  if (!channel) {
    GuildLogger.error(
      res.guildId,
      'Welcome message channel could not be found. Please configure it again.'
    );
    return;
  }

  let sentMessage: Message;

  if (res.messageType === 'embed') {
    if (!res.embed) return;

    sentMessage = await sendEmbed(channel, res.embed as EmbedData, [
      ['{user}', `<@${member.user.id}>`],
    ]);
  } else {
    if (!res.messages) return;

    let messages: string[] = [];
    try {
      messages = Array.isArray(res.messages)
        ? (res.messages as string[])
        : JSON.parse(res.messages as unknown as string);
    } catch {
      GuildLogger.error(res.guildId, 'Could not parse welcome messages array.');
      return;
    }

    if (!messages.length) return;

    const randomIndex = Math.floor(Math.random() * messages.length);
    const messageToSend = messages[randomIndex]!;

    const updatedMessage = messageToSend.replace(/{user}/g, `<@${member.user.id}>`);

    // The template is guild-configured; only the joining member may be pinged
    // by it, never @everyone or an arbitrary role.
    sentMessage = await channel.send({
      content: updatedMessage,
      allowedMentions: { users: [member.user.id] },
    });
  }

  await prisma.welcomeMessagesSended.create({
    data: {
      guildId: member.guild.id,
      userId: member.user.id,
      channelId: channel.id,
      messageId: sentMessage.id,
    },
  });
}

/** Posts the configured welcome message and remembers it, so it can be removed later. */
export default defineEvent({
  name: Events.GuildMemberAdd,
  async execute(member) {
    const freshMember = await member.fetch(true);
    await memberAdd(freshMember);
  },
});
