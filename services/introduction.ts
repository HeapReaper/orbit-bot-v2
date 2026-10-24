import {
  type Collection,
  EmbedBuilder,
  type GuildMember,
  type Message,
  type PartialGuildMember,
  type TextChannel,
} from 'discord.js';
import { prisma } from '../lib/prisma';
import { getRedisClient } from '../lib/redis';
import { Logging } from '../lib/logging';

interface IntroSettings {
  guild_id: string;
  enabled: boolean;
  channel?: string | null;
  maxMessages: number;
  messageType: string;
  embed: any;
  autoReply?: string | null;
  autoEmoji?: string | null;
  autoDelete: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function handleIntroCreate(message: Message) {
  if (!message.guild || message.author.bot) return;

  const settings = await getIntroSettings(message.guild.id);

  if (!settings || !settings.enabled) return;

  // Without a configured channel there is nothing to police. The previous
  // version fell back to "whatever channel this message is in", which meant
  // every message anywhere in the guild triggered a 100-message history fetch.
  if (!settings.channel) return;
  if (message.channel.id !== settings.channel) return;

  const channelToUse = message.channel as TextChannel;

  const fetchedMessages = await channelToUse.messages.fetch({ limit: 100 });

  const userMessagesCount = fetchedMessages.filter(
    (msg) => msg.author.id === message.author.id
  ).size;

  if (userMessagesCount > settings.maxMessages) {
    await message.delete().catch((error) => {
      Logging.error(`Introduction: could not delete excess introduction: ${error}`);
    });
    // TODO: add notification
    return;
  }

  if (settings.autoEmoji) {
    try {
      await message.react(settings.autoEmoji);
    } catch {
      Logging.warn(`Introduction: invalid emoji in settings: ${settings.autoEmoji}`);
    }
  }

  if (settings.autoReply && settings.messageType === 'text') {
    await message
      .reply({
        content: settings.autoReply.replaceAll('{user}', `<@${message.author.id}>`),
        allowedMentions: { users: [message.author.id] },
      })
      .catch((error) => Logging.error(`Introduction: could not reply: ${error}`));
  }

  if (settings.embed && settings.messageType === 'embed') {
    const embed = new EmbedBuilder();

    if (settings.embed.color)
      embed.setColor(settings.embed.color.replaceAll('{user}', `<@${message.author.id}>`));

    if (settings.embed.title)
      embed.setTitle(settings.embed.title.replaceAll('{user}', `<@${message.author.id}>`));

    if (settings.embed.titleUrl)
      embed.setURL(settings.embed.titleUrl.replaceAll('{user}', `<@${message.author.id}>`));

    if (settings.embed.description)
      embed.setDescription(
        settings.embed.description.replaceAll('{user}', `<@${message.author.id}>`)
      );

    if (settings.embed.author?.name) {
      embed.setAuthor({
        name: settings.embed.author.name,
        iconURL: settings.embed.author.icon || undefined,
      });
    }

    if (settings.embed.thumbnail) embed.setThumbnail(settings.embed.thumbnail);
    if (settings.embed.image) embed.setImage(settings.embed.image);

    if (settings.embed.fields?.length) {
      embed.addFields(
        settings.embed.fields
          .filter((f: { name: any; value: any }) => f.name && f.value)
          .map((f: { name: any; value: any; inline: any }) => ({
            name: f.name,
            value: f.value.replaceAll('{user}', `<@${message.author.id}>`),
            inline: f.inline ?? false,
          }))
      );
    }

    await message
      .reply({ embeds: [embed] })
      .catch((error) => Logging.error(`Introduction: could not reply: ${error}`));
  }
}

export async function handleIntroDelete(guildMember: GuildMember | PartialGuildMember) {
  // A member that just left cannot be fetched anymore (v1 tried, which threw
  // and skipped the cleanup); only its ids are needed here.
  const settings = await getIntroSettings(guildMember.guild.id);
  if (!settings || !settings.enabled || !settings.autoDelete || !settings.channel) return;

  let channel: TextChannel;
  try {
    channel = (await guildMember.client.channels.fetch(settings.channel)) as TextChannel;
  } catch {
    Logging.error(`Introduction: Could not fetch channel ${settings.channel}`);
    return;
  }

  try {
    let lastId: string | undefined = undefined;
    let totalDeleted = 0;

    while (totalDeleted < 10) {
      const messages: Collection<string, Message> = await channel.messages.fetch({
        limit: 100,
        ...(lastId ? { before: lastId } : {}),
        cache: false,
      });
      if (!messages.size) break;

      const userMessages = messages.filter((m) => m.author.id === guildMember.id);

      const botReplies = messages.filter(
        (m) =>
          m.author.id === guildMember.client.user.id &&
          m.reference?.messageId &&
          userMessages.has(m.reference.messageId)
      );

      const toDelete = userMessages.concat(botReplies);

      if (toDelete.size > 0) {
        await channel.bulkDelete(toDelete, true);
        totalDeleted += toDelete.size;
      }

      lastId = messages.last()?.id;
      if (!lastId) break;
    }
  } catch (err) {
    Logging.error(
      `Introduction: Failed to delete messages for ${guildMember.id} in ${channel.id}: ${err}`
    );
  }
}

async function getIntroSettings(guildId: string): Promise<IntroSettings | null> {
  const cacheKey = `intro_settings:${guildId}`;

  // Try settings in cache first
  let settings: IntroSettings | null = null;
  const redis = getRedisClient();
  const cached = await redis.get(cacheKey);

  if (cached) {
    settings = JSON.parse(cached) as IntroSettings;
  } else {
    // Fetch from DB if not in cache
    settings = (await prisma.introductionSettings.findUnique({
      where: { guildId },
    })) as IntroSettings | null;

    // Cache in Redis for 3 minutes
    if (settings) {
      await redis.set(cacheKey, JSON.stringify(settings), 'EX', 180);
    }
  }
  return settings;
}
